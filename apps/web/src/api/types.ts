// Response types of the API that are not view models from @hermes-helfer/core.

import type { AgentDef, GlobalRole, PhaseId, ProjectListItem, ProjectRole } from "@hermes-helfer/core";

export type {
  ChecklistView,
  ConditionView,
  DeliverableDetailView,
  DeliverableRowView,
  GateView,
  MemberView,
  ParticipantView,
  PhaseView,
  ProjectListItem,
  ProjectView,
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
}

export interface ProjectPage {
  items: ProjectListItem[];
  total: number;
}

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
