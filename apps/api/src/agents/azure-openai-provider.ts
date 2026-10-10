// Azure OpenAI (Microsoft Foundry) in the EU. Authenticates with Entra ID
// (managed identity in Azure, developer sign-in locally); no API keys.
// Written against the documented REST API and not yet tested against a real
// deployment (todo-later P07).

import type { TokenCredential } from "@azure/identity";
import { CR_FLAGS, PROJECT_ROLES, RISK_LEVELS, type DraftContent, type Finding } from "@hermes-helfer/core";
import { z } from "zod";
import {
  AiProviderError,
  type AiProvider,
  type ChangeRequestDraft,
  type ChangeRequestDraftRequest,
  type ChatMessage,
  type ChatResponse,
  type CritiqueRequest,
  type DraftRequest,
  type ProviderInfo,
  type RiskReview,
  type RiskReviewRequest,
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
  riskReviewSystemPrompt,
  riskReviewUserPrompt,
} from "./prompts";

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
  /** Only for reasoning models such as the GPT-5 series. */
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
}

export type TokenSource = () => Promise<string>;

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "openPoints"],
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "body"],
        properties: { heading: { type: "string" }, body: { type: "string" } },
      },
    },
    openPoints: { type: "array", items: { type: "string" } },
  },
} as const;

const FLAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "reason"],
  properties: { value: { type: "boolean" }, reason: { type: "string" } },
} as const;

const CHANGE_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "sections", "openPoints", "flags"],
  properties: {
    ...DRAFT_SCHEMA.properties,
    flags: {
      type: "object",
      additionalProperties: false,
      required: [...CR_FLAGS],
      properties: Object.fromEntries(CR_FLAGS.map((f) => [f, FLAG_SCHEMA])),
    },
  },
} as const;

const LEVEL_SCHEMA = { type: "string", enum: [...RISK_LEVELS] } as const;

const RISK_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["newRisks", "reassessments"],
  properties: {
    newRisks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "probability", "impact", "ownerRole", "mitigation", "reason"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          probability: LEVEL_SCHEMA,
          impact: LEVEL_SCHEMA,
          ownerRole: { type: "string", enum: [...PROJECT_ROLES] },
          mitigation: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    reassessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["risk", "probability", "impact", "mitigation", "reason"],
        properties: {
          risk: { type: "string" },
          probability: LEVEL_SCHEMA,
          impact: LEVEL_SCHEMA,
          mitigation: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "text"],
        properties: { severity: { type: "string", enum: ["hinweis", "warnung"] }, text: { type: "string" } },
      },
    },
  },
} as const;

const DraftOut = z.object({
  summary: z.string().max(4000),
  sections: z.array(z.object({ heading: z.string().max(200), body: z.string().max(30_000) })).max(40),
  openPoints: z.array(z.string().max(500)).max(50),
});
const FlagOut = z.object({ value: z.boolean(), reason: z.string().max(500) });
const ChangeRequestOut = DraftOut.extend({
  flags: z.object({
    daten: FlagOut,
    schnittstelle: FlagOut,
    sonderloesung: FlagOut,
    oberflaeche: FlagOut,
    extern: FlagOut,
  }),
});
const LevelOut = z.enum(RISK_LEVELS);
const RiskReviewOut = z.object({
  newRisks: z
    .array(
      z.object({
        title: z.string().max(200),
        description: z.string().max(2000),
        probability: LevelOut,
        impact: LevelOut,
        ownerRole: z.enum(PROJECT_ROLES),
        mitigation: z.string().max(1000),
        reason: z.string().max(500),
      }),
    )
    .max(20),
  reassessments: z
    .array(
      z.object({
        risk: z.string().max(20),
        probability: LevelOut,
        impact: LevelOut,
        mitigation: z.string().max(1000),
        reason: z.string().max(500),
      }),
    )
    .max(20),
});
const CritiqueOut = z.object({
  findings: z
    .array(z.object({ severity: z.enum(["hinweis", "warnung"]), text: z.string().max(500) }))
    .max(10),
});

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

  private async call(deployment: string, body: Record<string, unknown>) {
    const base = this.cfg.endpoint.replace(/\/$/, "");
    const v1 = this.cfg.apiVersion === "v1";
    const url = v1
      ? `${base}/openai/v1/chat/completions`
      : `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(this.cfg.apiVersion)}`;
    const payload = {
      ...(v1 ? { model: deployment } : {}),
      ...body,
      ...(this.cfg.maxCompletionTokens ? { max_completion_tokens: this.cfg.maxCompletionTokens } : {}),
      ...(this.cfg.reasoningEffort ? { reasoning_effort: this.cfg.reasoningEffort } : {}),
    };
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await this.token()}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 180_000),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new AiProviderError(timeout ? "timeout" : "provider_error", String(err));
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
    if (choice.finish_reason === "content_filter")
      throw new AiProviderError("blocked", "Azure OpenAI content filter");
    if (choice.finish_reason === "length") {
      throw new AiProviderError("invalid_output", "Answer cut off at max_completion_tokens");
    }
    const usage: Usage | undefined = parsed.data.usage
      ? { inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens }
      : undefined;
    return { message: choice.message, usage };
  }

  private async structured<T>(
    deployment: string,
    system: string,
    user: string,
    name: string,
    schema: unknown,
    out: z.ZodType<T>,
  ): Promise<{ value: T; usage?: Usage }> {
    const { message, usage } = await this.call(deployment, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    });
    let json: unknown;
    try {
      json = JSON.parse(message.content ?? "");
    } catch {
      throw new AiProviderError("invalid_output", "Model output is not JSON");
    }
    const value = out.safeParse(json);
    if (!value.success) throw new AiProviderError("invalid_output", "Model output does not match the schema");
    return { value: value.data, ...(usage ? { usage } : {}) };
  }

  async draft(req: DraftRequest): Promise<{ draft: DraftContent; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      draftSystemPrompt(req),
      draftUserPrompt(req),
      "entwurf",
      DRAFT_SCHEMA,
      DraftOut,
    );
    return { draft: value, ...(usage ? { usage } : {}) };
  }

  async draftChangeRequest(
    req: ChangeRequestDraftRequest,
  ): Promise<{ draft: ChangeRequestDraft; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      changeRequestSystemPrompt(req),
      changeRequestUserPrompt(req),
      "change_request",
      CHANGE_REQUEST_SCHEMA,
      ChangeRequestOut,
    );
    const { flags, ...content } = value;
    return { draft: { content, flags }, ...(usage ? { usage } : {}) };
  }

  async reviewRisks(req: RiskReviewRequest): Promise<{ review: RiskReview; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      riskReviewSystemPrompt(req),
      riskReviewUserPrompt(req),
      "risikopruefung",
      RISK_REVIEW_SCHEMA,
      RiskReviewOut,
    );
    return { review: value, ...(usage ? { usage } : {}) };
  }

  async critique(req: CritiqueRequest): Promise<{ findings: Finding[]; usage?: Usage }> {
    const { value, usage } = await this.structured(
      this.cfg.draftDeployment,
      critiqueSystemPrompt(),
      critiqueUserPrompt(req),
      "kritik",
      CRITIQUE_SCHEMA,
      CritiqueOut,
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

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatResponse> {
    const { message, usage } = await this.call(this.cfg.chatDeployment, {
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
    });
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
