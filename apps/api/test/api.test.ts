import {
  CR_SECTIONS,
  NO_FLAGS,
  type ChangeRequestRegisterView,
  type PortfolioOverview,
  type ProjectEvent,
  type ProjectListItem,
  type ProjectView,
  type RiskRegisterView,
  type RiskReviewResult,
  type StatusReportProposal,
  type StatusReportRegisterView,
} from "@hermes-helfer/core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { MockProvider } from "../src/agents/mock-provider";
import { AiProviderError } from "../src/agents/provider";
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
    // A high risk: no criterion of the gate, but the decision records it.
    events.push({
      type: "RiskRecorded",
      data: {
        riskId: "risk-1",
        number: 1,
        title: "Lieferverzug",
        description: "",
        probability: "hoch",
        impact: "hoch",
        ownerRole: "PL",
        mitigation: "",
        producer: { kind: "human" },
      },
    });
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
    expect(v.phases[0]!.gate.decisions[0]!.highRisks).toEqual([
      { label: "R-01", title: "Lieferverzug", score: 9 },
    ]);
    const record = (await server.as("u-anna").get("/api/projects/KPO/events?category=entscheid")).json();
    expect(record.items[0].text).toMatch(
      /Variante B mit Auflage\. Offene hohe Risiken beim Entscheid: R-01\.$/,
    );
  });
});

describe("portfolio", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const overview = async (s: Server, user: string, scope = "all") =>
    (await s.as(user).get(`/api/portfolio?scope=${scope}`)).json() as PortfolioOverview & { scope: string };
  const list = async (s: Server, user: string, query: string) =>
    ((await s.as(user).get(`/api/projects?${query}`)).json() as { items: ProjectListItem[] }).items;
  const codes = async (s: Server, user: string, query: string) =>
    (await list(s, user, query)).map((p) => p.code);

  it("shows key figures of the viewer's own projects, and of all projects to PMO and Portfolio", async () => {
    server = await testServer();
    expect(await overview(server, "u-anna")).toMatchObject({ scope: "mine", projects: 3 });
    for (const user of ["u-peter", "u-rita"]) {
      expect(await overview(server, user)).toMatchObject({
        scope: "all",
        projects: 5,
        active: 5,
        finished: 0,
      });
    }
    const all = await overview(server, "u-rita");
    expect(all.phases.map((p) => [p.id, p.total])).toEqual([
      ["init", 1],
      ["konzept", 1],
      ["real", 1],
      ["einf", 1],
      ["skal", 1],
    ]);
    expect(all.phases.find((p) => p.id === "konzept")).toMatchObject({ blocked: 1, open: 0, ready: 0 });
    // The ISDS veto in CRM and the go-live veto in DAP.
    expect(all.signals.find((x) => x.id === "veto")?.projects).toBe(2);
    expect((await server.app.inject({ url: "/api/portfolio" })).statusCode).toBe(401);
    expect((await server.as("u-rita").get("/api/portfolio?scope=everything")).statusCode).toBe(422);
  });

  it("filters the list by phase, gate state and signal, and sorts the most urgent first", async () => {
    server = await testServer();
    expect(await codes(server, "u-rita", "scope=all&gate=blocked&sort=name")).toEqual(["CRM", "DAP"]);
    expect(await codes(server, "u-rita", "scope=all&signal=veto&phase=konzept")).toEqual(["CRM"]);
    expect((await codes(server, "u-rita", "scope=all&sort=attention")).slice(0, 2).sort()).toEqual([
      "CRM",
      "DAP",
    ]);
    // Members see only their own projects, whatever they ask for.
    expect(await codes(server, "u-anna", "scope=all&signal=veto")).toEqual(["CRM"]);
    const [crm] = await list(server, "u-anna", "q=crm");
    expect(crm).toMatchObject({
      // The ISDS veto, and the red status report about it.
      signals: ["veto", "status-rot"],
      status: "rot",
      gateName: "Phasenfreigabe Realisierung",
      myRoles: ["PL"],
    });
    expect((await server.as("u-rita").get("/api/projects?signal=unknown")).statusCode).toBe(422);
    expect((await server.as("u-rita").get("/api/projects?gate=closed")).statusCode).toBe(422);
  });

  it("flags Auflagen as overdue once their due date has passed", async () => {
    let now = new Date();
    server = await testServer({ now: () => now });
    const decide = (due: string) =>
      server!.as("u-marco").post("/api/projects/CRM/skills/konzept.isds/decisions", {
        role: "ISM",
        decision: "mit Auflagen",
        reason: "Restrisiken sind tragbar, wenn die Massnahmen folgen.",
        conditions: [{ text: "Restrisiken mit Verantwortlichen ergänzen", ownerRole: "ISM", due }],
        version: 1,
      });
    // Only the offered options: they decide when the Auflage is due.
    expect((await decide("irgendwann")).statusCode).toBe(422);
    expect((await decide("1 Woche")).statusCode).toBe(200);

    // CRM's last status report is red until the PL publishes a new one.
    const crm = async () => (await list(server!, "u-rita", "scope=all&q=crm"))[0]!;
    expect(await crm()).toMatchObject({ openConditions: 1, overdueConditions: 0, signals: ["status-rot"] });

    now = new Date(now.getTime() + 8 * DAY);
    expect(await crm()).toMatchObject({
      overdueConditions: 1,
      signals: ["status-rot", "auflagen-ueberfaellig"],
    });
    expect(await overview(server, "u-rita")).toMatchObject({ openConditions: 1, overdueConditions: 1 });
    expect(await codes(server, "u-rita", "scope=all&signal=auflagen-ueberfaellig")).toEqual(["CRM"]);
    const [condition] = (await view(server, "u-marco", "CRM")).conditions;
    expect(condition).toMatchObject({ due: "1 Woche", overdue: true });
    expect(Date.parse(condition!.dueAt!)).toBeLessThan(now.getTime());

    expect(
      (await server.as("u-marco").post(`/api/projects/CRM/conditions/${condition!.id}/complete`)).statusCode,
    ).toBe(200);
    expect(await crm()).toMatchObject({ openConditions: 0, overdueConditions: 0, signals: ["status-rot"] });
  });
});

