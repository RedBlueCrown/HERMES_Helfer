import { DEFAULT_PROFILE, MODEL } from "@hermes-helfer/core";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { AzureOpenAiProvider } from "../src/agents/azure-openai-provider";
import { checkDraftStructure } from "../src/agents/kritiker";
import { AiProviderError } from "../src/agents/provider";
import { createEntraAuthenticator } from "../src/auth";
import { loadConfig } from "../src/config";
import { HttpError } from "../src/errors";

describe("configuration guards", () => {
  const production = {
    NODE_ENV: "production",
    AUTH_MODE: "entra",
    ENTRA_TENANT_ID: "t",
    ENTRA_API_CLIENT_ID: "api",
    ENTRA_WEB_CLIENT_ID: "web",
    AI_PROVIDER: "azure-openai",
    AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
    AZURE_OPENAI_DEPLOYMENT_DRAFT: "draft",
    AZURE_OPENAI_DEPLOYMENT_CHAT: "chat",
    STORE: "sql",
    SQL_SERVER: "sql.example",
    SQL_DATABASE: "hh",
  };

  it("accepts a complete production configuration", () => {
    const c = loadConfig(production);
    expect(c).toMatchObject({
      STORE: "sql",
      SQL_AUTH: "entra",
      SEED_DEMO: false,
      SQL_MIGRATE_ON_START: false,
    });
  });

  it("refuses unsafe settings in production", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ AUTH_MODE: "dev" }, /AUTH_MODE=dev/],
      [{ AI_PROVIDER: "mock" }, /AI_PROVIDER=mock/],
      [{ STORE: "memory" }, /STORE=sql/],
      [{ SQL_AUTH: "password", SQL_USER: "u", SQL_PASSWORD: "p" }, /SQL_AUTH=entra/],
      [{ SQL_TRUST_SERVER_CERTIFICATE: "true" }, /SQL_TRUST_SERVER_CERTIFICATE/],
      [{ SEED_DEMO: "true" }, /Demo data/],
      [{ SEED_SYNTHETIC_PROJECTS: "10" }, /Demo data/],
    ];
    for (const [change, message] of bad) {
      expect(() => loadConfig({ ...production, ...change }), JSON.stringify(change)).toThrow(message);
    }
  });

  it("needs the settings of the chosen modes", () => {
    expect(() => loadConfig({ AUTH_MODE: "entra" })).toThrow(/ENTRA_TENANT_ID/);
    expect(() => loadConfig({ AUTH_MODE: "entra", ENTRA_TENANT_ID: "t", ENTRA_API_CLIENT_ID: "a" })).toThrow(
      /ENTRA_WEB_CLIENT_ID/,
    );
    expect(() => loadConfig({ AUTH_MODE: "dev", STORE: "sql" })).toThrow(/SQL_SERVER/);
    expect(() =>
      loadConfig({
        AUTH_MODE: "dev",
        STORE: "sql",
        SQL_SERVER: "s",
        SQL_DATABASE: "d",
        SQL_AUTH: "password",
      }),
    ).toThrow(/SQL_USER/);
    expect(loadConfig({ AUTH_MODE: "dev" })).toMatchObject({ STORE: "memory", SEED_DEMO: false });
    // Empty values count as unset.
    expect(loadConfig({ AUTH_MODE: "dev", ENTRA_API_SCOPE: "", PORT: " " })).toMatchObject({ PORT: 3001 });
    expect(loadConfig({ AUTH_MODE: "dev", ENTRA_API_SCOPE: "" }).ENTRA_API_SCOPE).toBeUndefined();
  });

  it("fails closed: Entra ID sign-in by default, never dev sign-in in Azure", () => {
    expect(() => loadConfig({})).toThrow(/ENTRA_TENANT_ID/);
    // An empty NODE_ENV becomes "development", but that does not switch on dev sign-in.
    expect(() => loadConfig({ NODE_ENV: "" })).toThrow(/ENTRA_TENANT_ID/);
    for (const azure of [{ CONTAINER_APP_NAME: "ca-hh-pilot-api" }, { WEBSITE_SITE_NAME: "hh" }]) {
      expect(() => loadConfig({ AUTH_MODE: "dev", NODE_ENV: "development", ...azure })).toThrow(/in Azure/);
    }
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
      profile: DEFAULT_PROFILE,
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
    const body = JSON.parse(calls[0]!.init.body as string);
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
    expect(JSON.parse(calls[0]!.init.body as string).tools[0].function.name).toBe("meine_aufgaben");
  });
});
