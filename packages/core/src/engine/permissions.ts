// Who may do what (architecture §6). Every command in the API goes through one
// of these checks. Agents never get decision operations: these checks require a
// human viewer holding the role, and the agent runtime has no tool for them.

import type { HermesModel } from "../model";
import { CR_RECHECK_ROLES, type RecheckRole } from "../model/change-requests";
import { CONTROL_ROLES, roleConflict } from "../model/policy";
import { PROJECT_ROLE_LABELS, RESTRICTED_READERS } from "../model/roles";
import {
  PROJECT_ROLES,
  type ApproverDef,
  type ChecklistDef,
  type DeliverableDef,
  type GlobalRole,
  type PhaseId,
  type ProjectRole,
  type SkillDef,
} from "../model/types";
import { pendingRecheckRoles } from "./change-requests";
import { isInvolved, participantsFor } from "./participation";
import { checklistKey, type ChangeRequestState, type ProjectState } from "./state";
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
const sod = (model: HermesModel) => model.policy.separationOfDuties;

/**
 * Separation of duties when a control role acts: the role does not count while
 * the same person also holds a role it must be kept apart from. Assigning such
 * a combination is refused (checkAssignRole); this covers roles given before
 * the policy applied, for example in a test environment.
 */
function separated(s: ProjectState, model: HermesModel, v: Viewer, role: ProjectRole): Check {
  const clash = sod(model) ? roleConflict(rolesOf(s, v.userId), role) : undefined;
  if (!clash) return OK;
  return forbidden(
    `Du hast in diesem Vorhaben auch die Rolle ${PROJECT_ROLE_LABELS[clash]}. Als ${PROJECT_ROLE_LABELS[role]} handelt hier eine andere Person (Funktionentrennung); das PMO passt die Rollen an.`,
  );
}

/** Four-eyes principle: nobody decides or rechecks a change request they submitted. */
const ownRequest = (model: HermesModel, v: Viewer, cr: ChangeRequestState) =>
  sod(model) && cr.submittedBy.userId === v.userId;

export function canViewProject(s: ProjectState, v: Viewer): boolean {
  return rolesOf(s, v.userId).length > 0 || hasGlobal(v, "HH.PMO", "HH.Portfolio");
}

/**
 * Need-to-know for restricted deliverables (SchuBAn, ISDS, DSFA …): the
 * governance roles plus the roles that contribute to this deliverable.
 */
export function canViewDeliverableContent(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  d: DeliverableDef,
): boolean {
  if (!d.restricted) return true;
  const roles = rolesOf(s, v.userId);
  if (roles.some((r) => RESTRICTED_READERS.includes(r))) return true;
  return d.skills.some((id) => model.skill(id).mayStart.some((r) => roles.includes(r)));
}

