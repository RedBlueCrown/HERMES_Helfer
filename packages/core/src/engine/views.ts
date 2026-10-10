// View models: what the API returns and the UI renders. Built per viewer, so
// actions, restricted content and tasks already reflect the viewer's roles.

import type { HermesModel } from "../model";
import {
  CR_DAY_RATE_CHF,
  CR_RECHECK_DELIVERABLES,
  CR_RECHECK_ROLES,
  type CrFlags,
  type RecheckOutcome,
  type RecheckRole,
} from "../model/change-requests";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import type {
  AgentId,
  ApproverDef,
  ChecklistDef,
  DeliverableDef,
  Origin,
  PhaseId,
  ProjectProfile,
  ProjectRole,
  Requirement,
  SkillDef,
} from "../model/types";
import {
  CR_STATUS_LABELS,
  changeImpact,
  crCostChf,
  impactContext,
  crLabel,
  impactSummary,
  openChangeRequests,
  openRechecks,
  pendingRecheckRoles,
  reserveStatus,
  type ImpactRow,
  type ReserveStatus,
} from "./change-requests";
import { conditionDue, isConditionOverdue } from "./conditions";
import type { Decision, DraftContent, Finding, Producer } from "./events";
import { isInvolved, participantsFor } from "./participation";
import {
  canVerifyAudit,
  canViewDeliverableContent,
  canViewSkillContent,
  checkCompleteCondition,
  checkConfirmChecklistItem,
  checkConfirmRecheck,
  checkDecideChangeRequest,
  checkDecideGate,
  checkEditOutput,
  checkManageMembers,
  checkMarkNotApplicable,
  checkReactivate,
  checkRecordParticipation,
  checkRelease,
  checkSetChangeReserve,
  checkStartSkill,
  checkSubmitChangeRequest,
  checkUpdateProfile,
  checkWithdrawChangeRequest,
  decisionRolesFor,
  rolesOf,
  type Check,
  type Viewer,
} from "./permissions";
import {
  checklistKey,
  participationKey,
  type ActorRef,
  type ApprovalRecord,
  type ChangeRequestState,
  type ChangeRequestStatus,
  type ConditionState,
  type ProjectState,
} from "./state";
import {
  checklistAvailable,
  contentVersion,
  deliverableStatus,
  gateCriteria,
  gateStatus,
  isFinished,
  isPhaseClosed,
  isPhaseCurrent,
  isPhaseFuture,
  mandatoryProgress,
  pendingApprovers,
  skillStatus,
  unmetPreconditions,
  type DeliverableStatus,
  type GateCriterion,
  type GateStatus,
  type SkillStatus,
} from "./status";
import { myTasks, nextStep, type MyTask, type NextStep } from "./tasks";

// ---------- Labels ----------

export const SKILL_STATUS_LABELS: Readonly<Record<SkillStatus, string>> = {
  planned: "Geplant",
  ready: "Bereit",
  running: "Entwurf entsteht",
  approval: "Wartet auf Entscheid",
  veto: "Wartet auf Entscheid (Veto)",
  done: "Erledigt",
};

export const GATE_STATUS_LABELS: Readonly<Record<GateStatus, string>> = {
  passed: "Bestanden",
  historic: "Bestanden (vor Erfassung)",
  preview: "Noch nicht erreicht",
  blocked: "Blockiert",
  ready: "Bereit zum Entscheid",
  open: "Offen",
};

export function deliverableStatusLabel(d: DeliverableDef, st: DeliverableStatus, aiDraft: boolean): string {
  switch (st) {
    case "done":
      return d.preExisting ? "Liegt vor" : "Freigegeben";
    case "draft":
      return aiDraft ? "Entwurf (KI)" : "Entwurf";
    case "approval":
      return "Wartet auf Entscheid";
    case "veto":
      return "Wartet auf Entscheid (Veto)";
    case "confirm":
      return "Bestätigung offen";
    case "running":
      return "Entwurf entsteht";
    case "na":
      return "Nicht zutreffend";
    case "planned":
      return "Geplant";
    case "open":
      return d.requirement === "pflicht" ? "Offen" : "Bei Bedarf";
  }
}

// ---------- Types ----------

