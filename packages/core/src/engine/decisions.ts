// Validation of decisions (prototype: submitDecide). Returns a German message
// for the user, or null when the input is valid.

import { PROJECT_ROLES, type ProjectRole } from "../model/types";
import { DECISIONS, type Decision } from "./events";

export interface ConditionInput {
  text: string;
  ownerRole: ProjectRole;
  due: string;
}

export interface DecisionInput {
  decision: Decision;
  reason: string;
  konsent: boolean;
  conditions: ConditionInput[];
}

export interface DecisionContext {
  /** Lifting a veto always needs a reason. */
  veto: boolean;
  /** A reason even for a plain approval (change requests). */
  reasonRequired?: boolean;
  /** Committee decision: "Konsent festgestellt" is required (unless rejected). */
  konsentRequired: boolean;
  /** Open items of a checklist that must be complete before approval. */
  openChecklistItems: number;
  checklistTitle?: string;
}

export const MIN_REASON = 5;

export function validateDecision(input: DecisionInput, ctx: DecisionContext): string | null {
  if (!DECISIONS.includes(input.decision)) return "Bitte einen Entscheid wählen.";
  const reason = input.reason.trim();
  if (ctx.veto && reason.length < MIN_REASON) return "Beim Aufheben eines Vetos ist eine Begründung Pflicht.";
  if ((ctx.reasonRequired || input.decision !== "freigegeben") && reason.length < MIN_REASON) {
    return `Bitte eine Begründung erfassen (mindestens ${MIN_REASON} Zeichen).`;
  }
  if (input.decision === "mit Auflagen") {
    if (!input.conditions.length) return "Bitte mindestens eine Auflage erfassen.";
    for (const c of input.conditions) {
      if (c.text.trim().length < 3) return "Jede Auflage braucht einen Text (mindestens 3 Zeichen).";
      if (!PROJECT_ROLES.includes(c.ownerRole)) return "Jede Auflage braucht eine verantwortliche Rolle.";
      if (!c.due.trim()) return "Jede Auflage braucht eine Frist.";
    }
  }
  if (ctx.konsentRequired && input.decision !== "zurückgewiesen" && !input.konsent) {
    return "Für einen Entscheid des Projektausschusses muss der Konsent festgestellt sein.";
  }
  if (ctx.openChecklistItems > 0 && input.decision !== "zurückgewiesen") {
    return `Zuerst alle Punkte der Checkliste «${ctx.checklistTitle ?? "Checkliste"}» bestätigen (${ctx.openChecklistItems} offen).`;
  }
  return null;
}

export function validateNotApplicableReason(reason: string): string | null {
  return reason.trim().length < MIN_REASON
    ? "Bitte begründen, warum das Ergebnis für dieses Vorhaben nicht zutrifft."
    : null;
}
