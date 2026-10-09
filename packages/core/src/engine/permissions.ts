// Who may do what (architecture §6). Every command in the API goes through one
// of these checks. Agents never get decision operations: these checks require a
// human viewer holding the role, and the agent runtime has no tool for them.

import type { HermesModel } from "../model";
import { PROJECT_ROLE_LABELS, RESTRICTED_READERS } from "../model/roles";
import type {
  ApproverDef,
  ChecklistDef,
  DeliverableDef,
  GlobalRole,
  PhaseId,
  ProjectRole,
  SkillDef,
} from "../model/types";
import { isInvolved, participantsFor } from "./participation";
import { checklistKey, type ProjectState } from "./state";
import {
  checklistAvailable,
  deliverableStatus,
  gateStatus,
  isFinished,
  isPhaseClosed,
  isPhaseCurrent,
  pendingApprovers,
  skillStatus,
  unmetPreconditions,
} from "./status";

export interface Viewer {
  userId: string;
  displayName: string;
  globalRoles: readonly GlobalRole[];
}

export type Check = { ok: true } | { ok: false; code: "forbidden" | "invalid_state"; reason: string };

const OK: Check = { ok: true };
const forbidden = (reason: string): Check => ({ ok: false, code: "forbidden", reason });
const invalid = (reason: string): Check => ({ ok: false, code: "invalid_state", reason });

export function rolesOf(s: ProjectState, userId: string): ProjectRole[] {
  return s.members[userId]?.roles ?? [];
}

const hasGlobal = (v: Viewer, ...roles: GlobalRole[]) => roles.some((r) => v.globalRoles.includes(r));
const isPL = (s: ProjectState, v: Viewer) => rolesOf(s, v.userId).includes("PL");
const labels = (roles: readonly ProjectRole[]) => roles.map((r) => PROJECT_ROLE_LABELS[r]).join(", ");

export function canViewProject(s: ProjectState, v: Viewer): boolean {
  return rolesOf(s, v.userId).length > 0 || hasGlobal(v, "HH.PMO", "HH.Portfolio");
}

export function canViewDeliverableContent(s: ProjectState, v: Viewer, d: DeliverableDef): boolean {
  if (!d.restricted) return true;
  return rolesOf(s, v.userId).some((r) => RESTRICTED_READERS.includes(r));
}

/** A skill's output is restricted if it contributes to any restricted deliverable. */
export function canViewSkillContent(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  skill: SkillDef,
): boolean {
  return model.deliverablesOfSkill(skill.id).every((d) => canViewDeliverableContent(s, v, d));
}

function mayWorkOn(s: ProjectState, v: Viewer, skill: SkillDef): boolean {
  const roles = rolesOf(s, v.userId);
  return roles.includes("PL") || skill.mayStart.some((r) => roles.includes(r));
}

export function checkStartSkill(s: ProjectState, model: HermesModel, v: Viewer, skill: SkillDef): Check {
  if (!mayWorkOn(s, v, skill)) {
    const who = ["PL" as ProjectRole, ...skill.mayStart];
    return forbidden(`«${skill.name}» können nur diese Rollen anstossen: ${labels(who)}.`);
  }
  if (!isPhaseCurrent(s, skill.phase)) return invalid(`«${skill.name}» gehört nicht zur aktuellen Phase.`);
  const st = skillStatus(s, model, skill);
  if (st === "running") return invalid(`«${skill.name}» läuft bereits.`);
  if (st !== "ready") return invalid(`Für «${skill.name}» liegt bereits ein Ergebnis vor.`);
  const delivs = model.deliverablesOfSkill(skill.id);
  if (delivs.length && delivs.every((d) => s.notApplicable[d.id])) {
    return invalid(`Die Ergebnisse von «${skill.name}» sind als nicht zutreffend markiert.`);
  }
  const unmet = unmetPreconditions(s, model, skill);
  if (unmet.length) {
    return invalid(`Zuerst muss «${unmet.map((x) => x.name).join("», «")}» entschieden sein.`);
  }
  return OK;
}