describe("roles and separation of duties", () => {
  const assign = (s: Server, user: string, userId: string, displayName: string, role: string) =>
    s.as(user).post("/api/projects/KPO/members", { userId, displayName, role });

  it("lets the PMO assign the control roles, never to the project lead, and the PL the other roles", async () => {
    server = await testServer();
    const byLead = await assign(server, "u-anna", "u-david", "David Weber", "PA");
    expect(byLead.statusCode).toBe(403);
    expect(byLead.json().error.message).toBe(
      "Die Rolle Auftraggeber / Projektausschuss vergibt und entzieht das PMO (Funktionentrennung).",
    );
    expect((await assign(server, "u-peter", "u-david", "David Weber", "PA")).statusCode).toBe(200);
    expect((await assign(server, "u-anna", "u-david", "David Weber", "TEST")).statusCode).toBe(200);
    // Nobody makes the project lead their own control, not even the PMO.
    const lead = await assign(server, "u-peter", "u-anna", "Anna Keller", "ISM");
    expect(lead.statusCode).toBe(409);
    expect(lead.json().error.message).toBe(
      "Die Person hat bereits die Rolle Projektleitung. Die Rolle Informationssicherheit (ISM) nimmt eine andere Person wahr (Funktionentrennung).",
    );
    expect((await server.as("u-anna").del("/api/projects/KPO/members/u-thomas/roles/PA")).statusCode).toBe(
      403,
    );
    expect((await server.as("u-peter").del("/api/projects/KPO/members/u-david/roles/PA")).statusCode).toBe(
      200,
    );

    expect((await view(server, "u-anna", "KPO")).can.assignRoles).toEqual(
      expect.not.arrayContaining(["PA", "ISM", "DS"]),
    );
    expect((await view(server, "u-peter", "KPO")).can.assignRoles).toContain("PA");
    expect((await server.as("u-anna").get("/api/reference")).json().policy).toEqual({
      separationOfDuties: true,
      controlRoles: ["PA", "ISM", "DS"],
      incompatibleRoles: [
        ["PL", "PA"],
        ["PL", "ISM"],
        ["PL", "DS"],
      ],
    });
  });

  it("can be relaxed for a test environment, where one person tries every role", async () => {
    server = await testServer({ env: { SEPARATION_OF_DUTIES: "false" } });
    expect((await assign(server, "u-anna", "u-anna", "Anna Keller", "PA")).statusCode).toBe(200);
    expect((await view(server, "u-anna", "KPO")).can.assignRoles).toContain("DS");
    expect((await server.as("u-anna").get("/api/reference")).json().policy).toMatchObject({
      separationOfDuties: false,
    });
  });
});