export interface ActionView {
  kind: "start" | "release" | "decide" | "confirm";
  label: string;
  skillId?: string;
  enabled: boolean;
  reason?: string;
}

export interface DeliverableRowView {
  id: string;
  name: string;
  requirement: Requirement;
  kind: string;
  origin: Origin;
  restricted: boolean;
  status: DeliverableStatus;
  statusLabel: string;
  aiDraft: boolean;
  findings: number;
  waitingFor: string[];
  preExistingBy?: string;
  /** Send back with a release, see contentVersion in status.ts. */
  contentVersion: string;
  action: ActionView | null;
}

export interface ConditionView {
  id: string;
  text: string;
  ownerRole: ProjectRole;
  ownerLabel: string;
  due: string;
  /** When the Auflage is due: a date (ISO) … */
  dueAt?: string;
  /** … or the name of the gate it is due at. */
  dueGate?: string;
  /** Still open after its date, or after its gate was passed. */
  overdue: boolean;
  phase: PhaseId;
  sourceLabel: string;
  createdAt: string;
  createdBy: ActorRef;
  done: boolean;
  doneAt?: string;
  doneBy?: ActorRef;
  doneNote?: string;
  canComplete: boolean;
}

export interface GateDecisionView {
  decision: Decision;
  reason: string;
  konsent: boolean;
  at: string;
  by: ActorRef;
  conditions: ConditionView[];
}

export interface GateView {
  name: string;
  deciderLabel: string;
  note: string;
  status: GateStatus;
  statusLabel: string;
  requiresKonsent: boolean;
  criteria: GateCriterion[];
  canDecide: Check;
  decisions: GateDecisionView[];
}

export interface ParticipantView {
  id: string;
  label: string;
  why: string;
  required: boolean;
  triggers: string[];
  ownerRole: ProjectRole;
  ownerLabel: string;
  involved: boolean;
  how?: string;
  at?: string;
  by?: ActorRef;
  canRecord: boolean;
}

export interface PhaseView {
  id: PhaseId;
  label: string;
  description: string;
  extension: boolean;
  current: boolean;
  closed: boolean;
  future: boolean;
  gate: GateView;
  mandatory: { done: number; total: number };
  deliverables: DeliverableRowView[];
  participants: ParticipantView[];
}

export interface TaskView {
  kind: MyTask["kind"];
  title: string;
  detail: string;
  deliverableId?: string;
  skillId?: string;
  role?: ProjectRole;
  conditionId?: string;
  ownerId?: string;
  itemId?: string;
  phase?: PhaseId;
  participantId?: string;
  crId?: string;
}

export interface NextStepView {
  kind: NextStep["kind"];
  title: string;
  detail: string;
  skillId?: string;
  deliverableId?: string;
  crId?: string;
  actionLabel?: string;
  /** Whether the viewer can perform the step themselves. */
  canAct: boolean;
}

export interface MemberView {
  userId: string;
  displayName: string;
  roles: ProjectRole[];
}

export interface ProjectView {
  projectId: string;
  code: string;
  name: string;
  description: string;
  phase: PhaseId;
  phaseLabel: string;
  modelVersion: string;
  lastSeq: number;
  updatedAt: string;
  finished: boolean;
  myRoles: ProjectRole[];
  profile: ProjectProfile;
  canEditProfile: Check;
  phases: PhaseView[];
  members: MemberView[];
  conditions: ConditionView[];
  nextStep: NextStepView;
  myTasks: TaskView[];
  /** For the tab of the register; the requests themselves: changeRequestRegister. */
  changeRequests: { total: number; open: number; openRechecks: number };
  can: { manageMembers: boolean; verifyAudit: boolean };
}

export interface ChangeRequestView {
  id: string;
  number: number;
  /** CR-01 … */
  label: string;
  title: string;
  requestedBy: string;
  submittedAt: string;
  submittedBy: ActorRef;
  effortDays: number;
  costChf: number;
  flags: CrFlags;
  content: DraftContent;
  findings: Finding[];
  producer: Producer;
  status: ChangeRequestStatus;
  statusLabel: string;
  impact: ImpactRow[];
  impactSummary: string;
  decision?: { decision: Decision; reason: string; konsent: boolean; at: string; by: ActorRef };
  withdrawn?: { reason: string; at: string; by: ActorRef };
  /** Accepted requests that touch personal data. */
  recheck?: {
    done: boolean;
    deliverables: { id: string; name: string }[];
    roles: {
      role: RecheckRole;
      label: string;
      confirmed?: { outcome: RecheckOutcome; note: string; at: string; by: ActorRef };
      canConfirm: boolean;
    }[];
  };
  conditions: ConditionView[];
  canDecide: Check;
  canWithdraw: Check;
}

