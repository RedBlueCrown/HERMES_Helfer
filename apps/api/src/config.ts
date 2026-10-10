import { z } from "zod";

const flag = (byDefault: boolean) =>
  z
    .enum(["true", "false"])
    .default(byDefault ? "true" : "false")
    .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Secure default: dev sign-in only when asked for explicitly (dev.env, tests).
  AUTH_MODE: z.enum(["entra", "dev"]).default("entra"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_CLIENT_ID: z.string().optional(),
  ENTRA_REQUIRED_SCOPE: z.string().default("access_as_user"),
  /** Client ID of the web app registration; the web app reads it from /api/config. */
  ENTRA_WEB_CLIENT_ID: z.string().optional(),
  /** Scope the web app requests; default api://<ENTRA_API_CLIENT_ID>/<ENTRA_REQUIRED_SCOPE>. */
  ENTRA_API_SCOPE: z.string().optional(),
  /** Client ID of the user-assigned managed identity in Azure. */
  AZURE_CLIENT_ID: z.string().optional(),
  STORE: z.enum(["memory", "sql"]).default("memory"),
  DATA_DIR: z.string().optional(),
  SQL_SERVER: z.string().optional(),
  SQL_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
  SQL_DATABASE: z.string().optional(),
  SQL_AUTH: z.enum(["entra", "password"]).default("entra"),
  SQL_USER: z.string().optional(),
  SQL_PASSWORD: z.string().optional(),
  SQL_TRUST_SERVER_CERTIFICATE: flag(false),
  /** Apply pending migrations at startup. In Azure a separate job migrates with its own identity. */
  SQL_MIGRATE_ON_START: flag(false),
  SEED_DEMO: flag(false),
  SEED_SYNTHETIC_PROJECTS: z.coerce.number().int().min(0).max(5000).default(0),
  AI_PROVIDER: z.enum(["mock", "azure-openai"]).default("mock"),
  MOCK_AI_LATENCY_MS: z.coerce.number().int().min(0).max(60_000).default(1200),
  AZURE_OPENAI_ENDPOINT: z.url().optional(),
  AZURE_OPENAI_DEPLOYMENT_DRAFT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT_CHAT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_REGION_LABEL: z.string().default("EU"),
  WEB_DIST_DIR: z.string().optional(),
  /** Addresses or CIDR ranges of reverse proxies whose X-Forwarded-For is trusted; unset trusts none. */
  TRUSTED_PROXIES: z.string().optional(),
  /** Requests per minute per signed-in person (or per client address before sign-in). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(600),
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

/** Empty variables count as unset (deployment templates often set "" for "not configured"). */
export function withoutEmpty(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && e[1].trim() !== ""),
  );
}

/** Reads and checks the configuration. Refuses unsafe combinations (todo-later E18). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = schema.parse(withoutEmpty(env));
  const refuse = (message: string) => {
    throw new Error(message);
  };
  if (c.NODE_ENV === "production") {
    if (c.AUTH_MODE === "dev") refuse("AUTH_MODE=dev is not allowed with NODE_ENV=production.");
    if (c.AI_PROVIDER === "mock") refuse("AI_PROVIDER=mock is not allowed with NODE_ENV=production.");
    if (c.STORE !== "sql") refuse("NODE_ENV=production needs STORE=sql.");
    if (c.SQL_AUTH !== "entra") refuse("NODE_ENV=production needs SQL_AUTH=entra (no database passwords).");
    if (c.SQL_TRUST_SERVER_CERTIFICATE) {
      refuse("SQL_TRUST_SERVER_CERTIFICATE=true is not allowed with NODE_ENV=production.");
    }
    if (c.SEED_DEMO || c.SEED_SYNTHETIC_PROJECTS > 0) {
      refuse("Demo data (SEED_DEMO, SEED_SYNTHETIC_PROJECTS) is not allowed with NODE_ENV=production.");
    }
  }
  // Container Apps and App Service set these; dev sign-in never runs there, whatever NODE_ENV says.
  const inAzure = Boolean(env.CONTAINER_APP_NAME || env.CONTAINER_APP_JOB_NAME || env.WEBSITE_SITE_NAME);
  if (c.AUTH_MODE === "dev" && inAzure) refuse("AUTH_MODE=dev is not allowed in Azure.");
  if (c.AUTH_MODE === "entra" && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_CLIENT_ID || !c.ENTRA_WEB_CLIENT_ID)) {
    refuse("AUTH_MODE=entra needs ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID and ENTRA_WEB_CLIENT_ID.");
  }
  if (c.STORE === "sql" && (!c.SQL_SERVER || !c.SQL_DATABASE)) {
    refuse("STORE=sql needs SQL_SERVER and SQL_DATABASE.");
  }
  if (c.STORE === "sql" && c.SQL_AUTH === "password" && (!c.SQL_USER || !c.SQL_PASSWORD)) {
    refuse("SQL_AUTH=password needs SQL_USER and SQL_PASSWORD.");
  }
  if (
    c.AI_PROVIDER === "azure-openai" &&
    (!c.AZURE_OPENAI_ENDPOINT || !c.AZURE_OPENAI_DEPLOYMENT_DRAFT || !c.AZURE_OPENAI_DEPLOYMENT_CHAT)
  ) {
    refuse(
      "AI_PROVIDER=azure-openai needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_DRAFT and AZURE_OPENAI_DEPLOYMENT_CHAT.",
    );
  }
  return c;
}