describe("change requests", () => {
  const register = async (s: Server, user: string) =>
    (await s.as(user).get("/api/projects/ERP/change-requests")).json() as ChangeRequestRegisterView;
  const wish = {
    title: "Export der Kreditoren für die Revision",
    description: "Die externe Revision möchte Kreditorennamen und Adressen als Export erhalten.",
    requestedBy: "Revision",
  };
  const content = {
    summary: "Kreditoren als CSV-Export für die externe Revision.",
    sections: CR_SECTIONS.map((heading) => ({
      heading,
      body: `${heading}: ausführlich beschrieben für den Test.`,
    })),
    openPoints: [],
  };
  const submit = (s: Server, user: string, extra: object = {}) =>
    s.as(user).post("/api/projects/ERP/change-requests", {
      title: wish.title,
      requestedBy: wish.requestedBy,
      effortDays: 9,
      flags: { ...NO_FLAGS, daten: true, oberflaeche: true },
      content,
      ...extra,
    });
  /** The agent's draft; submitting with its id records the agent as author. */
  const draftWith = async (s: Server, user: string) =>
    (await s.as(user).post("/api/projects/ERP/change-requests/draft", wish)).json() as {
      proposalId: string;
      flags: Record<string, { value: boolean; reason: string }>;
    };

  it("drafts a request with the Change-Request agent and stores nothing until it is submitted", async () => {
    server = await testServer();
    const erp = (await server.repo.findByCode("ERP"))!;
    const res = await server.as("u-nina").post("/api/projects/ERP/change-requests/draft", wish);
    expect(res.statusCode).toBe(200);
    const proposal = res.json();
    expect(proposal.content.sections.map((x: { heading: string }) => x.heading)).toEqual(CR_SECTIONS);
    expect(proposal.flags.daten).toMatchObject({ value: true });
    expect(proposal.flags.sonderloesung).toMatchObject({ value: false });
    expect(proposal.producer).toMatchObject({ kind: "ai", agent: "A10" });
    expect((await server.repo.findByCode("ERP"))!.lastSeq).toBe(erp.lastSeq);

    // Only members of the project; the PMO sees the project but is no member.
    expect(
      (await server.as("u-peter").post("/api/projects/ERP/change-requests/draft", wish)).statusCode,
    ).toBe(403);
    expect((await server.as("u-anna").post("/api/projects/ERP/change-requests/draft", wish)).statusCode).toBe(
      404,
    );
    const short = await server
      .as("u-nina")
      .post("/api/projects/ERP/change-requests/draft", { ...wish, description: "kurz" });
    expect(short.statusCode).toBe(422);
  });

  it("says so when the agent is unavailable, so the request can be filled in by hand", async () => {
    const mock = new MockProvider(0);
    server = await testServer({
      provider: {
        info: mock.info,
        draft: (r) => mock.draft(r),
        critique: (r) => mock.critique(r),
        draftChangeRequest: async () => {
          throw new AiProviderError("rate_limited", "Azure OpenAI 429");
        },
        reviewRisks: (r) => mock.reviewRisks(r),
        draftStatusReport: (r) => mock.draftStatusReport(r),
      },
    });
    const res = await server.as("u-nina").post("/api/projects/ERP/change-requests/draft", wish);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/Hohe Auslastung.*ohne den Agenten/);
  });

  it("refuses the agent once the person's daily token budget is used up, others go on", async () => {
    const mock = new MockProvider(0);
    const usage = { inputTokens: 600, outputTokens: 500 };
    server = await testServer({
      env: { AI_DAILY_TOKENS_PER_USER: "1000" },
      provider: {
        info: mock.info,
        draft: (r) => mock.draft(r),
        critique: (r) => mock.critique(r),
        draftChangeRequest: async (r) => ({ ...(await mock.draftChangeRequest(r)), usage }),
        reviewRisks: (r) => mock.reviewRisks(r),
        draftStatusReport: (r) => mock.draftStatusReport(r),
      },
    });
    const draft = (user: string) => server!.as(user).post("/api/projects/ERP/change-requests/draft", wish);
    expect((await draft("u-nina")).statusCode).toBe(200);
    const refused = await draft("u-nina");
    expect(refused.statusCode).toBe(503);
    expect(refused.json().error.message).toMatch(/Tageskontingent.*ohne den Agenten/);
    expect((await draft("u-jonas")).statusCode).toBe(200);
  });

  it("is decided by the Projektausschuss with Konsent, then rechecked by ISM and Datenschutz", async () => {
    server = await testServer();
    const { proposalId } = await draftWith(server, "u-nina");
    expect((await submit(server, "u-nina", { proposalId })).statusCode).toBe(201);
    const [cr] = (await register(server, "u-thomas")).items;
    expect(cr).toMatchObject({
      label: "CR-03",
      status: "offen",
      costChf: 10_800,
      // The server knows the agent drafted it, and that the requester changed the text.
      producer: { kind: "ai", agent: "A10", edited: true },
      agentAssessment: { wish: wish.description },
    });
    expect(cr!.producer.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cr!.impact.find((r) => r.id === "sicherheit")?.level).toBe("hoch");
    expect(cr!.canDecide.ok).toBe(true);

    const decide = (user: string, body: object) =>
      server!.as(user).post(`/api/projects/ERP/change-requests/${cr!.id}/decision`, {
        basedOn: cr!.impactVersion,
        ...body,
      });
    expect(
      (await decide("u-jonas", { decision: "freigegeben", reason: "Passt.", konsent: true })).statusCode,
    ).toBe(403);
    const noKonsent = await decide("u-thomas", { decision: "freigegeben", reason: "Im Rahmen der Reserve." });
    expect(noKonsent.statusCode).toBe(422);
    expect(noKonsent.json().error.message).toMatch(/Konsent/);
    const noReason = await decide("u-thomas", { decision: "freigegeben", konsent: true });
    expect(noReason.json().error.message).toMatch(/Begründung/);
    expect(
      (await decide("u-thomas", { decision: "freigegeben", reason: "Im Rahmen der Reserve.", konsent: true }))
        .statusCode,
    ).toBe(200);

    const gate = (await view(server, "u-jonas", "ERP")).phases.find((ph) => ph.current)!.gate;
    expect(gate.criteria.find((c) => c.id === "neupruefung")).toMatchObject({ ok: false, blocking: true });
    expect((await view(server, "u-marco", "ERP")).myTasks.some((t) => t.kind === "recheck")).toBe(true);

    const recheck = (user: string, body: object) =>
      server!.as(user).post(`/api/projects/ERP/change-requests/${cr!.id}/recheck`, body);
    expect((await recheck("u-marco", { role: "DS", outcome: "keine Anpassung" })).statusCode).toBe(403);
    expect((await recheck("u-marco", { role: "ISM", outcome: "keine Anpassung" })).statusCode).toBe(200);
    expect((await recheck("u-sandra", { role: "DS", outcome: "Massnahme ergänzt" })).statusCode).toBe(422);
    expect(
      (
        await recheck("u-sandra", {
          role: "DS",
          outcome: "Massnahme ergänzt",
          note: "Export pseudonymisiert.",
        })
      ).statusCode,
    ).toBe(200);
    expect((await register(server, "u-jonas")).items[0]?.recheck).toMatchObject({ done: true });

    const events = (await server.as("u-jonas").get("/api/projects/ERP/events?category=aenderung")).json();
    const texts = events.items.map((e: { text: string }) => e.text);
    expect(texts).toContain(
      "CR-03 freigegeben durch den Projektausschuss (Konsent festgestellt): Im Rahmen der Reserve.",
    );
    expect(texts).toContain(
      "Neuprüfung nach CR-03 durch Datenschutz: Massnahme ergänzt (Export pseudonymisiert.).",
    );
    expect(events.items.every((e: { category: string }) => e.category === "aenderung")).toBe(true);
  });

  it("is decided and rechecked by others than the requester (four-eyes principle)", async () => {
    server = await testServer();
    expect((await submit(server, "u-thomas")).statusCode).toBe(201);
    const [cr] = (await register(server, "u-thomas")).items;
    expect(cr!.canDecide).toMatchObject({ ok: false, reason: expect.stringMatching(/Vier-Augen-Prinzip/) });
    const decide = (user: string) =>
      server!.as(user).post(`/api/projects/ERP/change-requests/${cr!.id}/decision`, {
        decision: "freigegeben",
        reason: "Im Rahmen der Reserve.",
        konsent: true,
        basedOn: cr!.impactVersion,
      });
    expect((await decide("u-thomas")).statusCode).toBe(403);
    // The PMO adds a second member of the Projektausschuss, who decides.
    const deputy = await server
      .as("u-peter")
      .post("/api/projects/ERP/members", { userId: "u-rita", displayName: "Rita Vogel", role: "PA" });
    expect(deputy.statusCode).toBe(200);
    expect((await view(server, "u-rita", "ERP")).myTasks).toContainEqual(
      expect.objectContaining({ kind: "decide-cr", crId: cr!.id }),
    );
    expect((await decide("u-rita")).statusCode).toBe(200);

    // ISM records a request touching personal data: Datenschutz rechecks, ISM needs a second person.
    expect((await submit(server, "u-marco")).statusCode).toBe(201);
    const own = (await register(server, "u-marco")).items[0]!;
    await server.as("u-thomas").post(`/api/projects/ERP/change-requests/${own.id}/decision`, {
      decision: "freigegeben",
      reason: "Im Rahmen der Reserve.",
      konsent: true,
      basedOn: own.impactVersion,
    });
    const roles = (await register(server, "u-marco")).items[0]!.recheck!.roles;
    expect(roles.find((r) => r.role === "ISM")).toMatchObject({
      canConfirm: false,
      blocked: expect.stringMatching(/Vier-Augen-Prinzip/),
    });
    const recheck = await server.as("u-marco").post(`/api/projects/ERP/change-requests/${own.id}/recheck`, {
      role: "ISM",
      outcome: "keine Anpassung",
    });
    expect(recheck.statusCode).toBe(403);
  });

  it("rechecks only the results that exist when the request is accepted, and keeps that list", async () => {
    server = await testServer();
    const kpo = (user: string) =>
      server!
        .as(user)
        .get("/api/projects/KPO/change-requests")
        .then((r) => r.json<ChangeRequestRegisterView>());
    const submitted = await server.as("u-nina").post("/api/projects/KPO/change-requests", {
      title: wish.title,
      requestedBy: wish.requestedBy,
      effortDays: 3,
      flags: { ...NO_FLAGS, daten: true },
      content,
    });
    expect(submitted.statusCode).toBe(201);
    const [cr] = (await kpo("u-thomas")).items;
    // Initialisierung: ISDS-Konzept and DSFA are written later, with the change already known.
    expect(cr!.impact.find((r) => r.id === "sicherheit")?.text).toMatch(
      /^SchuBAn und Datenschutz-Vorabklärung neu prüfen/,
    );
    const decided = await server.as("u-thomas").post(`/api/projects/KPO/change-requests/${cr!.id}/decision`, {
      decision: "freigegeben",
      reason: "Passt in den Rahmen.",
      konsent: true,
      basedOn: cr!.impactVersion,
    });
    expect(decided.statusCode).toBe(200);
    expect((await kpo("u-marco")).items[0]!.recheck!.deliverables.map((d) => d.id)).toEqual([
      "schuban",
      "dsvor",
    ]);
  });

  it("lets the requester withdraw a request and the PL record the reserve", async () => {
    server = await testServer();
    await submit(server, "u-nina");
    const [cr] = (await register(server, "u-nina")).items;
    const withdraw = (user: string, reason: string) =>
      server!.as(user).post(`/api/projects/ERP/change-requests/${cr!.id}/withdraw`, { reason });
    expect((await withdraw("u-tim", "Nicht mehr nötig.")).statusCode).toBe(403);
    expect((await withdraw("u-nina", "")).statusCode).toBe(422);
    expect((await withdraw("u-nina", "Die Revision braucht den Export doch nicht.")).statusCode).toBe(200);
    expect((await register(server, "u-nina")).items[0]).toMatchObject({ status: "zurueckgezogen" });

    expect(
      (await server.as("u-thomas").put("/api/projects/ERP/change-reserve", { amountChf: 1 })).statusCode,
    ).toBe(403);
    expect(
      (await server.as("u-jonas").put("/api/projects/ERP/change-reserve", { amountChf: 50_000 })).statusCode,
    ).toBe(200);
    // CR-01 from the demo data was accepted with 6 person-days.
    expect((await register(server, "u-jonas")).reserve).toMatchObject({
      reserveChf: 50_000,
      usedChf: 7_200,
      remainingChf: 42_800,
    });
    const invalid = await submit(server, "u-nina", { effortDays: 0 });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.message).toMatch(/Aufwand/);
  });

  it("records AI provenance only from the server's own proposals, and keeps what the agent said", async () => {
    server = await testServer();
    // Without a proposal the request counts as written by the person.
    expect((await submit(server, "u-nina")).statusCode).toBe(201);
    expect((await register(server, "u-nina")).items[0]!.producer).toEqual({ kind: "human" });
    // An unknown id, or someone else's proposal, is refused; the client cannot claim the agent.
    const unknown = await submit(server, "u-nina", { proposalId: "6f1c0d43-6a4f-4bfb-9a49-0d6f7c2f3e11" });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.code).toBe("proposal_gone");
    const { proposalId, flags } = await draftWith(server, "u-nina");
    expect(flags.daten!.value).toBe(true);
    expect((await submit(server, "u-tim", { proposalId })).statusCode).toBe(422);
    // The requester clears «Personendaten»: the request records it and warns the decider.
    expect(
      (await submit(server, "u-nina", { proposalId, flags: { ...NO_FLAGS, oberflaeche: true } })).statusCode,
    ).toBe(201);
    const [cr] = (await register(server, "u-thomas")).items;
    expect(cr!.findings[0]).toMatchObject({ severity: "warnung" });
    expect(cr!.findings[0]!.text).toMatch(
      /^Der Agent sah «Personendaten oder Datenumfang» als betroffen .*abgewählt\.$/,
    );
    expect(cr!.agentAssessment?.flags.daten).toMatchObject({ value: true });
    // A proposal is used once.
    expect((await submit(server, "u-nina", { proposalId })).statusCode).toBe(422);
  });

  it("hands a proposal back when the submission fails", async () => {
    server = await testServer();
    const { proposalId } = await draftWith(server, "u-nina");
    expect((await submit(server, "u-nina", { proposalId, effortDays: 0 })).statusCode).toBe(422);
    expect((await submit(server, "u-nina", { proposalId })).statusCode).toBe(201);
    expect((await register(server, "u-nina")).items[0]!.producer).toMatchObject({ kind: "ai", agent: "A10" });
  });

  it("keeps the impact the Projektausschuss decided on, and opens a recheck it requires", async () => {
    server = await testServer();
    await submit(server, "u-nina");
    await submit(server, "u-nina", {
      title: "Zusätzliche Spalte im Bericht",
      flags: { ...NO_FLAGS, oberflaeche: true },
    });
    const [plain, data] = (await register(server, "u-thomas")).items;
    const version = async (id: string) =>
      (await register(server!, "u-thomas")).items.find((c) => c.id === id)!.impactVersion;
    const decide = async (id: string, extra: object = {}) =>
      server!.as("u-thomas").post(`/api/projects/ERP/change-requests/${id}/decision`, {
        decision: "freigegeben",
        reason: "Im Rahmen der Reserve.",
        konsent: true,
        basedOn: await version(id),
        ...extra,
      });
    expect((await decide(data!.id)).statusCode).toBe(200);
    // Accepting the first request used reserve: a decision on the impact seen before is refused.
    const stale = await decide(plain!.id, { recheckRequired: true, basedOn: plain!.impactVersion });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toMatch(/Auswirkungen haben sich inzwischen geändert/);
    expect((await decide(plain!.id, { recheckRequired: true })).statusCode).toBe(200);
    const budget = (id: string, r: ChangeRequestRegisterView) =>
      r.items.find((c) => c.id === id)!.impact.find((x) => x.id === "budget")!.text;
    const before = budget(data!.id, await register(server, "u-jonas"));
    // A smaller reserve later does not change what the decision was based on.
    expect(
      (await server.as("u-jonas").put("/api/projects/ERP/change-reserve", { amountChf: 1_000 })).statusCode,
    ).toBe(200);
    const after = await register(server, "u-jonas");
    expect(budget(data!.id, after)).toBe(before);
    expect(after.items.find((c) => c.id === data!.id)).toMatchObject({ dayRateChf: 1_200, costChf: 10_800 });
    // Without personal data, but the Projektausschuss asked for a recheck.
    expect(after.items.find((c) => c.id === plain!.id)?.recheck).toMatchObject({ done: false });
  });

  it("answers questions about change requests in the chat", async () => {
    server = await testServer();
    const reply = (
      await server
        .as("u-nina")
        .post("/api/projects/ERP/chat", { message: "Welche Change Requests sind offen?" })
    ).json();
    expect(reply.text).toContain("CR-02 Export der offenen Posten als CSV für die Revision");
    expect(reply.text).toContain("wartet auf den Projektausschuss");
  });
});

