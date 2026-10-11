// View models: what the API returns and the UI renders. Built per viewer, so
// actions, restricted content and tasks already reflect the viewer's roles.

import type { HermesModel } from "../model";
import {
  CR_DAY_RATE_CHF,
  CR_RECHECK_ROLES,
  type CrFlags,
  type RecheckOutcome,
  type RecheckRole,
} from "../model/change-requests";
import { RISK_SCORE_HIGH, RISK_SCORE_MEDIUM, type RiskStatus } from "../model/risks";
import {
  AMPEL_LABELS,
  STATUS_CRITERIA,
  STATUS_REPORT_INTERVAL_DAYS,
  type Ampel,
  type StatusCriterion,
} from "../model/status-report";
import { PROJECT_ROLE_LABELS } from "../model/roles";
import type {
  AgentId,
  ApproverDef,
  ChecklistDef,
  DeliverableDef,
  Level,
  Origin,
  PhaseId,
  ProjectProfile,
  ProjectRole,
  Requirement,
  SkillDef,
} from "../model/types";
import {
  CR_STATUS_LABELS,
  crCostChf,
  requestImpact,
  crLabel,
  impactSummary,
  openChangeRequests,
  openRechecks,
  pendingRecheckRoles,
  recheckDeliverablesOf,
  recheckNames,
  reserveStatus,
  type ImpactRow,
  type ReserveStatus,
} from "./change-requests";
import { conditionDue, isConditionOverdue } from "./conditions";
import type {
  AgentAssessment,
  Decision,
  DraftContent,
  Finding,
  Producer,
  RiskRef,
  StatusFigures,
} from "./events";
import { isInvolved, participantsFor } from "./participation";
import {
  assignableRoles,
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
  checkAcknowledgeStatusReport,
  checkAssessRisk,
  checkPublishStatusReport,
  checkRecordRisk,
  checkRelease,
  checkReviewRisks,
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
  type RiskState,
  type StatusReportState,
} from "./state";
import {
  isStatusReportDue,
  latestStatusReport,
  reportOverall,
  reportTitle,
  statusReportDueAt,
  statusReports,
  suggestStatus,
} from "./status-report";
import {
  compareRisks,
  highRisks,
  isOpenRisk,
  openRisks,
  riskLabel,
  riskMatrix,
  riskReviewedAt,
  riskScore,
  riskTrend,
  scoreLevel,
  type RiskTrend,
} from "./risks";
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
  /** The open high risks the deciders saw. */
  highRisks: RiskRef[];
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
  riskId?: string;
  reportId?: string;
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
  /** For the tab of the risk register; the risks themselves: riskRegister. */
  risks: { total: number; open: number; high: number };
  /** The latest status report and when the next one is due; the reports: statusReportRegister. */
  statusReport: {
    latest?: { id: string; number: number; overall: Ampel; publishedAt: string };
    due: boolean;
    dueAt: string;
  };
  can: {
    manageMembers: boolean;
    /** The roles the viewer may assign and remove (separation of duties: the PMO assigns the control roles). */
    assignRoles: ProjectRole[];
    verifyAudit: boolean;
  };
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
  /** The rate the request was submitted with. */
  dayRateChf: number;
  costChf: number;
  flags: CrFlags;
  content: DraftContent;
  findings: Finding[];
  producer: Producer;
  /** What the Change-Request agent said, when it drafted the request. */
  agentAssessment?: AgentAssessment;
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
      /** Why the viewer, who holds the role, may not confirm (four-eyes principle). */
      blocked?: string;
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

export interface RiskHistoryView {
  probability: Level;
  impact: Level;
  score: number;
  status: RiskStatus;
  ownerRole: ProjectRole;
  ownerLabel: string;
  mitigation: string;
  note: string;
  producer: Producer;
  at: string;
  by: ActorRef;
}

