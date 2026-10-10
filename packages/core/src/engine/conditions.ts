// Auflagen (conditions of a decision): when they are due and when they are
// overdue (todo-later P09). The decision names one of DUE_OPTIONS; its rule
// turns it into a date or a gate.

import type { HermesModel } from "../model";
import { DUE_RULES } from "../model/roles";
import type { PhaseId } from "../model/types";
import type { ConditionState, ProjectState } from "./state";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConditionDue =
  /** Due at this time (ISO). */
  | { kind: "date"; at: string }
  /** Due at the gate of this phase. */
  | { kind: "gate"; phase: PhaseId }
  /** No rule: a due text from before the rules, or the next gate after the last phase. */
  | { kind: "none" };

export function conditionDue(model: HermesModel, c: ConditionState): ConditionDue {
  const rule = Object.hasOwn(DUE_RULES, c.due) ? DUE_RULES[c.due as keyof typeof DUE_RULES] : undefined;
  if (!rule) return { kind: "none" };
  if (rule.kind === "days") {
    return { kind: "date", at: new Date(Date.parse(c.createdAt) + rule.days * DAY_MS).toISOString() };
  }
  // A gate decision moves the project on, so its Auflagen are due at the following gate.
  // An Auflage from a decision within a phase is due at that phase's gate.
  const phase = c.source.startsWith("gate:") ? model.nextPhase(c.phase)?.id : c.phase;
  return phase ? { kind: "gate", phase } : { kind: "none" };
}

/** Open after its date, or after the gate it was due at has been passed. */
export function isConditionOverdue(
  s: ProjectState,
  model: HermesModel,
  c: ConditionState,
  now: Date,
): boolean {
  if (c.doneAt) return false;
  const due = conditionDue(model, c);
  switch (due.kind) {
    case "date":
      return now.getTime() > Date.parse(due.at);
    case "gate":
      return s.passed.includes(due.phase);
    case "none":
      return false;
  }
}
