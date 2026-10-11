import {
  CR_FLAGS,
  CR_FLAG_LABELS,
  CR_SECTIONS,
  DEFAULT_PROFILE,
  MODEL,
  foldEvents,
  skillReaders,
  type StoredEvent,
} from "@hermes-helfer/core";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { AzureOpenAiProvider } from "../src/agents/azure-openai-provider";
import { checkDraftStructure } from "../src/agents/kritiker";
import { MAX_SECTIONS, SECTION_MAX, cut, fitSections } from "../src/agents/output";
import { AiQuota, type QuotaOptions } from "../src/agents/quota";
import { CONFIDENTIAL_SUMMARY, agentFailure, projectContext } from "../src/agents/runner";
import { AiProviderError } from "../src/agents/provider";
import { ProposalStore } from "../src/agents/proposals";
import { reviewGrounds } from "../src/agents/risk-agent";
import { createEntraAuthenticator } from "../src/auth";
import { loadConfig } from "../src/config";
import { HttpError } from "../src/errors";
import { ProjectRepository } from "../src/projects/repository";
import { ProjectSummaries } from "../src/projects/summaries";
import { MemoryEventStore } from "../src/store/memory-event-store";

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

describe("project summaries (read model)", () => {
  it("rebuilds a summary only when the project has new events", async () => {
    const repo = new ProjectRepository(new MemoryEventStore(), MODEL);
    const actor = {
      userId: "u-peter",
      displayName: "Peter Graf",
      roles: ["HH.PMO"],
      channel: "web" as const,
    };
    const created = {
      type: "ProjectCreated" as const,
      data: {
        code: "SUM",
        name: "Summen",
        description: "",
        phase: "init" as const,
        profile: DEFAULT_PROFILE,
        modelVersion: MODEL.version,
      },
    };
    await repo.append("p-sum", 0, [created], actor, "c-test-1234");
    const summaries = new ProjectSummaries(MODEL);
    const first = summaries.of((await repo.get("p-sum"))!);
    expect(summaries.of((await repo.get("p-sum"))!)).toBe(first);
    expect(first.projectLeads).toEqual([]);

    await repo.append(
      "p-sum",
      1,
      [{ type: "MemberRoleAssigned", data: { userId: "u-anna", displayName: "Anna Keller", role: "PL" } }],
      actor,
      "c-test-1234",
    );
    const second = summaries.of((await repo.get("p-sum"))!);
    expect(second).not.toBe(first);
    expect(second.projectLeads).toEqual(["Anna Keller"]);
  });
});

