// Agent A10 "Change-Request": turns a rough wish into a change request with
// the five sections, and says which areas it touches. The person reviews and
// submits it; the engine computes the impact; the Projektausschuss decides.
// Nothing is stored before the person submits (architecture §3, principle 2).

import {
  CR_FLAGS,
  CR_FLAG_LABELS,
  CR_SECTIONS,
  checkSubmitChangeRequest,
  type CrFlag,
  type DraftContent,
  type Finding,
  type Producer,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { HttpError, assertCheck } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import { changeRequestCritique, checkChangeRequest, mergeFindings } from "./kritiker";
import {
  AiProviderError,
  USER_FACING_REASON,
  type AiProvider,
  type ChangeRequestIdea,
  type Usage,
} from "./provider";
import { projectContext, recordAiRun, type Logger } from "./runner";

export interface ChangeRequestProposal {
  content: DraftContent;
  flags: Record<CrFlag, { value: boolean; reason: string }>;
  /** Deterministic checks and the Kritiker's review; advice for the requester, not stored. */
  findings: Finding[];
  producer: Producer;
}

/**
 * The person waits for the answer, and Azure's ingress ends requests after 240 s:
 * after a slow draft, the Kritiker's model review is left out (todo-later E30).
 */
export const CRITIQUE_BUDGET_MS = 90_000;

const add = (a: Usage, b?: Usage): Usage =>
  b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : a;

export class ChangeRequestAgent {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
  ) {}

  async draft(code: string, ctx: RequestContext, idea: ChangeRequestIdea): Promise<ChangeRequestProposal> {
    const model = this.projects.model;
    const s = await this.projects.requireProject(code, ctx.viewer);
    assertCheck(checkSubmitChangeRequest(s, model, ctx.viewer));
    const agent = model.agent("A10");
    const info = this.provider.info;
    const context = projectContext(s, model, ctx.viewer);
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: "completed" | "failed", findings: number) =>
      recordAiRun(this.log, info, {
        runId,
        projectId: s.projectId,
        skillId: "cr.entwurf",
        agent: agent.id,
        outcome,
        findings,
        durationMs: Date.now() - started,
        usage,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
      });

    let proposal: ChangeRequestProposal;
    try {
      const drafted = await this.provider.draftChangeRequest({
        agent,
        project: context,
        idea,
        sections: CR_SECTIONS,
        flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
      });
      usage = add(usage, drafted.usage);
      const { content, flags } = drafted.draft;
      let review: Finding[];
      if (Date.now() - started > CRITIQUE_BUDGET_MS) {
        review = [
          {
            severity: "hinweis",
            source: "kritiker",
            text: "Das KI-Modell hat lange gebraucht; die inhaltliche Prüfung durch den Kritiker wurde ausgelassen. Bitte den Text selbst prüfen.",
          },
        ];
      } else {
        try {
          const critique = await this.provider.critique(
            changeRequestCritique(content, context.releasedResults),
          );
          usage = add(usage, critique.usage);
          review = critique.findings;
        } catch (err) {
          this.log.warn({ err, runId }, "kritiker failed");
          review = [
            {
              severity: "hinweis",
              source: "kritiker",
              text: "Die inhaltliche Prüfung durch den Kritiker ist fehlgeschlagen. Bitte den Text selbst prüfen.",
            },
          ];
        }
      }
      const values = Object.fromEntries(CR_FLAGS.map((f) => [f, flags[f].value])) as Record<CrFlag, boolean>;
      proposal = {
        content,
        flags,
        findings: mergeFindings(checkChangeRequest(content, values), review),
        producer: { kind: "ai", agent: agent.id, provider: info.provider, model: info.model },
      };
    } catch (err) {
      this.log.error({ err, runId, projectId: s.projectId }, "change request draft failed");
      record("failed", 0);
      const reason = err instanceof AiProviderError ? USER_FACING_REASON[err.reason] : "Unerwarteter Fehler";
      throw new HttpError(
        503,
        "ai_unavailable",
        `${reason}. Du kannst den Change Request auch ohne den Agenten ausfüllen.`,
      );
    }
    record("completed", proposal.findings.length);
    return proposal;
  }
}