export interface ChangeRequestRegisterView {
  dayRateChf: number;
  reserve: ReserveStatus & { canSet: Check };
  canSubmit: Check;
  /** Newest first. */
  items: ChangeRequestView[];
}

export interface ChecklistItemView {
  id: string;
  label: string;
  ownerRole: ProjectRole;
  ownerLabel: string;
  confirmed?: { at: string; by: ActorRef; note: string };
  canConfirm: boolean;
}

export interface ChecklistView {
  ownerId: string;
  title: string;
  requiredFor: ChecklistDef["requiredFor"];
  available: boolean;
  items: ChecklistItemView[];
}

export interface SkillOutputView {
  version: number;
  createdAt: string;
  requestedBy: ActorRef;
  producer: Producer;
  editedAt?: string;
  editedBy?: ActorRef;
  findings: Finding[];
  /** null when the content is restricted for the viewer. */
  draft: DraftContent | null;
}

export interface SkillView {
  id: string;
  name: string;
  agentId: AgentId | null;
  agentName: string | null;
  mode: SkillDef["mode"];
  description: string;
  outputDoc: string;
  sections: readonly string[];
  status: SkillStatus;
  statusLabel: string;
  veto: boolean;
  approvers: (ApproverDef & { decision?: ApprovalRecord })[];
  myDecisionRoles: ApproverDef[];
  output?: SkillOutputView;
  contentVisible: boolean;
  lastError?: { reason: string; at: string };
  lastRejection?: { role: ProjectRole; reason: string; at: string; by: ActorRef };
  canStart: Check;
  canEdit: Check;
  unmetPreconditions: string[];
  checklist?: ChecklistView;
}

export interface DeliverableDetailView {
  id: string;
  name: string;
  requirement: Requirement;
  kind: string;
  origin: Origin;
  restricted: boolean;
  phase: PhaseId;
  phaseLabel: string;
  status: DeliverableStatus;
  statusLabel: string;
  preExistingBy?: string;
  contentVersion: string;
  contentVisible: boolean;
  skills: SkillView[];
  checklist?: ChecklistView;
  notApplicable?: { reason: string; at: string; by: ActorRef };
  released?: { at: string; by: ActorRef };
  canRelease: Check;
  canMarkNotApplicable: Check;
  canReactivate: Check;
  conditions: ConditionView[];
}

// ---------- Builders ----------

const roleLabel = (r: ProjectRole) => PROJECT_ROLE_LABELS[r];

function hasAiDraft(s: ProjectState, d: DeliverableDef): boolean {
  return d.skills.some((id) => s.skills[id]?.output?.producer.kind === "ai");
}

function conditionView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  c: ConditionState,
  now: Date,
): ConditionView {
  const [kind, id] = c.source.split(":") as [string, string];
  const cr = kind === "cr" ? s.changeRequests[id] : undefined;
  const sourceLabel =
    kind === "gate"
      ? `Gate «${model.phase(id as PhaseId).gate.name}»`
      : kind === "cr"
        ? `Entscheid zu ${cr ? crLabel(cr.number) : "Change Request"}`
        : `Entscheid zu «${model.skill(id).name}»`;
  const due = conditionDue(model, c);
  return {
    id: c.id,
    text: c.text,
    ownerRole: c.ownerRole,
    ownerLabel: roleLabel(c.ownerRole),
    due: c.due,
    ...(due.kind === "date" ? { dueAt: due.at } : {}),
    ...(due.kind === "gate" ? { dueGate: model.phase(due.phase).gate.name } : {}),
    overdue: isConditionOverdue(s, model, c, now),
    phase: c.phase,
    sourceLabel,
    createdAt: c.createdAt,
    createdBy: c.createdBy,
    done: !!c.doneAt,
    ...(c.doneAt ? { doneAt: c.doneAt } : {}),
    ...(c.doneBy ? { doneBy: c.doneBy } : {}),
    ...(c.doneNote ? { doneNote: c.doneNote } : {}),
    canComplete: checkCompleteCondition(s, v, c.id).ok,
  };
}

