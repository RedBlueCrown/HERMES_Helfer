// Change Requests: the impact estimate in eight dimensions and the recheck of
// SchuBAn, ISDS and DSFA (prototype: crImpact, openRechecks). Deterministic:
// the engine computes the impact, the Change-Request agent only drafts the text,
// and the Projektausschuss decides.

import type { HermesModel } from "../model";
import type { PhaseId } from "../model/types";
import { CR_DAY_RATE_CHF, CR_RECHECK_ROLES, type CrFlags, type RecheckRole } from "../model/change-requests";
import type { ChangeRequestState, ChangeRequestStatus, ProjectState } from "./state";

export const CR_STATUS_LABELS: Readonly<Record<ChangeRequestStatus, string>> = {
  offen: "Wartet auf Entscheid",
  angenommen: "Angenommen",
  abgelehnt: "Abgelehnt",
  zurueckgezogen: "Zurückgezogen",
};

export const crLabel = (number: number) => `CR-${String(number).padStart(2, "0")}`;

export const crCostChf = (effortDays: number) => Math.round(effortDays * CR_DAY_RATE_CHF);

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
    .reduce((n, c) => n + crCostChf(c.effortDays), 0);
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
}

/** What the estimate needs from the project; small, so the web app can preview a new request. */
export interface ImpactContext {
  phase: PhaseId;
  reserve: ReserveStatus;
}

/** `exceptCrId`: the request itself, so an accepted request is not counted twice against the reserve. */
export function impactContext(s: ProjectState, exceptCrId?: string): ImpactContext {
  return { phase: s.phase, reserve: reserveStatus(s, exceptCrId) };
}

/**
 * The impact of a request on budget, schedule, architecture, security, testing,
 * training, operations and acceptance.
 */
export function changeImpact(input: ImpactInput, ctx: ImpactContext, model: HermesModel): ImpactRow[] {
  const { flags, effortDays } = input;
  const { reserve } = ctx;
  const cost = crCostChf(effortDays);
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
        ? "SchuBAn, Datenschutz-Vorabklärung, ISDS-Konzept und DSFA neu prüfen (ISM und Datenschutz); das Gate bleibt bis dahin zu"
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

/** Recheck roles that have not confirmed yet; empty when no recheck is needed or all confirmed. */
export function pendingRecheckRoles(cr: ChangeRequestState): RecheckRole[] {
  if (!cr.recheck) return [];
  return CR_RECHECK_ROLES.filter((r) => !cr.recheck![r]);
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
