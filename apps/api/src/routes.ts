import {
  AGENTS,
  CR_FLAGS,
  CR_FLAG_LABELS,
  CR_RECHECK_ROLES,
  CR_SECTIONS,
  DECISIONS,
  DUE_OPTIONS,
  EVENT_CATEGORIES,
  RECHECK_OUTCOMES,
  GLOBAL_ROLE_LABELS,
  INVOLVEMENT_OPTIONS,
  PHASE_IDS,
  PROJECT_ROLES,
  PROJECT_ROLE_LABELS,
  RISK_LEVELS,
  RISK_SCORE_HIGH,
  RISK_SCORE_MEDIUM,
  RISK_STATUSES,
  SIGNAL_IDS,
  canCreateProject,
  canVerifyAudit,
  changeRequestRegister,
  describeEvent,
  deliverableDetailView,
  eventCategory,
  eventRefs,
  portfolioOverview,
  projectView,
  riskRegister,
  rolesOf,
  seesAllProjects,
  type GlobalRole,
  type ProjectRole,
  type Viewer,
} from "@hermes-helfer/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ChangeRequestAgent } from "./agents/change-request-agent";
import type { Orchestrator } from "./agents/orchestrator";
import type { ProviderInfo } from "./agents/provider";
import type { RiskAgent } from "./agents/risk-agent";
import type { RunService } from "./agents/runner";
import type { Authenticator, DevUser } from "./auth";
import { HttpError, notFound, parse } from "./errors";
import type { ProjectRepository } from "./projects/repository";
import type { ProjectService, RequestContext } from "./projects/service";
import { ProjectSummaries, queryProjects } from "./projects/summaries";

/** Sign-in settings for the web app, served before sign-in. Contains no secrets. */
export type ClientConfig =
  | { authMode: "dev" }
  | { authMode: "entra"; entra: { tenantId: string; clientId: string; apiScope: string } };

export interface RouteDeps {
  clientConfig: ClientConfig;
  /** Throws if the app cannot serve requests (readiness probe). */
  ready: () => Promise<void>;
  repo: ProjectRepository;
  projects: ProjectService;
  runs: RunService;
  orchestrator: Orchestrator;
  changeRequestAgent: ChangeRequestAgent;
  riskAgent: RiskAgent;
  authenticator: Authenticator;
  provider: ProviderInfo;
  devUsers: readonly DevUser[];
  /** The clock for due dates and inactivity (tests set it). */
  now: () => Date;
}

// ---------- Input schemas ----------

const Code = z.string().regex(/^[A-Za-z0-9-]{2,20}$/, "Ungültiges Kürzel");
const Id = z.string().regex(/^[a-z0-9.-]{2,60}$/, "Ungültige Kennung");
const Role = z.enum(PROJECT_ROLES);
const Phase = z.enum(PHASE_IDS);
const Scope = z.enum(["mine", "all"]).default("mine");
const Level = z.enum(["niedrig", "mittel", "hoch"]);

const Profile = z.object({
  schutzbedarf: Level,
  personendaten: z.boolean(),
  cloud: z.boolean(),
  schnittstellen: z.number().int().min(0).max(50),
  lieferant: z.boolean(),
  verfuegbarkeit: Level,
  neueTechnologie: z.boolean(),
  externeNutzende: z.boolean(),
});

const DecisionBody = z.object({
  decision: z.enum(DECISIONS),
  reason: z.string().max(4000).default(""),
  konsent: z.boolean().default(false),
  conditions: z
    .array(z.object({ text: z.string().max(500), ownerRole: Role, due: z.enum(DUE_OPTIONS) }))
    .max(20)
    .default([]),
});

export const MAX_DRAFT_CHARS = 100_000;
const Draft = z
  .object({
    summary: z.string().max(4000),
    sections: z
      .array(z.object({ heading: z.string().trim().min(1).max(200), body: z.string().max(30_000) }))
      .max(40),
    openPoints: z.array(z.string().max(500)).max(50).default([]),
  })
  .refine(
    (d) =>
      d.summary.length + d.sections.reduce((n, s) => n + s.heading.length + s.body.length, 0) <=
      MAX_DRAFT_CHARS,
    "Der Entwurf ist zu lang (höchstens 100'000 Zeichen).",
  );

