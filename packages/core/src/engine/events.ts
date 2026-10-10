// Events of a project stream. The stream is the Projektakte: the project state
// is computed from it (state.ts), and the API hash-chains it (tamper evidence).
// Events are facts. Never change the meaning of an existing event type; add a new one.

import type { CrFlags, RecheckOutcome, RecheckRole } from "../model/change-requests";
import type { RiskStatus } from "../model/risks";
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

/** Who produced a result: an AI agent (with model) or a person (manual skill). */
export interface Producer {
  kind: "ai" | "human";
  agent?: AgentId;
  provider?: string;
  model?: string;
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
  | { type: "SkillRunRequested"; data: { runId: string; skillId: string } }
  | {
      type: "SkillRunCompleted";
      data: { runId: string; skillId: string; draft: DraftContent; findings: Finding[]; producer: Producer };
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
        flags: CrFlags;
        content: DraftContent;
        findings: Finding[];
        /** "ai": drafted with the Change-Request agent, then reviewed and submitted by a person. */
        producer: Producer;
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
      };
    }
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
