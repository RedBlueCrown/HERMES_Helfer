// Agent runs: a person requests a draft, the agent of the skill writes it, the
// Kritiker checks it, the result lands in the project stream as a draft.
// Pilot: runs execute in-process. Increment 2: durable queue (todo-later H02).

import {
  canViewSkillContent,
  checkStartSkill,
  deliverableStatus,
  type Actor,
  type AgentDef,
  type Finding,
  type HermesModel,
  type ProjectEvent,
  type ProjectState,
  type SkillDef,
  type Viewer,
} from "@hermes-helfer/core";
import { metrics } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { HttpError, assertCheck, notFound } from "../errors";
import type { ProjectRepository } from "../projects/repository";
import { PROJECT_NOT_FOUND, actorFor, type ProjectService, type RequestContext } from "../projects/service";
import { checkDraftStructure, mergeFindings } from "./kritiker";
import { AiProviderError, USER_FACING_REASON, type AiProvider, type ProjectContext } from "./provider";

// No-op unless telemetry is on (telemetry.ts).
const meter = metrics.getMeter("hermes-helfer");
const RUN_DURATION = meter.createHistogram("hh.ai_run.duration", {
  unit: "ms",
  description: "Duration of agent runs",
});
const RUN_TOKENS = meter.createCounter("hh.ai_run.tokens", {
  unit: "{token}",
  description: "Model tokens used by agent runs",
});

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export const SYSTEM_ACTOR: Actor = { userId: "system", displayName: "System", roles: [], channel: "system" };

export const agentActor = (agent: AgentDef): Actor => ({
  userId: `agent:${agent.id}`,
  displayName: `Agent ${agent.name}`,
  roles: [],
  channel: "agent",
});

/** Background for a draft: released results the requester may read. */
export function projectContext(s: ProjectState, model: HermesModel, viewer: Viewer): ProjectContext {
  const released: { name: string; summary: string; at: string }[] = [];
  for (const ph of model.phases) {
    for (const d of ph.deliverables) {
      if (deliverableStatus(s, model, d) !== "done") continue;
      for (const sid of d.skills) {
        const out = s.skills[sid]?.output;
        if (!out || !canViewSkillContent(s, model, viewer, model.skill(sid))) continue;
        released.push({
          name: model.skill(sid).outputDoc,
          summary: out.draft.summary.slice(0, 600),
          at: out.createdAt,
        });
      }
    }
  }
  return {
    code: s.code,
    name: s.name,
    description: s.description,
    phase: s.phase,
    phaseLabel: model.phase(s.phase).label,
    profile: s.profile,
    releasedResults: released
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 15)
      .map(({ name, summary }) => ({ name, summary })),
  };
}

