import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Orchestrator } from "./agents/orchestrator";
import type { AiProvider } from "./agents/provider";
import { RunService } from "./agents/runner";
import type { AuthenticatedUser, Authenticator, DevUser } from "./auth";
import type { Config } from "./config";
import { HttpError } from "./errors";
import type { ProjectRepository } from "./projects/repository";
import { ProjectService } from "./projects/service";
import { registerRoutes } from "./routes";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

export interface ServerDeps {
  config: Config;
  repo: ProjectRepository;
  provider: AiProvider;
  authenticator: Authenticator;
  devUsers?: readonly DevUser[];
  /** false: no logging (tests). */
  logger?: boolean;
}

export interface Server {
  app: FastifyInstance;
  projects: ProjectService;
  runs: RunService;
}

const PUBLIC_PATHS = new Set(["/api/health", "/api/dev/users"]);
const CORRELATION_ID = /^[A-Za-z0-9._-]{8,64}$/;

export async function buildServer(deps: ServerDeps): Promise<Server> {
  const { config } = deps;
  const app = Fastify({
    logger:
      deps.logger === false
        ? false
        : { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
    genReqId: (req) => {
      const h = req.headers["x-correlation-id"];
      return typeof h === "string" && CORRELATION_ID.test(h) ? h : randomUUID();
    },
    bodyLimit: 1_048_576,
    trustProxy: config.NODE_ENV === "production",
  });

  const projects = new ProjectService(deps.repo);
  const runs = new RunService(deps.repo, projects, deps.provider, app.log);
  const orchestrator = new Orchestrator(projects, runs, deps.provider, app.log);

  const production = config.NODE_ENV === "production";
  await app.register(helmet, {
    // Only over HTTPS in production; locally the app runs on plain http://localhost.
    hsts: production,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Fluent UI injects its styles at runtime (CSS-in-JS).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https://login.microsoftonline.com"],
        frameSrc: ["https://login.microsoftonline.com"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
  });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const path = req.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/") || PUBLIC_PATHS.has(path)) return;
    req.user = await deps.authenticator.authenticate(req);
  });
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-correlation-id", req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const send = (status: number, code: string, message: string) =>
      reply.code(status).send({ error: { code, message, correlationId: req.id } });
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ err }, "request failed");
      return send(err.status, err.code, err.message);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) return send(413, "too_large", "Die Anfrage ist zu gross.");
    if (status === 429) return send(429, "rate_limited", "Zu viele Anfragen. Bitte einen Moment warten.");
    if (status && status >= 400 && status < 500) return send(status, "bad_request", "Ungültige Anfrage.");
    req.log.error({ err }, "unhandled error");
    return send(500, "internal", "Unerwarteter Fehler. Bitte später erneut versuchen.");
  });

  registerRoutes(app, {
    repo: deps.repo,
    projects,
    runs,
    orchestrator,
    authenticator: deps.authenticator,
    provider: deps.provider.info,
    devUsers: deps.devUsers ?? [],
  });

  const webRoot = config.WEB_DIST_DIR ? resolve(config.WEB_DIST_DIR) : undefined;
  if (webRoot) await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (!webRoot || req.url.startsWith("/api/")) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Nicht gefunden.", correlationId: req.id } });
    }
    // Single-page app: unknown paths are client routes.
    return reply.sendFile("index.html");
  });

  return { app, projects, runs };
}
