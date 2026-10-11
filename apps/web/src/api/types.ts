// Response types of the API that are not view models from @hermes-helfer/core.

import type {
  AgentDef,
  Ampel,
  CrFlag,
  DraftContent,
  Finding,
  GlobalRole,
  Level,
  PhaseId,
  PortfolioOverview,
  Producer,
  ProjectListItem,
  ProjectRole,
  RiskStatus,
  RiskTrigger,
  StatusCriterion,
} from "@hermes-helfer/core";

export type {
  ChangeRequestRegisterView,
  ChangeRequestView,
  ChecklistView,
  ConditionView,
  DeliverableDetailView,
  DeliverableRowView,
  GateView,
  MemberView,
  ParticipantView,
  PhaseView,
  PortfolioOverview,
  ProjectListItem,
  ProjectView,
  RiskRegisterView,
  RiskView,
  SignalId,
  StatusReportRegisterView,
  StatusReportView,
  SkillView,
  TaskView,
} from "@hermes-helfer/core";

export interface Me {
  userId: string;
  displayName: string;
  upn: string;
  globalRoles: GlobalRole[];
  authMode: "dev" | "entra";
  ai: { provider: string; model: string; region: string; supportsChat: boolean };
  can: { createProject: boolean; seeAllProjects: boolean };
}

export interface Reference {
  modelVersion: string;
  phases: { id: PhaseId; label: string; extension: boolean }[];
  roles: { id: ProjectRole; label: string }[];
  decisions: string[];
  dueOptions: string[];
  involvementOptions: string[];
  agents: AgentDef[];
  changeRequests: {
    flags: { id: CrFlag; label: string; hint: string }[];
    sections: string[];
    recheckOutcomes: string[];
  };
  risks: { levels: Level[]; statuses: RiskStatus[]; scoreHigh: number; scoreMedium: number };
  statusReport: {
    criteria: { id: StatusCriterion; code: string; label: string }[];
    ampel: { id: Ampel; label: string; meaning: string }[];
    intervalDays: number;
  };
  /** Separation of duties; off only in a test environment. */
  policy: {
    separationOfDuties: boolean;
    controlRoles: ProjectRole[];
    incompatibleRoles: [ProjectRole, ProjectRole][];
  };
}

/** The texts the agent drafted for a status report (kept on the server until published). */
export interface StatusReportProposal {
  proposalId: string;
  overview: string;
  outlook: string;
  criteria: Partial<Record<StatusCriterion, { problem: string; measure: string }>>;
  findings: Finding[];
  producer: Producer;
}

/** A new risk the Risiko agent proposes (not stored until the PL accepts it). */
export interface RiskProposal {
  title: string;
  description: string;
  probability: Level;
  impact: Level;
  ownerRole: ProjectRole;
  mitigation: string;
  reason: string;
  /** The trigger the proposal rests on, or "profil" / "ergebnisse". */
  trigger: string;
  findings: Finding[];
}

/** A new assessment of an open risk the Risiko agent proposes. */
export interface ReassessmentProposal {
  risk: string;
  riskId: string;
  title: string;
  probability: Level;
  impact: Level;
  mitigation: string;
  reason: string;
  trigger: string;
  current: {
    probability: Level;
    impact: Level;
    status: RiskStatus;
    ownerRole: ProjectRole;
    mitigation: string;
    version: number;
  };
}

export interface RiskReviewResult {
  /** Accepting an item names this id and the item's index. */
  proposalId: string;
  newRisks: RiskProposal[];
  reassessments: ReassessmentProposal[];
  triggers: RiskTrigger[];
  producer: Producer;
}

/** The Change-Request agent's proposal (kept on the server until submitted). */
export interface ChangeRequestProposal {
  /** Submitting with it records the request as drafted by the agent. */
  proposalId: string;
  content: DraftContent;
  flags: Record<CrFlag, { value: boolean; reason: string }>;
  findings: Finding[];
  producer: Producer;
}

export interface ProjectPage {
  items: ProjectListItem[];
  total: number;
}

export type Scope = "mine" | "all";

/** Key figures of the projects the person may see; scope is what the API applied. */
export type Portfolio = PortfolioOverview & { scope: Scope };

export interface DevUserInfo {
  id: string;
  displayName: string;
  description: string;
}

export interface EventItem {
  seq: number;
  at: string;
  type: string;
  category: string;
  text: string;
  actor: { displayName: string; roles: string[]; channel: string };
}

export interface EventPage {
  items: EventItem[];
  hasMore: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
  reason?: string;
}

export type ChatAction =
  | { kind: "run_started"; skillId: string; runId: string; label: string }
  | { kind: "start_skill"; skillId: string; label: string }
  | { kind: "open_deliverable"; deliverableId: string; label: string };

export interface ChatReply {
  text: string;
  mode: "ki" | "regeln";
  actions: ChatAction[];
  suggestions: string[];
}

export interface CommandResult {
  lastSeq: number;
}
