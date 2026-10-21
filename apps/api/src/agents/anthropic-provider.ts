// Claude through the Claude API, for tests with fictional data on a developer's
// machine: the API processes data in the USA or globally, not only in the EU
// (decision D3), so config.ts refuses it in production, in Azure and with a
// database. The agents get the same prompts and answer schemas as with Azure
// OpenAI (schemas.ts), so the evaluation compares the models on equal terms.
//
// The SDK is a development dependency: create-provider.ts loads it only for
// AI_PROVIDER=anthropic, and this file uses its types alone.

import type Anthropic from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import type { DraftContent, Finding } from "@hermes-helfer/core";
import type { z } from "zod";
import {
  AiProviderError,
  type AiProvider,
  type CallContext,
  type ChangeRequestDraft,
  type ChangeRequestDraftRequest,
  type ChatMessage,
  type ChatResponse,
  type CritiqueRequest,
  type DraftRequest,
  type MinutesExtract,
  type MinutesExtractRequest,
  type ProviderInfo,
  type RiskReview,
  type RiskReviewRequest,
  type StatusReportDraft,
  type StatusReportDraftRequest,
  type ToolSpec,
  type Usage,
} from "./provider";
import {
  changeRequestSystemPrompt,
  changeRequestUserPrompt,
  critiqueSystemPrompt,
  critiqueUserPrompt,
  draftSystemPrompt,
  draftUserPrompt,
  minutesSystemPrompt,
  minutesUserPrompt,
  riskReviewSystemPrompt,
  riskReviewUserPrompt,
  statusReportSystemPrompt,
  statusReportUserPrompt,
} from "./prompts";
import {
  CHANGE_REQUEST_SCHEMA,
  CRITIQUE_SCHEMA,
  ChangeRequestOut,
  CritiqueOut,
  DRAFT_SCHEMA,
  DraftOut,
  MINUTES_SCHEMA,
  MinutesOut,
  RiskReviewOut,
  STATUS_REPORT_SCHEMA,
  StatusReportOut,
  riskReviewSchema,
} from "./schemas";

