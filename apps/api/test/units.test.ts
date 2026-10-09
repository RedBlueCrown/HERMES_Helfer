import { MODEL, type Actor, type ProjectEvent } from "@hermes-helfer/core";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AzureOpenAiProvider } from "../src/agents/azure-openai-provider";
import { checkDraftStructure } from "../src/agents/kritiker";
import { AiProviderError } from "../src/agents/provider";
import { createEntraAuthenticator } from "../src/auth";
import { loadConfig } from "../src/config";
import { HttpError } from "../src/errors";
import { MemoryEventStore, verifyChain } from "../src/store/event-store";
import { canonicalJson } from "../src/util/canonical-json";

const ACTOR: Actor = { userId: "u-test", displayName: "Test", roles: ["PL"], channel: "web" };
const created: ProjectEvent = {
  type: "ProjectCreated",
  data: {
    code: "T1",
    name: "Test",
    description: "",
    phase: "init",
    modelVersion: "x",
    profile: {
      schutzbedarf: "mittel",
      personendaten: false,
      cloud: false,
      schnittstellen: 0,
      lieferant: false,
      verfuegbarkeit: "mittel",
      neueTechnologie: false,
      externeNutzende: false,
    },
  },
};

describe("configuration guards", () => {
  it("refuses dev sign-in and the mock model in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow(/AUTH_MODE=dev/);
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "t",
        ENTRA_API_CLIENT_ID: "c",
      }),
    ).toThrow(/AI_PROVIDER=mock/);
    expect(() => loadConfig({ AUTH_MODE: "entra" })).toThrow(/ENTRA_TENANT_ID/);
    expect(loadConfig({}).AUTH_MODE).toBe("dev");
  });
});

describe("event store", () => {
  it("hashes canonically, chains events and rejects stale writes", async () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { f: 2, e: 1 }], c: undefined } })).toBe(
      '{"a":{"d":[1,{"e":1,"f":2}]},"b":1}',
    );
    const store = new MemoryEventStore();
    await store.append({
      projectId: "p1",
      expectedSeq: 0,
      events: [created],
      actor: ACTOR,
      correlationId: "c1",
    });
    await store.append({
      projectId: "p1",
      expectedSeq: 1,
      events: [{ type: "DeliverableReleased", data: { deliverableId: "kickoff" } }],
      actor: ACTOR,
      correlationId: "c2",
    });
    const events = store.read("p1");
    expect(events[1]!.prevHash).toBe(events[0]!.hash);
    expect(verifyChain(events).ok).toBe(true);
    await expect(
      store.append({ projectId: "p1", expectedSeq: 1, events: [created], actor: ACTOR, correlationId: "c3" }),
    ).rejects.toThrow(/Concurrent/);
    expect(() => {
      (events[0] as { seq: number }).seq = 99;
    }).toThrow();
  });

  it("persists to JSON lines and quarantines a manipulated project on load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-store-"));
    const store = new MemoryEventStore({ dataDir: dir });
    await store.append({
      projectId: "p1",
      expectedSeq: 0,
      events: [created],
      actor: ACTOR,
      correlationId: "c1",
    });
    await store.append({
      projectId: "p2",
      expectedSeq: 0,
      events: [created],
      actor: ACTOR,
      correlationId: "c1",
    });
    expect(new MemoryEventStore({ dataDir: dir }).read("p1")).toHaveLength(1);

    const file = join(dir, "projects", "p2.jsonl");
    writeFileSync(file, readFileSync(file, "utf8").replace('"name":"Test"', '"name":"Manipuliert"'));
    const quarantined: string[] = [];
    const reloaded = new MemoryEventStore({ dataDir: dir, onCorruptProject: (id) => quarantined.push(id) });
    expect(quarantined).toEqual(["p2"]);
    expect(reloaded.projectIds()).toEqual(["p1"]);
    expect(reloaded.verify("p2")).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });
});

describe("Kritiker structure check", () => {
  it("reports missing, thin and open sections", () => {
    const skill = MODEL.skill("konzept.test-engineer");
    const findings = checkDraftStructure(skill, {
      summary: "s",
      sections: [
        {
          heading: "Teststufen",
          body: "Komponententest, Integrationstest und Abnahmetest mit Verantwortlichen.",
        },
        { heading: "Mängelklassen", body: "kurz" },
        {
          heading: "Testumgebungen",
          body: "Test und Abnahme [OFFEN: Produktion?] mit eigenen Testdaten pro Umgebung.",
        },
      ],
      openPoints: [],
    });
    const texts = findings.map((f) => f.text);
    expect(texts).toContain("Abschnitt «Abnahmekriterien je Klasse» fehlt.");
    expect(texts).toContain("Abschnitt «Mängelklassen» ist sehr knapp.");
    expect(texts.some((t) => t.includes("[OFFEN]"))).toBe(true);
  });
});

