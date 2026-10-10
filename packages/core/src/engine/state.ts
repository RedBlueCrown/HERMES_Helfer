// Project state = the events of its stream, applied in order.
// `foldEvents` is the only way to build a state; it is pure from the caller's
// point of view (it builds a fresh object and never touches the events).

import type { HermesModel } from "../model";
import type { CrFlags, RecheckOutcome, RecheckRole } from "../model/change-requests";
import type { RiskStatus } from "../model/risks";
import type { Level, PhaseId, ProjectProfile, ProjectRole } from "../model/types";
import type { Actor, ConditionSpec, Decision, DraftContent, Finding, Producer, StoredEvent } from "./events";

export interface ActorRef {
  userId: string;
  displayName: string;
}

export interface ApprovalRecord {
  decision: Exclude<Decision, "zurückgewiesen">;
  reason: string;
  konsent: boolean;
  at: string;
  by: ActorRef;
}

export interface SkillOutput {
  runId: string;
  draft: DraftContent;
  findings: Finding[];
  producer: Producer;
  createdAt: string;
  requestedBy: ActorRef;
  /** Increases with every new run result or edit. */
  version: number;
  editedAt?: string;
  editedBy?: ActorRef;
}

export interface SkillState {
  runningRunId?: string;
  output?: SkillOutput;
  approvals: Partial<Record<ProjectRole, ApprovalRecord>>;
  lastError?: { reason: string; at: string };
  lastRejection?: { role: ProjectRole; reason: string; at: string; by: ActorRef };
}

export interface RunRecord {
  runId: string;
  skillId: string;
  status: "running" | "completed" | "failed";
  requestedAt: string;
  requestedBy: ActorRef;
  finishedAt?: string;
  reason?: string;
}

export interface ConditionState extends ConditionSpec {
  phase: PhaseId;
  /** "skill:<skillId>", "gate:<phaseId>" or "cr:<changeRequestId>" */
  source: string;
  createdAt: string;
  createdBy: ActorRef;
  doneAt?: string;
  doneBy?: ActorRef;
  doneNote?: string;
}

export type ChangeRequestStatus = "offen" | "angenommen" | "abgelehnt" | "zurueckgezogen";

export interface ChangeRequestState {
  id: string;
  number: number;
  title: string;
  requestedBy: string;
  effortDays: number;
  flags: CrFlags;
  content: DraftContent;
  findings: Finding[];
  producer: Producer;
  /** Phase in which the request was submitted. */
  phase: PhaseId;
  submittedAt: string;
  submittedBy: ActorRef;
  status: ChangeRequestStatus;
  decision?: {
    decision: Decision;
    reason: string;
    konsent: boolean;
    at: string;
    by: ActorRef;
    conditionIds: string[];
  };
  withdrawn?: { reason: string; at: string; by: ActorRef };
  /**
   * Accepted requests that touch personal data: SchuBAn, ISDS and DSFA are checked
   * again; each recheck role confirms. Absent when no recheck is needed.
   */
  recheck?: Partial<Record<RecheckRole, { outcome: RecheckOutcome; note: string; at: string; by: ActorRef }>>;
}

/** The values of a risk at one point in time. */
export interface RiskValues {
  probability: Level;
  impact: Level;
  status: RiskStatus;
  ownerRole: ProjectRole;
  mitigation: string;
}

export interface RiskAssessmentRecord extends RiskValues {
  note: string;
  producer: Producer;
  at: string;
  by: ActorRef;
}

export interface RiskState extends RiskValues {
  id: string;
  number: number;
  title: string;
  description: string;
  /** Who proposed it: a person, or the Risiko agent (accepted by a person). */
  producer: Producer;
  /** Phase in which the risk was recorded. */
  phase: PhaseId;
  recordedAt: string;
  recordedBy: ActorRef;
  /** Values at recording, then one entry per assessment; the last one is current. */
  history: RiskAssessmentRecord[];
}