export interface AnthropicConfig {
  /** Model for drafts, the Kritiker and the other agents with a fixed answer form. */
  draftModel: string;
  /** Model for the Delivery-Assistent. */
  chatModel: string;
  /** Upper bound for thinking and answer tokens per call. */
  maxTokens: number;
  /** Drafts of results follow templates with many fields, so they may write more. */
  draftMaxTokens: number;
  timeoutMs: number;
  draftTimeoutMs: number;
  /** How much the model thinks before it answers; unset: the model's default. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

/** Shown in the assistant next to the model's name. */
export const ANTHROPIC_REGION = "USA oder global – nur zum Testen mit erfundenen Daten";

const isText = (b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text";
const isToolUse = (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use";

/** The tokens of a call; tokens read from or written to the prompt cache are input too. */
const usageOf = (m: Anthropic.Message): Usage => ({
  inputTokens:
    m.usage.input_tokens +
    (m.usage.cache_creation_input_tokens ?? 0) +
    (m.usage.cache_read_input_tokens ?? 0),
  outputTokens: m.usage.output_tokens,
});

/** The API's error type and message; they never contain prompt content. */
function errorSummary(body: unknown): string {
  const e = (body as { error?: { type?: unknown; message?: unknown } } | undefined)?.error;
  return [e?.type, e?.message]
    .filter((x) => typeof x === "string")
    .join(": ")
    .slice(0, 300);
}

function parseArguments(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/**
 * The conversation in the form of the Messages API: system prompts apart, the
 * results of one round of tools in one message, and the assistant's turns as the
 * model wrote them, its reasoning included (the API needs it back unchanged).
 */
export function toClaudeMessages(messages: readonly ChatMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const system: string[] = [];
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system.push(m.content);
    } else if (m.role === "tool") {
      const result: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      const last = out.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(result);
      else out.push({ role: "user", content: [result] });
    } else if (m.role === "assistant") {
      if (Array.isArray(m.turn)) {
        out.push({ role: "assistant", content: m.turn as Anthropic.ContentBlockParam[] });
        continue;
      }
      const content: Anthropic.ContentBlockParam[] = [
        ...(m.content?.trim() ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.toolCalls ?? []).map((t) => ({
          type: "tool_use" as const,
          id: t.id,
          name: t.name,
          input: parseArguments(t.arguments),
        })),
      ];
      if (content.length) out.push({ role: "assistant", content });
    } else if (m.content.trim()) {
      out.push({ role: "user", content: m.content });
    }
  }
  // The conversation starts with the person: an earlier answer without its question is left out.
  while (out[0]?.role === "assistant") out.shift();
  return { system: system.join("\n\n"), messages: out };
}

export class AnthropicProvider implements AiProvider {
  readonly info: ProviderInfo;
  private readonly client: Anthropic;

  constructor(
    private readonly cfg: AnthropicConfig,
    private readonly sdk: typeof Anthropic,
    options: ClientOptions = {},
  ) {
    this.client = new sdk({ maxRetries: 2, ...options });
    this.info = {
      provider: "anthropic",
      model: cfg.draftModel === cfg.chatModel ? cfg.draftModel : `${cfg.draftModel} / ${cfg.chatModel}`,
      region: ANTHROPIC_REGION,
      supportsChat: true,
    };
  }

  private failure(err: unknown, signal?: AbortSignal): AiProviderError {
    if (err instanceof AiProviderError) return err;
    if (signal?.aborted || err instanceof this.sdk.APIUserAbortError) {
      return new AiProviderError("aborted", "The request was closed");
    }
    if (err instanceof this.sdk.APIConnectionTimeoutError)
      return new AiProviderError("timeout", "Claude API timeout");
    if (err instanceof this.sdk.RateLimitError) return new AiProviderError("rate_limited", "Claude API 429");
    if (err instanceof this.sdk.APIError) {
      if (err.status === 529) return new AiProviderError("rate_limited", "Claude API 529 overloaded");
      if (err.status === undefined) return new AiProviderError("provider_error", "Claude API not reachable");
      return new AiProviderError(
        "provider_error",
        `Claude API ${err.status} ${errorSummary(err.error)}`.trim(),
      );
    }
    return new AiProviderError("provider_error", String(err));
  }

  /** Answers that are of no use count their tokens too (review F9). */
  private checkStop(m: Anthropic.Message, usage: Usage): void {
    if (m.stop_reason === "refusal") throw new AiProviderError("blocked", "Claude declined to answer", usage);
    if (m.stop_reason === "max_tokens" || m.stop_reason === "model_context_window_exceeded") {
      throw new AiProviderError("invalid_output", `Answer cut off (${m.stop_reason})`, usage);
    }
  }

  /** One call with a fixed answer form (structured outputs); streamed, as long answers take minutes. */
  private async structured<T>(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    out: z.ZodType<T>,
    signal: AbortSignal | undefined,
    draft = false,
  ): Promise<{ value: T; usage: Usage }> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages
        .stream(
          {
            model: this.cfg.draftModel,
            max_tokens: draft ? this.cfg.draftMaxTokens : this.cfg.maxTokens,
            system,
            messages: [{ role: "user", content: user }],
            output_config: {
              ...(this.cfg.effort ? { effort: this.cfg.effort } : {}),
              format: { type: "json_schema", schema },
            },
          },
          { timeout: draft ? this.cfg.draftTimeoutMs : this.cfg.timeoutMs, ...(signal ? { signal } : {}) },
        )
        .finalMessage();
    } catch (err) {
      throw this.failure(err, signal);
    }
    const usage = usageOf(message);
    this.checkStop(message, usage);
    let json: unknown;
    try {
      json = JSON.parse(
        message.content
          .filter(isText)
          .map((b) => b.text)
          .join(""),
      );
    } catch {
      throw new AiProviderError("invalid_output", "Model output is not JSON", usage);
    }
    const value = out.safeParse(json);
    if (!value.success) {
      throw new AiProviderError("invalid_output", "Model output does not match the schema", usage);
    }
    return { value: value.data, usage };
  }