export interface RiskView {
  id: string;
  number: number;
  /** R-01 … */
  label: string;
  title: string;
  description: string;
  probability: Level;
  impact: Level;
  /** Probability × impact, 1 to 9. */
  score: number;
  level: Level;
  status: RiskStatus;
  open: boolean;
  ownerRole: ProjectRole;
  ownerLabel: string;
  mitigation: string;
  /** Change with the last assessment; absent before the first one. */
  trend?: RiskTrend;
  producer: Producer;
  phase: PhaseId;
  phaseLabel: string;
  recordedAt: string;
  recordedBy: ActorRef;
  reviewedAt: string;
  /** Number of entries in the history; a new assessment names it (409 when it changed). */
  version: number;
  /** Oldest first; the first entry is the recording. */
  history: RiskHistoryView[];
  canAssess: Check;
}

export interface RiskRegisterView {
  scoreHigh: number;
  scoreMedium: number;
  canRecord: Check;
  canReview: Check;
  /** Open risks per cell: matrix[probability][impact], both in the order niedrig, mittel, hoch. */
  matrix: number[][];
  counts: { open: number; high: number; closed: number };
  /** Open risks (most serious first), then closed ones (last closed first). */
  items: RiskView[];
}

export interface StatusCriterionView {
  id: StatusCriterion;
  code: string;
  label: string;
  ampel: Ampel;
  ampelLabel: string;
  suggested: Ampel;
  /** The project lead chose another colour than the engine suggested. */
  deviates: boolean;
  problem: string;
  measure: string;
}

export interface StatusReportView {
  id: string;
  number: number;
  /** "Statusbericht 3" */
  title: string;
  publishedAt: string;
  publishedBy: ActorRef;
  phase: PhaseId;
  phaseLabel: string;
  overall: Ampel;
  overallLabel: string;
  overallMeaning: string;
  criteria: StatusCriterionView[];
  overview: string;
  outlook: string;
  figures: StatusFigures;
  mandatory: { done: number; total: number };
  risks: RiskRef[];
  producer: Producer;
  acknowledgements: { at: string; by: ActorRef; note: string }[];
  canAcknowledge: Check;
}

export interface StatusReportRegisterView {
  intervalDays: number;
  due: boolean;
  dueAt: string;
  canPublish: Check;
  /** The engine's suggestion for a new report, per criterion with its reasons. */
  suggestion: { id: StatusCriterion; code: string; label: string; ampel: Ampel; reasons: string[] }[];
  /** What a new report would record with it. */
  current: {
    phaseLabel: string;
    mandatory: { done: number; total: number };
    risks: RiskRef[];
  };
  /** The figures of the last report, to start from. */
  lastFigures: StatusFigures;
  /** Newest first. */
  items: StatusReportView[];
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
            ["approval", "veto"].includes(skillStatus(s, model, sk)) &&
            decisionRolesFor(s, model, v, sk).length,
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
      highRisks: x.highRisks ?? [],
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
        detail: `${recheckNames(recheckDeliverablesOf(c))} prüfen. Bis dahin bleibt das Gate zu.`,
        crId: c.id,
        role: t.role,
      };
    }
    case "status-report": {
      const last = latestStatusReport(s);
      return {
        kind: t.kind,
        title: "Statusbericht erstellen",
        detail: last
          ? `Der letzte Statusbericht ist vom ${new Date(last.publishedAt).toLocaleDateString("de-CH")}; fällig alle ${STATUS_REPORT_INTERVAL_DAYS} Tage.`
          : `Noch kein Statusbericht; fällig alle ${STATUS_REPORT_INTERVAL_DAYS} Tage.`,
      };
    }
    case "acknowledge-report": {
      const r = s.statusReports[t.reportId]!;
      const overall = reportOverall(r);
      return {
        kind: t.kind,
        title: `${reportTitle(r.number)} zur Kenntnis nehmen`,
        detail: `Gesamtstatus ${AMPEL_LABELS[overall].label}: ${AMPEL_LABELS[overall].meaning}.`,
        reportId: r.id,
      };
    }
    case "risk": {
      const r = s.risks[t.riskId]!;
      return {
        kind: t.kind,
        title: `Hohes Risiko ${riskLabel(r.number)}: ${r.title}`,
        detail: r.mitigation
          ? `Massnahme umsetzen und das Risiko auf «in Bearbeitung» setzen: ${r.mitigation}`
          : "Eine Massnahme festlegen und das Risiko auf «in Bearbeitung» setzen.",
        riskId: r.id,
        role: r.ownerRole,
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
      const mine = skills.find((sk) => decisionRolesFor(s, model, v, sk).length);
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
        detail: `Ein angenommener Change Request betrifft Personendaten: ISM und Datenschutz prüfen ${recheckNames(crs.flatMap((c) => recheckDeliverablesOf(c)))}. Bis dahin bleibt das Gate zu.`,
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
    myTasks: myTasks(s, model, v, now).map((t) => taskView(s, model, t, now)),
    changeRequests: {
      total: Object.keys(s.changeRequests).length,
      open: openChangeRequests(s).length,
      openRechecks: openRechecks(s).length,
    },
    risks: {
      total: Object.keys(s.risks).length,
      open: openRisks(s).length,
      high: highRisks(s).length,
    },
    statusReport: (() => {
      const last = latestStatusReport(s);
      return {
        ...(last
          ? {
              latest: {
                id: last.id,
                number: last.number,
                overall: reportOverall(last),
                publishedAt: last.publishedAt,
              },
            }
          : {}),
        due: isStatusReportDue(s, model, now),
        dueAt: statusReportDueAt(last?.publishedAt, s.createdAt),
      };
    })(),
    can: {
      manageMembers: checkManageMembers(s, v).ok,
      assignRoles: assignableRoles(s, model, v),
      verifyAudit: canVerifyAudit(s, v),
    },
  };
}