export interface GateDecisionRecord {
  decision: Decision;
  reason: string;
  konsent: boolean;
  at: string;
  by: ActorRef;
  conditionIds: string[];
}

export interface ProjectState {
  projectId: string;
  code: string;
  name: string;
  description: string;
  phase: PhaseId;
  modelVersion: string;
  profile: ProjectProfile;
  createdAt: string;
  updatedAt: string;
  lastSeq: number;
  members: Record<string, { displayName: string; roles: ProjectRole[] }>;
  runs: Record<string, RunRecord>;
  skills: Record<string, SkillState>;
  /** Deliverables whose content changed since the last release. */
  unreleased: Record<string, true>;
  released: Record<string, { at: string; by: ActorRef }>;
  notApplicable: Record<string, { reason: string; at: string; by: ActorRef }>;
  /** Key: `${phase}:${participantId}` */
  participation: Record<string, { how: string; at: string; by: ActorRef }>;
  /** Key: `${checklistOwnerId}:${itemId}` (owner is a deliverable or skill id) */
  checklist: Record<string, { at: string; by: ActorRef; note: string }>;
  gateDecisions: Partial<Record<PhaseId, GateDecisionRecord[]>>;
  /** Phases whose gate was passed in the app. */
  passed: PhaseId[];
  conditions: Record<string, ConditionState>;
  changeRequests: Record<string, ChangeRequestState>;
  /** Reserve for changes from the project order, in CHF; undefined until the PL records it. */
  changeReserveChf?: number;
  risks: Record<string, RiskState>;
}

export const participationKey = (phase: PhaseId, participantId: string) => `${phase}:${participantId}`;
export const checklistKey = (ownerId: string, itemId: string) => `${ownerId}:${itemId}`;

const ref = (a: Actor): ActorRef => ({ userId: a.userId, displayName: a.displayName });

function skillState(s: ProjectState, skillId: string): SkillState {
  let sk = s.skills[skillId];
  if (!sk) {
    sk = { approvals: {} };
    s.skills[skillId] = sk;
  }
  return sk;
}

function addConditions(
  s: ProjectState,
  specs: ConditionSpec[],
  phase: PhaseId,
  source: string,
  e: StoredEvent,
): string[] {
  for (const c of specs) {
    s.conditions[c.id] = { ...c, phase, source, createdAt: e.at, createdBy: ref(e.actor) };
  }
  return specs.map((c) => c.id);
}

