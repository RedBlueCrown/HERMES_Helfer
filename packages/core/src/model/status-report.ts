// Status report (HERMES result «Projektstatusbericht»), as configuration: the
// six criteria of the traffic light, what each colour means, and how often a
// report is due. Ported from prototype v22; the PMO confirms (question F35).

/** The six criteria of the traffic light, with the short codes of the template. */
export const STATUS_CRITERIA = [
  { id: "termine", code: "TER", label: "Termine" },
  { id: "kosten", code: "KOS", label: "Kosten" },
  { id: "personal", code: "RES", label: "Personalaufwand" },
  { id: "ergebnisse", code: "ERG", label: "Ergebnisse" },
  { id: "ziele", code: "ZIEL", label: "Ziele" },
  { id: "risiken", code: "RIS", label: "Risiken" },
] as const;
export type StatusCriterion = (typeof STATUS_CRITERIA)[number]["id"];
export const STATUS_CRITERION_IDS = STATUS_CRITERIA.map((c) => c.id) as readonly StatusCriterion[];

export const AMPEL_VALUES = ["gruen", "gelb", "rot"] as const;
export type Ampel = (typeof AMPEL_VALUES)[number];

export const AMPEL_LABELS: Readonly<Record<Ampel, { label: string; meaning: string }>> = {
  gruen: { label: "Grün", meaning: "auf Kurs, keine Massnahmen nötig" },
  gelb: { label: "Gelb", meaning: "Massnahmen nötig" },
  rot: { label: "Rot", meaning: "Massnahmen und Eskalation an die nächsthöhere Stufe nötig" },
};

/** The project lead reports at least this often; afterwards the next report is due. */
export const STATUS_REPORT_INTERVAL_DAYS = 30;
