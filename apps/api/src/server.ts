import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { trace } from "@opentelemetry/api";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve, sep } from "node:path";
import { Orchestrator } from "./agents/orchestrator";
import type { AiProvider } from "./agents/provider";
import { RunService } from "./agents/runner";
import type { AuthenticatedUser, Authenticator, DevUser } from "./auth";
import type { Config } from "./config";
import { HttpError } from "./errors";
import type { ProjectRepository } from "./projects/repository";
import { ProjectService } from "./projects/service";
import { registerRoutes, type ClientConfig } from "./routes";
import { StoreUnavailableError, type EventStore } from "./store/event-store";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

export interface ServerDeps {
  config: Config;
  repo: ProjectRepository;
  store: EventStore;
  provider: AiProvider;
  authenticator: Authenticator;
  devUsers?: readonly DevUser[];
  /** The process logger; false: no logging (tests). */
  logger?: FastifyBaseLogger | false;
}

export interface Server {
  app: FastifyInstance;
  projects: ProjectService;
  runs: RunService;
}

const PUBLIC_PATHS = new Set(["/api/health", "/api/ready", "/api/config", "/api/dev/users"]);
const CORRELATION_ID = /^[A-Za-z0-9._-]{8,64}$/;

export async function buildServer(deps: ServerDeps): Promise<Server> {
  const { config } = deps;
  const app = Fastify({
    ...(deps.logger === false
      ? { logger: false }
      : deps.logger
        ? { loggerInstance: deps.logger }
        : {
            logger: { level: config.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie"] },
          }),
    genReqId: (req) => {
      const h = req.headers["x-correlation-id"];
      return typeof h === "string" && CORRELATION_ID.test(h) ? h : randomUUID();
    },
    bodyLimit: 1_048_576,
    // Only named proxies (in Azure the Container Apps ingress subnet) may set the client address.
    trustProxy: config.TRUSTED_PROXIES ?? false,
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
  // Per signed-in person: in a company many people share a few egress addresses.
  // Runs after sign-in (preHandler); before it, per client address.
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => (req.user ? `user:${req.user.userId}` : `ip:${req.ip}`),
  });

  // Telemetry: name requests by route instead of URL, and keep the correlation id
  // that users see in error messages. No-op without telemetry (telemetry.ts).
  app.addHook("onRequest", async (req) => {
    const span = trace.getActiveSpan();
    if (!span) return;
    const route = req.routeOptions.url;
    if (route) {
      span.updateName(`${req.method} ${route}`);
      span.setAttribute("http.route", route);
    }
    span.setAttribute("hh.correlation_id", req.id);
  });

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
    if (err instanceof StoreUnavailableError) {
      req.log.error({ err }, "event store unavailable");
      reply.header("retry-after", "5");
      return send(
        503,
        "unavailable",
        "Die Datenbank ist vorübergehend nicht erreichbar. Bitte gleich nochmals versuchen.",
      );
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413) return send(413, "too_large", "Die Anfrage ist zu gross.");
    if (status === 429) return send(429, "rate_limited", "Zu viele Anfragen. Bitte einen Moment warten.");
    if (status && status >= 400 && status < 500) return send(status, "bad_request", "Ungültige Anfrage.");
    req.log.error({ err }, "unhandled error");
    return send(500, "internal", "Unerwarteter Fehler. Bitte später erneut versuchen.");
  });

  const clientConfig: ClientConfig =
    deps.authenticator.mode === "entra"
      ? {
          authMode: "entra",
          entra: {
            tenantId: config.ENTRA_TENANT_ID ?? "",
            clientId: config.ENTRA_WEB_CLIENT_ID ?? "",
            apiScope:
              config.ENTRA_API_SCOPE ??
              `api://${config.ENTRA_API_CLIENT_ID ?? ""}/${config.ENTRA_REQUIRED_SCOPE}`,
          },
        }
      : { authMode: "dev" };

  registerRoutes(app, {
    clientConfig,
    ready: () => deps.store.ping(),
    repo: deps.repo,
    projects,
    runs,
    orchestrator,
    authenticator: deps.authenticator,
    provider: deps.provider.info,
    devUsers: deps.devUsers ?? [],
  });

  const webRoot = config.WEB_DIST_DIR ? resolve(config.WEB_DIST_DIR) : undefined;
  if (webRoot) {
    await app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      // Built assets have a content hash in their name; everything else is revalidated.
      setHeaders: (reply, path) => {
        reply.header(
          "cache-control",
          path.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (!webRoot || req.url.startsWith("/api/") || req.url.startsWith("/assets/")) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "Nicht gefunden.", correlationId: req.id } });
    }
    // Single-page app: unknown paths are client routes.
    return reply.sendFile("index.html");
  });

  return { app, projects, runs };
}