function rowAction(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  d: DeliverableDef,
  st: DeliverableStatus,
): ActionView | null {
  if (!isPhaseCurrent(s, d.phase) || d.preExisting) return null;
  switch (st) {
    case "open": {
      const ready = d.skills
        .map((id) => model.skill(id))
        .filter((sk) => skillStatus(s, model, sk) === "ready");
      const first = ready[0];
      if (!first) return null;
      const startable = ready.find((sk) => checkStartSkill(s, model, v, sk).ok);
      const target = startable ?? first;
      const check = checkStartSkill(s, model, v, target);
      return {
        kind: "start",
        label: target.mode === "manual" ? "Ergebnis erfassen" : "Entwurf erstellen",
        skillId: target.id,
        enabled: check.ok,
        ...(check.ok ? {} : { reason: check.reason }),
      };
    }
    case "approval":
    case "veto": {
      const mine = d.skills
        .map((id) => model.skill(id))
        .find(
          (sk) =>
            ["approval", "veto"].includes(skillStatus(s, model, sk)) && decisionRolesFor(s, v, sk).length,
        );
      return mine ? { kind: "decide", label: "Prüfen & entscheiden", skillId: mine.id, enabled: true } : null;
    }
    case "draft": {
      const check = checkRelease(s, model, v, d);
      return check.ok ? { kind: "release", label: "Freigeben", enabled: true } : null;
    }
    case "confirm": {
      const cl = d.checklist;
      if (!cl) return null;
      const can = cl.items.some((it) => checkConfirmChecklistItem(s, model, v, d.id, it.id).ok);
      return can ? { kind: "confirm", label: "Bestätigen", enabled: true } : null;
    }
    default:
      return null;
  }
}

function deliverableRow(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  d: DeliverableDef,
): DeliverableRowView {
  const st = deliverableStatus(s, model, d);
  const ai = hasAiDraft(s, d);
  const findings = canViewDeliverableContent(s, model, v, d)
    ? d.skills.reduce((n, id) => n + (s.skills[id]?.output?.findings.length ?? 0), 0)
    : 0;
  const waitingFor =
    st === "approval" || st === "veto"
      ? [...new Set(d.skills.flatMap((id) => pendingApprovers(s, model.skill(id)).map((a) => a.label)))]
      : [];
  return {
    id: d.id,
    name: d.name,
    requirement: d.requirement,
    kind: d.kind,
    origin: d.origin,
    restricted: d.restricted,
    status: st,
    statusLabel: deliverableStatusLabel(d, st, ai),
    aiDraft: ai,
    findings,
    waitingFor,
    ...(d.preExisting ? { preExistingBy: d.preExisting.by } : {}),
    contentVersion: contentVersion(s, d),
    action: rowAction(s, model, v, d, st),
  };
}

function participantViews(s: ProjectState, model: HermesModel, v: Viewer, phase: PhaseId): ParticipantView[] {
  return participantsFor(model, s.profile, phase).map((x) => {
    const rec = s.participation[participationKey(phase, x.id)];
    return {
      id: x.id,
      label: x.label,
      why: x.why,
      required: x.required,
      triggers: x.triggers,
      ownerRole: x.ownerRole,
      ownerLabel: roleLabel(x.ownerRole),
      involved: isInvolved(s, model, phase, x.id),
      ...(rec ? { how: rec.how, at: rec.at, by: rec.by } : {}),
      canRecord: checkRecordParticipation(s, model, v, phase, x.id).ok,
    };
  });
}

