// Derived status of skills, deliverables and gates. Ported from the prototype
// (agentStatus, delivStatus, gateState) and kept deterministic.

import type { HermesModel } from "../model";
import { roleConflict } from "../model/policy";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import type {
  ApproverDef,
  ChecklistDef,
  DeliverableDef,
  PhaseId,
  ProjectRole,
  SkillDef,
} from "../model/types";
import { crLabel, openChangeRequests, openRechecks, pendingRecheckRoles } from "./change-requests";
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

/**
 * Fingerprint of a deliverable's content: the version of every contributing
 * result. Releases and decisions must name it, so nobody approves a version
 * they have not seen (optimistic concurrency per document).
 */
export function contentVersion(s: ProjectState, d: DeliverableDef): string {
  return d.skills.map((id) => `${id}@${s.skills[id]?.output?.version ?? 0}`).join(",");
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

/** A decision that waits for a role. */
interface PendingDecision {
  role: ProjectRole;
  /** What waits, for people: «Go-live-Readiness-Bericht» (Veto), Neuprüfung CR-03. */
  what: string;
  /** The project lead may not take it: a veto, the gate. */
  notByPL: boolean;
  /** The person who submitted the change request may not take it (four-eyes principle). */
  notBy?: string;
}

/**
 * Whether a member may take the decision. Under separation of duties a role
 * does not count next to an incompatible one, the project lead casts no veto
 * and decides no gate, and nobody decides or rechecks their own change
 * request: the same rules the checks in permissions.ts apply to the person
 * acting.
 */
function mayDecide(model: HermesModel, userId: string, roles: readonly ProjectRole[], d: PendingDecision) {
  if (!roles.includes(d.role)) return false;
  if (!model.policy.separationOfDuties) return true;
  if (roleConflict(roles, d.role)) return false;
  if (d.notByPL && roles.includes("PL")) return false;
  return d.notBy !== userId;
}

function pendingDecisions(s: ProjectState, model: HermesModel, phase: PhaseId): PendingDecision[] {
  const ph = model.phase(phase);
  const out: PendingDecision[] = ph.gate.deciders.map((role) => ({
    role,
    what: `Gate «${ph.gate.name}»`,
    notByPL: true,
  }));
  for (const d of ph.deliverables) {
    if (d.requirement !== "pflicht") continue;
    for (const sid of d.skills) {
      const skill = model.skill(sid);
      for (const a of pendingApprovers(s, skill)) {
        out.push({
          role: a.role,
          what: `«${skill.outputDoc}»${skill.veto ? " (Veto)" : ""}`,
          notByPL: skill.veto,
        });
      }
    }
  }
  if (isPhaseCurrent(s, phase)) {
    for (const c of openChangeRequests(s)) {
      out.push({
        role: "PA",
        what: `Entscheid ${crLabel(c.number)}`,
        notByPL: false,
        notBy: c.submittedBy.userId,
      });
    }
    for (const c of openRechecks(s)) {
      for (const role of pendingRecheckRoles(c)) {
        out.push({
          role,
          what: `Neuprüfung ${crLabel(c.number)}`,
          notByPL: false,
          notBy: c.submittedBy.userId,
        });
      }
    }
  }
  return out;
}

/** A role a decision of the phase waits for, and nobody in the project may take it. */
export interface MissingRole {
  role: ProjectRole;
  /** The decisions that wait for it. */
  decisions: string[];
  /** Members hold the role but may not take these decisions (separation of duties, four-eyes principle). */
  held: boolean;
}

/**
 * Roles a decision of this phase waits for, where no member may take it:
 * nobody holds the role, or those who hold it may not decide here (todo-later
 * E15, review N3). One more person with the role resolves it.
 */
export function missingRoleDetails(s: ProjectState, model: HermesModel, phase: PhaseId): MissingRole[] {
  const members = Object.entries(s.members);
  const out = new Map<ProjectRole, MissingRole>();
  for (const d of pendingDecisions(s, model, phase)) {
    if (members.some(([id, m]) => mayDecide(model, id, m.roles, d))) continue;
    const entry = out.get(d.role) ?? {
      role: d.role,
      decisions: [],
      held: members.some(([, m]) => m.roles.includes(d.role)),
    };
    if (!entry.decisions.includes(d.what)) entry.decisions.push(d.what);
    out.set(d.role, entry);
  }
  return [...out.values()];
}

/** The roles of missingRoleDetails. */
export function missingRoles(s: ProjectState, model: HermesModel, phase: PhaseId): ProjectRole[] {
  return missingRoleDetails(s, model, phase).map((m) => m.role);
}

/** «Datenschutz (Neuprüfung CR-03)»: a missing role and what waits for it. */
export const missingRoleText = (m: MissingRole) =>
  `${PROJECT_ROLE_LABELS[m.role]} (${m.decisions.join(", ")})`;

export function gateStatus(s: ProjectState, model: HermesModel, phase: PhaseId): GateStatus {
  if (s.passed.includes(phase)) return "passed";
  if (model.phaseIndex(phase) < model.phaseIndex(s.phase)) return "historic";
  if (model.phaseIndex(phase) > model.phaseIndex(s.phase)) return "preview";
  const statuses = model
    .phase(phase)
    .deliverables.filter((d) => d.requirement === "pflicht")
    .map((d) => deliverableStatus(s, model, d));
  if (statuses.includes("veto")) return "blocked";
  if (
    statuses.every((x) => x === "done") &&
    openParticipation(s, model, phase).length === 0 &&
    openRechecks(s).length === 0
  ) {
    return "ready";
  }
  return "open";
}

export interface GateCriterion {
  id: "pflicht" | "beteiligung" | "veto" | "neupruefung" | "rollen" | "auflagen";
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
  // A change request that touches personal data: its recheck results are checked again first.
  const rechecks = isPhaseCurrent(s, phase) ? openRechecks(s) : [];
  if (rechecks.length) {
    out.push({
      id: "neupruefung",
      label: "Neuprüfung nach Change Request",
      ok: false,
      detail: rechecks
        .map(
          (c) =>
            `${crLabel(c.number)} wartet auf ${pendingRecheckRoles(c)
              .map((r) => PROJECT_ROLE_LABELS[r])
              .join(" und ")}`,
        )
        .join("; "),
      blocking: true,
    });
  }
  const missing = missingRoleDetails(s, model, phase);
  out.push({
    id: "rollen",
    label: "Entscheidende Rollen besetzt",
    ok: missing.length === 0,
    detail: missing.length ? `fehlt: ${missing.map(missingRoleText).join("; ")}` : "alle besetzt",
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