export function changeRequestView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  c: ChangeRequestState,
  now: Date = new Date(),
): ChangeRequestView {
  const impact = requestImpact(s, c, model);
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
    dayRateChf: c.dayRateChf,
    costChf: crCostChf(c.effortDays, c.dayRateChf),
    flags: c.flags,
    content: c.content,
    findings: c.findings,
    producer: c.producer,
    ...(c.agentAssessment ? { agentAssessment: c.agentAssessment } : {}),
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
            deliverables: recheckDeliverablesOf(c).map((id) => ({ id, name: model.deliverable(id).name })),
            roles: (c.recheckRoles ?? CR_RECHECK_ROLES).map((role) => {
              const confirmed = c.recheck![role];
              const check = checkConfirmRecheck(s, model, v, c.id, role);
              const holds = rolesOf(s, v.userId).includes(role);
              return {
                role,
                label: roleLabel(role),
                ...(confirmed ? { confirmed } : {}),
                canConfirm: check.ok,
                ...(!check.ok && !confirmed && holds && check.code === "forbidden"
                  ? { blocked: check.reason }
                  : {}),
              };
            }),
          },
        }
      : {}),
    conditions: Object.values(s.conditions)
      .filter((x) => decisionIds.has(x.id))
      .map((x) => conditionView(s, model, v, x, now)),
    canDecide: checkDecideChangeRequest(s, model, v, c.id),
    canWithdraw: checkWithdrawChangeRequest(s, model, v, c.id),
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

export function riskView(s: ProjectState, model: HermesModel, v: Viewer, r: RiskState): RiskView {
  const score = riskScore(r.probability, r.impact);
  const trend = riskTrend(r);
  return {
    id: r.id,
    number: r.number,
    label: riskLabel(r.number),
    title: r.title,
    description: r.description,
    probability: r.probability,
    impact: r.impact,
    score,
    level: scoreLevel(score),
    status: r.status,
    open: isOpenRisk(r),
    ownerRole: r.ownerRole,
    ownerLabel: roleLabel(r.ownerRole),
    mitigation: r.mitigation,
    ...(trend ? { trend } : {}),
    producer: r.producer,
    phase: r.phase,
    phaseLabel: model.phase(r.phase).label,
    recordedAt: r.recordedAt,
    recordedBy: r.recordedBy,
    reviewedAt: riskReviewedAt(r),
    version: r.history.length,
    history: r.history.map((h) => ({
      probability: h.probability,
      impact: h.impact,
      score: riskScore(h.probability, h.impact),
      status: h.status,
      ownerRole: h.ownerRole,
      ownerLabel: roleLabel(h.ownerRole),
      mitigation: h.mitigation,
      note: h.note,
      producer: h.producer,
      at: h.at,
      by: h.by,
    })),
    canAssess: checkAssessRisk(s, model, v, r.id),
  };
}