function apply(s: ProjectState, e: StoredEvent, model: HermesModel): void {
  switch (e.type) {
    case "ProjectCreated":
      throw new Error("ProjectCreated may only be the first event of a stream");
    case "MemberRoleAssigned": {
      const m = (s.members[e.data.userId] ??= { displayName: e.data.displayName, roles: [] });
      m.displayName = e.data.displayName;
      if (!m.roles.includes(e.data.role)) m.roles.push(e.data.role);
      return;
    }
    case "MemberRoleRemoved": {
      const m = s.members[e.data.userId];
      if (!m) return;
      m.roles = m.roles.filter((r) => r !== e.data.role);
      if (m.roles.length === 0) delete s.members[e.data.userId];
      return;
    }
    case "ProfileUpdated":
      s.profile = { ...e.data.profile };
      return;
    case "SkillRunRequested": {
      s.runs[e.data.runId] = {
        runId: e.data.runId,
        skillId: e.data.skillId,
        status: "running",
        requestedAt: e.at,
        requestedBy: ref(e.actor),
      };
      const sk = skillState(s, e.data.skillId);
      sk.runningRunId = e.data.runId;
      delete sk.lastError;
      return;
    }
    case "SkillRunCompleted": {
      const run = s.runs[e.data.runId];
      if (run) {
        run.status = "completed";
        run.finishedAt = e.at;
      }
      const sk = skillState(s, e.data.skillId);
      delete sk.runningRunId;
      delete sk.lastError;
      sk.output = {
        runId: e.data.runId,
        draft: e.data.draft,
        findings: e.data.findings,
        producer: e.data.producer,
        createdAt: e.at,
        requestedBy: run?.requestedBy ?? ref(e.actor),
        version: (sk.output?.version ?? 0) + 1,
      };
      sk.approvals = {};
      // A result without a human decision is a draft until the PL releases it.
      if (model.skill(e.data.skillId).approvers.length === 0) {
        for (const d of model.deliverablesOfSkill(e.data.skillId)) s.unreleased[d.id] = true;
      }
      return;
    }
    case "SkillRunFailed": {
      const run = s.runs[e.data.runId];
      if (run) {
        run.status = "failed";
        run.finishedAt = e.at;
        run.reason = e.data.reason;
      }
      const sk = skillState(s, e.data.skillId);
      if (sk.runningRunId === e.data.runId) delete sk.runningRunId;
      sk.lastError = { reason: e.data.reason, at: e.at };
      return;
    }
    case "DraftEdited": {
      const sk = skillState(s, e.data.skillId);
      if (!sk.output) return;
      sk.output = {
        ...sk.output,
        draft: e.data.draft,
        version: sk.output.version + 1,
        editedAt: e.at,
        editedBy: ref(e.actor),
      };
      // Changed content needs fresh decisions and a new release.
      sk.approvals = {};
      for (const d of model.deliverablesOfSkill(e.data.skillId)) s.unreleased[d.id] = true;
      return;
    }
    case "DeliverableReleased":
      delete s.unreleased[e.data.deliverableId];
      s.released[e.data.deliverableId] = { at: e.at, by: ref(e.actor) };
      return;
    case "SkillDecisionRecorded": {
      const sk = skillState(s, e.data.skillId);
      if (e.data.decision === "zurückgewiesen") {
        // Back to the agent: the result is discarded and must be produced again.
        delete sk.output;
        sk.approvals = {};
        sk.lastRejection = { role: e.data.role, reason: e.data.reason, at: e.at, by: ref(e.actor) };
        return;
      }
      sk.approvals[e.data.role] = {
        decision: e.data.decision,
        reason: e.data.reason,
        konsent: e.data.konsent,
        at: e.at,
        by: ref(e.actor),
      };
      addConditions(s, e.data.conditions, model.skill(e.data.skillId).phase, `skill:${e.data.skillId}`, e);
      return;
    }
    case "DeliverableMarkedNotApplicable":
      s.notApplicable[e.data.deliverableId] = { reason: e.data.reason, at: e.at, by: ref(e.actor) };
      return;
    case "DeliverableReactivated":
      delete s.notApplicable[e.data.deliverableId];
      return;
    case "ParticipationRecorded":
      s.participation[participationKey(e.data.phase, e.data.participantId)] = {
        how: e.data.how,
        at: e.at,
        by: ref(e.actor),
      };
      return;
    case "ChecklistItemConfirmed":
      s.checklist[checklistKey(e.data.checklistOwnerId, e.data.itemId)] = {
        at: e.at,
        by: ref(e.actor),
        note: e.data.note,
      };
      return;
    case "GateDecisionRecorded": {
      const conditionIds = addConditions(s, e.data.conditions, e.data.phase, `gate:${e.data.phase}`, e);
      (s.gateDecisions[e.data.phase] ??= []).push({
        decision: e.data.decision,
        reason: e.data.reason,
        konsent: e.data.konsent,
        at: e.at,
        by: ref(e.actor),
        conditionIds,
      });
      if (e.data.decision === "zurückgewiesen") return;
      if (!s.passed.includes(e.data.phase)) s.passed.push(e.data.phase);
      const next = model.nextPhase(e.data.phase);
      if (next && s.phase === e.data.phase) s.phase = next.id;
      return;
    }
    case "ConditionCompleted": {
      const c = s.conditions[e.data.conditionId];
      if (!c) return;
      c.doneAt = e.at;
      c.doneBy = ref(e.actor);
      c.doneNote = e.data.note;
      return;
    }
    case "ChangeRequestSubmitted":
      s.changeRequests[e.data.crId] = {
        id: e.data.crId,
        number: e.data.number,
        title: e.data.title,
        requestedBy: e.data.requestedBy,
        effortDays: e.data.effortDays,
        flags: { ...e.data.flags },
        content: e.data.content,
        findings: e.data.findings,
        producer: e.data.producer,
        phase: s.phase,
        submittedAt: e.at,
        submittedBy: ref(e.actor),
        status: "offen",
      };
      return;
    case "ChangeRequestWithdrawn": {
      const cr = s.changeRequests[e.data.crId];
      if (!cr) return;
      cr.status = "zurueckgezogen";
      cr.withdrawn = { reason: e.data.reason, at: e.at, by: ref(e.actor) };
      return;
    }
    case "ChangeRequestDecided": {
      const cr = s.changeRequests[e.data.crId];
      if (!cr) return;
      const accepted = e.data.decision !== "zurückgewiesen";
      cr.status = accepted ? "angenommen" : "abgelehnt";
      cr.decision = {
        decision: e.data.decision,
        reason: e.data.reason,
        konsent: e.data.konsent,
        at: e.at,
        by: ref(e.actor),
        conditionIds: addConditions(s, e.data.conditions, s.phase, `cr:${cr.id}`, e),
      };
      if (accepted && cr.flags.daten) cr.recheck = {};
      return;
    }
    case "ChangeRecheckConfirmed": {
      const cr = s.changeRequests[e.data.crId];
      if (!cr?.recheck) return;
      cr.recheck[e.data.role] = { outcome: e.data.outcome, note: e.data.note, at: e.at, by: ref(e.actor) };
      return;
    }
    case "ChangeReserveSet":
      s.changeReserveChf = e.data.amountChf;
      return;
    case "RiskRecorded": {
      const values: RiskValues = {
        probability: e.data.probability,
        impact: e.data.impact,
        status: "offen",
        ownerRole: e.data.ownerRole,
        mitigation: e.data.mitigation,
      };
      s.risks[e.data.riskId] = {
        id: e.data.riskId,
        number: e.data.number,
        title: e.data.title,
        description: e.data.description,
        producer: e.data.producer,
        phase: s.phase,
        recordedAt: e.at,
        recordedBy: ref(e.actor),
        ...values,
        history: [{ ...values, note: "", producer: e.data.producer, at: e.at, by: ref(e.actor) }],
      };
      return;
    }
    case "RiskAssessed": {
      const r = s.risks[e.data.riskId];
      if (!r) return;
      const values: RiskValues = {
        probability: e.data.probability,
        impact: e.data.impact,
        status: e.data.status,
        ownerRole: e.data.ownerRole,
        mitigation: e.data.mitigation,
      };
      Object.assign(r, values);
      r.history.push({ ...values, note: e.data.note, producer: e.data.producer, at: e.at, by: ref(e.actor) });
      return;
    }
    default: {
      const unknown: never = e;
      throw new Error(`Unknown event type ${(unknown as StoredEvent).type}`);
    }
  }
}

export function foldEvents(events: readonly StoredEvent[], model: HermesModel): ProjectState {
  const first = events[0];
  if (!first || first.type !== "ProjectCreated") {
    throw new Error("A project stream must start with ProjectCreated");
  }
  const s: ProjectState = {
    projectId: first.projectId,
    code: first.data.code,
    name: first.data.name,
    description: first.data.description,
    phase: first.data.phase,
    modelVersion: first.data.modelVersion,
    profile: { ...first.data.profile },
    createdAt: first.at,
    updatedAt: first.at,
    lastSeq: first.seq,
    members: {},
    runs: {},
    skills: {},
    unreleased: {},
    released: {},
    notApplicable: {},
    participation: {},
    checklist: {},
    gateDecisions: {},
    passed: [],
    conditions: {},
    changeRequests: {},
    risks: {},
  };
  for (let i = 1; i < events.length; i++) {
    const e = events[i]!;
    apply(s, e, model);
    s.updatedAt = e.at;
    s.lastSeq = e.seq;
  }
  return s;
}
