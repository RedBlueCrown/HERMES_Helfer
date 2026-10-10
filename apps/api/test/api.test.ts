import type { ProjectEvent, ProjectView } from "@hermes-helfer/core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Authenticator } from "../src/auth";
import { StoreUnavailableError } from "../src/store/event-store";
import { testServer } from "./helpers";

type Server = Awaited<ReturnType<typeof testServer>>;
let server: Server | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const view = async (s: Server, user: string, code: string) =>
  (await s.as(user).get(`/api/projects/${code}`)).json() as ProjectView;
const row = (v: ProjectView, id: string) =>
  v.phases.find((p) => p.current)!.deliverables.find((d) => d.id === id)!;

describe("authentication and visibility", () => {
  it("answers health without sign-in and rejects other calls without a user", async () => {
    server = await testServer();
    expect((await server.app.inject({ url: "/api/health" })).statusCode).toBe(200);
    const res = await server.app.inject({ url: "/api/projects" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("not_authenticated");
    expect(res.headers["x-correlation-id"]).toBeTruthy();
    expect((await server.as("u-nobody").get("/api/me")).statusCode).toBe(401);
  });

  it("lists only the viewer's projects, and all projects for the PMO", async () => {
    server = await testServer();
    const mine = (await server.as("u-anna").get("/api/projects")).json();
    expect(mine.items.map((p: { code: string }) => p.code).sort()).toEqual(["CRM", "INT", "KPO"]);
    const annaAll = (await server.as("u-anna").get("/api/projects?scope=all")).json();
    expect(annaAll.total).toBe(3);
    const pmo = (await server.as("u-peter").get("/api/projects?scope=all")).json();
    expect(pmo.total).toBe(5);
    const filtered = (await server.as("u-peter").get("/api/projects?scope=all&q=erp")).json();
    expect(filtered.items.map((p: { code: string }) => p.code)).toEqual(["ERP"]);
  });

  it("returns the same 404 for unknown projects and projects without access", async () => {
    server = await testServer();
    const forbidden = await server.as("u-anna").get("/api/projects/ERP");
    const unknown = await server.as("u-anna").get("/api/projects/NOPE");
    expect(forbidden.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(forbidden.json().error.message).toBe(unknown.json().error.message);
    expect((await server.as("u-peter").get("/api/projects/ERP")).statusCode).toBe(200);
  });
});

describe("platform endpoints", () => {
  it("tells the web app how to sign in, without a user", async () => {
    server = await testServer();
    const res = await server.app.inject({ url: "/api/config" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ authMode: "dev" });
  });

  it("hands the browser the Entra ID settings, never secrets", async () => {
    const entra: Authenticator = {
      mode: "entra",
      authenticate: async () => {
        throw new Error("not used");
      },
    };
    const env = {
      AUTH_MODE: "entra",
      ENTRA_TENANT_ID: "tenant-1",
      ENTRA_API_CLIENT_ID: "api-1",
      ENTRA_WEB_CLIENT_ID: "web-1",
    };
    server = await testServer({ authenticator: entra, env, seed: false });
    expect((await server.app.inject({ url: "/api/config" })).json()).toEqual({
      authMode: "entra",
      entra: { tenantId: "tenant-1", clientId: "web-1", apiScope: "api://api-1/access_as_user" },
    });
    await server.app.close();

    server = await testServer({
      authenticator: entra,
      env: { ...env, ENTRA_API_SCOPE: "api://hermes-helfer-pilot/access_as_user" },
      seed: false,
    });
    expect((await server.app.inject({ url: "/api/config" })).json().entra.apiScope).toBe(
      "api://hermes-helfer-pilot/access_as_user",
    );
  });

  it("is ready while the store answers, and reports 503 when it does not", async () => {
    server = await testServer();
    expect((await server.app.inject({ url: "/api/ready" })).json()).toEqual({ status: "ready" });

    server.store.ping = async () => {
      throw new Error("down");
    };
    const notReady = await server.app.inject({ url: "/api/ready" });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: "unavailable" });

    server.store.read = async () => {
      throw new StoreUnavailableError("down");
    };
    const res = await server.as("u-anna").get("/api/projects/KPO");
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json().error.code).toBe("unavailable");
  });

  it("limits requests per signed-in person, not per shared company address", async () => {
    server = await testServer({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    for (let i = 0; i < 3; i++) expect((await server.as("u-anna").get("/api/me")).statusCode).toBe(200);
    const limited = await server.as("u-anna").get("/api/me");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("rate_limited");
    // Same client address, other person.
    expect((await server.as("u-peter").get("/api/me")).statusCode).toBe(200);
  });

  it("takes the client address only from trusted proxies, so it cannot be spoofed", async () => {
    // app.inject connects from 127.0.0.1, which plays the Container Apps ingress here.
    server = await testServer({ env: { RATE_LIMIT_PER_MINUTE: "2", TRUSTED_PROXIES: "127.0.0.1" } });
    const health = (forwardedFor: string) =>
      server!.app.inject({ url: "/api/health", headers: { "x-forwarded-for": forwardedFor } });
    expect((await health("203.0.113.7")).statusCode).toBe(200);
    // A forged entry in front does not make the same client someone else.
    expect((await health("198.51.100.1, 203.0.113.7")).statusCode).toBe(200);
    expect((await health("198.51.100.2, 203.0.113.7")).statusCode).toBe(429);
    expect((await health("203.0.113.8")).statusCode).toBe(200);
  });

  it("serves the web app with security and cache headers, and client routes as index.html", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
    server = await testServer({ env: { WEB_DIST_DIR: dir } });

    const index = await server.app.inject({ url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.headers["cache-control"]).toBe("no-cache");
    expect(index.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(index.headers["x-content-type-options"]).toBe("nosniff");

    const asset = await server.app.inject({ url: "/assets/app-abc123.js" });
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const route = await server.app.inject({ url: "/vorhaben/KPO" });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain("id=root");
    expect((await server.app.inject({ url: "/assets/missing.js" })).statusCode).toBe(404);
    expect((await server.app.inject({ url: "/api/unknown" })).statusCode).toBe(401);
    expect((await server.as("u-anna").get("/api/unknown")).statusCode).toBe(404);
  });
});

describe("drafts, releases and decisions", () => {
  it("runs the kick-off agent, then the PL releases the draft", async () => {
    server = await testServer();
    let v = await view(server, "u-anna", "KPO");
    expect(v.nextStep).toMatchObject({ kind: "run", skillId: "init.kick-off", canAct: true });

    const start = await server.as("u-anna").post("/api/projects/KPO/skills/init.kick-off/runs");
    expect(start.statusCode).toBe(202);
    await server.runs.idle();
    v = await view(server, "u-anna", "KPO");
    expect(row(v, "kickoff")).toMatchObject({ status: "draft", statusLabel: "Entwurf (KI)" });

    const detail = (await server.as("u-anna").get("/api/projects/KPO/deliverables/kickoff")).json();
    expect(detail.skills[0].output.producer).toMatchObject({ kind: "ai", agent: "A2", provider: "mock" });
    expect(detail.skills[0].output.draft.sections.length).toBe(4);

    expect(
      (
        await server
          .as("u-nina")
          .post("/api/projects/KPO/deliverables/kickoff/release", { contentVersion: "init.kick-off@1" })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server
          .as("u-anna")
          .post("/api/projects/KPO/deliverables/kickoff/release", { contentVersion: "init.kick-off@1" })
      ).statusCode,
    ).toBe(200);
    expect(row(await view(server, "u-anna", "KPO"), "kickoff").status).toBe("done");
  });

  it("lets the right role decide, and validates Konsent and reasons", async () => {
    server = await testServer();
    expect(
      (await server.as("u-nina").post("/api/projects/KPO/skills/init.datenklassifizierung/runs")).statusCode,
    ).toBe(202);
    await server.runs.idle();
    const decide = (user: string, body: object) =>
      server!
        .as(user)
        .post("/api/projects/KPO/skills/init.datenklassifizierung/decisions", { version: 1, ...body });
    expect((await decide("u-tim", { role: "ISM", decision: "freigegeben" })).statusCode).toBe(403);
    const short = await decide("u-marco", { role: "ISM", decision: "zurückgewiesen", reason: "x" });
    expect(short.statusCode).toBe(422);
    expect(short.json().error.message).toMatch(/Begründung/);
    expect((await decide("u-marco", { role: "ISM", decision: "freigegeben" })).statusCode).toBe(200);
    expect(row(await view(server, "u-anna", "KPO"), "klass").status).toBe("done");

    expect((await server.as("u-jonas").post("/api/projects/KPO/skills/init.bewerter/runs")).statusCode).toBe(
      403,
    );
    expect((await server.as("u-anna").post("/api/projects/KPO/skills/init.bewerter/runs")).statusCode).toBe(
      202,
    );
    await server.runs.idle();
    const noKonsent = await server.as("u-thomas").post("/api/projects/KPO/skills/init.bewerter/decisions", {
      role: "PA",
      decision: "freigegeben",
      version: 1,
    });
    expect(noKonsent.statusCode).toBe(422);
    expect(noKonsent.json().error.message).toMatch(/Konsent/);
  });

  it("refuses agent runs for manual skills and records manual results", async () => {
    server = await testServer();
    expect(
      (await server.as("u-jonas").post("/api/projects/ERP/skills/real.integrationstest/runs")).statusCode,
    ).toBe(409);
    const res = await server.as("u-tim").post("/api/projects/ERP/skills/real.integrationstest/result", {
      draft: {
        summary: "142 Tests, 139 bestanden.",
        sections: [
          {
            heading: "Ausgeführte Tests",
            body: "Schnittstellen- und Regressionstests aus der Pipeline vom 3. Oktober.",
          },
        ],
        openPoints: [],
      },
    });
    expect(res.statusCode).toBe(200);
    const detail = (await server.as("u-jonas").get("/api/projects/ERP/deliverables/testprot")).json();
    expect(detail.skills[0].output.producer.kind).toBe("human");
    expect(detail.skills[0].output.findings.map((f: { text: string }) => f.text)).toContain(
      "Abschnitt «Ergebnisse» fehlt.",
    );
  });

  it("refuses releases, decisions and edits on a version the person has not seen", async () => {
    server = await testServer();
    const draft = (text: string) => ({
      summary: text,
      sections: [{ heading: "Teilnehmende", body: text }],
      openPoints: [],
    });
    await server.as("u-anna").post("/api/projects/KPO/skills/init.kick-off/runs");
    await server.as("u-nina").post("/api/projects/KPO/skills/init.datenklassifizierung/runs");
    await server.runs.idle();

    // Two people edit from version 1: the second save is refused instead of overwriting.
    const edit = (user: string, text: string, version: number) =>
      server!.as(user).put("/api/projects/KPO/skills/init.kick-off/draft", { draft: draft(text), version });
    expect((await edit("u-anna", "Fassung von Anna", 1)).statusCode).toBe(200);
    const stale = await edit("u-anna", "Zweite Fassung auf alter Basis", 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale");

    // The PL reviewed version 1, but version 2 is current now.
    const release = (contentVersion: string) =>
      server!.as("u-anna").post("/api/projects/KPO/deliverables/kickoff/release", { contentVersion });
    expect((await release("init.kick-off@1")).statusCode).toBe(409);
    const kickoff = (await view(server, "u-anna", "KPO")).phases[0]!.deliverables.find(
      (d) => d.id === "kickoff",
    )!;
    expect(kickoff.contentVersion).toBe("init.kick-off@2");
    expect((await release(kickoff.contentVersion)).statusCode).toBe(200);

    // The ISM opened version 1; the result was edited meanwhile.
    await server.as("u-nina").put("/api/projects/KPO/skills/init.datenklassifizierung/draft", {
      draft: draft("Datenklasse intern"),
      version: 1,
    });
    const decide = (version: number) =>
      server!.as("u-marco").post("/api/projects/KPO/skills/init.datenklassifizierung/decisions", {
        role: "ISM",
        decision: "freigegeben",
        version,
      });
    expect((await decide(1)).statusCode).toBe(409);
    expect((await decide(2)).statusCode).toBe(200);
    const events = (await server.as("u-anna").get("/api/projects/KPO/events?category=entscheid")).json();
    expect(events.items[0].text).toContain(
      "Datenklassifizierung (Version 2) freigegeben durch Informationssicherheit",
    );
  });

  it("answers one of two simultaneous releases with a conflict", async () => {
    server = await testServer();
    await server.as("u-anna").post("/api/projects/KPO/skills/init.kick-off/runs");
    await server.runs.idle();
    const [a, b] = await Promise.all([
      server
        .as("u-anna")
        .post("/api/projects/KPO/deliverables/kickoff/release", { contentVersion: "init.kick-off@1" }),
      server
        .as("u-anna")
        .post("/api/projects/KPO/deliverables/kickoff/release", { contentVersion: "init.kick-off@1" }),
    ]);
    expect([a.statusCode, b.statusCode].sort((x, y) => x - y)).toEqual([200, 409]);
  });

  it("decides a gate and moves the project to the next phase", async () => {
    server = await testServer();
    const s = (await server.repo.findByCode("KPO"))!;
    // Fast-forward: complete all mandatory results and participation of Initialisierung.
    const model = server.repo.model;
    const events: ProjectEvent[] = [];
    for (const d of model
      .phase("init")
      .deliverables.filter((x) => x.requirement === "pflicht" && !x.preExisting)) {
      for (const sid of d.skills) {
        if (events.some((e) => e.type === "SkillRunCompleted" && e.data.skillId === sid)) continue;
        events.push({ type: "SkillRunRequested", data: { runId: `r-${sid}`, skillId: sid } });
        events.push({
          type: "SkillRunCompleted",
          data: {
            runId: `r-${sid}`,
            skillId: sid,
            draft: { summary: "x", sections: [], openPoints: [] },
            findings: [],
            producer: { kind: "ai" },
          },
        });
        for (const a of model.skill(sid).approvers) {
          events.push({
            type: "SkillDecisionRecorded",
            data: {
              skillId: sid,
              role: a.role,
              decision: "freigegeben",
              reason: "ok",
              konsent: true,
              conditions: [],
            },
          });
        }
      }
      events.push({ type: "DeliverableReleased", data: { deliverableId: d.id } });
    }
    for (const p of ["sach", "apm", "ism", "ea", "ds", "dev", "tk", "besch"]) {
      events.push({
        type: "ParticipationRecorded",
        data: { phase: "init", participantId: p, how: "Workshop" },
      });
    }
    await server.repo.append(
      s.projectId,
      s.lastSeq,
      events,
      { userId: "system", displayName: "Test", roles: [], channel: "system" },
      "c-test-1234",
    );

    let v = await view(server, "u-thomas", "KPO");
    expect(v.phases[0]!.gate.status).toBe("ready");
    expect(
      (await server.as("u-anna").post("/api/projects/KPO/gates/init/decisions", { decision: "freigegeben" }))
        .statusCode,
    ).toBe(403);
    const res = await server.as("u-thomas").post("/api/projects/KPO/gates/init/decisions", {
      decision: "mit Auflagen",
      reason: "Variante B mit Auflage",
      conditions: [{ text: "Exit-Klausel im Vertrag prüfen", ownerRole: "PL", due: "2 Wochen" }],
    });
    expect(res.statusCode).toBe(200);
    v = await view(server, "u-anna", "KPO");
    expect(v.phase).toBe("konzept");
    expect(v.conditions).toHaveLength(1);
    expect(v.myTasks.some((t) => t.kind === "condition")).toBe(true);
  });
});

describe("audit trail", () => {
  it("lists events in German, newest first, and detects tampering", async () => {
    server = await testServer();
    const events = (await server.as("u-anna").get("/api/projects/CRM/events?limit=5")).json();
    expect(events.items).toHaveLength(5);
    expect(events.items[0].seq).toBeGreaterThan(events.items[4].seq);
    expect(events.hasMore).toBe(true);
    expect(events.items.some((e: { text: string }) => e.text.includes("ISDS-Konzept"))).toBe(true);

    expect((await server.as("u-anna").post("/api/projects/CRM/audit/verify")).json()).toMatchObject({
      ok: true,
    });
    expect((await server.as("u-nina").post("/api/projects/CRM/audit/verify")).statusCode).toBe(403);

    const crm = (await server.repo.findByCode("CRM"))!;
    server.store.tamperForTest(crm.projectId, 3, (e) => ({
      ...e,
      actor: { ...e.actor, displayName: "Jemand anderes" },
    }));
    const broken = (await server.as("u-anna").post("/api/projects/CRM/audit/verify")).json();
    expect(broken).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });

  it("closes runs that a restart interrupted", async () => {
    server = await testServer();
    const kpo = (await server.repo.findByCode("KPO"))!;
    await server.repo.append(
      kpo.projectId,
      kpo.lastSeq,
      [{ type: "SkillRunRequested", data: { runId: "r-lost", skillId: "init.kick-off" } }],
      { userId: "u-anna", displayName: "Anna Keller", roles: ["PL"], channel: "web" },
      "c-test-1234",
    );
    expect(await server.runs.recover()).toBe(1);
    const state = (await server.repo.findByCode("KPO"))!;
    expect(state.skills["init.kick-off"]?.lastError?.reason).toBe("Abgebrochen durch Neustart");
    expect(row(await view(server, "u-anna", "KPO"), "kickoff").status).toBe("open");
  });
});

describe("Delivery-Assistent (rules mode)", () => {
  const chat = (s: Server, user: string, message: string) =>
    s.as(user).post("/api/projects/KPO/chat", { message, history: [] });

  it("answers the next step and the user's tasks", async () => {
    server = await testServer();
    const next = (await chat(server, "u-anna", "Was ist als Nächstes?")).json();
    expect(next.mode).toBe("regeln");
    expect(next.text).toContain("Kick-off");
    expect(next.actions[0]).toMatchObject({ kind: "start_skill", skillId: "init.kick-off" });
    const tasks = (await chat(server, "u-anna", "Meine Aufgaben")).json();
    expect(tasks.text).toContain("Einbeziehen");
  });

  it("starts a draft on request but never on a question", async () => {
    server = await testServer();
    const started = (await chat(server, "u-anna", "Starte bitte den Kick-off")).json();
    expect(started.actions[0]).toMatchObject({ kind: "run_started", skillId: "init.kick-off" });
    await server.runs.idle();
    const question = (await chat(server, "u-anna", "Was wird erstellt?")).json();
    expect(question.actions.every((a: { kind: string }) => a.kind !== "run_started")).toBe(true);
    const denied = (await chat(server, "u-nina", "Starte Kick-off")).json();
    expect(denied.text).toMatch(/nicht anstossen/);
  });

  it("rejects overly long messages", async () => {
    server = await testServer();
    expect((await chat(server, "u-anna", "x".repeat(2001))).statusCode).toBe(422);
  });
});