function gateView(s: ProjectState, model: HermesModel, v: Viewer, phase: PhaseId, now: Date): GateView {
  const g = model.phase(phase).gate;
  const st = gateStatus(s, model, phase);
  return {
    name: g.name,
    deciderLabel: g.deciderLabel,
    note: g.note,
    status: st,
    statusLabel: GATE_STATUS_LABELS[st],
    requiresKonsent: g.requiresKonsent,
    criteria: gateCriteria(s, model, phase),
    canDecide: checkDecideGate(s, model, v, phase),
    decisions: (s.gateDecisions[phase] ?? []).map((x) => ({
      decision: x.decision,
      reason: x.reason,
      konsent: x.konsent,
      at: x.at,
      by: x.by,
      conditions: x.conditionIds
        .map((id) => s.conditions[id])
        .filter((c): c is ConditionState => !!c)
        .map((c) => conditionView(s, model, v, c, now)),
    })),
  };
}

function taskView(s: ProjectState, model: HermesModel, t: MyTask, now: Date): TaskView {
  switch (t.kind) {
    case "decide-skill": {
      const sk = model.skill(t.skillId);
      const d = model.deliverablesOfSkill(sk.id)[0];
      return {
        kind: t.kind,
        title: `${t.veto ? "Veto-Entscheid" : "Entscheid"}: ${sk.outputDoc}`,
        detail: `Als ${roleLabel(t.role)} prüfen und entscheiden.`,
        skillId: sk.id,
        role: t.role,
        ...(d ? { deliverableId: d.id } : {}),
      };
    }
    case "decide-gate": {
      const g = model.phase(t.phase).gate;
      return {
        kind: t.kind,
        title: `Gate «${g.name}» entscheiden`,
        detail: "Alle Kriterien sind erfüllt.",
        phase: t.phase,
      };
    }
    case "release": {
      const d = model.deliverable(t.deliverableId);
      return {
        kind: t.kind,
        title: `Freigeben: ${d.name}`,
        detail: "Entwurf prüfen und freigeben.",
        deliverableId: d.id,
      };
    }
    case "condition": {
      const c = s.conditions[t.conditionId]!;
      const overdue = isConditionOverdue(s, model, c, now) ? " · überfällig" : "";
      return {
        kind: t.kind,
        title: `Auflage: ${c.text}`,
        detail: `Frist: ${c.due}${overdue}`,
        conditionId: c.id,
      };
    }
    case "checklist": {
      const owner = model.findDeliverable(t.ownerId) ?? model.skill(t.ownerId);
      const cl = owner.checklist!;
      const it = cl.items.find((x) => x.id === t.itemId)!;
      const deliverableId = "requirement" in owner ? owner.id : model.deliverablesOfSkill(owner.id)[0]?.id;
      return {
        kind: t.kind,
        title: `Bestätigen: ${it.label}`,
        detail: cl.title,
        ownerId: t.ownerId,
        itemId: t.itemId,
        ...(deliverableId ? { deliverableId } : {}),
      };
    }
    case "involve": {
      const p = participantsFor(model, s.profile, t.phase).find((x) => x.id === t.participantId);
      return {
        kind: t.kind,
        title: `Einbeziehen: ${p?.label ?? t.participantId}`,
        detail: p?.why ?? "",
        phase: t.phase,
        participantId: t.participantId,
      };
    }
    case "assign-role":
      return {
        kind: t.kind,
        title: `Rolle besetzen: ${roleLabel(t.role)}`,
        detail: "Niemand im Vorhaben hat diese Rolle, die für einen Entscheid nötig ist.",
        role: t.role,
      };
    case "decide-cr": {
      const c = s.changeRequests[t.crId]!;
      return {
        kind: t.kind,
        title: `${crLabel(c.number)} entscheiden: ${c.title}`,
        detail: "Als Projektausschuss mit Konsent entscheiden.",
        crId: c.id,
      };
    }
    case "recheck": {
      const c = s.changeRequests[t.crId]!;
      return {
        kind: t.kind,
        title: `Neuprüfung nach ${crLabel(c.number)}`,
        detail:
          "SchuBAn, Datenschutz-Vorabklärung, ISDS-Konzept und DSFA prüfen. Bis dahin bleibt das Gate zu.",
        crId: c.id,
        role: t.role,
      };
    }
  }
}

