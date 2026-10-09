// Derived status of skills, deliverables and gates. Ported from the prototype
// (agentStatus, delivStatus, gateState) and kept deterministic.

import type { HermesModel } from "../model";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import type {
  ApproverDef,
  ChecklistDef,
  DeliverableDef,
  PhaseId,
  ProjectRole,
  SkillDef,
} from "../model/types";
import { openParticipation, participantsFor } from "./participation";
import { checklistKey, type ProjectState } from "./state";

export type SkillStatus = "planned" | "ready" | "running" | "approval" | "veto" | "done";
export type DeliverableStatus =
  "planned" | "open" | "running" | "draft" | "approval" | "veto" | "confirm" | "done" | "na";
export type GateStatus = "passed" | "historic" | "preview" | "blocked" | "ready" | "open";

export function isPhaseClosed(s: ProjectState, model: HermesModel, phase: PhaseId): boolean {
  return s.passed.includes(phase) || model.phaseIndex(phase) < model.phaseIndex(s.phase);
}

export function isPhaseFuture(s: ProjectState, model: HermesModel, phase: PhaseId): boolean {
  return !isPhaseClosed(s, model, phase) && model.phaseIndex(phase) > model.phaseIndex(s.phase);
}

export function isPhaseCurrent(s: ProjectState, phase: PhaseId): boolean {
  return phase === s.phase && !s.passed.includes(phase);
}

/** All phases passed: nothing left to do. */
export function isFinished(s: ProjectState, model: HermesModel): boolean {
  const last = model.phases[model.phases.length - 1];
  return !!last && s.passed.includes(last.id);
}

export function pendingApprovers(s: ProjectState, skill: SkillDef): ApproverDef[] {
  const approvals = s.skills[skill.id]?.approvals ?? {};
  return skill.approvers.filter((a) => !approvals[a.role]);
}

export function skillStatus(s: ProjectState, model: HermesModel, skill: SkillDef): SkillStatus {
  if (isPhaseClosed(s, model, skill.phase)) return "done";
  if (isPhaseFuture(s, model, skill.phase)) return "planned";
  const st = s.skills[skill.id];
  if (st?.runningRunId) return "running";
  if (!st?.output) return "ready";
  if (pendingApprovers(s, skill).length) return skill.veto ? "veto" : "approval";
  return "done";
}

/** Skills that must be approved before `skill` may start, and are not yet. */
export function unmetPreconditions(s: ProjectState, model: HermesModel, skill: SkillDef): SkillDef[] {
  return (skill.requiresApproved ?? [])
    .map((id) => model.skill(id))
    .filter((pre) => skillStatus(s, model, pre) !== "done");
}

export function checklistAvailable(s: ProjectState, model: HermesModel, cl: ChecklistDef): boolean {
  const skill = model.skill(cl.availableAfterSkill);
  return isPhaseClosed(s, model, skill.phase) || !!s.skills[skill.id]?.output;
}

export function openChecklistItems(s: ProjectState, ownerId: string, cl: ChecklistDef) {
  return cl.items.filter((it) => !s.checklist[checklistKey(ownerId, it.id)]);
}

export function deliverableStatus(s: ProjectState, model: HermesModel, d: DeliverableDef): DeliverableStatus {
  if (isPhaseClosed(s, model, d.phase) || d.preExisting) return "done";
  if (s.notApplicable[d.id]) return "na";
  if (isPhaseFuture(s, model, d.phase)) return "planned";
  const ss = d.skills.map((id) => skillStatus(s, model, model.skill(id)));
  if (ss.includes("running")) return "running";
  if (ss.includes("ready")) return "open";
  if (ss.includes("veto")) return "veto";
  if (ss.includes("approval")) return "approval";
  if (d.checklist && openChecklistItems(s, d.id, d.checklist).length) return "confirm";
  return s.unreleased[d.id] ? "draft" : "done";
}

export function mandatoryProgress(s: ProjectState, model: HermesModel, phase: PhaseId) {
  const list = model.phase(phase).deliverables.filter((d) => d.requirement === "pflicht");
  return {
    done: list.filter((d) => deliverableStatus(s, model, d) === "done").length,
    total: list.length,
  };
}

/** Roles that must decide in this phase but are held by no member (todo-later E15). */
export function missingRoles(s: ProjectState, model: HermesModel, phase: PhaseId): ProjectRole[] {
  const held = new Set(Object.values(s.members).flatMap((m) => m.roles));
  const needed = new Set<ProjectRole>(model.phase(phase).gate.deciders);
  for (const d of model.phase(phase).deliverables) {
    if (d.requirement !== "pflicht") continue;
    for (const sid of d.skills) for (const a of pendingApprovers(s, model.skill(sid))) needed.add(a.role);
  }
  return [...needed].filter((r) => !held.has(r));
}

export function gateStatus(s: ProjectState, model: HermesModel, phase: PhaseId): GateStatus {
  if (s.passed.includes(phase)) return "passed";
  if (model.phaseIndex(phase) < model.phaseIndex(s.phase)) return "historic";
  if (model.phaseIndex(phase) > model.phaseIndex(s.phase)) return "preview";
  const statuses = model
    .phase(phase)
    .deliverables.filter((d) => d.requirement === "pflicht")
    .map((d) => deliverableStatus(s, model, d));
  if (statuses.includes("veto")) return "blocked";
  if (statuses.every((x) => x === "done") && openParticipation(s, model, phase).length === 0) return "ready";
  return "open";
}

export interface GateCriterion {
  id: "pflicht" | "beteiligung" | "veto" | "rollen" | "auflagen";
  label: string;
  ok: boolean;
  detail: string;
  /** Blocking criteria must be met before the gate can be decided. */
  blocking: boolean;
}

export function gateCriteria(s: ProjectState, model: HermesModel, phase: PhaseId): GateCriterion[] {
  const ph = model.phase(phase);
  const out: GateCriterion[] = [];
  const { done, total } = mandatoryProgress(s, model, phase);
  out.push({
    id: "pflicht",
    label: "Pflichtergebnisse freigegeben",
    ok: done === total,
    detail: `${done} von ${total}`,
    blocking: true,
  });
  const required = participantsFor(model, s.profile, phase).filter((x) => x.required);
  if (required.length) {
    const open = openParticipation(s, model, phase).length;
    out.push({
      id: "beteiligung",
      label: "Beteiligte einbezogen",
      ok: open === 0,
      detail: `${required.length - open} von ${required.length}`,
      blocking: true,
    });
  }
  if (ph.skills.some((sk) => sk.veto)) {
    const vetoes = ph.deliverables.filter(
      (d) => d.requirement === "pflicht" && deliverableStatus(s, model, d) === "veto",
    );
    out.push({
      id: "veto",
      label: "Kein Veto offen",
      ok: vetoes.length === 0,
      detail: vetoes.length ? vetoes.map((d) => d.name).join(", ") : "keines",
      blocking: true,
    });
  }
  const missing = missingRoles(s, model, phase);
  out.push({
    id: "rollen",
    label: "Entscheidende Rollen besetzt",
    ok: missing.length === 0,
    detail: missing.length
      ? `fehlt: ${missing.map((r) => PROJECT_ROLE_LABELS[r]).join(", ")}`
      : "alle besetzt",
    blocking: false,
  });
  const openConditions = Object.values(s.conditions).filter((c) => c.phase === phase && !c.doneAt);
  if (openConditions.length) {
    out.push({
      id: "auflagen",
      label: "Auflagen erledigt",
      ok: false,
      detail: `${openConditions.length} offen`,
      blocking: false,
    });
  }
  return out;
}