export function checkEditOutput(s: ProjectState, model: HermesModel, v: Viewer, skill: SkillDef): Check {
  if (!mayWorkOn(s, v, skill)) return forbidden(`Du darfst «${skill.outputDoc}» nicht bearbeiten.`);
  if (!canViewSkillContent(s, model, v, skill))
    return forbidden("Der Inhalt ist für deine Rolle eingeschränkt.");
  if (!isPhaseCurrent(s, skill.phase))
    return invalid("Ergebnisse abgeschlossener Phasen sind schreibgeschützt.");
  const st = s.skills[skill.id];
  if (st?.runningRunId) return invalid("Der Entwurf entsteht gerade.");
  if (!st?.output) return invalid("Es liegt noch kein Entwurf vor.");
  return OK;
}

export function checkRelease(s: ProjectState, model: HermesModel, v: Viewer, d: DeliverableDef): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung gibt Ergebnisse frei.");
  if (!isPhaseCurrent(s, d.phase)) return invalid("Das Ergebnis gehört nicht zur aktuellen Phase.");
  if (deliverableStatus(s, model, d) !== "draft")
    return invalid("Das Ergebnis wartet nicht auf eine Freigabe.");
  return OK;
}

/** Approver roles of `skill` that are still pending and held by the viewer. */
export function decisionRolesFor(s: ProjectState, v: Viewer, skill: SkillDef): ApproverDef[] {
  const roles = rolesOf(s, v.userId);
  return pendingApprovers(s, skill).filter((a) => roles.includes(a.role));
}

export function checkDecideSkill(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  skill: SkillDef,
  role: ProjectRole,
): Check {
  if (!rolesOf(s, v.userId).includes(role)) {
    return forbidden(`Du hast in diesem Vorhaben nicht die Rolle ${PROJECT_ROLE_LABELS[role]}.`);
  }
  if (!isPhaseCurrent(s, skill.phase)) return invalid("Der Schritt gehört nicht zur aktuellen Phase.");
  const st = skillStatus(s, model, skill);
  if (st !== "approval" && st !== "veto") return invalid(`Für «${skill.name}» ist kein Entscheid offen.`);
  if (!pendingApprovers(s, skill).some((a) => a.role === role)) {
    return invalid(`Die Rolle ${PROJECT_ROLE_LABELS[role]} hat bereits entschieden.`);
  }
  return OK;
}

export function checkMarkNotApplicable(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  d: DeliverableDef,
): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung kann Ergebnisse als nicht zutreffend markieren.");
  if (d.requirement !== "situativ") return invalid("Pflichtergebnisse können nicht abgewählt werden.");
  if (isPhaseClosed(s, model, d.phase)) return invalid("Die Phase ist abgeschlossen.");
  const st = deliverableStatus(s, model, d);
  if (st !== "open" && st !== "planned") return invalid("Nur offene Ergebnisse können abgewählt werden.");
  return OK;
}

export function checkReactivate(s: ProjectState, model: HermesModel, v: Viewer, d: DeliverableDef): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung kann Ergebnisse reaktivieren.");
  if (isPhaseClosed(s, model, d.phase)) return invalid("Die Phase ist abgeschlossen.");
  if (deliverableStatus(s, model, d) !== "na")
    return invalid("Das Ergebnis ist nicht als nicht zutreffend markiert.");
  return OK;
}

export function checkRecordParticipation(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  phase: PhaseId,
  participantId: string,
): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung erfasst die Beteiligung.");
  if (!isPhaseCurrent(s, phase))
    return invalid("Beteiligung lässt sich nur in der aktuellen Phase erfassen.");
  if (!participantsFor(model, s.profile, phase).some((x) => x.id === participantId)) {
    return invalid("Diese Beteiligung gibt es in der Phase nicht.");
  }
  if (isInvolved(s, model, phase, participantId)) return invalid("Bereits als einbezogen erfasst.");
  return OK;
}

