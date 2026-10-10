// Response types of the API that are not view models from @hermes-helfer/core.

import type {
  AgentDef,
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
  current: {
    probability: Level;
    impact: Level;
    status: RiskStatus;
    ownerRole: ProjectRole;
    mitigation: string;
  };
}

export interface RiskReviewResult {
  newRisks: RiskProposal[];
  reassessments: ReassessmentProposal[];
  triggers: RiskTrigger[];
  producer: Producer;
}

/** The Change-Request agent's proposal (not stored until submitted). */
export interface ChangeRequestProposal {
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