export function riskRegister(s: ProjectState, model: HermesModel, v: Viewer): RiskRegisterView {
  const all = Object.values(s.risks);
  const closed = all
    .filter((r) => !isOpenRisk(r))
    .sort((a, b) => riskReviewedAt(b).localeCompare(riskReviewedAt(a)) || compareRisks(a, b));
  return {
    scoreHigh: RISK_SCORE_HIGH,
    scoreMedium: RISK_SCORE_MEDIUM,
    canRecord: checkRecordRisk(s, model, v),
    canReview: checkReviewRisks(s, model, v),
    matrix: riskMatrix(s),
    counts: { open: all.length - closed.length, high: highRisks(s).length, closed: closed.length },
    items: [...openRisks(s), ...closed].map((r) => riskView(s, model, v, r)),
  };
}

export function statusReportView(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  r: StatusReportState,
): StatusReportView {
  const overall = reportOverall(r);
  return {
    id: r.id,
    number: r.number,
    title: reportTitle(r.number),
    publishedAt: r.publishedAt,
    publishedBy: r.publishedBy,
    phase: r.phase,
    phaseLabel: model.phase(r.phase).label,
    overall,
    overallLabel: AMPEL_LABELS[overall].label,
    overallMeaning: AMPEL_LABELS[overall].meaning,
    criteria: STATUS_CRITERIA.map((c) => {
      const e = r.criteria[c.id];
      return {
        id: c.id,
        code: c.code,
        label: c.label,
        ampel: e.ampel,
        ampelLabel: AMPEL_LABELS[e.ampel].label,
        suggested: e.suggested,
        deviates: e.ampel !== e.suggested,
        problem: e.problem,
        measure: e.measure,
      };
    }),
    overview: r.overview,
    outlook: r.outlook,
    figures: r.figures,
    mandatory: r.mandatory,
    risks: r.risks,
    producer: r.producer,
    acknowledgements: r.acknowledgements,
    canAcknowledge: checkAcknowledgeStatusReport(s, model, v, r.id),
  };
}

/** Open risks as a report records them: the five most serious. */
const riskRef = (r: RiskState): RiskRef => ({
  label: riskLabel(r.number),
  title: r.title,
  score: riskScore(r.probability, r.impact),
});

/** The most serious open risks, for a status report. */
export function reportRisks(s: ProjectState): RiskRef[] {
  return openRisks(s).slice(0, 5).map(riskRef);
}

/** The open high risks, for a gate decision. */
export function gateRisks(s: ProjectState): RiskRef[] {
  return highRisks(s).map(riskRef);
}

export function statusReportRegister(
  s: ProjectState,
  model: HermesModel,
  v: Viewer,
  now: Date = new Date(),
): StatusReportRegisterView {
  const suggestion = suggestStatus(s, model, now);
  const last = latestStatusReport(s);
  return {
    intervalDays: STATUS_REPORT_INTERVAL_DAYS,
    due: isStatusReportDue(s, model, now),
    dueAt: statusReportDueAt(last?.publishedAt, s.createdAt),
    canPublish: checkPublishStatusReport(s, model, v),
    suggestion: STATUS_CRITERIA.map((c) => ({ id: c.id, code: c.code, label: c.label, ...suggestion[c.id] })),
    current: {
      phaseLabel: model.phase(s.phase).label,
      mandatory: mandatoryProgress(s, model, s.phase),
      risks: reportRisks(s),
    },
    lastFigures: last?.figures ?? {},
    items: statusReports(s).map((r) => statusReportView(s, model, v, r)),
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
    myDecisionRoles: ["approval", "veto"].includes(status) ? decisionRolesFor(s, model, v, sk) : [],
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
