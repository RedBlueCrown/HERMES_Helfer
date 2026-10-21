// Events of a project stream. The stream is the Projektakte: the project state
// is computed from it (state.ts), and the API hash-chains it (tamper evidence).
// Events are facts. Never change the meaning of an existing event type; add a new one.

import type { CrFlag, CrFlags, RecheckOutcome, RecheckRole } from "../model/change-requests";
import type { RiskStatus } from "../model/risks";
import type { Ampel, StatusCriterion } from "../model/status-report";
import type { AgentId, Level, PhaseId, ProjectProfile, ProjectRole } from "../model/types";

export type Decision = "freigegeben" | "mit Auflagen" | "zurückgewiesen";
export const DECISIONS: readonly Decision[] = ["freigegeben", "mit Auflagen", "zurückgewiesen"];

/** An Auflage (condition) attached to an approval or a gate decision. */
export interface ConditionSpec {
  id: string;
  text: string;
  ownerRole: ProjectRole;
  due: string;
}

export interface DraftSection {
  heading: string;
  body: string;
}

export interface DraftContent {
  summary: string;
  sections: DraftSection[];
  openPoints: string[];
}

export interface Finding {
  severity: "hinweis" | "warnung";
  text: string;
  /** "checkliste": deterministic check. "kritiker": content review by the Kritiker agent. */
  source: "checkliste" | "kritiker";
}

/** One row of a change request's impact as the decider saw it (engine/change-requests.ts). */
export interface ImpactRecord {
  id: string;
  label: string;
  text: string;
  level: Level;
}

/** One criterion of a status report: the colour the project lead chose, and why. */
export interface StatusEntry {
  ampel: Ampel;
  /** What the engine suggested when the report was written. */
  suggested: Ampel;
  /** The engine's reasons for its suggestion, as the project lead saw them. */
  reasons?: string[];
  /** Required for yellow and red; empty for green. */
  problem: string;
  measure: string;
  /** Why the project lead judges the criterion better than suggested: always their own words, never the agent's. */
  deviationReason?: string;
}

/** Target and actual figures of a status report; all optional (from portfolio planning later, F11). */
export interface StatusFigures {
  budgetChf?: number;
  spentChf?: number;
  progressPct?: number;
  /** Dates (YYYY-MM-DD). */
  plannedEnd?: string;
  forecastEnd?: string;
}

/** A risk as a decision or a report names it: R-02, its title and score. */
export interface RiskRef {
  label: string;
  title: string;
  score: number;
}

/** An organisation's Word template a draft follows: the deliverable it is for, its version and file hash. */
export interface TemplateRef {
  deliverableId: string;
  version: number;
  sha256: string;
}

/** Who produced a result: an AI agent (with model) or a person (manual skill). */
export interface Producer {
  kind: "ai" | "human";
  agent?: AgentId;
  provider?: string;
  model?: string;
  /** The agent run (ai_run audit entry) that produced the proposal. Set by the server, never by the client. */
  runId?: string;
  /** The person changed the agent's proposal before submitting or accepting it. */
  edited?: boolean;
}

/** What the Change-Request agent said about a request, kept with it for the record. */
export interface AgentAssessment {
  /** The wish as the requester typed it, before the agent worked it out. */
  wish: string;
  /** The agent's view of the areas, each with its reason. */
  flags: Record<CrFlag, { value: boolean; reason: string }>;
  /** The Kritiker's findings on the agent's draft. */
  findings: Finding[];
}

/** Why the Risiko agent proposed a risk or an assessment, kept with the record (review F3). */
export interface AgentRiskBasis {
  /** The agent's reason, one sentence. */
  reason: string;
  /** The id of the fact it rested on, and the fact as the engine named it. */
  trigger: string;
  fact: string;
}

/** An item of meeting minutes; the quote is the passage of the notes or transcript it rests on. */
export interface MinutesItem {
  id: string;
  text: string;
  /** Only for items the Protokoll agent proposed: its evidence, checked against the text. */
  quote?: string;
}

