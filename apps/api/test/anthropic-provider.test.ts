import { CR_FLAGS, CR_FLAG_LABELS, CR_SECTIONS, DEFAULT_PROFILE, MODEL } from "@hermes-helfer/core";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicProvider, toClaudeMessages, type AnthropicConfig } from "../src/agents/anthropic-provider";
import { AiProviderError, type ChatMessage } from "../src/agents/provider";
import { loadConfig } from "../src/config";

const cfg: AnthropicConfig = {
  draftModel: "claude-opus-5-5",
  chatModel: "claude-haiku-5-5",
  maxTokens: 16_000,
  draftMaxTokens: 32_000,
  timeoutMs: 60_000,
  draftTimeoutMs: 600_000,
};

const req = {
  agent: MODEL.agent("A7"),
  skill: MODEL.skill("konzept.test-engineer"),
  deliverables: MODEL.deliverablesOfSkill("konzept.test-engineer"),
  project: {
    code: "KPO",
    name: "Kundenportal",
    description: "",
    phase: "konzept" as const,
    phaseLabel: "Konzept",
    profile: DEFAULT_PROFILE,
    releasedResults: [],
    openRisks: [],
  },
};

type Block = Record<string, unknown>;

/** A Messages API answer. */
const message = (content: Block[], stop = "end_turn", usage = { input_tokens: 10, output_tokens: 5 }) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage,
});

/** The same answer as server-sent events, as the API streams it. */
function sse(m: ReturnType<typeof message>): string {
  const events: Block[] = [
    {
      type: "message_start",
      message: { ...m, content: [], stop_reason: null, usage: { ...m.usage, output_tokens: 1 } },
    },
  ];
  m.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "", signature: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: block.signature },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: m.stop_reason, stop_sequence: null },
    usage: { output_tokens: m.usage.output_tokens },
  });
  events.push({ type: "message_stop" });
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

interface Call {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** A fake Claude API: answers each request with the next answer, streamed when asked to. */
function fakeApi(...answers: (ReturnType<typeof message> | { status: number; body: unknown })[]) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, body, headers: new Headers(init.headers) });
    const answer = answers[Math.min(calls.length, answers.length) - 1]!;
    if ("status" in answer) {
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    }
    return body.stream
      ? new Response(sse(answer), { headers: { "content-type": "text/event-stream" } })
      : new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  const provider = new AnthropicProvider(cfg, Anthropic, { apiKey: "test-key", fetch, maxRetries: 0 });
  return { provider, calls };
}

const text = (t: string): Block => ({ type: "text", text: t });