function nextStepView(s: ProjectState, model: HermesModel, v: Viewer): NextStepView {
  const n = nextStep(s, model);
  const phase = model.phase(s.phase);
  switch (n.kind) {
    case "run": {
      const sk = model.skill(n.skillId);
      const d = model.deliverable(n.deliverableId);
      return {
        kind: n.kind,
        title: `«${d.name}» erstellen`,
        detail: `Pflichtergebnis für das Gate «${phase.gate.name}». ${sk.mode === "manual" ? "Die zuständige Person erfasst das Ergebnis." : `Der Agent «${sk.name}» erstellt einen Entwurf, ein Mensch gibt ihn frei.`}`,
        skillId: sk.id,
        deliverableId: d.id,
        actionLabel: sk.mode === "manual" ? "Ergebnis erfassen" : "Entwurf erstellen",
        canAct: checkStartSkill(s, model, v, sk).ok,
      };
    }
    case "running":
      return {
        kind: n.kind,
        title: "Entwurf entsteht",
        detail: n.skillIds.map((id) => model.skill(id).outputDoc).join(", "),
        canAct: false,
      };
    case "decisions": {
      const skills = n.skillIds.map((id) => model.skill(id));
      const mine = skills.find((sk) => decisionRolesFor(s, v, sk).length);
      const waiting = [...new Set(skills.flatMap((sk) => pendingApprovers(s, sk).map((a) => a.label)))];
      const first = mine ?? skills[0]!;
      const d = model.deliverablesOfSkill(first.id)[0];
      return {
        kind: n.kind,
        title: `Entscheid nötig: ${waiting.join(", ")}`,
        detail: `Wartet auf: ${skills.map((sk) => sk.outputDoc).join(", ")}.`,
        skillId: first.id,
        ...(d ? { deliverableId: d.id } : {}),
        actionLabel: "Zum Entscheid",
        canAct: !!mine,
      };
    }
    case "release": {
      const names = n.deliverableIds.map((id) => model.deliverable(id).name);
      return {
        kind: n.kind,
        title: `${names.length === 1 ? "1 Entwurf wartet" : `${names.length} Entwürfe warten`} auf Freigabe`,
        detail: names.join(", "),
        deliverableId: n.deliverableIds[0]!,
        actionLabel: "Zum Entwurf",
        canAct: rolesOf(s, v.userId).includes("PL"),
      };
    }
    case "checklist":
      return {
        kind: n.kind,
        title: "Bestätigungen offen",
        detail: n.deliverableIds.map((id) => model.deliverable(id).name).join(", "),
        deliverableId: n.deliverableIds[0]!,
        actionLabel: "Zur Checkliste",
        canAct: true,
      };
    case "involve":
      return {
        kind: n.kind,
        title: `Beteiligte einbeziehen: ${n.participantIds.length} offen`,
        detail: "Ohne sie bleibt das Gate zu.",
        actionLabel: "Zur Beteiligung",
        canAct: rolesOf(s, v.userId).includes("PL"),
      };
    case "recheck": {
      const crs = n.crIds.map((id) => s.changeRequests[id]!);
      const mine = crs.find((c) => pendingRecheckRoles(c).some((r) => rolesOf(s, v.userId).includes(r)));
      return {
        kind: n.kind,
        title: `Neuprüfung nach ${crs.map((c) => crLabel(c.number)).join(", ")}`,
        detail:
          "Ein angenommener Change Request betrifft Personendaten: ISM und Datenschutz prüfen SchuBAn, ISDS-Konzept und DSFA. Bis dahin bleibt das Gate zu.",
        crId: (mine ?? crs[0]!).id,
        actionLabel: "Zur Neuprüfung",
        canAct: !!mine,
      };
    }
    case "gate":
      return {
        kind: n.kind,
        title: `Gate «${phase.gate.name}» entscheiden`,
        detail: `Alle Kriterien sind erfüllt. Entscheid: ${phase.gate.deciderLabel}.`,
        actionLabel: "Gate entscheiden",
        canAct: checkDecideGate(s, model, v, phase.id).ok,
      };
    case "idle":
      return {
        kind: n.kind,
        title: "Keine Pflichtschritte offen",
        detail: "Ergebnisse, die nur bei Bedarf nötig sind, stösst du selbst an.",
        canAct: false,
      };
    case "finished":
      return {
        kind: n.kind,
        title: "Alle Phasen abgeschlossen",
        detail: "Keine offenen Schritte mehr.",
        canAct: false,
      };
  }
}

