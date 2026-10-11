// Status report (HERMES «Projektstatusbericht», prototype renderReports): the
// engine suggests a colour per criterion from the project's data, with the
// reasons; the project lead decides and publishes; the Projektausschuss takes
// note. Deterministic: the agent only drafts the texts.

import type { HermesModel } from "../model";
import { RISK_SCORE_HIGH } from "../model/risks";
import {
  AMPEL_LABELS,
  STATUS_CRITERIA,
  STATUS_REPORT_INTERVAL_DAYS,
  type Ampel,
  type StatusCriterion,
} from "../model/status-report";
import {
  crCostChf,
  crLabel,
  formatChf,
  openChangeRequests,
  openRechecks,
  reserveStatus,
} from "./change-requests";
import { isConditionOverdue } from "./conditions";
import { MIN_REASON, MIN_SUMMARY } from "./decisions";
import { fingerprint } from "./fingerprint";
import type { StatusEntry } from "./events";
import { openParticipation } from "./participation";
import { openRisks, riskLabel, riskScore } from "./risks";
import type { ProjectState, StatusReportState } from "./state";
import {
  gateStatus,
  isFinished,
  isPhaseCurrent,
  mandatoryProgress,
  missingRoleDetails,
  missingRoleText,
} from "./status";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK: Readonly<Record<Ampel, number>> = { gruen: 0, gelb: 1, rot: 2 };

/** What the project lead enters per criterion. */
export interface StatusEntryInput {
  ampel: Ampel;
  problem: string;
  measure: string;
  /** Required for a colour better than suggested; never drafted by the agent. */
  deviationReason?: string;
}

/** The colour is better than the engine suggested. */
export const betterThanSuggested = (ampel: Ampel, suggested: Ampel) => RANK[ampel] < RANK[suggested];

/**
 * The project lead's report against the engine's suggestion; a message for the
 * person, or null. Yellow and red need a problem and a measure; a colour better
 * than the suggestion needs the project lead's own reason.
 */
export function validateStatusReport(
  input: { overview: string; criteria: Record<StatusCriterion, StatusEntryInput> },
  suggestion: Record<StatusCriterion, StatusSuggestion>,
): string | null {
  for (const c of STATUS_CRITERIA) {
    const e = input.criteria[c.id];
    if (
      e.ampel !== "gruen" &&
      (e.problem.trim().length < MIN_REASON || e.measure.trim().length < MIN_REASON)
    ) {
      return `«${c.label}» ist ${AMPEL_LABELS[e.ampel].label}: Bitte Problem und Massnahme nennen.`;
    }
    const suggested = suggestion[c.id].ampel;
    if (betterThanSuggested(e.ampel, suggested) && (e.deviationReason ?? "").trim().length < MIN_REASON) {
      return `«${c.label}»: Bitte begründen, warum die Lage besser ist als vorgeschlagen (Vorschlag ${AMPEL_LABELS[suggested].label}).`;
    }
  }
  if (input.overview.trim().length < MIN_SUMMARY) {
    return `Bitte den Stand kurz zusammenfassen (Übersicht, mindestens ${MIN_SUMMARY} Zeichen).`;
  }
  return null;
}

/** Red if one criterion is red, yellow if one is yellow, else green. */
export function overallAmpel(colours: Iterable<Ampel>): Ampel {
  let worst: Ampel = "gruen";
  for (const a of colours) if (RANK[a] > RANK[worst]) worst = a;
  return worst;
}

export const reportOverall = (r: Pick<StatusReportState, "criteria">) =>
  overallAmpel(Object.values(r.criteria).map((c: StatusEntry) => c.ampel));

export const reportTitle = (number: number) => `Statusbericht ${number}`;

export interface StatusSuggestion {
  ampel: Ampel;
  /** Why, in German, as people see it; at least one line. */
  reasons: string[];
  /**
   * The same reasons for an agent: the engine's fact without text people typed
   * (risk titles), which comes separately as a quote (architecture §3, principle 7).
   */
  facts: StatusFact[];
}

export interface StatusFact {
  text: string;
  quotes: string[];
}

/** One line of a suggestion: the colour, the text people see, and for the agents the fact without quotes. */
type Line = [Ampel, string, StatusFact?];

/**
 * What a report stores per criterion: problem and measure for yellow and red,
 * the project lead's reason for a colour better than suggested, and the
 * engine's suggestion with its reasons.
 */