/** Find the checklist owned by a deliverable or skill. */
export function findChecklist(
  model: HermesModel,
  ownerId: string,
): { phase: PhaseId; checklist: ChecklistDef } | undefined {
  const d = model.findDeliverable(ownerId);
  if (d?.checklist) return { phase: d.phase, checklist: d.checklist };
  const sk = model.findSkill(ownerId);
  if (sk?.checklist) return { phase: sk.phase, checklist: sk.checklist };
  return undefined;
}

export function checkConfirmChecklistItem(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  ownerId: string,
  itemId: string,
): Check {
  const found = findChecklist(model, ownerId);
  const item = found?.checklist.items.find((x) => x.id === itemId);
  if (!found || !item) return invalid("Diesen Prüfpunkt gibt es nicht.");
  if (!isPL(s, v) && !rolesOf(s, v.userId).includes(item.ownerRole)) {
    return forbidden(
      `Diesen Punkt bestätigt die Rolle ${PROJECT_ROLE_LABELS[item.ownerRole]} oder die Projektleitung.`,
    );
  }
  if (!isPhaseCurrent(s, found.phase)) return invalid("Die Checkliste gehört nicht zur aktuellen Phase.");
  if (!checklistAvailable(s, model, found.checklist)) {
    const pre = model.skill(found.checklist.availableAfterSkill);
    return invalid(`Zuerst muss «${pre.name}» ein Ergebnis liefern.`);
  }
  if (s.checklist[checklistKey(ownerId, itemId)]) return invalid("Bereits bestätigt.");
  return OK;
}

export function checkDecideGate(s: ProjectState, model: HermesModel, v: Viewer, phase: PhaseId): Check {
  const gate = model.phase(phase).gate;
  const roles = rolesOf(s, v.userId);
  const allowed =
    gate.deciders.some((r) => roles.includes(r)) || gate.globalDeciders.some((r) => hasGlobal(v, r));
  if (!allowed) return forbidden(`Das Gate «${gate.name}» entscheidet: ${gate.deciderLabel}.`);
  if (!isPhaseCurrent(s, phase)) return invalid("Das Gate gehört nicht zur aktuellen Phase.");
  if (gateStatus(s, model, phase) !== "ready")
    return invalid("Das Gate ist noch nicht bereit für den Entscheid.");
  return OK;
}

export function checkCompleteCondition(s: ProjectState, v: Viewer, conditionId: string): Check {
  const c = s.conditions[conditionId];
  if (!c) return invalid("Diese Auflage gibt es nicht.");
  if (!isPL(s, v) && !rolesOf(s, v.userId).includes(c.ownerRole)) {
    return forbidden(
      `Diese Auflage erledigt die Rolle ${PROJECT_ROLE_LABELS[c.ownerRole]} oder die Projektleitung.`,
    );
  }
  if (c.doneAt) return invalid("Die Auflage ist bereits erledigt.");
  return OK;
}

export function checkManageMembers(s: ProjectState, v: Viewer): Check {
  if (!isPL(s, v) && !hasGlobal(v, "HH.PMO"))
    return forbidden("Nur Projektleitung und PMO verwalten Rollen.");
  return OK;
}

export function checkUpdateProfile(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung ändert das Vorhabensprofil.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

export function canVerifyAudit(s: ProjectState, v: Viewer): boolean {
  return isPL(s, v) || hasGlobal(v, "HH.PMO");
}

export function canCreateProject(v: Viewer): boolean {
  return hasGlobal(v, "HH.PMO");
}

/** Sees every project (PMO, Portfolio-Gremium). */
export function seesAllProjects(v: Viewer): boolean {
  return hasGlobal(v, "HH.PMO", "HH.Portfolio");
}