describe("risks", () => {
  const risks = async (s: Server, user: string, code: string) =>
    (await s.as(user).get(`/api/projects/${code}/risks`)).json() as RiskRegisterView;
  const review = (s: Server, user: string, code: string) =>
    s.as(user).post(`/api/projects/${code}/risks/review`);
  const record = (s: Server, user: string, code: string, extra: object = {}) =>
    s.as(user).post(`/api/projects/${code}/risks`, {
      title: "Lieferverzug des externen Lieferanten",
      description: "Das Portal hängt von Lieferungen des Lieferanten ab.",
      probability: "mittel",
      impact: "hoch",
      ownerRole: "PL",
      mitigation: "Liefertermine vertraglich festhalten.",
      ...extra,
    });

  it("proposes risks with the Risiko agent and stores nothing until the PL accepts one", async () => {
    server = await testServer();
    const res = await review(server, "u-anna", "KPO");
    expect(res.statusCode).toBe(200);
    const proposals = res.json() as RiskReviewResult;
    expect(proposals.producer).toMatchObject({ kind: "ai", agent: "A12" });
    expect(proposals.triggers.map((t) => t.id)).toEqual(
      expect.arrayContaining(["profil:lieferant", "profil:cloud", "profil:extern"]),
    );
    const vendor = proposals.newRisks.find((r) => r.title === "Lieferverzug des externen Lieferanten");
    expect(vendor).toMatchObject({
      probability: "mittel",
      impact: "hoch",
      ownerRole: "PL",
      findings: [],
      // Grounded in one of the facts the engine supplied.
      trigger: "profil:lieferant",
    });
    expect((await risks(server, "u-anna", "KPO")).items).toEqual([]);

    // Only the PL asks the agent and accepts its proposals; members record risks themselves.
    expect((await review(server, "u-jonas", "KPO")).statusCode).toBe(403);
    expect((await review(server, "u-peter", "KPO")).statusCode).toBe(403);
    const item = { id: proposals.proposalId, item: proposals.newRisks.indexOf(vendor!) };
    expect((await record(server, "u-jonas", "KPO", { proposal: item })).statusCode).toBe(422);
    expect((await record(server, "u-anna", "KPO", { proposal: item })).statusCode).toBe(201);
    expect((await record(server, "u-anna", "KPO", { proposal: item })).statusCode).toBe(409);
    const [r1] = (await risks(server, "u-anna", "KPO")).items;
    expect(r1).toMatchObject({
      label: "R-01",
      score: 6,
      level: "hoch",
      // The test changed the agent's description and measure.
      producer: { kind: "ai", agent: "A12", edited: true },
    });

    // The register now has this risk: the agent proposes a new assessment instead of a duplicate.
    const again = (await review(server, "u-anna", "KPO")).json() as RiskReviewResult;
    expect(again.newRisks.some((r) => r.title === "Lieferverzug des externen Lieferanten")).toBe(false);
    expect(again.reassessments[0]).toMatchObject({
      risk: "R-01",
      riskId: r1!.id,
      probability: "hoch",
      current: { probability: "mittel", impact: "hoch", version: 1 },
    });

    // Closed in the meantime: accepting the proposal must not reopen it.
    const assess = (body: object) =>
      server!.as("u-anna").post(`/api/projects/KPO/risks/${r1!.id}/assessment`, {
        probability: "mittel",
        impact: "hoch",
        ownerRole: "PL",
        mitigation: "Liefertermine vertraglich festhalten.",
        ...body,
      });
    expect(
      (await assess({ status: "geschlossen", note: "Vertrag unterzeichnet.", basedOn: 1 })).statusCode,
    ).toBe(200);
    const accept = await assess({
      probability: "hoch",
      status: "offen",
      note: "Vorschlag des Risiko-Agenten",
      basedOn: 1,
    });
    expect(accept.statusCode).toBe(409);
    expect((await risks(server, "u-anna", "KPO")).items[0]).toMatchObject({ status: "geschlossen" });
  });

  it("keeps the agent's reason and fact with an accepted proposal; accepting changes only the values", async () => {
    server = await testServer();
    const first = (await review(server, "u-anna", "KPO")).json() as RiskReviewResult;
    const i = first.newRisks.findIndex((r) => r.trigger === "profil:lieferant");
    const proposed = first.newRisks[i]!;
    expect(
      (
        await record(server, "u-anna", "KPO", {
          title: proposed.title,
          description: proposed.description,
          probability: proposed.probability,
          impact: proposed.impact,
          ownerRole: proposed.ownerRole,
          mitigation: proposed.mitigation,
          proposal: { id: first.proposalId, item: i },
        })
      ).statusCode,
    ).toBe(201);
    // The proposal expires after a day; the record keeps why the agent proposed the risk.
    const [risk] = (await risks(server, "u-anna", "KPO")).items;
    expect(risk!.producer).toMatchObject({ kind: "ai", agent: "A12", edited: false });
    expect(risk!.history[0]!.agentBasis).toEqual({
      reason: proposed.reason,
      trigger: "profil:lieferant",
      fact: "Ein externer Lieferant ist beteiligt.",
    });

    const again = (await review(server, "u-anna", "KPO")).json() as RiskReviewResult;
    const re = again.reassessments[0]!;
    const accept = (body: object) =>
      server!.as("u-anna").post(`/api/projects/KPO/risks/${risk!.id}/assessment`, {
        probability: re.probability,
        impact: re.impact,
        status: re.current.status,
        ownerRole: re.current.ownerRole,
        mitigation: re.mitigation || re.current.mitigation,
        basedOn: re.current.version,
        proposal: { id: again.proposalId, item: 0 },
        ...body,
      });
    // Closing the risk or handing it over is the person's own assessment, not the agent's.
    for (const body of [{ status: "geschlossen", note: "Erledigt." }, { ownerRole: "FACH" }]) {
      const refused = await accept(body);
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error.message).toMatch(/bleiben Status und Verantwortung/);
    }
    expect((await accept({ note: "Eigene Notiz" })).statusCode).toBe(200);
    const assessed = (await risks(server, "u-anna", "KPO")).items[0]!;
    expect(assessed.status).toBe(re.current.status);
    expect(assessed.history.at(-1)).toMatchObject({
      note: "",
      producer: { kind: "ai", agent: "A12", edited: false },
      agentBasis: { reason: re.reason, trigger: re.trigger },
    });
    const verlauf = (
      await server.as("u-anna").get("/api/projects/KPO/events?category=risiko&limit=1")
    ).json();
    expect(verlauf.items[0].text).toContain(`(Vorschlag des Risiko-Agenten): ${re.reason}`);
  });

  it("lets the PL or the responsible role assess and close a risk, always with a reason to close", async () => {
    server = await testServer();
    const reg = await risks(server, "u-nina", "ERP");
    expect(reg.counts).toEqual({ open: 3, high: 2, closed: 1 });
    expect(reg.items.map((r) => `${r.label} ${r.status}`)).toEqual([
      "R-01 in Bearbeitung",
      "R-02 offen",
      "R-03 in Bearbeitung",
      "R-04 geschlossen",
    ]);
    const testers = reg.items[1]!;
    expect(testers).toMatchObject({ title: "Engpass bei Fachtestern im Monatsabschluss", ownerRole: "FACH" });
    expect((await view(server, "u-nina", "ERP")).myTasks.map((t) => t.title)).toContain(
      "Hohes Risiko R-02: Engpass bei Fachtestern im Monatsabschluss",
    );

    // Every assessment names the version it was based on (the number of entries in the history).
    const assess = (user: string, body: object, basedOn = 1) =>
      server!.as(user).post(`/api/projects/ERP/risks/${testers.id}/assessment`, {
        probability: "hoch",
        impact: "mittel",
        ownerRole: "FACH",
        status: "offen",
        mitigation: "",
        basedOn,
        ...body,
      });
    expect((await assess("u-tim", { status: "in Bearbeitung", mitigation: "Testfenster" })).statusCode).toBe(
      403,
    );
    const noMeasure = await assess("u-nina", { status: "in Bearbeitung" });
    expect(noMeasure.statusCode).toBe(422);
    expect(noMeasure.json().error.message).toMatch(/Massnahme/);
    expect((await assess("u-nina", {})).statusCode).toBe(422);
    const measure = "Testfenster vor dem Monatsabschluss reservieren.";
    expect(
      (
        await assess("u-nina", {
          status: "in Bearbeitung",
          mitigation: measure,
          note: "Mit der Fachstelle geklärt.",
        })
      ).statusCode,
    ).toBe(200);
    expect((await view(server, "u-nina", "ERP")).myTasks.some((t) => t.kind === "risk")).toBe(false);
    // Someone who still looks at version 1 cannot overwrite the new assessment.
    const stale = await assess("u-jonas", { status: "geschlossen", mitigation: measure, note: "Erledigt." });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("stale");
    expect((await assess("u-jonas", { status: "geschlossen", mitigation: measure }, 2)).statusCode).toBe(422);
    expect(
      (
        await assess(
          "u-jonas",
          { status: "geschlossen", mitigation: measure, note: "Tests abgeschlossen." },
          2,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await assess("u-jonas", { status: "geschlossen", mitigation: measure, note: "Nachtrag." }, 3))
        .statusCode,
    ).toBe(409);
    const closed = (await risks(server, "u-jonas", "ERP")).items.find((r) => r.id === testers.id)!;
    expect(closed).toMatchObject({ status: "geschlossen", open: false });
    expect(closed.history.map((h) => h.status)).toEqual(["offen", "in Bearbeitung", "geschlossen"]);

    const events = (
      await server.as("u-jonas").get("/api/projects/ERP/events?category=risiko&limit=2")
    ).json();
    expect(events.items.map((e: { text: string }) => e.text)).toEqual([
      "R-02 geschlossen: Tests abgeschlossen.",
      "R-02 neu beurteilt: Eintritt hoch, Auswirkung mittel, in Bearbeitung: Mit der Fachstelle geklärt.",
    ]);
    expect((await server.as("u-jonas").post("/api/projects/ERP/risks/abc/assessment", {})).statusCode).toBe(
      422,
    );
    expect((await record(server, "u-nina", "ERP", { probability: "sehr hoch" })).statusCode).toBe(422);
  });

  it("flags projects with high risks in the portfolio and answers questions in the chat", async () => {
    server = await testServer();
    const flagged = (await server.as("u-peter").get("/api/projects?scope=all&signal=risiko-hoch")).json();
    expect(flagged.items.map((p: { code: string }) => p.code)).toEqual(["ERP"]);
    const reply = (
      await server.as("u-nina").post("/api/projects/ERP/chat", { message: "Welche Risiken gibt es?" })
    ).json();
    expect(reply.text).toContain("3 offene Risiken, davon 2 hoch");
    expect(reply.text).toContain("R-01 Lieferverzug beim Release-Upgrade des Herstellers");
    const start = (
      await server.as("u-jonas").post("/api/projects/ERP/chat", { message: "Starte die Risikoprüfung" })
    ).json();
    expect(start.text).toContain("«Risiken prüfen lassen»");
    expect(start.actions).toEqual([]);
  });

  it("says so when the agent is unavailable, so risks can be recorded by hand", async () => {
    const mock = new MockProvider(0);
    server = await testServer({
      provider: {
        info: mock.info,
        draft: (r) => mock.draft(r),
        critique: (r) => mock.critique(r),
        draftChangeRequest: (r) => mock.draftChangeRequest(r),
        reviewRisks: async () => {
          throw new AiProviderError("timeout", "Azure OpenAI timeout");
        },
        draftStatusReport: (r) => mock.draftStatusReport(r),
      },
    });
    const res = await review(server, "u-anna", "KPO");
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/Zeitüberschreitung.*ohne den Agenten erfassen/);
  });
});

