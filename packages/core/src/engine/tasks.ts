// "Meine Aufgaben" and "Als Nächstes" (prototype: myItems, nextAction).

import type { HermesModel } from "../model";
import type { RecheckRole } from "../model/change-requests";
import type { PhaseId, ProjectRole } from "../model/types";
import { openChangeRequests, openRechecks, pendingRecheckRoles } from "./change-requests";
import { openParticipation } from "./participation";
import {
  checkDecideGate,
  checkConfirmChecklistItem,
  decisionRolesFor,
  rolesOf,
  type Viewer,
} from "./permissions";
import type { ProjectState } from "./state";
import {
  deliverableStatus,
  gateStatus,
  isFinished,
  isPhaseCurrent,
  missingRoles,
  openChecklistItems,
  skillStatus,
  unmetPreconditions,
} from "./status";

export type MyTask =
  | { kind: "decide-skill"; skillId: string; role: ProjectRole; veto: boolean }
  | { kind: "decide-gate"; phase: PhaseId }
  | { kind: "release"; deliverableId: string }
  | { kind: "condition"; conditionId: string }
  | { kind: "checklist"; ownerId: string; itemId: string }
  | { kind: "involve"; phase: PhaseId; participantId: string }
  | { kind: "assign-role"; role: ProjectRole }
  | { kind: "decide-cr"; crId: string }
  | { kind: "recheck"; crId: string; role: RecheckRole };

export function myTasks(s: ProjectState, model: HermesModel, v: Viewer): MyTask[] {
  const out: MyTask[] = [];
  const roles = rolesOf(s, v.userId);
  const phase = model.phase(s.phase);
  const current = isPhaseCurrent(s, phase.id);
  const isPL = roles.includes("PL");

  if (current) {
    const decisions: MyTask[] = [];
    for (const skill of phase.skills) {
      const st = skillStatus(s, model, skill);
      if (st !== "approval" && st !== "veto") continue;
      for (const a of decisionRolesFor(s, v, skill)) {
        decisions.push({ kind: "decide-skill", skillId: skill.id, role: a.role, veto: st === "veto" });
      }
    }
    // Vetoes first: they block the gate.
    decisions.sort(
      (a, b) => Number(b.kind === "decide-skill" && b.veto) - Number(a.kind === "decide-skill" && a.veto),
    );
    out.push(...decisions);
    // Rechecks after a change request hold the gate, so they come before it.
    for (const c of openRechecks(s)) {
      for (const role of pendingRecheckRoles(c)) {
        if (roles.includes(role)) out.push({ kind: "recheck", crId: c.id, role });
      }
    }
    if (checkDecideGate(s, model, v, phase.id).ok) out.push({ kind: "decide-gate", phase: phase.id });
  }

  if (roles.includes("PA")) {
    for (const c of openChangeRequests(s)) out.push({ kind: "decide-cr", crId: c.id });
  }

  for (const c of Object.values(s.conditions)) {
    if (!c.doneAt && roles.includes(c.ownerRole)) out.push({ kind: "condition", conditionId: c.id });
  }

  if (current) {
    const owners = [
      ...phase.deliverables.filter((d) => d.checklist).map((d) => ({ id: d.id, cl: d.checklist! })),
      ...phase.skills.filter((sk) => sk.checklist).map((sk) => ({ id: sk.id, cl: sk.checklist! })),
    ];
    for (const { id, cl } of owners) {
      for (const it of openChecklistItems(s, id, cl)) {
        if (roles.includes(it.ownerRole) && checkConfirmChecklistItem(s, model, v, id, it.id).ok) {
          out.push({ kind: "checklist", ownerId: id, itemId: it.id });
        }
      }
    }
    if (isPL) {
      for (const d of phase.deliverables) {
        if (deliverableStatus(s, model, d) === "draft") out.push({ kind: "release", deliverableId: d.id });
      }
      for (const x of openParticipation(s, model, phase.id)) {
        out.push({ kind: "involve", phase: phase.id, participantId: x.id });
      }
      for (const r of missingRoles(s, model, phase.id)) out.push({ kind: "assign-role", role: r });
    }
  }
  return out;
}

export type NextStep =
  | { kind: "run"; skillId: string; deliverableId: string }
  | { kind: "running"; skillIds: string[] }
  | { kind: "decisions"; skillIds: string[] }
  | { kind: "release"; deliverableIds: string[] }
  | { kind: "checklist"; deliverableIds: string[] }
  | { kind: "involve"; participantIds: string[] }
  | { kind: "recheck"; crIds: string[] }
  | { kind: "gate" }
  | { kind: "idle" }
  | { kind: "finished" };

/** The next step of the project as a whole (independent of who looks at it). */
export function nextStep(s: ProjectState, model: HermesModel): NextStep {
  if (isFinished(s, model)) return { kind: "finished" };
  const phase = model.phase(s.phase);
  const mandatory = phase.deliverables.filter((d) => d.requirement === "pflicht" && !d.preExisting);

  for (const d of mandatory) {
    if (s.notApplicable[d.id]) continue;
    for (const sid of d.skills) {
      const skill = model.skill(sid);
      if (skillStatus(s, model, skill) === "ready" && unmetPreconditions(s, model, skill).length === 0) {
        return { kind: "run", skillId: sid, deliverableId: d.id };
      }
    }
  }
  const running = phase.skills.filter((sk) => skillStatus(s, model, sk) === "running").map((sk) => sk.id);
  if (running.length) return { kind: "running", skillIds: running };

  const waiting = new Set<string>();
  for (const d of mandatory) {
    for (const sid of d.skills) {
      const st = skillStatus(s, model, model.skill(sid));
      if (st === "approval" || st === "veto") waiting.add(sid);
    }
  }
  if (waiting.size) return { kind: "decisions", skillIds: [...waiting] };

  const drafts = mandatory.filter((d) => deliverableStatus(s, model, d) === "draft").map((d) => d.id);
  if (drafts.length) return { kind: "release", deliverableIds: drafts };

  const confirm = mandatory.filter((d) => deliverableStatus(s, model, d) === "confirm").map((d) => d.id);
  if (confirm.length) return { kind: "checklist", deliverableIds: confirm };

  const involve = openParticipation(s, model, phase.id).map((x) => x.id);
  if (involve.length) return { kind: "involve", participantIds: involve };

  const rechecks = openRechecks(s).map((c) => c.id);
  if (rechecks.length) return { kind: "recheck", crIds: rechecks };

  if (gateStatus(s, model, phase.id) === "ready") return { kind: "gate" };
  return { kind: "idle" };
}
