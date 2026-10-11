// Agent A2 (Projektführung & Kommunikation) drafts the texts of a status
// report: overview, outlook, and problem and measure for each criterion that
// is not green. The colours are the project lead's; the engine suggested
// them. The Kritiker reviews the draft. Nothing is stored until the PL
// publishes (architecture §3, principle 2).

import {
  STATUS_CRITERIA,
  checkPublishStatusReport,
  crCostChf,
  formatChf,
  mandatoryProgress,
  openChangeRequests,
  reserveStatus,
  suggestStatus,
  type Ampel,
  type Finding,
  type HermesModel,
  type Producer,
  type ProjectState,
  type StatusCriterion,
  type StatusFigures,
} from "@hermes-helfer/core";
import { randomUUID } from "node:crypto";
import { HttpError, assertCheck } from "../errors";
import type { ProjectService, RequestContext } from "../projects/service";
import { CRITIQUE_BUDGET_MS } from "./change-request-agent";
import { checkStatusReport, mergeFindings, statusReportCritique, type StatusReportTexts } from "./kritiker";
import { AiProviderError, USER_FACING_REASON, type AiProvider, type Usage } from "./provider";
import { projectContext, recordAiRun, type Logger } from "./runner";

/** What the PL has entered so far: the colours and any text. */
export interface StatusReportInputSoFar {
  criteria: Record<StatusCriterion, { ampel: Ampel; problem: string; measure: string }>;
  figures: StatusFigures;
}

export interface StatusReportProposal extends StatusReportTexts {
  /** Deterministic checks and the Kritiker's review; advice for the PL, not stored. */
  findings: Finding[];
  producer: Producer;
}

const add = (a: Usage, b?: Usage): Usage =>
  b ? { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens } : a;

/** The facts a status report rests on, as short German sentences. */
export function statusFacts(s: ProjectState, model: HermesModel, figures: StatusFigures): string[] {
  const progress = mandatoryProgress(s, model, s.phase);
  const reserve = reserveStatus(s);
  const open = openChangeRequests(s);
  const facts = [
    `Phase ${model.phase(s.phase).label}: ${progress.done} von ${progress.total} Pflichtergebnissen freigegeben.`,
    reserve.reserveChf === undefined
      ? "Keine Reserve für Änderungen erfasst."
      : `Reserve für Änderungen ${formatChf(reserve.reserveChf)}, davon verbraucht ${formatChf(reserve.usedChf)}.`,
  ];
  if (open.length) {
    const cost = open.reduce((n, c) => n + crCostChf(c.effortDays, c.dayRateChf), 0);
    facts.push(`${open.length} Change Request(s) offen, zusammen ${formatChf(cost)}.`);
  }
  if (figures.budgetChf !== undefined) {
    facts.push(
      `Budget ${formatChf(figures.budgetChf)}${figures.spentChf !== undefined ? `, verbraucht ${formatChf(figures.spentChf)}` : ""}.`,
    );
  }
  if (figures.progressPct !== undefined)
    facts.push(`Fortschritt gemäss Projektleitung: ${figures.progressPct} %.`);
  if (figures.plannedEnd) {
    facts.push(
      `Geplantes Ende ${figures.plannedEnd}${figures.forecastEnd ? `, Prognose ${figures.forecastEnd}` : ""}.`,
    );
  }
  return facts;
}

export class StatusReportAgent {
  constructor(
    private readonly projects: ProjectService,
    private readonly provider: AiProvider,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async draft(
    code: string,
    ctx: RequestContext,
    input: StatusReportInputSoFar,
  ): Promise<StatusReportProposal> {
    const model = this.projects.model;
    const s = await this.projects.requireProject(code, ctx.viewer);
    assertCheck(checkPublishStatusReport(s, model, ctx.viewer));
    const agent = model.agent("A2");
    const info = this.provider.info;
    const suggestion = suggestStatus(s, model, this.now());
    const colours = Object.fromEntries(
      STATUS_CRITERIA.map((c) => [c.id, input.criteria[c.id].ampel]),
    ) as Record<StatusCriterion, Ampel>;
    const facts = statusFacts(s, model, input.figures);
    const context = projectContext(s, model, ctx.viewer);
    const runId = randomUUID();
    const started = Date.now();
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const record = (outcome: "completed" | "failed", findings: number) =>
      recordAiRun(this.log, info, {
        runId,
        projectId: s.projectId,
        skillId: "statusbericht.entwurf",
        agent: agent.id,
        outcome,
        findings,
        durationMs: Date.now() - started,
        usage,
        requestedBy: ctx.viewer.userId,
        channel: ctx.channel,
        correlationId: ctx.correlationId,
      });

    let proposal: StatusReportProposal;
    try {
      const drafted = await this.provider.draftStatusReport({
        agent,
        project: context,
        criteria: STATUS_CRITERIA.map((c) => ({
          id: c.id,
          label: c.label,
          ampel: colours[c.id],
          reasons: suggestion[c.id].reasons,
          problem: input.criteria[c.id].problem,
          measure: input.criteria[c.id].measure,
        })),
        facts,
      });
      usage = add(usage, drafted.usage);
      // Texts only for criteria that are not green; what the PL wrote stays if the agent left it out.
      const texts: StatusReportTexts = {
        overview: drafted.draft.overview,
        outlook: drafted.draft.outlook,
        criteria: Object.fromEntries(
          STATUS_CRITERIA.filter((c) => colours[c.id] !== "gruen").map((c) => {
            const d = drafted.draft.criteria.find((x) => x.id === c.id);
            const own = input.criteria[c.id];
            return [c.id, { problem: d?.problem || own.problem, measure: d?.measure || own.measure }];
          }),
        ),
      };
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
            statusReportCritique(texts, colours, [
              { name: "Fakten", summary: facts.join(" ") },
              ...context.releasedResults,
            ]),
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
      proposal = {
        ...texts,
        findings: mergeFindings(checkStatusReport(texts, colours), review),
        producer: { kind: "ai", agent: agent.id, provider: info.provider, model: info.model },
      };
    } catch (err) {
      this.log.error({ err, runId, projectId: s.projectId }, "status report draft failed");
      record("failed", 0);
      const reason = err instanceof AiProviderError ? USER_FACING_REASON[err.reason] : "Unerwarteter Fehler";
      throw new HttpError(
        503,
        "ai_unavailable",
        `${reason}. Den Statusbericht kannst du auch ohne den Agenten schreiben.`,
      );
    }
    record("completed", proposal.findings.length);
    return proposal;
  }
}