describe("Claude provider (against a fake Claude API)", () => {
  it("streams a draft with the shared answer schema and the larger limit for drafts", async () => {
    const draft = { summary: "S", sections: [{ heading: "Teststufen", body: "B" }], openPoints: [] };
    const { provider, calls } = fakeApi(
      message([{ type: "thinking", signature: "sig" }, text(JSON.stringify(draft))], "end_turn", {
        input_tokens: 100,
        output_tokens: 40,
      }),
    );
    const out = await provider.draft(req);
    expect(out.draft).toEqual(draft);
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
    const { url, body, headers } = calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(body).toMatchObject({ model: "claude-opus-5-5", max_tokens: 32_000, stream: true });
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(typeof body.system).toBe("string");
    // Sampling parameters and thinking budgets, which newer models refuse, are never sent.
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("thinking");
    expect(provider.info).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5 / claude-haiku-5-5",
    });
  });

  it("sends only schema keywords that structured outputs support", async () => {
    const SUPPORTED = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
    const unsupported: string[] = [];
    const walk = (x: unknown, path: string) => {
      if (!x || typeof x !== "object") return;
      const node = x as Record<string, unknown>;
      for (const key of Object.keys(node)) if (!SUPPORTED.has(key)) unsupported.push(`${path}.${key}`);
      if (node.type === "object" && node.additionalProperties !== false) unsupported.push(`${path} (offen)`);
      for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, unknown>))
        walk(v, `${path}.${k}`);
      walk(node.items, `${path}[]`);
    };
    const answers = [
      { summary: "S", sections: [], openPoints: [] },
      {
        summary: "S",
        sections: [],
        openPoints: [],
        flags: Object.fromEntries(CR_FLAGS.map((f) => [f, { value: false, reason: "R" }])),
      },
      { newRisks: [], reassessments: [] },
      { overview: "O", outlook: "A", criteria: [] },
      { findings: [] },
    ].map((a) => message([text(JSON.stringify(a))]));
    const { provider, calls } = fakeApi(...answers);
    await provider.draft(req);
    await provider.draftChangeRequest({
      agent: MODEL.agent("A10"),
      project: req.project,
      idea: { title: "Export", description: "Export der Kreditoren", requestedBy: "Revision" },
      sections: CR_SECTIONS,
      flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
    });
    await provider.reviewRisks({
      agent: MODEL.agent("A12"),
      project: req.project,
      triggers: [{ id: "profil:lieferant", text: "Ein externer Lieferant ist beteiligt." }],
      roles: [{ id: "PL", label: "Projektleitung" }],
      max: 5,
    });
    await provider.draftStatusReport({
      agent: MODEL.agent("A2"),
      project: req.project,
      criteria: [],
      facts: [],
    });
    await provider.critique({
      key: "change-request",
      document: "Change Request",
      sections: CR_SECTIONS,
      results: [],
      draft: { summary: "S", sections: [], openPoints: [] },
    });
    expect(calls).toHaveLength(5);
    calls.forEach((c, i) =>
      walk((c.body.output_config as { format: { schema: unknown } }).format.schema, `#${i}`),
    );
    expect(unsupported).toEqual([]);
    // Only drafts of results get the larger limit.
    expect(calls.map((c) => c.body.max_tokens)).toEqual([32_000, 16_000, 16_000, 16_000, 16_000]);
  });

  it("passes the configured effort, and nothing when it is unset", async () => {
    const draft = message([text(JSON.stringify({ summary: "S", sections: [], openPoints: [] }))]);
    const calls: Call[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(init.body as string),
        headers: new Headers(init.headers),
      });
      return new Response(sse(draft), { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof globalThis.fetch;
    await new AnthropicProvider({ ...cfg, effort: "low" }, Anthropic, { apiKey: "k", fetch }).draft(req);
    expect(calls[0]!.body.output_config).toMatchObject({ effort: "low" });
    const { provider, calls: plain } = fakeApi(draft);
    await provider.draft(req);
    expect(plain[0]!.body.output_config).not.toHaveProperty("effort");
  });

  it("maps errors, refusals and cut-off answers to provider errors with a safe reason", async () => {
    const reason = async (...answers: Parameters<typeof fakeApi>) => {
      const err = await fakeApi(...answers)
        .provider.draft(req)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiProviderError);
      return err as AiProviderError;
    };
    expect((await reason({ status: 429, body: {} })).reason).toBe("rate_limited");
    expect((await reason({ status: 529, body: {} })).reason).toBe("rate_limited");
    const bad = await reason({
      status: 400,
      body: { type: "error", error: { type: "invalid_request_error", message: "max_tokens: too large" } },
    });
    expect(bad).toMatchObject({ reason: "provider_error" });
    expect(bad.message).toBe("Claude API 400 invalid_request_error: max_tokens: too large");
    const refused = await reason(message([], "refusal"));
    expect(refused).toMatchObject({ reason: "blocked", usage: { inputTokens: 10, outputTokens: 5 } });
    expect((await reason(message([text('{"summ')], "max_tokens"))).reason).toBe("invalid_output");
    expect((await reason(message([text("kein JSON")]))).reason).toBe("invalid_output");
    expect((await reason(message([text('{"summary":1}')]))).reason).toBe("invalid_output");
  });

  it("stops the call when the person closes the request", async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        if (init.signal!.aborted) abort();
        else init.signal!.addEventListener("abort", abort);
      })) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    const call = new AnthropicProvider(cfg, Anthropic, { apiKey: "k", fetch: hanging, maxRetries: 0 }).draft(
      req,
      {
        userId: "u",
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(call).rejects.toMatchObject({ reason: "aborted" });
  });

  it("calls tools and sends the turn back unchanged, reasoning included, with the results", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig-1" };
    const toolUse = { type: "tool_use", id: "toolu_1", name: "naechster_schritt", input: {} };
    const { provider, calls } = fakeApi(
      message([thinking, toolUse], "tool_use"),
      message([text("Als Nächstes: Kick-off.")]),
    );
    const tools = [
      {
        name: "naechster_schritt",
        description: "x",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ];
    const messages: ChatMessage[] = [
      { role: "system", content: "Regeln" },
      { role: "user", content: "Was ist als Nächstes?" },
    ];
    const first = await provider.chat(messages, tools);
    expect(first.toolCalls).toEqual([{ id: "toolu_1", name: "naechster_schritt", arguments: "{}" }]);
    expect(first.turn).toEqual([thinking, toolUse]);
    expect(calls[0]!.body).toMatchObject({
      model: "claude-haiku-5-5",
      system: "Regeln",
      messages: [{ role: "user", content: "Was ist als Nächstes?" }],
      tools: [{ name: "naechster_schritt", strict: true, input_schema: tools[0]!.parameters }],
      cache_control: { type: "ephemeral" },
    });
    // Forcing a tool is refused by newer models; the prompt asks for tools instead.
    expect(calls[0]!.body).not.toHaveProperty("tool_choice");

    messages.push({
      role: "assistant",
      content: first.content,
      toolCalls: first.toolCalls,
      turn: first.turn,
    });
    messages.push({ role: "tool", toolCallId: "toolu_1", content: '{"title":"Kick-off"}' });
    const second = await provider.chat(messages, tools);
    expect(second).toMatchObject({ content: "Als Nächstes: Kick-off.", toolCalls: [] });
    expect(second).not.toHaveProperty("turn");
    expect(calls[1]!.body.messages).toEqual([
      { role: "user", content: "Was ist als Nächstes?" },
      { role: "assistant", content: [thinking, toolUse] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"title":"Kick-off"}' }],
      },
    ]);
  });

  it("never runs a tool call that was cut off", async () => {
    const { provider } = fakeApi(
      message([{ type: "tool_use", id: "toolu_1", name: "entwurf_anstossen", input: {} }], "max_tokens"),
    );
    await expect(provider.chat([{ role: "user", content: "Starte" }], [])).rejects.toMatchObject({
      reason: "invalid_output",
    });
  });
});