export function reportEntry(input: StatusEntryInput, suggestion: StatusSuggestion): StatusEntry {
  const green = input.ampel === "gruen";
  return {
    ampel: input.ampel,
    suggested: suggestion.ampel,
    reasons: suggestion.reasons,
    problem: green ? "" : input.problem.trim(),
    measure: green ? "" : input.measure.trim(),
    ...(betterThanSuggested(input.ampel, suggestion.ampel)
      ? { deviationReason: (input.deviationReason ?? "").trim() }
      : {}),
  };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * A colour per criterion from the project's data, with the reasons. The
 * project lead may choose another colour; the report keeps both.
 */
export function suggestStatus(
  s: ProjectState,
  model: HermesModel,
  now: Date,
): Record<StatusCriterion, StatusSuggestion> {
  const phase = model.phase(s.phase);
  const current = isPhaseCurrent(s, phase.id);
  const gate = current ? gateStatus(s, model, phase.id) : "passed";
  const rejected = current && s.gateDecisions[phase.id]?.at(-1)?.decision === "zurückgewiesen";
  const overdue = Object.values(s.conditions).filter(
    (c) => !c.doneAt && isConditionOverdue(s, model, c, now),
  );
  const rechecks = openRechecks(s);
  const idleDays = Math.floor((now.getTime() - Date.parse(s.updatedAt)) / DAY_MS);
  const result = (ampel: Ampel, lines: Line[], ok: string): StatusSuggestion =>
    lines.length
      ? {
          ampel,
          reasons: lines.map(([, text]) => text),
          facts: lines.map(([, text, fact]) => fact ?? { text, quotes: [] }),
        }
      : { ampel, reasons: [ok], facts: [{ text: ok, quotes: [] }] };

  // Termine
  const termine: Line[] = [];
  if (rejected)
    termine.push(["rot", `Das Gate «${phase.gate.name}» wurde zurückgewiesen; Nacharbeit nötig.`]);
  if (gate === "blocked") termine.push(["rot", `Ein Veto blockiert das Gate «${phase.gate.name}».`]);
  if (overdue.length)
    termine.push(["gelb", `${plural(overdue.length, "Auflage ist", "Auflagen sind")} überfällig.`]);
  for (const cr of rechecks) {
    termine.push(["gelb", `Die Neuprüfung nach ${crLabel(cr.number)} hält das Gate.`]);
  }
  if (idleDays >= 30) termine.push(["gelb", `Seit ${idleDays} Tagen kein Eintrag in der Projektakte.`]);

  // Kosten
  const kosten: Line[] = [];
  const reserve = reserveStatus(s);
  const openCost = openChangeRequests(s).reduce((n, c) => n + crCostChf(c.effortDays, c.dayRateChf), 0);
  if (reserve.remainingChf !== undefined && reserve.remainingChf < 0) {
    kosten.push([
      "rot",
      `Die angenommenen Change Requests übersteigen die Reserve um ${formatChf(-reserve.remainingChf)}.`,
    ]);
  } else if (reserve.reserveChf === undefined && reserve.usedChf > 0) {
    kosten.push(["gelb", `Mehrkosten von ${formatChf(reserve.usedChf)} ohne erfasste Reserve.`]);
  }
  if (openCost > 0 && reserve.remainingChf !== undefined && openCost > Math.max(0, reserve.remainingChf)) {
    kosten.push([
      "gelb",
      `Offene Change Requests (${formatChf(openCost)}) übersteigen die verbleibende Reserve.`,
    ]);
  }

  // Personalaufwand
  const personal: Line[] = [];
  const missing = current ? missingRoleDetails(s, model, phase.id) : [];
  if (missing.length) {
    personal.push(["gelb", `Für offene Entscheide fehlt: ${missing.map(missingRoleText).join("; ")}.`]);
  }
  const involve = current ? openParticipation(s, model, phase.id) : [];
  if (involve.length) {
    personal.push(["gelb", `Noch nicht einbezogen: ${involve.map((p) => p.label).join(", ")}.`]);
  }

  // Ergebnisse
  const ergebnisse: Line[] = [];
  if (gate === "blocked") ergebnisse.push(["rot", "Ein Veto-Entscheid zu einem Pflichtergebnis ist offen."]);
  for (const sk of current ? phase.skills : []) {
    const st = s.skills[sk.id];
    if (st?.lastRejection && !st.output) {
      ergebnisse.push(["gelb", `«${sk.outputDoc}» wurde zurückgewiesen und muss neu erstellt werden.`]);
    }
  }
  const progress = mandatoryProgress(s, model, s.phase);

  // Ziele
  const ziele: Line[] = [];
  const crs = openChangeRequests(s);
  if (crs.length) {
    ziele.push([
      "gelb",
      `${plural(crs.length, "Change Request wartet", "Change Requests warten")} auf den Entscheid; der Umfang kann sich ändern.`,
    ]);
  }

  // Risiken
  const risiken: Line[] = [];
  for (const r of openRisks(s)) {
    const score = riskScore(r.probability, r.impact);
    if (score < RISK_SCORE_HIGH) continue;
    // The title is text people typed: the agents get it as a quote next to the fact.
    const label = riskLabel(r.number);
    const line = (ampel: Ampel, what: string): Line => [
      ampel,
      `${label} «${r.title}»: ${what}`,
      { text: `${label}: ${what}`, quotes: [r.title] },
    ];
    if (score === 9) risiken.push(line("rot", "Eintritt und Auswirkung hoch."));
    else if (!r.mitigation) risiken.push(line("rot", "hohes Risiko ohne Massnahme."));
    else
      risiken.push(
        line("gelb", `hohes Risiko, Massnahme ${r.status === "offen" ? "festgelegt" : "in Bearbeitung"}.`),
      );
  }

  const pick = (list: Line[], ok: string) => result(overallAmpel(list.map(([a]) => a)), list, ok);
  return {
    termine: pick(termine, "Keine Verzögerung erkennbar."),
    kosten: pick(
      kosten,
      reserve.reserveChf === undefined
        ? "Keine Mehrkosten aus Change Requests."
        : `Reserve verbleibend: ${formatChf(reserve.remainingChf ?? 0)}.`,
    ),
    personal: pick(personal, "Alle nötigen Rollen und Beteiligten sind dabei."),
    ergebnisse: pick(ergebnisse, `${progress.done} von ${progress.total} Pflichtergebnissen freigegeben.`),
    ziele: pick(ziele, "Keine offenen Änderungen am Umfang."),
    risiken: pick(risiken, "Keine hohen Risiken offen."),
  };
}

/** Reports, newest first. */
export function statusReports(s: ProjectState): StatusReportState[] {
  return Object.values(s.statusReports).sort((a, b) => b.number - a.number);
}

export const latestStatusReport = (s: ProjectState): StatusReportState | undefined => statusReports(s)[0];

export const nextStatusReportNumber = (s: ProjectState) =>
  Object.values(s.statusReports).reduce((n, r) => Math.max(n, r.number), 0) + 1;

/** When the next report is due: the interval after the last one, or after the project started. */
export function statusReportDueAt(lastReportAt: string | undefined, createdAt: string): string {
  return new Date(Date.parse(lastReportAt ?? createdAt) + STATUS_REPORT_INTERVAL_DAYS * DAY_MS).toISOString();
}

export function isStatusReportDue(s: ProjectState, model: HermesModel, now: Date): boolean {
  if (isFinished(s, model)) return false;
  return now.getTime() >= Date.parse(statusReportDueAt(latestStatusReport(s)?.publishedAt, s.createdAt));
}

/** The latest report, if no member of the Projektausschuss took note of it yet. */
/**
 * Reports the Projektausschuss has to take note of, newest first: the latest
 * one, and every red one, also when a newer report followed it. A red report
 * cannot disappear unseen behind a greener one.
 */
export function reportsAwaitingAcknowledgement(s: ProjectState): StatusReportState[] {
  const latest = latestStatusReport(s);
  return statusReports(s).filter(
    (r) => r.acknowledgements.length === 0 && (r === latest || reportOverall(r) === "rot"),
  );
}

/** What publishing a report names: the suggestion the project lead saw. */
export const suggestionVersion = (suggestion: Record<StatusCriterion, StatusSuggestion>) =>
  fingerprint(STATUS_CRITERIA.map((c) => [suggestion[c.id].ampel, suggestion[c.id].reasons]));

/** Criteria of a report the project lead judged better than the engine suggested. */
export const deviatingCriteria = (r: Pick<StatusReportState, "criteria">) =>
  STATUS_CRITERIA.filter((c) => betterThanSuggested(r.criteria[c.id].ampel, r.criteria[c.id].suggested));

export const ampelLabel = (a: Ampel) => AMPEL_LABELS[a].label;

/** «Termine Gelb, Kosten Rot»: the criteria that are not green. */
export function nonGreenSummary(criteria: Record<StatusCriterion, { ampel: Ampel }>): string {
  return STATUS_CRITERIA.filter((c) => criteria[c.id].ampel !== "gruen")
    .map((c) => `${c.label} ${ampelLabel(criteria[c.id].ampel)}`)
    .join(", ");
}
