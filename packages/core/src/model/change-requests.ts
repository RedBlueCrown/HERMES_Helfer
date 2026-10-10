// Change Requests (HERMES: Änderungsmanagement), as configuration: what a
// request can affect, the cost rate for the impact estimate, and which results
// are checked again when a request touches personal data. Ported from
// prototype v22; the PMO confirms the values (question F31).

import type { ProjectRole } from "./types";

/** What a change request affects. Drives the impact estimate (engine/change-requests.ts). */
export const CR_FLAGS = ["daten", "schnittstelle", "sonderloesung", "oberflaeche", "extern"] as const;
export type CrFlag = (typeof CR_FLAGS)[number];
export type CrFlags = Record<CrFlag, boolean>;

export const CR_FLAG_LABELS: Readonly<Record<CrFlag, { label: string; hint: string }>> = {
  daten: {
    label: "Personendaten oder Datenumfang",
    hint: "Neue Daten, andere Empfänger, ein Export: SchuBAn, ISDS-Konzept und DSFA werden neu geprüft.",
  },
  schnittstelle: {
    label: "Schnittstelle",
    hint: "Neue oder geänderte Schnittstelle zu einem anderen System.",
  },
  sonderloesung: {
    label: "Abweichung vom Standard",
    hint: "Das Standardprodukt wird angepasst (Sonderlösung).",
  },
  oberflaeche: { label: "Benutzeroberfläche", hint: "Neue Felder, Masken oder Abläufe für die Nutzenden." },
  extern: {
    label: "Externe Nutzende",
    hint: "Betrifft Kundinnen, Kunden oder Partner ausserhalb der Firma.",
  },
};

export const NO_FLAGS: CrFlags = {
  daten: false,
  schnittstelle: false,
  sonderloesung: false,
  oberflaeche: false,
  extern: false,
};

/** Cost of one person-day for the budget estimate, in CHF (placeholder, question F31). */
export const CR_DAY_RATE_CHF = 1200;

/** Sections of a change request: the Change-Request agent drafts them, the requester completes them. */
export const CR_SECTIONS: readonly string[] = [
  "Ausgangslage",
  "Gewünschte Änderung",
  "Begründung und Nutzen",
  "Betroffene Abläufe und Ergebnisse",
  "Alternativen",
];

/** Results checked again after an accepted request that touches personal data. */
export const CR_RECHECK_DELIVERABLES: readonly string[] = ["schuban", "dsvor", "isds", "dsfa"];

/** Roles that confirm the recheck: information security and data protection. */
export const CR_RECHECK_ROLES = ["ISM", "DS"] as const satisfies readonly ProjectRole[];
export type RecheckRole = (typeof CR_RECHECK_ROLES)[number];

export const RECHECK_OUTCOMES = ["keine Anpassung", "Massnahme ergänzt"] as const;
export type RecheckOutcome = (typeof RECHECK_OUTCOMES)[number];