/** An action item (Pendenz): who does what by when. */
export interface MinutesAction extends MinutesItem {
  /** A member of the project; absent for someone outside it. */
  ownerId?: string;
  /** The member's name when recorded, or the name of someone outside the project. */
  ownerName?: string;
  /** YYYY-MM-DD */
  due?: string;
}

export type ProjectEvent =
  | {
      type: "ProjectCreated";
      data: {
        code: string;
        name: string;
        description: string;
        phase: PhaseId;
        profile: ProjectProfile;
        modelVersion: string;
      };
    }
  | { type: "MemberRoleAssigned"; data: { userId: string; displayName: string; role: ProjectRole } }
  | { type: "MemberRoleRemoved"; data: { userId: string; displayName: string; role: ProjectRole } }
  | { type: "ProfileUpdated"; data: { profile: ProjectProfile } }
  /** The link to the project's folder for its files (Projektablage, engine/storage.ts); empty: removed. */
  | { type: "DocumentStorageSet"; data: { url: string } }
  | { type: "SkillRunRequested"; data: { runId: string; skillId: string } }
  | {
      type: "SkillRunCompleted";
      data: {
        runId: string;
        skillId: string;
        draft: DraftContent;
        findings: Finding[];
        producer: Producer;
        /** The templates whose fields the draft's sections are; absent: the model's sections. */
        templates?: TemplateRef[];
      };
    }
  | { type: "SkillRunFailed"; data: { runId: string; skillId: string; reason: string } }
  | { type: "DraftEdited"; data: { skillId: string; draft: DraftContent } }
  | {
      type: "DeliverableReleased";
      /** contentVersion: the exact content released (see contentVersion in status.ts). */
      data: { deliverableId: string; contentVersion?: string };
    }
  | {
      type: "SkillDecisionRecorded";
      data: {
        skillId: string;
        role: ProjectRole;
        decision: Decision;
        reason: string;
        konsent: boolean;
        conditions: ConditionSpec[];
        /** Version of the result the decision refers to. */
        version?: number;
      };
    }
  | { type: "DeliverableMarkedNotApplicable"; data: { deliverableId: string; reason: string } }
  | { type: "DeliverableReactivated"; data: { deliverableId: string } }
  | { type: "ParticipationRecorded"; data: { phase: PhaseId; participantId: string; how: string } }
  | { type: "ChecklistItemConfirmed"; data: { checklistOwnerId: string; itemId: string; note: string } }
  | {
      type: "GateDecisionRecorded";
      data: {
        phase: PhaseId;
        decision: Decision;
        reason: string;
        konsent: boolean;
        conditions: ConditionSpec[];
        /** The open high risks the deciders saw: no criterion, but part of the basis (§5.6). */
        highRisks?: RiskRef[];
      };
    }
  | { type: "ConditionCompleted"; data: { conditionId: string; text: string; note: string } }
  | {
      type: "ChangeRequestSubmitted";
      data: {
        crId: string;
        /** Running number in the project: CR-01, CR-02 … */
        number: number;
        title: string;
        /** Who asked for the change (a role or unit, e.g. "Fachstelle"). */
        requestedBy: string;
        /** Estimated effort in person-days. */
        effortDays: number;
        /** Cost of a person-day when submitted; absent in streams from before it was recorded. */
        dayRateChf?: number;
        flags: CrFlags;
        content: DraftContent;
        findings: Finding[];
        /** "ai": drafted with the Change-Request agent, then reviewed and submitted by a person. */
        producer: Producer;
        /** Present when the agent drafted the request. */
        agentAssessment?: AgentAssessment;
      };
    }
  | { type: "ChangeRequestWithdrawn"; data: { crId: string; reason: string } }
  | {
      type: "ChangeRequestDecided";
      data: {
        crId: string;
        decision: Decision;
        reason: string;
        konsent: boolean;
        conditions: ConditionSpec[];
        /** The basis of the decision, as the engine computed it at that moment. */
        impact?: ImpactRecord[];
        reserveRemainingChf?: number;
        /** The Projektausschuss asks for a recheck although the request is not marked as touching personal data. */
        recheckRequired?: boolean;
        /** Who confirms the recheck; set when one is needed. */
        recheckRoles?: RecheckRole[];
        /** The results to recheck: those that existed at the decision and apply (deliverable ids). */
        recheckDeliverables?: string[];
      };
    }
  | {
      type: "ChangeRecheckConfirmed";
      data: { crId: string; role: RecheckRole; outcome: RecheckOutcome; note: string };
    }
  | { type: "ChangeReserveSet"; data: { amountChf: number } }
  | {
      type: "RiskRecorded";
      data: {
        riskId: string;
        /** Running number in the project: R-01, R-02 … */
        number: number;
        title: string;
        description: string;
        probability: Level;
        impact: Level;
        /** The role that takes care of the measure. */
        ownerRole: ProjectRole;
        /** Empty until someone defines it. */
        mitigation: string;
        /** "ai": proposed by the Risiko agent, reviewed and accepted by a person. */
        producer: Producer;
        /** For a proposal of the Risiko agent: its reason and the fact behind it. */
        agentBasis?: AgentRiskBasis;
      };
    }
  | {
      type: "StatusReportPublished";
      data: {
        reportId: string;
        /** Running number in the project: Statusbericht 1, 2 … */
        number: number;
        criteria: Record<StatusCriterion, StatusEntry>;
        /** Übersicht und Prognose der Zielerreichung. */
        overview: string;
        /** Ausblick auf die nächste Periode. */
        outlook: string;
        figures: StatusFigures;
        /** Facts at the time of the report, kept with it: phase, mandatory results, open risks. */
        phase: PhaseId;
        mandatory: { done: number; total: number };
        risks: RiskRef[];
        /** "ai": the texts were drafted with the agent, then reviewed and published by the PL. */
        producer: Producer;
      };
    }
  | { type: "StatusReportAcknowledged"; data: { reportId: string; note: string } }
  | {
      /** Minutes of a meeting: decisions, action items and open questions. The notes themselves are not kept. */
      type: "MinutesRecorded";
      data: {
        minutesId: string;
        /** Running number in the project: P-01, P-02 … */
        number: number;
        title: string;
        /** Day of the meeting, YYYY-MM-DD. */
        heldOn: string;
        decisions: MinutesItem[];
        actions: MinutesAction[];
        questions: MinutesItem[];
        /** "ai": proposed by the Protokoll agent, checked and accepted by a person. */
        producer: Producer;
      };
    }
  | { type: "MinutesActionCompleted"; data: { minutesId: string; actionId: string; note: string } }
  | {
      /** A new assessment: the current values, not a difference. Closing is status «geschlossen». */
      type: "RiskAssessed";
      data: {
        riskId: string;
        probability: Level;
        impact: Level;
        status: RiskStatus;
        ownerRole: ProjectRole;
        mitigation: string;
        note: string;
        /** "ai": proposed by the Risiko agent, accepted by a person. */
        producer: Producer;
        /** For a proposal of the Risiko agent: its reason and the fact behind it. */
        agentBasis?: AgentRiskBasis;
      };
    };

export type EventType = ProjectEvent["type"];

export type Channel = "web" | "chat" | "agent" | "system";

export interface Actor {
  userId: string;
  displayName: string;
  /** Roles held when acting (project roles and global roles), for the record. */
  roles: string[];
  channel: Channel;
}

export interface EventEnvelope {
  projectId: string;
  /** 1-based position in the project stream. */
  seq: number;
  id: string;
  at: string;
  actor: Actor;
  correlationId: string;
  prevHash: string;
  hash: string;
}

export type StoredEvent = ProjectEvent & EventEnvelope;

/** Narrow a stored event to one type. */
export type StoredEventOf<T extends EventType> = Extract<ProjectEvent, { type: T }> & EventEnvelope;
