// Status report (HERMES «Projektstatusbericht», prototype renderReports): the
// engine suggests a colour per criterion from the project's data, with the
// reasons; the project lead decides and publishes; the Projektausschuss takes
// note. Deterministic: the agent only drafts the texts.

import type { HermesModel } from "../model";
import { RISK_SCORE_HIGH } from "../model/risks";
import { PROJECT_ROLE_LABELS } from "../model/roles";
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
import type { StatusEntry } from "./events";
import { openParticipation } from "./participation";
import { openRisks, riskLabel, riskScore } from "./risks";
import type { ProjectState, StatusReportState } from "./state";
import { gateStatus, isFinished, isPhaseCurrent, mandatoryProgress, missingRoles } from "./status";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK: Readonly<Record<Ampel, number>> = { gruen: 0, gelb: 1, rot: 2 };

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
  /** Why, in German; at least one line. */
  reasons: string[];
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
  const result = (ampel: Ampel, reasons: string[], ok: string): StatusSuggestion => ({
    ampel,
    reasons: reasons.length ? reasons : [ok],
  });

  // Termine
  const termine: [Ampel, string][] = [];
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
  const kosten: [Ampel, string][] = [];
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
  const personal: [Ampel, string][] = [];
  const missing = current ? missingRoles(s, model, phase.id) : [];
  if (missing.length) {
    personal.push(["gelb", `Unbesetzt: ${missing.map((r) => PROJECT_ROLE_LABELS[r]).join(", ")}.`]);
  }
  const involve = current ? openParticipation(s, model, phase.id) : [];
  if (involve.length) {
    personal.push(["gelb", `Noch nicht einbezogen: ${involve.map((p) => p.label).join(", ")}.`]);
  }

  // Ergebnisse
  const ergebnisse: [Ampel, string][] = [];
  if (gate === "blocked") ergebnisse.push(["rot", "Ein Veto-Entscheid zu einem Pflichtergebnis ist offen."]);
  for (const sk of current ? phase.skills : []) {
    const st = s.skills[sk.id];
    if (st?.lastRejection && !st.output) {
      ergebnisse.push(["gelb", `«${sk.outputDoc}» wurde zurückgewiesen und muss neu erstellt werden.`]);
    }
  }
  const progress = mandatoryProgress(s, model, s.phase);

  // Ziele
  const ziele: [Ampel, string][] = [];
  const crs = openChangeRequests(s);
  if (crs.length) {
    ziele.push([
      "gelb",
      `${plural(crs.length, "Change Request wartet", "Change Requests warten")} auf den Entscheid; der Umfang kann sich ändern.`,
    ]);
  }

  // Risiken
  const risiken: [Ampel, string][] = [];
  for (const r of openRisks(s)) {
    const score = riskScore(r.probability, r.impact);
    if (score < RISK_SCORE_HIGH) continue;
    const name = `${riskLabel(r.number)} «${r.title}»`;
    if (score === 9) risiken.push(["rot", `${name}: Eintritt und Auswirkung hoch.`]);
    else if (!r.mitigation) risiken.push(["rot", `${name}: hohes Risiko ohne Massnahme.`]);
    else
      risiken.push([
        "gelb",
        `${name}: hohes Risiko, Massnahme ${r.status === "offen" ? "festgelegt" : "in Bearbeitung"}.`,
      ]);
  }

  const pick = (list: [Ampel, string][], ok: string) =>
    result(
      overallAmpel(list.map(([a]) => a)),
      list.map(([, text]) => text),
      ok,
    );
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
export function reportAwaitingAcknowledgement(s: ProjectState): StatusReportState | undefined {
  const latest = latestStatusReport(s);
  return latest && latest.acknowledgements.length === 0 ? latest : undefined;
}

export const ampelLabel = (a: Ampel) => AMPEL_LABELS[a].label;

/** «Termine Gelb, Kosten Rot»: the criteria that are not green. */
export function nonGreenSummary(criteria: Record<StatusCriterion, { ampel: Ampel }>): string {
  return STATUS_CRITERIA.filter((c) => criteria[c.id].ampel !== "gruen")
    .map((c) => `${c.label} ${ampelLabel(criteria[c.id].ampel)}`)
    .join(", ");
}