describe("Entra ID token validation", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const clientId = "22222222-2222-2222-2222-222222222222";

  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const auth = createEntraAuthenticator({
      tenantId,
      clientId,
      requiredScope: "access_as_user",
      jwks: createLocalJWKSet({ keys: [jwk] }),
    });
    const token = (claims: Record<string, unknown>, audience = `api://${clientId}`) =>
      new SignJWT({
        tid: tenantId,
        oid: "oid-1",
        name: "Anna Keller",
        scp: "access_as_user",
        roles: ["HH.User"],
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
    const run = async (t: string) =>
      auth.authenticate({ headers: { authorization: `Bearer ${t}` } } as never);
    return { token, run };
  }

  const status = async (p: Promise<unknown>) => {
    try {
      await p;
      return 200;
    } catch (err) {
      return err instanceof HttpError ? err.status : 500;
    }
  };

  it("accepts a valid user token and maps app roles", async () => {
    const { token, run } = await setup();
    const user = await run(await token({ roles: ["HH.PMO"] }));
    expect(user).toMatchObject({
      userId: "oid-1",
      displayName: "Anna Keller",
      globalRoles: ["HH.User", "HH.PMO"],
    });
  });

  it("rejects wrong audience, missing scope and missing app role", async () => {
    const { token, run } = await setup();
    expect(await status(run(await token({}, "api://other")))).toBe(401);
    expect(await status(run(await token({ scp: "User.Read" })))).toBe(403);
    expect(await status(run(await token({ roles: [] })))).toBe(403);
    expect(await status(run("not-a-token"))).toBe(401);
  });
});

describe("Azure OpenAI provider (against a fake API)", () => {
  const cfg = {
    endpoint: "https://res.openai.azure.com/",
    draftDeployment: "d",
    chatDeployment: "c",
    apiVersion: "2024-10-21",
    regionLabel: "Sweden Central",
  };
  const fakeFetch = (status: number, body: unknown) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { fn, calls };
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
      profile: created.type === "ProjectCreated" ? created.data.profile : (undefined as never),
      releasedResults: [],
    },
  };

  it("sends a structured-output request with a bearer token and parses the draft", async () => {
    const draft = { summary: "S", sections: [{ heading: "Teststufen", body: "B" }], openPoints: [] };
    const { fn, calls } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const p = new AzureOpenAiProvider(cfg, async () => "tok", fn);
    const out = await p.draft(req);
    expect(out.draft).toEqual(draft);
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(calls[0]!.url).toBe(
      "https://res.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21",
    );
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("maps rate limits, content filters and invalid output to provider errors", async () => {
    const reason = async (status: number, body: unknown) => {
      try {
        await new AzureOpenAiProvider(cfg, async () => "tok", fakeFetch(status, body).fn).draft(req);
        return "none";
      } catch (err) {
        return err instanceof AiProviderError ? err.reason : "other";
      }
    };
    expect(await reason(429, "slow down")).toBe("rate_limited");
    expect(await reason(400, '{"error":{"code":"content_filter"}}')).toBe("blocked");
    expect(
      await reason(200, { choices: [{ finish_reason: "content_filter", message: { content: null } }] }),
    ).toBe("blocked");
    expect(
      await reason(200, { choices: [{ finish_reason: "stop", message: { content: "kein JSON" } }] }),
    ).toBe("invalid_output");
  });

  it("maps tool calls in chat", async () => {
    const { fn, calls } = fakeFetch(200, {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              { id: "t1", type: "function", function: { name: "meine_aufgaben", arguments: "{}" } },
            ],
          },
        },
      ],
    });
    const p = new AzureOpenAiProvider(cfg, async () => "tok", fn);
    const res = await p.chat(
      [{ role: "user", content: "Meine Aufgaben" }],
      [{ name: "meine_aufgaben", description: "x", parameters: { type: "object", properties: {} } }],
    );
    expect(res.toolCalls).toEqual([{ id: "t1", name: "meine_aufgaben", arguments: "{}" }]);
    expect(JSON.parse(String(calls[0]!.init.body)).tools[0].function.name).toBe("meine_aufgaben");
  });
});
