import type { GlobalRole, ProjectRole } from "./types";

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

/** Due dates offered for Auflagen (todo-later P09: real dates). */
export const DUE_OPTIONS: readonly string[] = ["1 Woche", "2 Wochen", "bis zum nächsten Gate"];
