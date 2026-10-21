// Azure OpenAI (Microsoft Foundry) in the EU. Authenticates with Entra ID
// (managed identity in Azure, developer sign-in locally); no API keys.
// Written against the documented REST API and not yet tested against a real
// deployment (todo-later P07).

import type { TokenCredential } from "@azure/identity";
import type { DraftContent, Finding } from "@hermes-helfer/core";
import { z } from "zod";
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
  type KnowledgeReply,
  type KnowledgeRequest,
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
  knowledgeSystemPrompt,
  knowledgeUserPrompt,
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
  KNOWLEDGE_SCHEMA,
  KnowledgeOut,
  MINUTES_SCHEMA,
  MinutesOut,
  RiskReviewOut,
  STATUS_REPORT_SCHEMA,
  StatusReportOut,
  riskReviewSchema,
} from "./schemas";

export interface AzureOpenAiConfig {
  endpoint: string;
  draftDeployment: string;
  chatDeployment: string;
  /** "v1": the versionless v1 API (default). A date such as 2024-10-21: the older deployments path. */
  apiVersion: string;
  regionLabel: string;
  timeoutMs?: number;
  /** Upper bound for reasoning and answer tokens per call (unbounded consumption, architecture §8.2). */
  maxCompletionTokens?: number;
  /**
   * Drafts of results: they follow templates with many fields (an ISDS-Konzept has
   * 65) and run in the background, so they may write more and take longer. A
   * deployment's quota counts each call's limit, so the other calls keep the smaller one.
   */
  draftMaxCompletionTokens?: number;
  draftTimeoutMs?: number;
  /** Only for reasoning models such as the GPT-5 series. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
}

export type TokenSource = () => Promise<string>;

const ApiResponse = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

function errorSummary(body: string): string {
  try {
    const e = (JSON.parse(body) as { error?: { code?: unknown; message?: unknown } }).error;
    return [e?.code, e?.message]
      .filter((x) => typeof x === "string")
      .join(": ")
      .slice(0, 300);
  } catch {
    return "";
  }
}

/** Entra ID token for Azure OpenAI, renewed two minutes before it expires. */
export function entraTokenSource(credential: () => Promise<TokenCredential>): TokenSource {
  let cached: { token: string; expires: number } | undefined;
  return async () => {
    if (cached && cached.expires - Date.now() > 120_000) return cached.token;
    const t = await (await credential()).getToken("https://cognitiveservices.azure.com/.default");
    if (!t) throw new AiProviderError("provider_error", "No token for Azure OpenAI");
    cached = { token: t.token, expires: t.expiresOnTimestamp };
    return t.token;
  };
}

export class AzureOpenAiProvider implements AiProvider {
  readonly info: ProviderInfo;

  constructor(
    private readonly cfg: AzureOpenAiConfig,
    private readonly token: TokenSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.info = {
      provider: "azure-openai",
      model: `${cfg.draftDeployment} / ${cfg.chatDeployment}`,
      region: cfg.regionLabel,
      supportsChat: true,
    };
  }