  async draft(req: DraftRequest, ctx?: CallContext): Promise<{ draft: DraftContent; usage?: Usage }> {
    const { value, usage } = await this.structured(
      draftSystemPrompt(req),
      draftUserPrompt(req),
      DRAFT_SCHEMA,
      DraftOut,
      ctx?.signal,
      true,
    );
    return { draft: value, usage };
  }

  async draftChangeRequest(
    req: ChangeRequestDraftRequest,
    ctx?: CallContext,
  ): Promise<{ draft: ChangeRequestDraft; usage?: Usage }> {
    const { value, usage } = await this.structured(
      changeRequestSystemPrompt(req),
      changeRequestUserPrompt(req),
      CHANGE_REQUEST_SCHEMA,
      ChangeRequestOut,
      ctx?.signal,
    );
    const { flags, ...content } = value;
    return { draft: { content, flags }, usage };
  }

  async reviewRisks(
    req: RiskReviewRequest,
    ctx?: CallContext,
  ): Promise<{ review: RiskReview; usage?: Usage }> {
    const { value, usage } = await this.structured(
      riskReviewSystemPrompt(req),
      riskReviewUserPrompt(req),
      riskReviewSchema(req.triggers.map((t) => t.id)),
      RiskReviewOut,
      ctx?.signal,
    );
    return { review: value, usage };
  }

  async draftStatusReport(
    req: StatusReportDraftRequest,
    ctx?: CallContext,
  ): Promise<{ draft: StatusReportDraft; usage?: Usage }> {
    const { value, usage } = await this.structured(
      statusReportSystemPrompt(req),
      statusReportUserPrompt(req),
      STATUS_REPORT_SCHEMA,
      StatusReportOut,
      ctx?.signal,
    );
    return { draft: value, usage };
  }

  async extractMinutes(
    req: MinutesExtractRequest,
    ctx?: CallContext,
  ): Promise<{ extract: MinutesExtract; usage?: Usage }> {
    const { value, usage } = await this.structured(
      minutesSystemPrompt(req),
      minutesUserPrompt(req),
      MINUTES_SCHEMA,
      MinutesOut,
      ctx?.signal,
    );
    return { extract: value, usage };
  }

  async critique(req: CritiqueRequest, ctx?: CallContext): Promise<{ findings: Finding[]; usage?: Usage }> {
    const { value, usage } = await this.structured(
      critiqueSystemPrompt(),
      critiqueUserPrompt(req),
      CRITIQUE_SCHEMA,
      CritiqueOut,
      ctx?.signal,
    );
    return {
      findings: value.findings.map((f) => ({
        severity: f.severity,
        text: f.text,
        source: "kritiker" as const,
      })),
      usage,
    };
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], ctx?: CallContext): Promise<ChatResponse> {
    const { system, messages: conversation } = toClaudeMessages(messages);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(
        {
          model: this.cfg.chatModel,
          max_tokens: this.cfg.maxTokens,
          ...(system ? { system } : {}),
          messages: conversation,
          // The tools' schemas allow no other properties, so the arguments always match them.
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool.InputSchema,
            strict: true,
          })),
          ...(this.cfg.effort ? { output_config: { effort: this.cfg.effort } } : {}),
          // Each round of tools sends the conversation again; the cache spares reading it anew.
          cache_control: { type: "ephemeral" },
        },
        { timeout: this.cfg.timeoutMs, ...(ctx?.signal ? { signal: ctx.signal } : {}) },
      );
    } catch (err) {
      throw this.failure(err, ctx?.signal);
    }
    const usage = usageOf(message);
    // A tool call cut off at max_tokens has incomplete arguments: never run it.
    this.checkStop(message, usage);
    const toolCalls = message.content.filter(isToolUse).map((b) => ({
      id: b.id,
      name: b.name,
      arguments: JSON.stringify(b.input),
    }));
    const text = message.content
      .filter(isText)
      .map((b) => b.text)
      .join("");
    return {
      content: text || null,
      toolCalls,
      usage,
      ...(toolCalls.length ? { turn: message.content } : {}),
    };
  }
}
