// The answers the agents expect from the model: strict JSON schemas sent with
// each call (structured outputs) and the parsers that read the answer. Shared by
// the model adapters, so every model is held to the same contract.

import { CR_FLAGS, PROJECT_ROLES, RISK_LEVELS, STATUS_CRITERION_IDS } from "@hermes-helfer/core";
import { z } from "zod";
import { MAX_SECTIONS, SECTION_MAX, clampedList, clampedText } from "./output";

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "openPoints"],
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: { heading: { type: "string" }, body: { type: "string" } },
      },
    },
    openPoints: { type: "array", items: { type: "string" } },
  },
} as const;

const FLAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "reason"],
  properties: { value: { type: "boolean" }, reason: { type: "string" } },
} as const;

export const CHANGE_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "openPoints", "flags"],
  properties: {
    ...DRAFT_SCHEMA.properties,
    flags: {
      type: "object",
      additionalProperties: false,
      required: [...CR_FLAGS],
      properties: Object.fromEntries(CR_FLAGS.map((f) => [f, FLAG_SCHEMA])),
    },
  },
} as const;

const LEVEL_SCHEMA = { type: "string", enum: [...RISK_LEVELS] } as const;

/** The trigger of each proposal must be one of the supplied ids (the agent's grounding). */
export const riskReviewSchema = (triggers: readonly string[]) => {
  const trigger = { type: "string", enum: [...triggers] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["newRisks", "reassessments"],
    properties: {
      newRisks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "description",
            "probability",
            "impact",
            "ownerRole",
            "mitigation",
            "reason",
            "trigger",
          ],
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            probability: LEVEL_SCHEMA,
            impact: LEVEL_SCHEMA,
            ownerRole: { type: "string", enum: [...PROJECT_ROLES] },
            mitigation: { type: "string" },
            reason: { type: "string" },
            trigger,
          },
        },
      },
      reassessments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["risk", "probability", "impact", "mitigation", "reason", "trigger"],
          properties: {
            risk: { type: "string" },
            probability: LEVEL_SCHEMA,
            impact: LEVEL_SCHEMA,
            mitigation: { type: "string" },
            reason: { type: "string" },
            trigger,
          },
        },
      },
    },
  };
};

export const STATUS_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "outlook", "criteria"],
  properties: {
    overview: { type: "string" },
    outlook: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "problem", "measure"],
        properties: {
          id: { type: "string", enum: [...STATUS_CRITERION_IDS] },
          problem: { type: "string" },
          measure: { type: "string" },
        },
      },
    },
  },
} as const;

export const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "text"],
        properties: { severity: { type: "string", enum: ["hinweis", "warnung"] }, text: { type: "string" } },
      },
    },
  },
} as const;

// The parsers cut over-long text and drop surplus items instead of refusing the
// answer (output.ts); the limits are those of the API's own requests, so what
// the agent proposes can be submitted as it is.
export const DraftOut = z.object({
  summary: clampedText(4000),
  sections: clampedList(
    z.object({ heading: clampedText(200), body: clampedText(SECTION_MAX) }),
    MAX_SECTIONS,
  ),
  openPoints: clampedList(clampedText(500), 50),
});
const FlagOut = z.object({ value: z.boolean(), reason: clampedText(500) });
export const ChangeRequestOut = DraftOut.extend({
  flags: z.object({
    daten: FlagOut,
    schnittstelle: FlagOut,
    sonderloesung: FlagOut,
    oberflaeche: FlagOut,
    extern: FlagOut,
  }),
});
const LevelOut = z.enum(RISK_LEVELS);
export const RiskReviewOut = z.object({
  newRisks: clampedList(
    z.object({
      title: clampedText(200),
      description: clampedText(2000),
      probability: LevelOut,
      impact: LevelOut,
      ownerRole: z.enum(PROJECT_ROLES),
      mitigation: clampedText(1000),
      reason: clampedText(500),
      trigger: clampedText(80),
    }),
    20,
  ),
  reassessments: clampedList(
    z.object({
      risk: clampedText(20),
      probability: LevelOut,
      impact: LevelOut,
      mitigation: clampedText(1000),
      reason: clampedText(500),
      trigger: clampedText(80),
    }),
    20,
  ),
});
export const StatusReportOut = z.object({
  overview: clampedText(4000),
  outlook: clampedText(4000),
  criteria: clampedList(
    z.object({ id: z.enum(STATUS_CRITERION_IDS), problem: clampedText(2000), measure: clampedText(2000) }),
    12,
  ),
});
export const CritiqueOut = z.object({
  findings: clampedList(z.object({ severity: z.enum(["hinweis", "warnung"]), text: clampedText(500) }), 10),
});
