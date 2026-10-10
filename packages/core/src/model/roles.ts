import type { GlobalRole, ProjectProfile, ProjectRole } from "./types";

export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  PL: "Projektleitung",
  BC: "Business Analyse",
  PA: "Auftraggeber / Projektausschuss",
  FACH: "Fachvertretung",
  TEST: "Testverantwortung",
  ISM: "Informationssicherheit (ISM)",
  DS: "Datenschutz",
  ARCH: "Architektur",
  APM: "Applikationsmanagement",
  INFRA: "Infrastruktur / Technische Koordination",
};

export const GLOBAL_ROLE_LABELS: Readonly<Record<GlobalRole, string>> = {
  "HH.User": "Benutzer/in",
  "HH.PMO": "PMO",
  "HH.Portfolio": "Portfolio-Gremium",
  "HH.Admin": "Administration",
};

/** Roles that may read restricted deliverables (SchuBAn, ISDS, DSFA …). */
export const RESTRICTED_READERS: readonly ProjectRole[] = ["PL", "PA", "ISM", "DS", "ARCH"];

/**
 * Due options for Auflagen and when each is due: a number of days after the
 * decision, or the next gate (engine/conditions.ts; todo-later P09).
 */
export const DUE_RULES = {
  "1 Woche": { kind: "days", days: 7 },
  "2 Wochen": { kind: "days", days: 14 },
  "bis zum nächsten Gate": { kind: "next-gate" },
} as const satisfies Record<string, DueRule>;

export type DueRule = { kind: "days"; days: number } | { kind: "next-gate" };
export type DueOption = keyof typeof DUE_RULES;

/** Offered in the decision form; the API accepts only these. */
export const DUE_OPTIONS = Object.keys(DUE_RULES) as readonly DueOption[];

/** Profile of a new project until the PL fills it in. */
export const DEFAULT_PROFILE: ProjectProfile = {
  schutzbedarf: "mittel",
  personendaten: false,
  cloud: false,
  schnittstellen: 0,
  lieferant: false,
  verfuegbarkeit: "mittel",
  neueTechnologie: false,
  externeNutzende: false,
};