describe("conversation for the Messages API", () => {
  it("puts the results of one round in one message and starts with the person", () => {
    const { system, messages } = toClaudeMessages([
      { role: "system", content: "A" },
      { role: "assistant", content: "Eine frühere Antwort ohne ihre Frage" },
      { role: "user", content: "Frage" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          { id: "t1", name: "risiken", arguments: "{}" },
          { id: "t2", name: "gate_status", arguments: "kaputt" },
        ],
      },
      { role: "tool", toolCallId: "t1", content: "R" },
      { role: "tool", toolCallId: "t2", content: "G" },
      { role: "user", content: "  " },
    ]);
    expect(system).toBe("A");
    expect(messages).toEqual([
      { role: "user", content: "Frage" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "risiken", input: {} },
          { type: "tool_use", id: "t2", name: "gate_status", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "R" },
          { type: "tool_result", tool_use_id: "t2", content: "G" },
        ],
      },
    ]);
  });
});

describe("configuration guards for Claude", () => {
  const dev = { AUTH_MODE: "dev", AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" };

  it("allows Claude only on a developer's machine, with fictional data in memory", () => {
    expect(loadConfig(dev)).toMatchObject({
      AI_PROVIDER: "anthropic",
      ANTHROPIC_MODEL_DRAFT: "claude-opus-5-5",
      ANTHROPIC_MODEL_CHAT: "claude-opus-5-5",
    });
    expect(() => loadConfig({ ...dev, ANTHROPIC_API_KEY: "" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ ...dev, CONTAINER_APP_JOB_NAME: "caj-hh-test-eval" })).toThrow(/in Azure/);
    expect(() =>
      loadConfig({ ...dev, STORE: "sql", SQL_SERVER: "s", SQL_DATABASE: "d", SQL_AUTH: "entra" }),
    ).toThrow(/STORE=memory/);
    expect(() =>
      loadConfig({
        ...dev,
        NODE_ENV: "production",
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "t",
        ENTRA_API_CLIENT_ID: "a",
        ENTRA_WEB_CLIENT_ID: "w",
      }),
    ).toThrow(/AI_PROVIDER=anthropic/);
  });
});