export function projectView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  now: Date = new Date(),
): ProjectView {
  return {
    projectId: s.projectId,
    code: s.code,
    name: s.name,
    description: s.description,
    phase: s.phase,
    phaseLabel: model.phase(s.phase).label,
    modelVersion: s.modelVersion,
    lastSeq: s.lastSeq,
    updatedAt: s.updatedAt,
    finished: isFinished(s, model),
    myRoles: rolesOf(s, v.userId),
    profile: s.profile,
    canEditProfile: checkUpdateProfile(s, model, v),
    phases: model.phases.map((ph) => ({
      id: ph.id,
      label: ph.label,
      description: ph.description,
      extension: ph.extension,
      current: isPhaseCurrent(s, ph.id),
      closed: isPhaseClosed(s, model, ph.id),
      future: isPhaseFuture(s, model, ph.id),
      gate: gateView(s, model, v, ph.id, now),
      mandatory: mandatoryProgress(s, model, ph.id),
      deliverables: ph.deliverables.map((d) => deliverableRow(s, model, v, d)),
      participants: participantViews(s, model, v, ph.id),
    })),
    members: Object.entries(s.members)
      .map(([userId, m]) => ({ userId, displayName: m.displayName, roles: [...m.roles] }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "de")),
    conditions: Object.values(s.conditions).map((c) => conditionView(s, model, v, c, now)),
    nextStep: nextStepView(s, model, v),
    myTasks: myTasks(s, model, v).map((t) => taskView(s, model, t, now)),
    changeRequests: {
      total: Object.keys(s.changeRequests).length,
      open: openChangeRequests(s).length,
      openRechecks: openRechecks(s).length,
    },
    can: { manageMembers: checkManageMembers(s, v).ok, verifyAudit: canVerifyAudit(s, v) },
  };
}

export function changeRequestView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  c: ChangeRequestState,
  now: Date = new Date(),
): ChangeRequestView {
  const impact = changeImpact(c, impactContext(s, c.id), model);
  const decisionIds = new Set(c.decision?.conditionIds ?? []);
  return {
    id: c.id,
    number: c.number,
    label: crLabel(c.number),
    title: c.title,
    requestedBy: c.requestedBy,
    submittedAt: c.submittedAt,
    submittedBy: c.submittedBy,
    effortDays: c.effortDays,
    costChf: crCostChf(c.effortDays),
    flags: c.flags,
    content: c.content,
    findings: c.findings,
    producer: c.producer,
    status: c.status,
    statusLabel: CR_STATUS_LABELS[c.status],
    impact,
    impactSummary: impactSummary(impact),
    ...(c.decision
      ? {
          decision: {
            decision: c.decision.decision,
            reason: c.decision.reason,
            konsent: c.decision.konsent,
            at: c.decision.at,
            by: c.decision.by,
          },
        }
      : {}),
    ...(c.withdrawn ? { withdrawn: c.withdrawn } : {}),
    ...(c.recheck
      ? {
          recheck: {
            done: pendingRecheckRoles(c).length === 0,
            deliverables: CR_RECHECK_DELIVERABLES.map((id) => ({ id, name: model.deliverable(id).name })),
            roles: CR_RECHECK_ROLES.map((role) => {
              const confirmed = c.recheck![role];
              return {
                role,
                label: roleLabel(role),
                ...(confirmed ? { confirmed } : {}),
                canConfirm: checkConfirmRecheck(s, v, c.id, role).ok,
              };
            }),
          },
        }
      : {}),
    conditions: Object.values(s.conditions)
      .filter((x) => decisionIds.has(x.id))
      .map((x) => conditionView(s, model, v, x, now)),
    canDecide: checkDecideChangeRequest(s, v, c.id),
    canWithdraw: checkWithdrawChangeRequest(s, v, c.id),
  };
}

export function changeRequestRegister(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  now: Date = new Date(),
): ChangeRequestRegisterView {
  return {
    dayRateChf: CR_DAY_RATE_CHF,
    reserve: { ...reserveStatus(s), canSet: checkSetChangeReserve(s, model, v) },
    canSubmit: checkSubmitChangeRequest(s, model, v),
    items: Object.values(s.changeRequests)
      .sort((a, b) => b.number - a.number)
      .map((c) => changeRequestView(s, model, v, c, now)),
  };
}

