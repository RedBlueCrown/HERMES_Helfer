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
  type Producer,
  type ReassessmentProposal,
  type RiskProposal,
  type RiskReviewResult,
  type RiskTrigger,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { assertCheck } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import {
  addUsage,
  failedUsage,
  type AiProvider,
  type ProjectContext,
  type RiskReview,
  type Usage,
} from "./provider";
import type { ProposalStore } from "./proposals";
import {
  CONFIDENTIAL_SUMMARY,
  agentFailure,
  callFor,
  closedByPerson,
  projectContext,
  recordAiRun,
  type AiRunRecord,
  type Logger,
} from "./runner";

/** What the server keeps of a review until the PL accepts items of it (proposals.ts). */
export interface RiskReviewContent {
  newRisks: RiskProposal[];
  reassessments: ReassessmentProposal[];
  /** The facts the review rested on: an accepted item keeps its fact in the record. */
  triggers: RiskTrigger[];
}

/**
 * What a proposal may rest on: the engine's facts, and the released results
 * whose content the agent sees (a result known by name only grounds nothing).
 * A proposal naming anything else is dropped (review F8).
 */
export function reviewGrounds(facts: readonly RiskTrigger[], context: ProjectContext): RiskTrigger[] {
  const readable = context.releasedResults.filter((r) => r.summary !== CONFIDENTIAL_SUMMARY);
  if (!readable.length) return [...facts];
  const names = readable.map((r) => `«${r.name}»`).join(", ");
  return [...facts, { id: "ergebnisse", text: `Freigegebene Ergebnisse: ${names}.` }];
}

const hint = (text: string): Finding => ({ severity: "hinweis", source: "checkliste", text });

export class RiskAgent {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
    private readonly proposals: ProposalStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async review(code: string, ctx: RequestContext): Promise<RiskReviewResult> {
    const model = this.projects.model;
    const s = await this.projects.requireProject(code, ctx.viewer);
    assertCheck(checkReviewRisks(s, model, ctx.viewer));
    const agent = model.agent("A12");
    const info = this.provider.info;
    const context = projectContext(s, model, ctx.viewer);
    const triggers = reviewGrounds(riskTriggers(s, model, this.now()), context);
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: AiRunRecord["outcome"], findings: number) =>
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
      // Without a fact to rest on there is nothing to propose, and no model call.
      let review: RiskReview = { newRisks: [], reassessments: [] };
      if (triggers.length) {
        const answer = await this.provider.reviewRisks(
          {
            agent,
            project: context,
            triggers,
            roles: PROJECT_ROLES.map((id) => ({ id, label: PROJECT_ROLE_LABELS[id] })),
            max: RISK_PROPOSALS_MAX,
          },
          callFor(ctx),
        );
        if (answer.usage) usage = answer.usage;
        review = answer.review;
      }
      const open = new Map(openRisks(s).map((r) => [riskLabel(r.number), r]));
      // Grounding: a proposal names one of the supplied facts; others are dropped.
      const grounds = new Set(triggers.map((t) => t.id));

      const newRisks: RiskProposal[] = [];
      for (const p of review.newRisks) {
        const title = p.title.trim();
        if (!grounds.has(p.trigger)) continue;
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
        if (!r || !grounds.has(p.trigger) || reassessments.some((x) => x.riskId === r.id)) continue;
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
            version: r.history.length,
          },
        });
        if (reassessments.length === RISK_PROPOSALS_MAX) break;
      }
      const producer: Producer = {
        kind: "ai",
        agent: agent.id,
        provider: info.provider,
        model: info.model,
        runId,
      };
      const proposalId = this.proposals.put<RiskReviewContent>({
        kind: "risk-review",
        projectId: s.projectId,
        userId: ctx.viewer.userId,
        producer,
        content: { newRisks, reassessments, triggers },
      });
      result = { proposalId, newRisks, reassessments, triggers, producer };
    } catch (err) {
      usage = addUsage(usage, failedUsage(err));
      record(closedByPerson(err) ? "aborted" : "failed", 0);
      throw agentFailure(
        this.log,
        err,
        { runId, projectId: s.projectId },
        "risk review",
        "Risiken kannst du auch ohne den Agenten erfassen.",
      );
    }
    record(
      "completed",
      result.newRisks.reduce((n, x) => n + x.findings.length, 0),
    );
    return result;
  }
}