const CrFlagsBody = z.object({
  daten: z.boolean(),
  schnittstelle: z.boolean(),
  sonderloesung: z.boolean(),
  oberflaeche: z.boolean(),
  extern: z.boolean(),
});
const CrTitle = z.string().trim().min(4, "Bitte einen Titel erfassen (mindestens 4 Zeichen).").max(200);
const RiskValues = {
  probability: Level,
  impact: Level,
  ownerRole: Role,
  mitigation: z.string().max(1000).default(""),
  aiAssisted: z.boolean().default(false),
};

export const MAX_CHAT_CHARS = 2000;
const ChatBody = z.object({
  message: z.string().trim().min(1).max(MAX_CHAT_CHARS),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(12)
    .default([]),
});

const roleLabel = (r: string) =>
  PROJECT_ROLE_LABELS[r as ProjectRole] ??
  (r === "HH.User" ? null : (GLOBAL_ROLE_LABELS[r as GlobalRole] ?? r));

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { repo, projects, runs, orchestrator } = deps;
  const model = repo.model;
  const summaries = new ProjectSummaries(model);

  /** List items of the projects the viewer may see: all for PMO and Portfolio, else their own. */
  const listItems = async (viewer: Viewer, requested: "mine" | "all", now: Date) => {
    const scope = requested === "all" && seesAllProjects(viewer) ? "all" : "mine";
    const items = (await repo.all())
      .filter((s) => scope === "all" || rolesOf(s, viewer.userId).length > 0)
      .map((s) => summaries.item(s, viewer, now));
    return { scope, items };
  };

  const ctx = (req: FastifyRequest): RequestContext => {
    if (!req.user) throw new HttpError(401, "not_authenticated", "Bitte anmelden.");
    return { viewer: req.user, channel: "web", correlationId: req.id };
  };
  const params = <S extends z.ZodType>(req: FastifyRequest, schema: S) => parse(schema, req.params);

  // Liveness: the process runs. Readiness: the event store answers too.
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/ready", async (req, reply) => {
    try {
      await deps.ready();
      return { status: "ready" };
    } catch (err) {
      req.log.warn({ err }, "not ready");
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/api/config", async (_req, reply) => {
    reply.header("cache-control", "no-cache");
    return deps.clientConfig;
  });

  if (deps.authenticator.mode === "dev") {
    app.get("/api/dev/users", async () =>
      deps.devUsers.map((u) => ({ id: u.id, displayName: u.displayName, description: u.description })),
    );
  }

  app.get("/api/me", async (req) => {
    const user = req.user!;
    return {
      userId: user.userId,
      displayName: user.displayName,
      upn: user.upn,
      globalRoles: user.globalRoles,
      authMode: deps.authenticator.mode,
      ai: deps.provider,
      can: { createProject: canCreateProject(user), seeAllProjects: seesAllProjects(user) },
    };
  });

  app.get("/api/reference", async () => ({
    modelVersion: model.version,
    phases: model.phases.map((p) => ({ id: p.id, label: p.label, extension: p.extension })),
    roles: PROJECT_ROLES.map((r) => ({ id: r, label: PROJECT_ROLE_LABELS[r] })),
    decisions: DECISIONS,
    dueOptions: DUE_OPTIONS,
    changeRequests: {
      flags: CR_FLAGS.map((id) => ({ id, ...CR_FLAG_LABELS[id] })),
      sections: CR_SECTIONS,
      recheckOutcomes: RECHECK_OUTCOMES,
    },
    risks: {
      levels: RISK_LEVELS,
      statuses: RISK_STATUSES,
      scoreHigh: RISK_SCORE_HIGH,
      scoreMedium: RISK_SCORE_MEDIUM,
    },
    involvementOptions: INVOLVEMENT_OPTIONS,
    agents: AGENTS,
  }));

  app.get("/api/projects", async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        phase: Phase.optional(),
        gate: z.enum(["open", "blocked", "ready", "passed"]).optional(),
        signal: z.enum(SIGNAL_IDS).optional(),
        sort: z.enum(["updated", "name", "attention"]).default("updated"),
        scope: Scope,
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const { items } = await listItems(ctx(req).viewer, q.scope, deps.now());
    const found = queryProjects(items, q);
    return { items: found.slice(q.offset, q.offset + q.limit), total: found.length };
  });

  // Key figures across the projects the viewer may see (architecture §7).
  app.get("/api/portfolio", async (req) => {
    const q = parse(z.object({ scope: Scope }), req.query);
    const now = deps.now();
    const { scope, items } = await listItems(ctx(req).viewer, q.scope, now);
    return { scope, ...portfolioOverview(items, model, now) };
  });

  app.post("/api/projects", async (req, reply) => {
    const body = parse(
      z.object({
        code: z.string().max(20),
        name: z.string().trim().min(3).max(120),
        description: z.string().max(2000).optional(),
        phase: Phase.optional(),
        profile: Profile.optional(),
        projectLead: z
          .object({ userId: z.string().min(1).max(100), displayName: z.string().min(1).max(120) })
          .optional(),
      }),
      req.body,
    );
    const created = await projects.createProject(ctx(req), body);
    return reply.code(201).send(created);
  });

  app.get("/api/projects/:code", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const c = ctx(req);
    return projectView(await projects.requireProject(code, c.viewer), model, c.viewer, deps.now());
  });

  app.get("/api/projects/:code/deliverables/:deliverableId", async (req) => {
    const { code, deliverableId } = params(req, z.object({ code: Code, deliverableId: Id }));
    const c = ctx(req);
    const s = await projects.requireProject(code, c.viewer);
    const d = model.findDeliverable(deliverableId);
    if (!d) throw notFound("Dieses Ergebnis gibt es nicht.");
    return deliverableDetailView(s, model, c.viewer, d, deps.now());
  });

  app.post(
    "/api/projects/:code/skills/:skillId/runs",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { code, skillId } = params(req, z.object({ code: Code, skillId: Id }));
      const result = await runs.start(code, ctx(req), skillId);
      return reply.code(202).send(result);
    },
  );

  app.post("/api/projects/:code/skills/:skillId/result", async (req) => {
    const { code, skillId } = params(req, z.object({ code: Code, skillId: Id }));
    const body = parse(z.object({ draft: Draft }), req.body);
    return projects.recordManualResult(code, ctx(req), skillId, body.draft);
  });

  app.put("/api/projects/:code/skills/:skillId/draft", async (req) => {
    const { code, skillId } = params(req, z.object({ code: Code, skillId: Id }));
    const body = parse(z.object({ draft: Draft, version: z.number().int().min(1) }), req.body);
    return projects.editDraft(code, ctx(req), skillId, body.draft, body.version);
  });

  app.post("/api/projects/:code/skills/:skillId/decisions", async (req) => {
    const { code, skillId } = params(req, z.object({ code: Code, skillId: Id }));
    const body = parse(DecisionBody.extend({ role: Role, version: z.number().int().min(1) }), req.body);
    return projects.decideSkill(code, ctx(req), skillId, body.role, body, body.version);
  });

  app.post("/api/projects/:code/deliverables/:deliverableId/release", async (req) => {
    const { code, deliverableId } = params(req, z.object({ code: Code, deliverableId: Id }));
    const body = parse(z.object({ contentVersion: z.string().max(2000) }), req.body);
    return projects.release(code, ctx(req), deliverableId, body.contentVersion);
  });

  app.post("/api/projects/:code/deliverables/:deliverableId/not-applicable", async (req) => {
    const { code, deliverableId } = params(req, z.object({ code: Code, deliverableId: Id }));
    const body = parse(z.object({ reason: z.string().max(2000) }), req.body);
    return projects.markNotApplicable(code, ctx(req), deliverableId, body.reason);
  });

  app.post("/api/projects/:code/deliverables/:deliverableId/reactivate", async (req) => {
    const { code, deliverableId } = params(req, z.object({ code: Code, deliverableId: Id }));
    return projects.reactivate(code, ctx(req), deliverableId);
  });

  app.post("/api/projects/:code/participation", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(
      z.object({ phase: Phase, participantId: Id, how: z.string().trim().min(2).max(100) }),
      req.body,
    );
    return projects.recordParticipation(code, ctx(req), body.phase, body.participantId, body.how);
  });

  app.post("/api/projects/:code/checklist", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(
      z.object({ ownerId: Id, itemId: Id, note: z.string().max(500).default("") }),
      req.body,
    );
    return projects.confirmChecklistItem(code, ctx(req), body.ownerId, body.itemId, body.note);
  });

  app.post("/api/projects/:code/gates/:phase/decisions", async (req) => {
    const { code, phase } = params(req, z.object({ code: Code, phase: Phase }));
    const body = parse(DecisionBody, req.body);
    return projects.decideGate(code, ctx(req), phase, body);
  });

  app.post("/api/projects/:code/conditions/:conditionId/complete", async (req) => {
    const { code, conditionId } = params(req, z.object({ code: Code, conditionId: z.uuid() }));
    const body = parse(z.object({ note: z.string().max(500).default("") }), req.body ?? {});
    return projects.completeCondition(code, ctx(req), conditionId, body.note);
  });

  app.put("/api/projects/:code/profile", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(z.object({ profile: Profile }), req.body);
    return projects.updateProfile(code, ctx(req), body.profile);
  });

  app.post("/api/projects/:code/members", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(
      z.object({
        userId: z.string().min(1).max(100),
        displayName: z.string().trim().min(1).max(120),
        role: Role,
      }),
      req.body,
    );
    return projects.assignRole(code, ctx(req), body.userId, body.displayName, body.role);
  });

  app.delete("/api/projects/:code/members/:userId/roles/:role", async (req) => {
    const { code, userId, role } = params(
      req,
      z.object({ code: Code, userId: z.string().min(1).max(100), role: Role }),
    );
    return projects.removeRole(code, ctx(req), userId, role);
  });

  app.get("/api/projects/:code/events", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const q = parse(
      z.object({
        before: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        category: z.enum(EVENT_CATEGORIES).optional(),
      }),
      req.query,
    );
    const s = await projects.requireProject(code, ctx(req).viewer);
    const refs = eventRefs(s);
    const all = (await repo.events(s.projectId)).filter(
      (e) => (!q.before || e.seq < q.before) && (!q.category || eventCategory(e) === q.category),
    );
    const page = all.slice(-q.limit).reverse();
    return {
      items: page.map((e) => ({
        seq: e.seq,
        at: e.at,
        type: e.type,
        category: eventCategory(e),
        text: describeEvent(e, model, refs),
        actor: {
          displayName: e.actor.displayName,
          roles: e.actor.roles.map(roleLabel).filter((x): x is string => !!x),
          channel: e.actor.channel,
        },
      })),
      hasMore: all.length > page.length,
    };
  });

  app.post("/api/projects/:code/audit/verify", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const c = ctx(req);
    const s = await projects.requireProject(code, c.viewer);
    if (!canVerifyAudit(s, c.viewer)) {
      throw new HttpError(403, "forbidden", "Die Integrität prüfen können Projektleitung und PMO.");
    }
    return repo.verify(s.projectId);
  });

  // ---------- Change Requests ----------

  app.get("/api/projects/:code/change-requests", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const c = ctx(req);
    return changeRequestRegister(await projects.requireProject(code, c.viewer), model, c.viewer, deps.now());
  });

  // Agent A10 drafts a request from a rough wish; nothing is stored until the person submits.
  app.post(
    "/api/projects/:code/change-requests/draft",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const { code } = params(req, z.object({ code: Code }));
      const body = parse(
        z.object({
          title: CrTitle,
          description: z.string().trim().min(10, "Bitte den Wunsch kurz beschreiben.").max(4000),
          requestedBy: z.string().trim().max(120).default(""),
        }),
        req.body,
      );
      return deps.changeRequestAgent.draft(code, ctx(req), body);
    },
  );

  app.post("/api/projects/:code/change-requests", async (req, reply) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(
      z.object({
        title: CrTitle,
        requestedBy: z.string().trim().min(2, "Bitte angeben, wer die Änderung beantragt.").max(120),
        effortDays: z.number().positive("Bitte den Aufwand in Personentagen schätzen.").max(2000),
        flags: CrFlagsBody,
        content: Draft,
        aiAssisted: z.boolean().default(false),
      }),
      req.body,
    );
    const info = deps.provider;
    const result = await projects.submitChangeRequest(code, ctx(req), {
      title: body.title,
      requestedBy: body.requestedBy,
      effortDays: body.effortDays,
      flags: body.flags,
      content: body.content,
      producer: body.aiAssisted
        ? { kind: "ai", agent: "A10", provider: info.provider, model: info.model }
        : { kind: "human" },
    });
    return reply.code(201).send(result);
  });

  app.post("/api/projects/:code/change-requests/:crId/withdraw", async (req) => {
    const { code, crId } = params(req, z.object({ code: Code, crId: z.uuid() }));
    const body = parse(z.object({ reason: z.string().max(2000) }), req.body);
    return projects.withdrawChangeRequest(code, ctx(req), crId, body.reason);
  });

  app.post("/api/projects/:code/change-requests/:crId/decision", async (req) => {
    const { code, crId } = params(req, z.object({ code: Code, crId: z.uuid() }));
    const body = parse(DecisionBody, req.body);
    return projects.decideChangeRequest(code, ctx(req), crId, body);
  });

  app.post("/api/projects/:code/change-requests/:crId/recheck", async (req) => {
    const { code, crId } = params(req, z.object({ code: Code, crId: z.uuid() }));
    const body = parse(
      z.object({
        role: z.enum(CR_RECHECK_ROLES),
        outcome: z.enum(RECHECK_OUTCOMES),
        note: z.string().max(1000).default(""),
      }),
      req.body,
    );
    return projects.confirmRecheck(code, ctx(req), crId, body.role, body.outcome, body.note);
  });

  app.put("/api/projects/:code/change-reserve", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(z.object({ amountChf: z.number().int().min(0).max(1_000_000_000) }), req.body);
    return projects.setChangeReserve(code, ctx(req), body.amountChf);
  });

  // ---------- Risks ----------

  app.get("/api/projects/:code/risks", async (req) => {
    const { code } = params(req, z.object({ code: Code }));
    const c = ctx(req);
    return riskRegister(await projects.requireProject(code, c.viewer), model, c.viewer);
  });

  // Agent A12 proposes new risks and reassessments; nothing is stored until the PL accepts one.
  app.post(
    "/api/projects/:code/risks/review",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const { code } = params(req, z.object({ code: Code }));
      return deps.riskAgent.review(code, ctx(req));
    },
  );

  const riskProducer = (aiAssisted: boolean) =>
    aiAssisted
      ? ({ kind: "ai", agent: "A12", provider: deps.provider.provider, model: deps.provider.model } as const)
      : ({ kind: "human" } as const);

  app.post("/api/projects/:code/risks", async (req, reply) => {
    const { code } = params(req, z.object({ code: Code }));
    const body = parse(
      z.object({
        title: z.string().trim().min(4, "Bitte das Risiko benennen (mindestens 4 Zeichen).").max(200),
        description: z.string().max(2000).default(""),
        ...RiskValues,
      }),
      req.body,
    );
    const result = await projects.recordRisk(code, ctx(req), {
      title: body.title,
      description: body.description,
      probability: body.probability,
      impact: body.impact,
      ownerRole: body.ownerRole,
      mitigation: body.mitigation,
      producer: riskProducer(body.aiAssisted),
    });
    return reply.code(201).send(result);
  });

  app.post("/api/projects/:code/risks/:riskId/assessment", async (req) => {
    const { code, riskId } = params(req, z.object({ code: Code, riskId: z.uuid() }));
    const body = parse(
      z.object({ ...RiskValues, status: z.enum(RISK_STATUSES), note: z.string().max(2000).default("") }),
      req.body,
    );
    return projects.assessRisk(code, ctx(req), riskId, {
      probability: body.probability,
      impact: body.impact,
      status: body.status,
      ownerRole: body.ownerRole,
      mitigation: body.mitigation,
      note: body.note,
      producer: riskProducer(body.aiAssisted),
    });
  });

  app.post(
    "/api/projects/:code/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { code } = params(req, z.object({ code: Code }));
      const body = parse(ChatBody, req.body);
      return orchestrator.respond(code, { ...ctx(req), channel: "chat" }, body.message, body.history);
    },
  );
}