describe("Kritiker structure check", () => {
  it("reports missing, thin and open sections", () => {
    const skill = MODEL.skill("konzept.test-engineer");
    const findings = checkDraftStructure(skill.sections, {
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
    // An empty section counts as missing.
    expect(
      checkDraftStructure(["Ziele"], {
        summary: "",
        sections: [{ heading: "Ziele", body: " " }],
        openPoints: [],
      }),
    ).toEqual([{ severity: "warnung", source: "checkliste", text: "Abschnitt «Ziele» fehlt." }]);
  });
});

describe("what an agent may put into a text (principle 3)", () => {
  it("passes a restricted result only into texts whose readers may all read it", () => {
    const canary = "KANARIENVOGEL";
    const skill = MODEL.skill("init.datenschutz");
    const events = [
      { type: "SkillRunRequested", data: { runId: "r1", skillId: skill.id } },
      {
        type: "SkillRunCompleted",
        data: {
          runId: "r1",
          skillId: skill.id,
          draft: { summary: canary, sections: [], openPoints: [] },
          findings: [],
          producer: { kind: "human" },
        },
      },
      {
        type: "SkillDecisionRecorded",
        data: {
          skillId: skill.id,
          role: "DS",
          decision: "freigegeben",
          reason: "",
          konsent: false,
          conditions: [],
        },
      },
      { type: "DeliverableReleased", data: { deliverableId: "dsvor" } },
    ] as const;
    const st = foldEvents(
      [
        {
          type: "ProjectCreated",
          data: {
            code: "T",
            name: "T",
            description: "",
            phase: "init",
            profile: DEFAULT_PROFILE,
            modelVersion: MODEL.version,
          },
        },
        { type: "MemberRoleAssigned", data: { userId: "anna", displayName: "Anna", role: "PL" } },
        ...events,
      ].map((e, i) => ({
        ...e,
        projectId: "p",
        seq: i + 1,
        id: `e${i}`,
        at: new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString(),
        actor: { userId: "anna", displayName: "Anna", roles: ["PL"], channel: "web" as const },
        correlationId: "c",
        prevHash: "",
        hash: "",
      })) as StoredEvent[],
      MODEL,
    );
    const anna = { userId: "anna", displayName: "Anna", globalRoles: ["HH.User" as const] };
    const summaryOf = (readers: Parameters<typeof projectContext>[3]) =>
      projectContext(st, MODEL, anna, readers).releasedResults.find((r) => r.name === skill.outputDoc)
        ?.summary;
    // A text everyone reads: the result by name and status only.
    expect(summaryOf("all")).toBe(CONFIDENTIAL_SUMMARY);
    // The DSFA is read only by roles that may also read the Datenschutz-Vorabklärung.
    const dsfa = MODEL.skill(MODEL.deliverable("dsfa").skills[0]!);
    expect(summaryOf(skillReaders(MODEL, dsfa))).toBe(canary);
    // The ISDS-Konzept is also read by Infrastruktur (security engineering), which may not.
    expect(summaryOf(skillReaders(MODEL, MODEL.skill("konzept.isds")))).toBe(CONFIDENTIAL_SUMMARY);
    // The SchuBAn is also read by the Fachvertretung, which may not read it.
    expect(summaryOf(skillReaders(MODEL, MODEL.skill("init.schutzbedarf")))).toBe(CONFIDENTIAL_SUMMARY);
  });
});

describe("agent output that does not fit (review F7)", () => {
  it("cuts over-long text instead of refusing it", () => {
    expect(cut("kurz", 10)).toBe("kurz");
    expect(cut("abcdefghij", 5)).toBe("abcd…");
    expect(cut("abc 😀def", 6).length).toBeLessThanOrEqual(6);
    expect(cut("abc 😀def", 6)).toBe("abc…");
  });

  it("fits a change request into its five sections, whatever headings the model used", () => {
    const { draft, findings } = fitSections(
      {
        summary: "S",
        sections: [
          { heading: "ausgangslage", body: "Heute wird von Hand exportiert." },
          { heading: "Gewünschte Änderung", body: "Ein Export." },
          { heading: "Gewünschte Änderung", body: "Als CSV." },
          { heading: "Begründung", body: "Spart Zeit." },
          { heading: "Risiken", body: "Datenabfluss." },
          { heading: "", body: "" },
        ],
        openPoints: [],
      },
      CR_SECTIONS,
    );
    expect(draft.sections.map((x) => x.heading)).toEqual([...CR_SECTIONS]);
    expect(draft.sections.map((x) => x.body)).toEqual([
      "Heute wird von Hand exportiert.",
      "Ein Export.\n\nAls CSV.",
      "Spart Zeit.\n\nRisiken:\nDatenabfluss.",
      "",
      "",
    ]);
    expect(findings).toEqual([
      {
        severity: "hinweis",
        source: "checkliste",
        text: "Der Agent hat einen Abschnitt «Risiken» geschrieben, der nicht zur Vorlage gehört; der Text steht unter «Begründung und Nutzen».",
      },
    ]);
    // The missing sections are reported by the structure check.
    expect(checkDraftStructure(CR_SECTIONS, draft).map((f) => f.text)).toEqual(
      expect.arrayContaining(["Abschnitt «Alternativen» fehlt."]),
    );
  });

  it("cuts a section joined from several parts to the length the API accepts", () => {
    const long = "x".repeat(SECTION_MAX - 10);
    const { draft, findings } = fitSections(
      {
        summary: "S",
        sections: [
          { heading: "Gewünschte Änderung", body: long },
          { heading: "Gewünschte Änderung", body: long },
        ],
        openPoints: [],
      },
      CR_SECTIONS,
    );
    expect(draft.sections[1]!.body).toHaveLength(SECTION_MAX);
    expect(draft.sections[1]!.body.endsWith("…")).toBe(true);
    expect(findings.map((f) => f.text)).toEqual([
      "Der Abschnitt «Gewünschte Änderung» war zu lang und wurde gekürzt; bitte das Ende prüfen.",
    ]);
  });

  it("fits a draft into a Word template's fields when the model leaves out the chapter", () => {
    const fields = [
      "Deckblatt › System / Anwendung",
      "3. Schutzbedarf › Vertraulichkeit",
      "4. System › Vertraulichkeit",
    ];
    const { draft, findings } = fitSections(
      {
        summary: "S",
        sections: [
          { heading: "System / Anwendung", body: "Kundenportal" },
          { heading: "Vertraulichkeit", body: "Hoch." },
          { heading: "4. System › Vertraulichkeit", body: "Nur intern." },
        ],
        openPoints: [],
      },
      fields,
    );
    // The first field of a label that is still free; the exact heading wins.
    expect(draft.sections).toEqual([
      { heading: fields[0], body: "Kundenportal" },
      { heading: fields[1], body: "Hoch." },
      { heading: fields[2], body: "Nur intern." },
    ]);
    expect(findings).toEqual([]);
  });

  it("names empty headings and merges repeated ones when there is no template", () => {
    const { draft } = fitSections(
      {
        summary: "S",
        sections: [
          { heading: "Ziel", body: "A" },
          { heading: "", body: "B" },
          { heading: "ziel", body: "C" },
        ],
        openPoints: [],
      },
      [],
    );
    expect(draft.sections).toEqual([
      { heading: "Ziel", body: "A\n\nC" },
      { heading: "Abschnitt 2", body: "B" },
    ]);
  });
});

describe("an agent request that fails", () => {
  it("is no error when the person closed it, and says what to do otherwise", () => {
    const logged: string[] = [];
    const log = {
      info: (_: object, msg?: string) => void logged.push(`info ${msg}`),
      warn: (_: object, msg?: string) => void logged.push(`warn ${msg}`),
      error: (_: object, msg?: string) => void logged.push(`error ${msg}`),
    };
    const closed = agentFailure(
      log,
      new AiProviderError("aborted", "closed"),
      {},
      "risk review",
      "Selbst erfassen.",
    );
    expect(closed).toMatchObject({ status: 499, code: "aborted" });
    const busy = agentFailure(
      log,
      new AiProviderError("busy", "busy"),
      {},
      "risk review",
      "Selbst erfassen.",
    );
    expect(busy).toMatchObject({ status: 503, code: "ai_unavailable" });
    expect(busy.message).toMatch(/ausgelastet.*\. Selbst erfassen\.$/);
    expect(logged).toEqual(["info risk review: closed by the person", "error risk review failed"]);
  });
});

describe("what a risk proposal may rest on (review F8)", () => {
  it("names the engine's facts, and released results only when the agent sees their content", () => {
    const fact = { id: "profil:lieferant", text: "Ein externer Lieferant ist beteiligt." };
    const context = (summaries: string[]) => ({
      code: "KPO",
      name: "Kundenportal",
      description: "",
      phase: "init" as const,
      phaseLabel: "Initialisierung",
      profile: DEFAULT_PROFILE,
      releasedResults: summaries.map((summary, i) => ({ name: `Ergebnis ${i + 1}`, summary })),
      openRisks: [],
    });
    expect(reviewGrounds([fact], context([]))).toEqual([fact]);
    // Known by name only: nothing to rest a proposal on.
    expect(reviewGrounds([fact], context([CONFIDENTIAL_SUMMARY]))).toEqual([fact]);
    expect(reviewGrounds([fact], context([CONFIDENTIAL_SUMMARY, "Kurzfassung."]))).toEqual([
      fact,
      { id: "ergebnisse", text: "Freigegebene Ergebnisse: «Ergebnis 2»." },
    ]);
  });
});

describe("agent proposals (review F3)", () => {
  it("serve one submission at a time: handed back when it fails, used up when it succeeds", () => {
    const store = new ProposalStore();
    const id = store.put({
      kind: "change-request",
      projectId: "p1",
      userId: "u1",
      producer: { kind: "ai", agent: "A10", provider: "mock", model: "mock", runId: "r1" },
      content: {},
    });
    const claim = () => store.claim(id, "change-request", "p1", "u1");
    claim();
    // A second submission while the first is still running: refused, not recorded twice.
    expect(claim).toThrow(/bereits übernommen/);
    store.release(id);
    expect(claim().id).toBe(id);
    store.delete(id);
    expect(claim).toThrow(/abgelaufen/);
  });
});

describe("shared model quota (review F9)", () => {
  const deferred = () => {
    let resolve!: (usage: { inputTokens: number; outputTokens: number }) => void;
    const promise = new Promise<{ usage: { inputTokens: number; outputTokens: number } }>((r) => {
      resolve = (usage) => r({ usage });
    });
    return { promise, resolve };
  };
  const limits = (o: Partial<QuotaOptions>): QuotaOptions => ({
    maxConcurrent: 8,
    maxConcurrentPerUser: 8,
    waitMs: 0,
    backgroundWaitMs: 0,
    dailyTokensPerUser: 0,
    ...o,
  });
  const reasonOf = (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e: unknown) => (e instanceof AiProviderError ? e.reason : "other"),
    );

  it("runs at most the configured calls at a time; the next waits, then is refused as busy", async () => {
    const quota = new AiQuota(limits({ maxConcurrent: 1, waitMs: 50 }));
    const first = deferred();
    const running = quota.run({ userId: "a" }, () => first.promise);
    let secondStarted = false;
    const second = quota.run({ userId: "b" }, async () => {
      secondStarted = true;
      return {};
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondStarted).toBe(false);
    first.resolve({ inputTokens: 1, outputTokens: 1 });
    await running;
    await second;
    expect(secondStarted).toBe(true);

    const hold = deferred();
    const holding = quota.run({ userId: "a" }, () => hold.promise);
    expect(await reasonOf(quota.run({ userId: "b" }, async () => ({})))).toBe("busy");
    hold.resolve({ inputTokens: 0, outputTokens: 0 });
    await holding;
    // A failed call frees its slot.
    expect(await reasonOf(quota.run({ userId: "a" }, () => Promise.reject(new Error("x"))))).toBe("other");
    expect(await reasonOf(quota.run({ userId: "a" }, async () => ({})))).toBe("ok");
  });

  it("stops waiting when the person closes the request", async () => {
    const quota = new AiQuota(limits({ maxConcurrent: 1, waitMs: 5_000 }));
    const hold = deferred();
    const holding = quota.run({ userId: "a" }, () => hold.promise);
    const controller = new AbortController();
    const waiting = reasonOf(quota.run({ userId: "b", signal: controller.signal }, async () => ({})));
    controller.abort();
    expect(await waiting).toBe("aborted");
    expect(await reasonOf(quota.run({ userId: "b", signal: controller.signal }, async () => ({})))).toBe(
      "aborted",
    );
    hold.resolve({ inputTokens: 0, outputTokens: 0 });
    await holding;
    expect(await reasonOf(quota.run({ userId: "b" }, async () => ({})))).toBe("ok");
  });

  it("charges the tokens to the person and refuses more once the daily budget is used up", async () => {
    let now = Date.UTC(2026, 9, 11, 22, 0);
    const quota = new AiQuota(limits({ maxConcurrent: 2, dailyTokensPerUser: 1000, now: () => now }));
    const spend = (userId: string, tokens: number) =>
      quota.run({ userId }, async () => ({ usage: { inputTokens: tokens / 2, outputTokens: tokens / 2 } }));
    await spend("a", 600);
    await spend("a", 600);
    expect(quota.usedToday("a")).toBe(1200);
    expect(await reasonOf(spend("a", 10))).toBe("budget");
    expect(await reasonOf(spend("b", 10))).toBe("ok");
    // A new day (UTC), a new budget.
    now += 3 * 3600_000;
    expect(await reasonOf(spend("a", 10))).toBe("ok");
    expect(quota.usedToday("a")).toBe(10);
    // A call that failed after the model answered (cut off, not matching the schema) counts too.
    const failed = new AiProviderError("invalid_output", "cut off", { inputTokens: 300, outputTokens: 700 });
    expect(await reasonOf(quota.run({ userId: "a" }, () => Promise.reject(failed)))).toBe("invalid_output");
    expect(quota.usedToday("a")).toBe(1010);
  });

  it("keeps slots for others: one person runs only a few calls at a time", async () => {
    const quota = new AiQuota(limits({ maxConcurrent: 3, maxConcurrentPerUser: 2, waitMs: 5_000 }));
    const holds = [deferred(), deferred()];
    const running = holds.map((h) => quota.run({ userId: "a" }, () => h.promise));
    // Anna's third call waits although a slot is free; Bruno's call takes that slot at once.
    let third = false;
    const waiting = quota.run({ userId: "a" }, async () => {
      third = true;
      return {};
    });
    expect(await reasonOf(quota.run({ userId: "b" }, async () => ({})))).toBe("ok");
    expect(third).toBe(false);
    // When one of Anna's calls ends, her waiting call goes first.
    holds[0]!.resolve({ inputTokens: 0, outputTokens: 0 });
    await waiting;
    expect(third).toBe(true);
    holds[1]!.resolve({ inputTokens: 0, outputTokens: 0 });
    await Promise.all(running);

    // Without a free slot of her own, Anna hears why.
    const short = new AiQuota(limits({ maxConcurrent: 3, maxConcurrentPerUser: 1, waitMs: 20 }));
    const hold = deferred();
    const holding = short.run({ userId: "a" }, () => hold.promise);
    expect(await reasonOf(short.run({ userId: "a" }, async () => ({})))).toBe("own_limit");
    hold.resolve({ inputTokens: 0, outputTokens: 0 });
    await holding;
  });

  it("lets a draft in the background wait longer for a slot than a request", async () => {
    const quota = new AiQuota(limits({ maxConcurrent: 1, waitMs: 10, backgroundWaitMs: 5_000 }));
    const hold = deferred();
    const holding = quota.run({ userId: "a" }, () => hold.promise);
    const background = reasonOf(quota.run({ userId: "b", background: true }, async () => ({})));
    expect(await reasonOf(quota.run({ userId: "c" }, async () => ({})))).toBe("busy");
    hold.resolve({ inputTokens: 0, outputTokens: 0 });
    await holding;
    expect(await background).toBe("ok");
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
    apiVersion: "v1",
    regionLabel: "Sweden Central",
    maxCompletionTokens: 16000,
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
      openRisks: [],
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
    expect(calls[0]!.url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "d", max_completion_tokens: 16000 });
    expect(body.response_format.json_schema.strict).toBe(true);
    // Parameters that reasoning models reject are never sent.
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("drafts a change request with its areas as structured output, never with effort or cost", async () => {
    const out = {
      summary: "S",
      sections: [{ heading: "Ausgangslage", body: "B" }],
      openPoints: [],
      flags: Object.fromEntries(CR_FLAGS.map((f) => [f, { value: f === "daten", reason: "R" }])),
    };
    const { fn, calls } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(out) } }],
    });
    const p = new AzureOpenAiProvider(cfg, async () => "tok", fn);
    const res = await p.draftChangeRequest({
      agent: MODEL.agent("A10"),
      project: req.project,
      idea: { title: "Export", description: "Export der Kreditoren", requestedBy: "Revision" },
      sections: CR_SECTIONS,
      flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
    });
    expect(res.draft.flags.daten).toEqual({ value: true, reason: "R" });
    expect(res.draft.content).toEqual({ summary: "S", sections: out.sections, openPoints: [] });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format.json_schema).toMatchObject({ name: "change_request", strict: true });
    expect(body.response_format.json_schema.schema.properties.flags.required).toEqual([...CR_FLAGS]);
    expect(body.messages[0].content).toMatch(/Schätze weder Aufwand noch Kosten/);
    // The wish is passed as data, not as instructions.
    expect(JSON.parse(body.messages[1].content).wunsch_als_daten).toMatchObject({ titel: "Export" });
  });

  it("asks for risk proposals as structured output with the project's facts as data", async () => {
    const out = {
      newRisks: [
        {
          title: "Lieferverzug",
          description: "D",
          probability: "mittel",
          impact: "hoch",
          ownerRole: "PL",
          mitigation: "M",
          reason: "R",
          trigger: "profil:lieferant",
        },
      ],
      reassessments: [],
    };
    const { fn, calls } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(out) } }],
    });
    const p = new AzureOpenAiProvider(cfg, async () => "tok", fn);
    const res = await p.reviewRisks({
      agent: MODEL.agent("A12"),
      project: req.project,
      triggers: [{ id: "profil:lieferant", text: "Ein externer Lieferant ist beteiligt." }],
      roles: [{ id: "PL", label: "Projektleitung" }],
      max: 5,
    });
    expect(res.review).toEqual(out);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format.json_schema).toMatchObject({ name: "risikopruefung", strict: true });
    const item = body.response_format.json_schema.schema.properties.newRisks.items;
    expect(item.properties.ownerRole.enum).toContain("ISM");
    expect(item.required).toContain("reason");
    expect(body.messages[0].content).toMatch(/entscheidet die Projektleitung/);
    expect(JSON.parse(body.messages[1].content).hinweise_aus_dem_projekt).toEqual([
      { id: "profil:lieferant", hinweis: "Ein externer Lieferant ist beteiligt." },
    ]);
    // Every proposal names one of the supplied facts.
    expect(item.properties.trigger.enum).toEqual(["profil:lieferant"]);
  });

  it("drafts status report texts as structured output and never asks for the colours", async () => {
    const out = {
      overview: "Stand",
      outlook: "Ausblick",
      criteria: [{ id: "kosten", problem: "P", measure: "M" }],
    };
    const { fn, calls } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(out) } }],
    });
    const p = new AzureOpenAiProvider(cfg, async () => "tok", fn);
    const res = await p.draftStatusReport({
      agent: MODEL.agent("A2"),
      project: req.project,
      criteria: [
        {
          id: "kosten",
          label: "Kosten",
          ampel: "gelb",
          reasons: [{ text: "Mehrkosten", quotes: [] }],
          problem: "",
          measure: "",
        },
      ],
      facts: ["Reserve 40'000 CHF."],
    });
    expect(res.draft).toEqual(out);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format.json_schema).toMatchObject({ name: "statusbericht", strict: true });
    const schema = body.response_format.json_schema.schema;
    expect(schema.properties.criteria.items.properties).not.toHaveProperty("ampel");
    expect(body.messages[0].content).toMatch(/du änderst sie nicht/);
    expect(JSON.parse(body.messages[1].content).ampel[0]).toMatchObject({ id: "kosten", farbe: "gelb" });
  });

  it("can use a dated api-version and a reasoning effort", async () => {
    const draft = { summary: "S", sections: [], openPoints: [] };
    const { fn, calls } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }],
    });
    const p = new AzureOpenAiProvider(
      { ...cfg, apiVersion: "2025-04-01-preview", reasoningEffort: "low" },
      async () => "tok",
      fn,
    );
    await p.draft(req);
    expect(calls[0]!.url).toBe(
      "https://res.openai.azure.com/openai/deployments/d/chat/completions?api-version=2025-04-01-preview",
    );
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).not.toHaveProperty("model");
    expect(body.reasoning_effort).toBe("low");
  });

  it("reports Azure's error code, and cut-off answers", async () => {
    const fail = async (status: number, body: unknown) =>
      new AzureOpenAiProvider(cfg, async () => "tok", fakeFetch(status, body).fn).draft(req).catch((e) => e);
    const notFound = await fail(404, {
      error: { code: "DeploymentNotFound", message: "no such deployment" },
    });
    expect(notFound).toBeInstanceOf(AiProviderError);
    expect(notFound.message).toBe("Azure OpenAI 404 DeploymentNotFound: no such deployment");
    const cutOff = await fail(200, {
      choices: [{ finish_reason: "length", message: { content: '{"summ' } }],
    });
    expect(cutOff).toMatchObject({ reason: "invalid_output" });
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
    // Unknown fields or types are refused; over-long text and surplus items are not (below).
    expect(
      await reason(200, { choices: [{ finish_reason: "stop", message: { content: '{"summary":1}' } }] }),
    ).toBe("invalid_output");
    expect(await reason(400, '{"error":{"code":"content_filter"}}')).toBe("blocked");
    expect(
      await reason(200, { choices: [{ finish_reason: "content_filter", message: { content: null } }] }),
    ).toBe("blocked");
    expect(
      await reason(200, { choices: [{ finish_reason: "stop", message: { content: "kein JSON" } }] }),
    ).toBe("invalid_output");
  });

  it("keeps the strict schemas sent to Azure and the parsers in step (contract)", async () => {
    type Schema = {
      type?: string;
      enum?: unknown[];
      properties?: Record<string, Schema>;
      required?: string[];
      additionalProperties?: boolean;
      items?: Schema;
    };
    /** Objects that break strict mode: every property required, no others (Azure refuses the call). */
    const notStrict: string[] = [];
    /** An answer the schema allows: every property, one item per list, the first value of an enum. */
    const instance = (x: Schema, path: string): unknown => {
      if (x.enum) return x.enum[0];
      if (x.type === "object") {
        const keys = Object.keys(x.properties!);
        if (x.additionalProperties !== false || JSON.stringify(x.required) !== JSON.stringify(keys)) {
          notStrict.push(path);
        }
        return Object.fromEntries(keys.map((k) => [k, instance(x.properties![k]!, `${path}.${k}`)]));
      }
      if (x.type === "array") return [instance(x.items!, `${path}[]`)];
      if (x.type === "string") return "Text";
      if (x.type === "boolean") return true;
      throw new Error(`Typ nicht abgedeckt: ${path}`);
    };
    const schemas: string[] = [];
    const echo = (async (_url: string, init: RequestInit) => {
      const format = JSON.parse(init.body as string).response_format.json_schema;
      schemas.push(format.name);
      const content = JSON.stringify(instance(format.schema, format.name));
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }));
    }) as unknown as typeof fetch;
    const p = new AzureOpenAiProvider(cfg, async () => "tok", echo);
    await p.draft(req);
    await p.draftChangeRequest({
      agent: MODEL.agent("A10"),
      project: req.project,
      idea: { title: "Export", description: "Export der Kreditoren", requestedBy: "Revision" },
      sections: CR_SECTIONS,
      flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
    });
    await p.reviewRisks({
      agent: MODEL.agent("A12"),
      project: req.project,
      triggers: [{ id: "profil:lieferant", text: "Ein externer Lieferant ist beteiligt." }],
      roles: [{ id: "PL", label: "Projektleitung" }],
      max: 5,
    });
    await p.draftStatusReport({
      agent: MODEL.agent("A2"),
      project: req.project,
      criteria: [],
      facts: [],
    });
    await p.critique({
      key: "change-request",
      document: "Change Request",
      sections: CR_SECTIONS,
      results: [],
      draft: { summary: "S", sections: [], openPoints: [] },
    });
    expect(schemas).toEqual(["entwurf", "change_request", "risikopruefung", "statusbericht", "kritik"]);
    expect(notStrict).toEqual([]);
  });

  it("cuts over-long text and surplus items instead of wasting the call", async () => {
    const long = {
      summary: "x".repeat(5000),
      sections: Array.from({ length: MAX_SECTIONS + 5 }, (_, i) => ({ heading: `Teil ${i}`, body: "B" })),
      openPoints: ["y".repeat(600)],
    };
    const { fn } = fakeFetch(200, {
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(long) } }],
    });
    const { draft } = await new AzureOpenAiProvider(cfg, async () => "tok", fn).draft(req);
    expect(draft.summary).toHaveLength(4000);
    expect(draft.summary.endsWith("…")).toBe(true);
    expect(draft.sections).toHaveLength(MAX_SECTIONS);
    expect(draft.openPoints[0]).toHaveLength(500);
  });

  it("stops the call when the person closes the request", async () => {
    // Like fetch: rejects when the signal is or becomes aborted, and never answers otherwise.
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        if (init.signal!.aborted) abort();
        else init.signal!.addEventListener("abort", abort);
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const call = new AzureOpenAiProvider(cfg, async () => "tok", hanging).draft(req, {
      userId: "u",
      signal: controller.signal,
    });
    controller.abort();
    await expect(call).rejects.toMatchObject({ reason: "aborted" });
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
