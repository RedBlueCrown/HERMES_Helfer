// Change Requests: the impact estimate in eight dimensions and the recheck of
// the data protection results (prototype: crImpact, openRechecks). Deterministic:
// the engine computes the impact, the Change-Request agent only drafts the text,
// and the Projektausschuss decides.

import type { HermesModel } from "../model";
import type { PhaseId } from "../model/types";
import {
  CR_DAY_RATE_CHF,
  CR_RECHECK_DELIVERABLES,
  CR_RECHECK_RESULTS,
  CR_RECHECK_ROLES,
  type CrFlags,
  type RecheckOutcome,
  type RecheckRole,
} from "../model/change-requests";
import { MIN_REASON, MIN_SUMMARY, MIN_TITLE } from "./decisions";
import type { ChangeRequestState, ChangeRequestStatus, ProjectState } from "./state";

export const CR_STATUS_LABELS: Readonly<Record<ChangeRequestStatus, string>> = {
  offen: "Wartet auf Entscheid",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

export const crLabel = (number: number) => `CR-${String(number).padStart(2, "0")}`;

/** Cost of a request at the rate it was submitted with (new requests: the current rate). */
export const crCostChf = (effortDays: number, dayRateChf: number = CR_DAY_RATE_CHF) =>
  Math.round(effortDays * dayRateChf);

/** Swiss format, e.g. 10'800 CHF. */
export const formatChf = (amount: number) =>
  `${Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'")} CHF`;

export interface ReserveStatus {
  /** From the project order; undefined until the PL records it. */
  reserveChf?: number;
  /** Cost of the accepted requests. */
  usedChf: number;
  remainingChf?: number;
}

export function reserveStatus(s: ProjectState, exceptCrId?: string): ReserveStatus {
  const usedChf = Object.values(s.changeRequests)
    .filter((c) => c.status === "angenommen" && c.id !== exceptCrId)
    .reduce((n, c) => n + crCostChf(c.effortDays, c.dayRateChf), 0);
  return s.changeReserveChf === undefined
    ? { usedChf }
    : { reserveChf: s.changeReserveChf, usedChf, remainingChf: s.changeReserveChf - usedChf };
}

export type ImpactLevel = "niedrig" | "mittel" | "hoch";

export const IMPACT_DIMENSIONS = [
  "budget",
  "termin",
  "architektur",
  "sicherheit",
  "test",
  "schulung",
  "betrieb",
  "abnahme",
] as const;
export type ImpactDimension = (typeof IMPACT_DIMENSIONS)[number];

export interface ImpactRow {
  id: ImpactDimension;
  label: string;
  text: string;
  level: ImpactLevel;
}

export interface ImpactInput {
  effortDays: number;
  flags: CrFlags;
  /** The request's rate; new requests use the current one. */
  dayRateChf?: number;
}

/** What the estimate needs from the project; small, so the web app can preview a new request. */
export interface ImpactContext {
  phase: PhaseId;
  reserve: ReserveStatus;
  /** Results marked not applicable; they are not rechecked. */
  notApplicable?: readonly string[];
}

/** `exceptCrId`: the request itself, so an accepted request is not counted twice against the reserve. */
export function impactContext(s: ProjectState, exceptCrId?: string): ImpactContext {
  return {
    phase: s.phase,
    reserve: reserveStatus(s, exceptCrId),
    notApplicable: Object.keys(s.notApplicable).filter((id) => s.notApplicable[id]),
  };
}

/**
 * The results a recheck covers when a request is accepted now: those of the
 * current and earlier phases, unless marked not applicable. A result of a later
 * phase is written with the change already known.
 */
export function recheckResults(
  model: HermesModel,
  phase: PhaseId,
  notApplicable: readonly string[] = [],
): string[] {
  const current = model.phaseIndex(phase);
  return CR_RECHECK_DELIVERABLES.filter(
    (id) => !notApplicable.includes(id) && model.phaseIndex(model.deliverable(id).phase) <= current,
  );
}

/** «SchuBAn und Datenschutz-Vorabklärung»: the short names of recheck results, for texts. */
export function recheckNames(ids: readonly string[]): string {
  const names = CR_RECHECK_RESULTS.filter((r) => ids.includes(r.id)).map((r) => r.short);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : (names[0] ?? "");
}

/** The results of a request's recheck, as fixed at the decision. */
export const recheckDeliverablesOf = (cr: ChangeRequestState): readonly string[] =>
  cr.recheckDeliverables ?? CR_RECHECK_DELIVERABLES;

/**
 * The impact of a request on budget, schedule, architecture, security, testing,
 * training, operations and acceptance.
 */
export function changeImpact(input: ImpactInput, ctx: ImpactContext, model: HermesModel): ImpactRow[] {
  const { flags, effortDays } = input;
  const { reserve } = ctx;
  const cost = crCostChf(effortDays, input.dayRateChf);
  const overReserve = reserve.remainingChf === undefined || cost > reserve.remainingChf;
  const days = Math.ceil(effortDays / 3);
  const late = model.phaseIndex(ctx.phase) >= model.phaseIndex("real");
  const testCases = Math.max(2, Math.ceil(effortDays / 2));
  return [
    {
      id: "budget",
      label: "Budget",
      text:
        reserve.remainingChf === undefined
          ? `${formatChf(cost)}; keine Reserve erfasst, die Mehrkosten sind nicht gedeckt`
          : `${formatChf(cost)}; Reserve danach ${formatChf(Math.max(0, reserve.remainingChf - cost))}${overReserve ? " (überschritten)" : ""}`,
      level: overReserve ? "hoch" : "mittel",
    },
    {
      id: "termin",
      label: "Termin",
      text: `rund ${days} ${days === 1 ? "Arbeitstag" : "Arbeitstage"} Mehraufwand im Team${late ? "; verschiebt den Go-live, falls nicht im Puffer" : ""}`,
      level: late ? (days > 3 ? "hoch" : "mittel") : days > 3 ? "mittel" : "niedrig",
    },
    {
      id: "architektur",
      label: "Architektur und Systemskizze",
      text:
        flags.schnittstelle || flags.sonderloesung
          ? `Systemskizze nachführen; der Pattern-Pilot prüft die Änderung neu${flags.schnittstelle ? " (neue Schnittstelle)" : ""}`
          : "keine Auswirkung",
      level: flags.schnittstelle || flags.sonderloesung ? "mittel" : "niedrig",
    },
    {
      id: "sicherheit",
      label: "Security und Datenschutz",
      text: flags.daten
        ? `${recheckNames(recheckResults(model, ctx.phase, ctx.notApplicable))} neu prüfen (ISM und Datenschutz); das Gate bleibt bis dahin zu`
        : "keine Neuprüfung nötig",
      level: flags.daten ? "hoch" : "niedrig",
    },
    {
      id: "test",
      label: "Testing",
      text: `etwa ${testCases} zusätzliche Testfälle inklusive Fehlerfälle${flags.schnittstelle ? ", zusätzliche Schnittstellentests" : ""}`,
      level: flags.schnittstelle ? "mittel" : "niedrig",
    },
    {
      id: "schulung",
      label: "Schulung und Kommunikation",
      text: flags.oberflaeche
        ? `Schulungsunterlagen anpassen${flags.extern ? "; externe Nutzende informieren" : ""}`
        : flags.extern
          ? "externe Nutzende informieren"
          : "keine Auswirkung",
      level: flags.extern ? "mittel" : "niedrig",
    },
    {
      id: "betrieb",
      label: "Betrieb und Folgelast",
      text: flags.sonderloesung
        ? "Sonderlösung: Mehraufwand bei jedem Release des Standardprodukts"
        : flags.schnittstelle
          ? "zusätzliche Überwachung der Schnittstelle"
          : "gering",
      level: flags.sonderloesung ? "hoch" : flags.schnittstelle ? "mittel" : "niedrig",
    },
    {
      id: "abnahme",
      label: "Abnahme",
      text: "Akzeptanzkriterien ergänzen; die fachliche Abnahme wird erweitert",
      level: "niedrig",
    },
  ];
}

export function impactSummary(rows: readonly ImpactRow[]): string {
  const high = rows.filter((r) => r.level === "hoch").map((r) => r.label);
  return high.length ? `Hohe Auswirkung auf: ${high.join(", ")}` : "Keine hohe Auswirkung";
}

/** What the requester enters; a message for the person, or null. */
export function validateChangeRequest(input: { title: string; summary: string }): string | null {
  if (input.title.trim().length < MIN_TITLE) {
    return `Bitte einen Titel erfassen (mindestens ${MIN_TITLE} Zeichen).`;
  }
  if (input.summary.trim().length < MIN_SUMMARY) {
    return `Bitte die Änderung kurz beschreiben (mindestens ${MIN_SUMMARY} Zeichen).`;
  }
  return null;
}

export function validateWithdrawal(reason: string): string | null {
  return reason.trim().length < MIN_REASON
    ? "Bitte begründen, warum der Change Request zurückgezogen wird."
    : null;
}

export function validateRecheck(outcome: RecheckOutcome, note: string): string | null {
  return outcome === "Massnahme ergänzt" && note.trim().length < MIN_REASON
    ? "Bitte die ergänzte Massnahme nennen."
    : null;
}

/** Recheck roles that have not confirmed yet; empty when no recheck is needed or all confirmed. */
export function pendingRecheckRoles(cr: ChangeRequestState): RecheckRole[] {
  if (!cr.recheck) return [];
  return (cr.recheckRoles ?? CR_RECHECK_ROLES).filter((r) => !cr.recheck![r]);
}

/** The impact rows of a request: frozen at the decision, computed live while it is open. */
export function requestImpact(s: ProjectState, cr: ChangeRequestState, model: HermesModel): ImpactRow[] {
  return (cr.decision?.impact as ImpactRow[] | undefined) ?? changeImpact(cr, impactContext(s, cr.id), model);
}

/** Accepted requests whose recheck is not complete; they keep the current gate closed. */
export function openRechecks(s: ProjectState): ChangeRequestState[] {
  return Object.values(s.changeRequests)
    .filter((c) => pendingRecheckRoles(c).length > 0)
    .sort((a, b) => a.number - b.number);
}

export function openChangeRequests(s: ProjectState): ChangeRequestState[] {
  return Object.values(s.changeRequests)
    .filter((c) => c.status === "offen")
    .sort((a, b) => a.number - b.number);
}

export const nextCrNumber = (s: ProjectState) =>
  Object.values(s.changeRequests).reduce((n, c) => Math.max(n, c.number), 0) + 1;