describe("status reports", () => {
  const reports = async (s: Server, user: string, code = "ERP") =>
    (await s.as(user).get(`/api/projects/${code}/status-reports`)).json() as StatusReportRegisterView;
  /** The engine's suggestion as the PL's choice, with texts where a colour is not green. */
  const fromSuggestion = (r: StatusReportRegisterView, text = "Beschrieben für den Test.") =>
    Object.fromEntries(
      r.suggestion.map((x) => [
        x.id,
        {
          ampel: x.ampel,
          problem: x.ampel === "gruen" ? "" : text,
          measure: x.ampel === "gruen" ? "" : text,
        },
      ]),
    );

  it("suggests the traffic light, drafts the texts with the agent, and stores nothing until the PL publishes", async () => {
    server = await testServer();
    const reg = await reports(server, "u-jonas");
    expect(reg.items.map((r) => `${r.title} ${r.overall}`)).toEqual(["Statusbericht 1 gelb"]);
    expect(reg.items[0]!.acknowledgements[0]).toMatchObject({ by: { displayName: "Thomas Meier" } });
    expect(reg.items[0]!.criteria.find((c) => c.id === "risiken")).toMatchObject({
      ampel: "gelb",
      suggested: "rot",
      deviates: true,
    });
    const risiken = reg.suggestion.find((x) => x.id === "risiken")!;
    expect(risiken.ampel).toBe("rot");
    expect(risiken.reasons).toContain(
      "R-02 «Engpass bei Fachtestern im Monatsabschluss»: hohes Risiko ohne Massnahme.",
    );

    const body = { criteria: fromSuggestion(reg, ""), figures: { budgetChf: 400_000, spentChf: 180_000 } };
    expect((await server.as("u-nina").post("/api/projects/ERP/status-reports/draft", body)).statusCode).toBe(
      403,
    );
    const res = await server.as("u-jonas").post("/api/projects/ERP/status-reports/draft", body);
    expect(res.statusCode).toBe(200);
    const draft = res.json() as StatusReportProposal;
    expect(draft.producer).toMatchObject({ kind: "ai", agent: "A2" });
    expect(draft.overview).toContain("Abweichungen:");
    expect(draft.overview).toContain("Budget 400'000 CHF, verbraucht 180'000 CHF.");
    expect(Object.keys(draft.criteria).sort()).toEqual(
      reg.suggestion
        .filter((x) => x.ampel !== "gruen")
        .map((x) => x.id)
        .sort(),
    );
    expect(draft.criteria.risiken?.problem).toContain("hohes Risiko ohne Massnahme");
    // The offline agent leaves the measures open: the Kritiker's checklist says so.
    expect(draft.findings.map((f) => f.text)).toContain("4 Texte enthalten noch offene Angaben ([OFFEN]).");
    expect((await reports(server, "u-jonas")).items).toHaveLength(1);
  });

  it("is published by the PL with problems and measures, and taken note of by the Projektausschuss", async () => {
    server = await testServer();
    const reg = await reports(server, "u-jonas");
    const publish = (user: string, criteria: object, extra: object = {}) =>
      server!.as(user).post("/api/projects/ERP/status-reports", {
        criteria,
        overview: "Realisierung planmässig, Fachtest im nächsten Monat.",
        outlook: "Entscheid zu CR-02.",
        basedOn: reg.suggestionVersion,
        ...extra,
      });
    const base = fromSuggestion(reg);
    const { proposalId } = (
      await server.as("u-jonas").post("/api/projects/ERP/status-reports/draft", { criteria: base })
    ).json() as StatusReportProposal;
    const noMeasure = await publish("u-jonas", {
      ...base,
      kosten: { ampel: "gelb", problem: "", measure: "" },
    });
    expect(noMeasure.statusCode).toBe(422);
    expect(noMeasure.json().error.message).toBe("«Kosten» ist Gelb: Bitte Problem und Massnahme nennen.");
    const better = await publish("u-jonas", {
      ...base,
      risiken: { ampel: "gruen", problem: "", measure: "" },
    });
    expect(better.statusCode).toBe(422);
    expect(better.json().error.message).toMatch(/besser ist als vorgeschlagen \(Vorschlag Rot\)/);
    // A problem text (perhaps the agent's) is no reason: the project lead's own field is.
    const problemOnly = await publish("u-jonas", {
      ...base,
      risiken: {
        ampel: "gruen",
        problem: "Zwei Fachtester sind knapp.",
        measure: "Testfenster reservieren.",
      },
    });
    expect(problemOnly.statusCode).toBe(422);
    // The suggestion changed since the form was opened.
    const stale = await publish("u-jonas", base, { basedOn: "00000000" });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.message).toMatch(/Vorschlag hat sich inzwischen geändert/);
    expect((await publish("u-nina", base)).statusCode).toBe(403);
    expect((await publish("u-jonas", base, { proposalId })).statusCode).toBe(201);

    const latest = (await reports(server, "u-thomas")).items[0]!;
    expect(latest).toMatchObject({
      title: "Statusbericht 2",
      overall: "rot",
      producer: { kind: "ai", agent: "A2", edited: true },
    });
    expect(latest.risks.map((r) => r.label)).toEqual(["R-01", "R-02", "R-03"]);
    expect(latest.canAcknowledge.ok).toBe(true);
    expect((await view(server, "u-thomas", "ERP")).myTasks.map((t) => t.title)).toContain(
      "Statusbericht 2 zur Kenntnis nehmen",
    );
    const ack = (user: string) =>
      server!.as(user).post(`/api/projects/ERP/status-reports/${latest.id}/acknowledge`, {
        note: "Eskalation besprochen.",
      });
    expect((await ack("u-nina")).statusCode).toBe(403);
    expect((await ack("u-thomas")).statusCode).toBe(200);
    // Taken note of once; a second time is refused like other actions on a settled state.
    expect((await ack("u-thomas")).statusCode).toBe(409);

    const events = (
      await server.as("u-jonas").get("/api/projects/ERP/events?category=status&limit=2")
    ).json();
    expect(events.items.map((e: { text: string }) => e.text)).toEqual([
      "Statusbericht 2 vom Projektausschuss zur Kenntnis genommen: Eskalation besprochen.",
      expect.stringMatching(
        /^Statusbericht 2 veröffentlicht: Gesamtstatus Rot \(.*Risiken Rot.*\); Texte mit dem Agenten entworfen\.$/,
      ),
    ]);
    const red = (await server.as("u-peter").get("/api/projects?scope=all&signal=status-rot")).json();
    expect(red.items.map((p: { code: string }) => p.code).sort()).toEqual(["CRM", "ERP"]);
  });

  it("records whether the PL changed the agent's texts; the reason for a better colour is always the PL's", async () => {
    server = await testServer();
    const draftAndChoose = async () => {
      const reg = await reports(server!, "u-jonas");
      const p = (
        await server!
          .as("u-jonas")
          .post("/api/projects/ERP/status-reports/draft", { criteria: fromSuggestion(reg, "") })
      ).json() as StatusReportProposal;
      const criteria = Object.fromEntries(
        reg.suggestion.map((x) => [
          x.id,
          {
            ampel: x.ampel,
            problem: p.criteria[x.id]?.problem ?? "",
            measure: p.criteria[x.id]?.measure ?? "",
            deviationReason: "",
          },
        ]),
      );
      const publish = (changed: object) =>
        server!.as("u-jonas").post("/api/projects/ERP/status-reports", {
          criteria: { ...criteria, ...changed },
          overview: p.overview,
          outlook: p.outlook,
          basedOn: reg.suggestionVersion,
          proposalId: p.proposalId,
        });
      return publish;
    };
    // The agent's texts as they are.
    expect((await (await draftAndChoose())({})).statusCode).toBe(201);
    let latest = (await reports(server, "u-thomas")).items[0]!;
    expect(latest.producer).toMatchObject({ kind: "ai", agent: "A2", edited: false });

    // Risiken better than suggested: the agent's problem text goes, the PL's reason stays.
    const publish = await draftAndChoose();
    const reason = "Die Fachstelle hat die Testfenster zugesagt.";
    expect(
      (
        await publish({
          risiken: { ampel: "gelb", problem: "Engpass", measure: "Testfenster", deviationReason: "" },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await publish({ risiken: { ampel: "gruen", problem: "x", measure: "y", deviationReason: reason } }))
        .statusCode,
    ).toBe(201);
    latest = (await reports(server, "u-thomas")).items[0]!;
    expect(latest.producer).toMatchObject({ kind: "ai", edited: true });
    expect(latest.criteria.find((c) => c.id === "risiken")).toMatchObject({
      ampel: "gruen",
      suggested: "rot",
      problem: "",
      measure: "",
      deviationReason: reason,
      reasons: expect.arrayContaining([
        "R-02 «Engpass bei Fachtestern im Monatsabschluss»: hohes Risiko ohne Massnahme.",
      ]),
    });
    const record = (
      await server.as("u-jonas").get("/api/projects/ERP/events?category=status&limit=1")
    ).json();
    expect(record.items[0].text).toMatch(
      /Besser als vorgeschlagen, mit Begründung: Risiken \(Vorschlag Rot\)\.$/,
    );
  });

  it("answers questions about the status report in the chat", async () => {
    server = await testServer();
    const ask = async (message: string) =>
      (await server!.as("u-jonas").post("/api/projects/ERP/chat", { message })).json() as { text: string };
    const answer = await ask("Wie ist der Statusbericht?");
    expect(answer.text).toMatch(/^Statusbericht 1 vom .*: Gesamtstatus Gelb\./);
    expect(answer.text).toContain("Vorschlag für den nächsten:");
    expect((await ask("Erstelle den Statusbericht")).text).toContain("«Neuer Statusbericht»");
  });
});

describe("what reaches the model and the logs (principle 3)", () => {
  it("keeps restricted results out of texts everyone reads, and content out of the logs", async () => {
    const CANARY = "KANARIENVOGEL-DSVOR";
    const seen: { userId: string; context: string }[] = [];
    const note = (ctx: { userId: string } | undefined, project: object) =>
      seen.push({ userId: ctx?.userId ?? "", context: JSON.stringify(project) });
    const mock = new MockProvider(0);
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (line: string) => void lines.push(line) });
    server = await testServer({
      logger,
      provider: {
        info: mock.info,
        draft: (r, c) => mock.draft(r, c),
        critique: (r) => mock.critique(r),
        draftChangeRequest: (r, c) => {
          note(c, r.project);
          return mock.draftChangeRequest(r, c);
        },
        reviewRisks: (r, c) => {
          note(c, r.project);
          return mock.reviewRisks(r, c);
        },
        draftStatusReport: (r, c) => {
          note(c, r.project);
          return mock.draftStatusReport(r, c);
        },
      },
    });
    // A released Datenschutz-Vorabklärung: restricted, need-to-know.
    const kpo = (await server.repo.findByCode("KPO"))!;
    const skill = server.repo.model.skill("init.datenschutz");
    const actor = { userId: "u-sandra", displayName: "Sandra Roth", roles: ["DS"], channel: "web" as const };
    await server.repo.append(
      kpo.projectId,
      kpo.lastSeq,
      [
        { type: "SkillRunRequested", data: { runId: "run-dsvor", skillId: skill.id } },
        {
          type: "SkillRunCompleted",
          data: {
            runId: "run-dsvor",
            skillId: skill.id,
            draft: {
              summary: `${CANARY}: Gesundheitsdaten von Kundinnen werden verarbeitet.`,
              sections: skill.sections.map((heading) => ({ heading, body: `${heading} erfasst.` })),
              openPoints: [],
            },
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
      ],
      actor,
      "c-dsvor",
    );
    const wish = {
      title: "Export für das Inkasso",
      description: "WUNSCH-TEXT: Adressen säumiger Kunden an das Inkassobüro übermitteln.",
      requestedBy: "Debitoren",
    };
    for (const user of ["u-nina", "u-sandra"]) {
      expect((await server.as(user).post("/api/projects/KPO/change-requests/draft", wish)).statusCode).toBe(
        200,
      );
    }
    expect((await server.as("u-anna").post("/api/projects/KPO/risks/review")).statusCode).toBe(200);
    const reg = (await server.as("u-anna").get("/api/projects/KPO/status-reports")).json();
    const criteria = Object.fromEntries(
      reg.suggestion.map((x: { id: string; ampel: string }) => [
        x.id,
        { ampel: x.ampel, problem: "", measure: "" },
      ]),
    );
    expect(
      (await server.as("u-anna").post("/api/projects/KPO/status-reports/draft", { criteria })).statusCode,
    ).toBe(200);

    // Change requests, risks and status reports are read by every member: the restricted
    // result reaches the model by name only, also when the requester (Datenschutz, the
    // project lead) may read it.
    expect(seen.map((x) => x.userId).sort()).toEqual(["u-anna", "u-anna", "u-nina", "u-sandra"]);
    expect(seen.filter((x) => x.context.includes(CANARY))).toEqual([]);
    // Who may read the result learns that it exists and is released; the others not even that.
    const named = seen.filter((x) => x.context.includes(skill.outputDoc)).map((x) => x.userId);
    expect(named.sort()).toEqual(["u-anna", "u-anna", "u-sandra"]);

    // The audit logs keep who, what and how much, never the content.
    const log = lines.join("\n");
    expect(lines.filter((l) => l.includes('"type":"ai_run"'))).toHaveLength(4);
    expect(log).not.toContain(CANARY);
    expect(log).not.toContain("WUNSCH-TEXT");
    expect(log).not.toContain("Inkasso");
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