  private async call(
    deployment: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
    limits: { maxCompletionTokens?: number | undefined; timeoutMs?: number | undefined } = {},
  ) {
    const maxCompletionTokens = limits.maxCompletionTokens ?? this.cfg.maxCompletionTokens;
    const base = this.cfg.endpoint.replace(/\/$/, "");
    const v1 = this.cfg.apiVersion === "v1";
    const url = v1
      ? `${base}/openai/v1/chat/completions`
      : `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(this.cfg.apiVersion)}`;
    const payload = {
      ...(v1 ? { model: deployment } : {}),
      ...body,
      ...(maxCompletionTokens ? { max_completion_tokens: maxCompletionTokens } : {}),
      ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
    };
    const timeout = AbortSignal.timeout(limits.timeoutMs ?? this.cfg.timeoutMs ?? 180_000);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await this.token()}` },
        body: JSON.stringify(payload),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw new AiProviderError("aborted", "The request was closed");
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new AiProviderError(timedOut ? "timeout" : "provider_error", String(err));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new AiProviderError("rate_limited", `Azure OpenAI 429`);
      if (res.status === 400 && /content_filter|ResponsibleAIPolicyViolation/i.test(text)) {
        throw new AiProviderError("blocked", "Azure OpenAI content filter");
      }
      // Azure's error code and message help operations (wrong deployment, unsupported
      // parameter); they never contain prompt content.
      throw new AiProviderError("provider_error", `Azure OpenAI ${res.status} ${errorSummary(text)}`.trim());
    }
    const parsed = ApiResponse.safeParse(await res.json());
    if (!parsed.success) throw new AiProviderError("invalid_output", "Unexpected Azure OpenAI response");
    const choice = parsed.data.choices[0]!;
    // The tokens count also when the answer is of no use (review F9).
    const usage: Usage | undefined = parsed.data.usage
      ? { inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens }
      : undefined;
    if (choice.finish_reason === "content_filter")
      throw new AiProviderError("blocked", "Azure OpenAI content filter", usage);
    if (choice.finish_reason === "length") {
      throw new AiProviderError("invalid_output", "Answer cut off at max_completion_tokens", usage);
    }
    return { message: choice.message, usage };
  }

  private async structured<T>(
    deployment: string,
    system: string,
    user: string,
    name: string,
    schema: unknown,
    out: z.ZodType<T>,
    signal: AbortSignal | undefined,
    limits?: { maxCompletionTokens?: number | undefined; timeoutMs?: number | undefined },
  ): Promise<{ value: T; usage?: Usage }> {
    const { message, usage } = await this.call(
      deployment,
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      },
      signal,
      limits,
    );
    let json: unknown;
    try {
      json = JSON.parse(message.content ?? "");
    } catch {
      throw new AiProviderError("invalid_output", "Model output is not JSON", usage);
    }
    const value = out.safeParse(json);
    if (!value.success) {
      throw new AiProviderError("invalid_output", "Model output does not match the schema", usage);
    }
    return { value: value.data, ...(usage ? { usage } : {}) };
  }

  async draft(req: DraftRequest, ctx?: CallContext): Promise<{ draft: DraftContent; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      draftSystemPrompt(req),
      draftUserPrompt(req),
      "entwurf",
      DRAFT_SCHEMA,
      DraftOut,
      ctx?.signal,
      { maxCompletionTokens: this.cfg.draftMaxCompletionTokens, timeoutMs: this.cfg.draftTimeoutMs },
    );
    return { draft: value, ...(usage ? { usage } : {}) };
  }

  async draftChangeRequest(
    req: ChangeRequestDraftRequest,
    ctx?: CallContext,
  ): Promise<{ draft: ChangeRequestDraft; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      changeRequestSystemPrompt(req),
      changeRequestUserPrompt(req),
      "change_request",
      CHANGE_REQUEST_SCHEMA,
      ChangeRequestOut,
      ctx?.signal,
    );
    const { flags, ...content } = value;
    return { draft: { content, flags }, ...(usage ? { usage } : {}) };
  }

  async reviewRisks(
    req: RiskReviewRequest,
    ctx?: CallContext,
  ): Promise<{ review: RiskReview; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      riskReviewSystemPrompt(req),
      riskReviewUserPrompt(req),
      "risikopruefung",
      riskReviewSchema(req.triggers.map((t) => t.id)),
      RiskReviewOut,
      ctx?.signal,
    );
    return { review: value, ...(usage ? { usage } : {}) };
  }

  async draftStatusReport(
    req: StatusReportDraftRequest,
    ctx?: CallContext,
  ): Promise<{ draft: StatusReportDraft; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      statusReportSystemPrompt(req),
      statusReportUserPrompt(req),
      "statusbericht",
      STATUS_REPORT_SCHEMA,
      StatusReportOut,
      ctx?.signal,
    );
    return { draft: value, ...(usage ? { usage } : {}) };
  }

  async extractMinutes(
    req: MinutesExtractRequest,
    ctx?: CallContext,
  ): Promise<{ extract: MinutesExtract; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      minutesSystemPrompt(req),
      minutesUserPrompt(req),
      "protokoll",
      MINUTES_SCHEMA,
      MinutesOut,
      ctx?.signal,
    );
    return { extract: value, ...(usage ? { usage } : {}) };
  }

  async answerQuestion(
    req: KnowledgeRequest,
    ctx?: CallContext,
  ): Promise<{ reply: KnowledgeReply; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.chatDeployment,
      knowledgeSystemPrompt(req),
      knowledgeUserPrompt(req),
      "wissen",
      KNOWLEDGE_SCHEMA,
      KnowledgeOut,
      ctx?.signal,
    );
    return { reply: value, ...(usage ? { usage } : {}) };
  }

  async critique(req: CritiqueRequest, ctx?: CallContext): Promise<{ findings: Finding[]; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      critiqueSystemPrompt(),
      critiqueUserPrompt(req),
      "kritik",
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
      ...(usage ? { usage } : {}),
    };
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], ctx?: CallContext): Promise<ChatResponse> {
    const { message, usage } = await this.call(
      this.cfg.chatDeployment,
      {
        messages: messages.map((m) => {
          if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
          if (m.role === "assistant") {
            return {
              role: "assistant",
              content: m.content,
              ...(m.toolCalls?.length
                ? {
                    tool_calls: m.toolCalls.map((t) => ({
                      id: t.id,
                      type: "function",
                      function: { name: t.name, arguments: t.arguments },
                    })),
                  }
                : {}),
            };
          }
          return { role: m.role, content: m.content };
        }),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
      },
      ctx?.signal,
    );
    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? []).map((t) => ({
        id: t.id,
        name: t.function.name,
        arguments: t.function.arguments,
      })),
      ...(usage ? { usage } : {}),
    };
  }
}
