// Agent A12 "Risiko": reviews the risk register against the project's state
// and proposes new risks and new assessments of open ones, each with its
// reason. The Projektleitung accepts what fits; nothing is stored before
// (architecture §3, principle 2). The engine supplies the facts (riskTriggers).

import {
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  RISK_PROPOSALS_MAX,
  RISK_SCORE_HIGH,
  checkReviewRisks,
  openRisks,
  riskLabel,
  riskScore,
  riskTriggers,
  similarOpenRisk,
  titlesSimilar,
  type Finding,
  type Level,
  type Producer,
  type ProjectRole,
  type RiskStatus,
  type RiskTrigger,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { HttpError, assertCheck } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import {
  AiProviderError,
  USER_FACING_REASON,
  type AiProvider,
  type ProposedReassessment,
  type ProposedRisk,
  type Usage,
} from "./provider";
import { projectContext, recordAiRun, type Logger } from "./runner";

export interface RiskProposal extends ProposedRisk {
  /** Deterministic checks: a similar open risk, a high risk without a measure. */
  findings: Finding[];
}

export interface ReassessmentProposal extends ProposedReassessment {
  riskId: string;
  title: string;
  current: {
    probability: Level;
    impact: Level;
    status: RiskStatus;
    ownerRole: ProjectRole;
    mitigation: string;
  };
}

export interface RiskReviewResult {
  newRisks: RiskProposal[];
  reassessments: ReassessmentProposal[];
  /** The facts the agent reviewed. */
  triggers: RiskTrigger[];
  producer: Producer;
}

const hint = (text: string): Finding => ({ severity: "hinweis", source: "checkliste", text });

export class RiskAgent {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async review(code: string, ctx: RequestContext): Promise<RiskReviewResult> {
    const model = this.projects.model;
    const s = await this.projects.requireProject(code, ctx.viewer);
    assertCheck(checkReviewRisks(s, model, ctx.viewer));
    const agent = model.agent("A12");
    const info = this.provider.info;
    const triggers = riskTriggers(s, model, this.now());
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: "completed" | "failed", findings: number) =>
      recordAiRun(this.log, info, {
        runId,
        projectId: s.projectId,
        skillId: "risiko.pruefung",
        agent: agent.id,
        outcome,
        findings,
        durationMs: Date.now() - started,
        usage,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
      });

    let result: RiskReviewResult;
    try {
      const answer = await this.provider.reviewRisks({
        agent,
        project: projectContext(s, model, ctx.viewer),
        triggers,
        roles: PROJECT_ROLES.map((id) => ({ id, label: PROJECT_ROLE_LABELS[id] })),
        max: RISK_PROPOSALS_MAX,
      });
      if (answer.usage) usage = answer.usage;
      const { review } = answer;
      const open = new Map(openRisks(s).map((r) => [riskLabel(r.number), r]));

      const newRisks: RiskProposal[] = [];
      for (const p of review.newRisks) {
        const title = p.title.trim();
        if (title.length < 4 || newRisks.some((x) => titlesSimilar(x.title, title))) continue;
        const findings: Finding[] = [];
        const similar = similarOpenRisk(s, title);
        if (similar) {
          findings.push(
            hint(
              `Ähnlich wie ${riskLabel(similar.number)} «${similar.title}»: prüfen, ob es dasselbe Risiko ist.`,
            ),
          );
        }
        if (riskScore(p.probability, p.impact) >= RISK_SCORE_HIGH && !p.mitigation.trim()) {
          findings.push(hint("Hohes Risiko ohne Massnahme: bitte eine Massnahme ergänzen."));
        }
        newRisks.push({ ...p, title, findings });
        if (newRisks.length === RISK_PROPOSALS_MAX) break;
      }

      const reassessments: ReassessmentProposal[] = [];
      for (const p of review.reassessments) {
        const r = open.get(p.risk.trim().toUpperCase());
        if (!r || reassessments.some((x) => x.riskId === r.id)) continue;
        const mitigation = p.mitigation.trim();
        const unchanged =
          p.probability === r.probability &&
          p.impact === r.impact &&
          (!mitigation || mitigation === r.mitigation);
        if (unchanged) continue;
        reassessments.push({
          ...p,
          risk: riskLabel(r.number),
          mitigation,
          riskId: r.id,
          title: r.title,
          current: {
            probability: r.probability,
            impact: r.impact,
            status: r.status,
            ownerRole: r.ownerRole,
            mitigation: r.mitigation,
          },
        });
        if (reassessments.length === RISK_PROPOSALS_MAX) break;
      }
      result = {
        newRisks,
        reassessments,
        triggers,
        producer: { kind: "ai", agent: agent.id, provider: info.provider, model: info.model },
      };
    } catch (err) {
      this.log.error({ err, runId, projectId: s.projectId }, "risk review failed");
      record("failed", 0);
      const reason = err instanceof AiProviderError ? USER_FACING_REASON[err.reason] : "Unerwarteter Fehler";
      throw new HttpError(
        503,
        "ai_unavailable",
        `${reason}. Risiken kannst du auch ohne den Agenten erfassen.`,
      );
    }
    record(
      "completed",
      result.newRisks.reduce((n, x) => n + x.findings.length, 0),
    );
    return result;
  }
}
