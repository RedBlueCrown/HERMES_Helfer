// The model behind the agents is pluggable (architecture §4.3). Only providers
// that process data in the EU may be added (decision D3).

import type {
  AgentDef,
  DeliverableDef,
  DraftContent,
  Finding,
  PhaseId,
  ProjectProfile,
  SkillDef,
} from "@hermes-helfer/core";

export interface ProviderInfo {
  provider: "mock" | "azure-openai";
  /** Model or deployment names, for provenance. */
  model: string;
  /** Where the model processes data, shown to users. */
  region: string;
  /** Free-text chat with tool calls; without it the assistant uses the rule-based router. */
  supportsChat: boolean;
}

export interface ProjectContext {
  code: string;
  name: string;
  description: string;
  phase: PhaseId;
  phaseLabel: string;
  profile: ProjectProfile;
  /** Released results the requester may read, as background for the draft. */
  releasedResults: { name: string; summary: string }[];
}

export interface DraftRequest {
  agent: AgentDef;
  skill: SkillDef;
  deliverables: readonly DeliverableDef[];
  project: ProjectContext;
}

export interface CritiqueRequest {
  skill: SkillDef;
  deliverables: readonly DeliverableDef[];
  draft: DraftContent;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments as produced by the model. */
  arguments: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: Usage;
}

export interface AiProvider {
  readonly info: ProviderInfo;
  draft(req: DraftRequest): Promise<{ draft: DraftContent; usage?: Usage }>;
  critique(req: CritiqueRequest): Promise<{ findings: Finding[]; usage?: Usage }>;
  chat?(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResponse>;
}

/** A provider failure with a reason that is safe to show to users. */
export class AiProviderError extends Error {
  constructor(
    readonly reason: "rate_limited" | "blocked" | "timeout" | "invalid_output" | "provider_error",
    message: string,
  ) {
    super(message);
  }
}

export const USER_FACING_REASON: Readonly<Record<AiProviderError["reason"], string>> = {
  rate_limited: "Hohe Auslastung des KI-Modells, bitte später erneut versuchen",
  blocked: "Vom Inhaltsfilter blockiert",
  timeout: "Zeitüberschreitung beim KI-Modell",
  invalid_output: "Das KI-Modell hat keinen gültigen Entwurf geliefert",
  provider_error: "Das KI-Modell ist gerade nicht erreichbar",
};