function checklistView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  ownerId: string,
  cl: ChecklistDef,
): ChecklistView {
  return {
    ownerId,
    title: cl.title,
    requiredFor: cl.requiredFor,
    available: checklistAvailable(s, model, cl),
    items: cl.items.map((it) => {
      const rec = s.checklist[checklistKey(ownerId, it.id)];
      return {
        id: it.id,
        label: it.label,
        ownerRole: it.ownerRole,
        ownerLabel: roleLabel(it.ownerRole),
        ...(rec ? { confirmed: rec } : {}),
        canConfirm: checkConfirmChecklistItem(s, model, v, ownerId, it.id).ok,
      };
    }),
  };
}

function skillView(s: ProjectState, model: HermesModel, v: Viewer, sk: SkillDef): SkillView {
  const st = s.skills[sk.id];
  const visible = canViewSkillContent(s, model, v, sk);
  const status = skillStatus(s, model, sk);
  return {
    id: sk.id,
    name: sk.name,
    agentId: sk.agent,
    agentName: sk.agent ? model.agent(sk.agent).name : null,
    mode: sk.mode,
    description: sk.description,
    outputDoc: sk.outputDoc,
    sections: sk.sections,
    status,
    statusLabel: SKILL_STATUS_LABELS[status],
    veto: sk.veto,
    approvers: sk.approvers.map((a) => {
      const decision = st?.approvals[a.role];
      return decision ? { ...a, decision } : { ...a };
    }),
    myDecisionRoles: ["approval", "veto"].includes(status) ? decisionRolesFor(s, v, sk) : [],
    ...(st?.output
      ? {
          output: {
            version: st.output.version,
            createdAt: st.output.createdAt,
            requestedBy: st.output.requestedBy,
            producer: st.output.producer,
            ...(st.output.editedAt ? { editedAt: st.output.editedAt } : {}),
            ...(st.output.editedBy ? { editedBy: st.output.editedBy } : {}),
            findings: visible ? st.output.findings : [],
            draft: visible ? st.output.draft : null,
          },
        }
      : {}),
    contentVisible: visible,
    ...(st?.lastError ? { lastError: st.lastError } : {}),
    ...(st?.lastRejection ? { lastRejection: st.lastRejection } : {}),
    canStart: checkStartSkill(s, model, v, sk),
    canEdit: checkEditOutput(s, model, v, sk),
    unmetPreconditions: unmetPreconditions(s, model, sk).map((x) => x.name),
    ...(sk.checklist ? { checklist: checklistView(s, model, v, sk.id, sk.checklist) } : {}),
  };
}

export function deliverableDetailView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  d: DeliverableDef,
  now: Date = new Date(),
): DeliverableDetailView {
  const st = deliverableStatus(s, model, d);
  const skillIds = new Set(d.skills);
  return {
    id: d.id,
    name: d.name,
    requirement: d.requirement,
    kind: d.kind,
    origin: d.origin,
    restricted: d.restricted,
    phase: d.phase,
    phaseLabel: model.phase(d.phase).label,
    status: st,
    statusLabel: deliverableStatusLabel(d, st, hasAiDraft(s, d)),
    ...(d.preExisting ? { preExistingBy: d.preExisting.by } : {}),
    contentVersion: contentVersion(s, d),
    contentVisible: canViewDeliverableContent(s, model, v, d),
    skills: d.skills.map((id) => skillView(s, model, v, model.skill(id))),
    ...(d.checklist ? { checklist: checklistView(s, model, v, d.id, d.checklist) } : {}),
    ...(s.notApplicable[d.id] ? { notApplicable: s.notApplicable[d.id]! } : {}),
    ...(s.released[d.id] ? { released: s.released[d.id]! } : {}),
    canRelease: checkRelease(s, model, v, d),
    canMarkNotApplicable: checkMarkNotApplicable(s, model, v, d),
    canReactivate: checkReactivate(s, model, v, d),
    conditions: Object.values(s.conditions)
      .filter((c) => c.source.startsWith("skill:") && skillIds.has(c.source.slice("skill:".length)))
      .map((c) => conditionView(s, model, v, c, now)),
  };
}