export class RunService {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly repo: ProjectRepository,
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
  ) {}

  private get model() {
    return this.repo.model;
  }

  async start(code: string, ctx: RequestContext, skillId: string): Promise<{ runId: string }> {
    const skill = this.model.findSkill(skillId);
    if (!skill) throw notFound("Diesen Schritt gibt es nicht.");
    if (skill.mode === "manual" || !skill.agent) {
      throw new HttpError(409, "invalid_state", `«${skill.name}» erfasst die zuständige Person selbst.`);
    }
    const { projectId } = await this.projects.requireProject(code, ctx.viewer);
    const runId = randomUUID();
    const snapshot = await this.repo.withLock(projectId, async () => {
      const s = await this.repo.get(projectId);
      if (!s) throw notFound(PROJECT_NOT_FOUND);
      assertCheck(checkStartSkill(s, this.model, ctx.viewer, skill));
      await this.repo.append(
        projectId,
        s.lastSeq,
        [{ type: "SkillRunRequested", data: { runId, skillId } }],
        actorFor(s, ctx),
        ctx.correlationId,
      );
      return (await this.repo.get(projectId))!;
    });
    const job = this.execute(projectId, runId, skill, snapshot, ctx).catch((err: unknown) => {
      this.log.error({ err, runId, projectId }, "agent run crashed");
    });
    this.inFlight.add(job);
    void job.finally(() => this.inFlight.delete(job));
    return { runId };
  }

  private async execute(
    projectId: string,
    runId: string,
    skill: SkillDef,
    s: ProjectState,
    ctx: RequestContext,
  ): Promise<void> {
    const started = Date.now();
    const agent = this.model.agent(skill.agent!);
    const deliverables = this.model.deliverablesOfSkill(skill.id);
    const info = this.provider.info;
    let event: ProjectEvent;
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const drafted = await this.provider.draft({
        agent,
        skill,
        deliverables,
        project: projectContext(s, this.model, ctx.viewer),
      });
      if (drafted.usage) usage = drafted.usage;
      let content: Finding[];
      try {
        const critique = await this.provider.critique({ skill, deliverables, draft: drafted.draft });
        content = critique.findings;
        if (critique.usage) {
          usage = {
            inputTokens: usage.inputTokens + critique.usage.inputTokens,
            outputTokens: usage.outputTokens + critique.usage.outputTokens,
          };
        }
      } catch (err) {
        this.log.warn({ err, runId }, "kritiker failed");
        content = [
          {
            severity: "hinweis",
            source: "kritiker",
            text: "Die inhaltliche Prüfung durch den Kritiker ist fehlgeschlagen. Bitte den Entwurf selbst prüfen.",
          },
        ];
      }
      event = {
        type: "SkillRunCompleted",
        data: {
          runId,
          skillId: skill.id,
          draft: drafted.draft,
          findings: mergeFindings(checkDraftStructure(skill, drafted.draft), content),
          producer: { kind: "ai", agent: agent.id, provider: info.provider, model: info.model },
        },
      };
    } catch (err) {
      const reason = err instanceof AiProviderError ? USER_FACING_REASON[err.reason] : "Unerwarteter Fehler";
      this.log.error({ err, runId, projectId, skillId: skill.id }, "agent run failed");
      event = { type: "SkillRunFailed", data: { runId, skillId: skill.id, reason } };
    }

    await this.repo.withLock(projectId, async () => {
      const cur = await this.repo.get(projectId);
      // Only close runs that are still open (a restart may have closed it already).
      if (cur?.runs[runId]?.status !== "running") return;
      await this.repo.append(projectId, cur.lastSeq, [event], agentActor(agent), ctx.correlationId);
    });

    const outcome = event.type === "SkillRunCompleted" ? "completed" : "failed";
    const durationMs = Date.now() - started;
    // Metrics without people or projects: no per-person evaluation (architecture §9.6).
    const dimensions = { skill: skill.id, agent: agent.id, outcome, model: info.model };
    RUN_DURATION.record(durationMs, dimensions);
    RUN_TOKENS.add(usage.inputTokens, { ...dimensions, direction: "input" });
    RUN_TOKENS.add(usage.outputTokens, { ...dimensions, direction: "output" });

    // Stream 2 of the audit design (architecture §9): metadata only, no content.
    this.log.info(
      {
        type: "ai_run",
        runId,
        projectId,
        skillId: skill.id,
        agent: agent.id,
        provider: info.provider,
        model: info.model,
        region: info.region,
        outcome,
        findings: event.type === "SkillRunCompleted" ? event.data.findings.length : 0,
        durationMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
      },
      "ai_run",
    );
  }

  /** Resolves when no run is in flight (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.allSettled(this.inFlight);
  }

  /**
   * Close runs that were interrupted by a restart (todo-later E10). Assumes one
   * API instance: with several, this would also close runs another instance is
   * still working on (durable run queue, todo-later H02).
   */
  async recover(): Promise<number> {
    let closed = 0;
    for (const s of await this.repo.all()) {
      const open = Object.values(s.runs).filter((r) => r.status === "running");
      if (!open.length) continue;
      await this.repo.withLock(s.projectId, async () => {
        const cur = await this.repo.get(s.projectId);
        if (!cur) return;
        const events: ProjectEvent[] = open
          .filter((r) => cur.runs[r.runId]?.status === "running")
          .map((r) => ({
            type: "SkillRunFailed",
            data: { runId: r.runId, skillId: r.skillId, reason: "Abgebrochen durch Neustart" },
          }));
        if (!events.length) return;
        await this.repo.append(s.projectId, cur.lastSeq, events, SYSTEM_ACTOR, `recover-${randomUUID()}`);
        closed += events.length;
      });
    }
    return closed;
  }
}
