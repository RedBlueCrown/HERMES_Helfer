// Risks (HERMES: Risikomanagement), as configuration: the scale, the statuses
// and from which score a risk counts as high. Ported from prototype v22
// (RISK_TABLE, riskScore); the PMO confirms the values (question F33).

import type { Level } from "./types";

/** Probability ("Eintritt") and impact ("Auswirkung") use the same three steps. */
export const RISK_LEVELS = ["niedrig", "mittel", "hoch"] as const satisfies readonly Level[];

export const RISK_LEVEL_VALUE: Readonly<Record<Level, number>> = { niedrig: 1, mittel: 2, hoch: 3 };

/** "in Bearbeitung": the responsible role works on the measure. */
export const RISK_STATUSES = ["offen", "in Bearbeitung", "geschlossen"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

/** Score = probability × impact (1 to 9). From 6 on a risk counts as high, from 3 on as medium. */
export const RISK_SCORE_HIGH = 6;
export const RISK_SCORE_MEDIUM = 3;

/** The Risiko agent proposes at most this many new risks and reassessments per review. */
export const RISK_PROPOSALS_MAX = 5;