/** A skill's output is restricted if it contributes to any restricted deliverable. */
export function canViewSkillContent(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  skill: SkillDef,
): boolean {
  return model.deliverablesOfSkill(skill.id).every((d) => canViewDeliverableContent(s, model, v, d));
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

/** Approver roles of `skill` that are still pending and in which the viewer may decide. */
export function decisionRolesFor(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  skill: SkillDef,
): ApproverDef[] {
  const roles = rolesOf(s, v.userId);
  return pendingApprovers(s, skill).filter(
    (a) => roles.includes(a.role) && separated(s, model, v, a.role).ok,
  );
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
  const separate = separated(s, model, v, role);
  if (!separate.ok) return separate;
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
  if (sod(model) && isPL(s, v)) {
    return forbidden(
      "Die Projektleitung entscheidet nicht über das Gate des eigenen Vorhabens (Funktionentrennung).",
    );
  }
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

/** Under separation of duties the PMO assigns and removes the control roles; the project lead the others. */
function checkManageRole(s: ProjectState, model: HermesModel, v: Viewer, role: ProjectRole): Check {
  if (sod(model) && CONTROL_ROLES.includes(role) && !hasGlobal(v, "HH.PMO")) {
    return forbidden(
      `Die Rolle ${PROJECT_ROLE_LABELS[role]} vergibt und entzieht das PMO (Funktionentrennung).`,
    );
  }
  return checkManageMembers(s, v);
}

/** The roles the viewer may assign and remove in the project. */
export function assignableRoles(s: ProjectState, model: HermesModel, v: Viewer): ProjectRole[] {
  return PROJECT_ROLES.filter((r) => checkManageRole(s, model, v, r).ok);
}

export function checkAssignRole(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  userId: string,
  role: ProjectRole,
): Check {
  const manage = checkManageRole(s, model, v, role);
  if (!manage.ok) return manage;
  const held = rolesOf(s, userId);
  if (held.includes(role)) return invalid("Die Person hat diese Rolle bereits.");
  const clash = sod(model) ? roleConflict(held, role) : undefined;
  if (clash) {
    return invalid(
      `Die Person hat bereits die Rolle ${PROJECT_ROLE_LABELS[clash]}. Die Rolle ${PROJECT_ROLE_LABELS[role]} nimmt eine andere Person wahr (Funktionentrennung).`,
    );
  }
  return OK;
}

export function checkRemoveRole(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  userId: string,
  role: ProjectRole,
): Check {
  const manage = checkManageRole(s, model, v, role);
  if (!manage.ok) return manage;
  if (!rolesOf(s, userId).includes(role)) return invalid("Die Person hat diese Rolle nicht.");
  const leads = Object.values(s.members).filter((m) => m.roles.includes("PL")).length;
  if (role === "PL" && leads <= 1) return invalid("Mindestens eine Projektleitung muss im Vorhaben bleiben.");
  return OK;
}

export function checkUpdateProfile(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!isPL(s, v)) return forbidden("Nur die Projektleitung ändert das Vorhabensprofil.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

// ---------- Change Requests ----------

/** Anyone with a role in the project may submit a change request. */
export function checkSubmitChangeRequest(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!rolesOf(s, v.userId).length) {
    return forbidden("Change Requests erfassen die Mitglieder des Vorhabens.");
  }
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

/** The requester or the PL withdraws an open request. */
export function checkWithdrawChangeRequest(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  crId: string,
): Check {
  const cr = s.changeRequests[crId];
  if (!cr) return invalid("Diesen Change Request gibt es nicht.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  if (cr.submittedBy.userId !== v.userId && !isPL(s, v)) {
    return forbidden("Zurückziehen können die erfassende Person und die Projektleitung.");
  }
  if (cr.status !== "offen") return invalid("Der Change Request ist bereits entschieden oder zurückgezogen.");
  return OK;
}

/** The Projektausschuss decides change requests, with Konsent. */
export function checkDecideChangeRequest(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  crId: string,
): Check {
  const cr = s.changeRequests[crId];
  if (!cr) return invalid("Diesen Change Request gibt es nicht.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  if (!rolesOf(s, v.userId).includes("PA")) {
    return forbidden(`Change Requests entscheidet die Rolle ${PROJECT_ROLE_LABELS.PA}.`);
  }
  if (cr.status !== "offen") return invalid("Der Change Request ist bereits entschieden oder zurückgezogen.");
  if (ownRequest(model, v, cr)) {
    return forbidden(
      "Über einen eigenen Change Request entscheidet ein anderes Mitglied des Projektausschusses (Vier-Augen-Prinzip).",
    );
  }
  return separated(s, model, v, "PA");
}

/** ISM and Datenschutz each confirm the recheck after an accepted request touching personal data. */
export function checkConfirmRecheck(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  crId: string,
  role: RecheckRole,
): Check {
  const cr = s.changeRequests[crId];
  if (!cr) return invalid("Diesen Change Request gibt es nicht.");
  if (!(cr.recheckRoles ?? CR_RECHECK_ROLES).includes(role)) {
    return invalid("Die Neuprüfung bestätigen ISM und Datenschutz.");
  }
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  if (!rolesOf(s, v.userId).includes(role)) {
    return forbidden(`Diesen Teil der Neuprüfung bestätigt die Rolle ${PROJECT_ROLE_LABELS[role]}.`);
  }
  if (!pendingRecheckRoles(cr).includes(role)) return invalid("Für diese Rolle ist keine Neuprüfung offen.");
  if (ownRequest(model, v, cr)) {
    return forbidden(
      `Die Neuprüfung eines eigenen Change Requests bestätigt eine andere Person mit der Rolle ${PROJECT_ROLE_LABELS[role]} (Vier-Augen-Prinzip).`,
    );
  }
  return separated(s, model, v, role);
}

/** The PL records the reserve for changes from the project order. */
export function checkSetChangeReserve(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!isPL(s, v)) return forbidden("Die Reserve erfasst die Projektleitung gemäss Projektauftrag.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

// ---------- Risks ----------

/** Anyone with a role in the project may record a risk. */
export function checkRecordRisk(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!rolesOf(s, v.userId).length) return forbidden("Risiken erfassen die Mitglieder des Vorhabens.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

/** The PL or the role responsible for the risk assesses, updates and closes it. */
export function checkAssessRisk(s: ProjectState, model: HermesModel, v: Viewer, riskId: string): Check {
  const r = s.risks[riskId];
  if (!r) return invalid("Dieses Risiko gibt es nicht.");
  if (!isPL(s, v) && !rolesOf(s, v.userId).includes(r.ownerRole)) {
    return forbidden(
      `Dieses Risiko beurteilen die Projektleitung und die Rolle ${PROJECT_ROLE_LABELS[r.ownerRole]}.`,
    );
  }
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

/** The PL asks the Risiko agent for proposals and decides which to accept. */
export function checkReviewRisks(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!isPL(s, v)) return forbidden("Die Risikoprüfung durch den Agenten stösst die Projektleitung an.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

// ---------- Status reports ----------

/** The project lead writes and publishes the status report. */
export function checkPublishStatusReport(s: ProjectState, model: HermesModel, v: Viewer): Check {
  if (!isPL(s, v)) return forbidden("Den Statusbericht erstellt die Projektleitung.");
  if (isFinished(s, model)) return invalid("Das Vorhaben ist abgeschlossen.");
  return OK;
}

/** The Projektausschuss takes note of the latest report, once. */
export function checkAcknowledgeStatusReport(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  reportId: string,
): Check {
  const r = s.statusReports[reportId];
  if (!r) return invalid("Diesen Statusbericht gibt es nicht.");
  if (!rolesOf(s, v.userId).includes("PA")) {
    return forbidden(`Zur Kenntnis nimmt den Statusbericht die Rolle ${PROJECT_ROLE_LABELS.PA}.`);
  }
  const separate = separated(s, model, v, "PA");
  if (!separate.ok) return separate;
  const latest = Object.values(s.statusReports).every((x) => x.number <= r.number);
  if (!latest) return invalid("Es gibt einen neueren Statusbericht.");
  if (r.acknowledgements.length) return invalid("Der Statusbericht wurde bereits zur Kenntnis genommen.");
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
