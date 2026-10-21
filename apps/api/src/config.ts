import { z } from "zod";

const flag = (byDefault: boolean) =>
  z
    .enum(["true", "false"])
    .default(byDefault ? "true" : "false")
    .transform((v) => v === "true");

/** A host name, or «*.» and a domain for every host below it («*.sharepoint.com»). */
const HOST_PATTERN = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

const hostList = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(HOST_PATTERN, "Expected a host name or *.domain")).min(1));

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
  /**
   * Separation of duties (Funktionentrennung, architecture §6.1). Off only in a
   * test environment, so that one person can try every role.
   */
  SEPARATION_OF_DUTIES: flag(true),
  /**
   * Where project files may be: the hosts a Projektablage link may point to,
   * comma-separated. The default allows SharePoint and OneDrive for work; a
   * test environment adds a private OneDrive (onedrive.live.com, 1drv.ms).
   */
  DOCUMENT_STORAGE_HOSTS: hostList.default(["*.sharepoint.com"]),
  SEED_DEMO: flag(false),
  SEED_SYNTHETIC_PROJECTS: z.coerce.number().int().min(0).max(5000).default(0),
  AI_PROVIDER: z.enum(["mock", "azure-openai", "anthropic"]).default("mock"),
  MOCK_AI_LATENCY_MS: z.coerce.number().int().min(0).max(60_000).default(1200),
  AZURE_OPENAI_ENDPOINT: z.url().optional(),
  AZURE_OPENAI_DEPLOYMENT_DRAFT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT_CHAT: z.string().optional(),
  /** "v1" (versionless API, default) or a dated api-version for the older deployments path. */
  AZURE_OPENAI_API_VERSION: z.string().default("v1"),
  /** Upper bound per model call, reasoning included. */
  AZURE_OPENAI_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).max(200_000).default(16_000),
  /** The same for drafts of results, which follow templates with many fields. */
  AZURE_OPENAI_DRAFT_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).max(200_000).default(32_000),
  /** Only for reasoning models (GPT-5 series; "none" from GPT-5.1, "minimal" for GPT-5); unset sends nothing. */
  AZURE_OPENAI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),
  AZURE_OPENAI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(180_000),
  /** Drafts of results run in the background, not within a request: they may take longer. */
  AZURE_OPENAI_DRAFT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(1_800_000).default(600_000),
  AZURE_OPENAI_REGION_LABEL: z.string().default("EU"),
  /**
   * Claude through the Claude API (AI_PROVIDER=anthropic): only for tests with fictional
   * data on a developer's machine, as the API processes data outside the EU (refused below).
   * The key comes from the environment, never from a file in the repository.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_DRAFT: z.string().default("claude-opus-5-5"),
  ANTHROPIC_MODEL_CHAT: z.string().default("claude-opus-5-5"),
  /** How much the model thinks before it answers; unset: the model's default. */
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(1024).max(128_000).default(16_000),
  ANTHROPIC_DRAFT_MAX_TOKENS: z.coerce.number().int().min(1024).max(128_000).default(32_000),
  /** Model calls at the same time, across all agents (agents/quota.ts). */
  AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(1).max(200).default(8),
  /** Model calls at the same time for one person, background drafts included. */
  AI_MAX_CONCURRENT_CALLS_PER_USER: z.coerce.number().int().min(1).max(200).default(3),
  /** How long a call waits for a free slot before the person is told the model is busy. */
  AI_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(30_000),
  /** The same for a draft in the background, which nobody waits for. */
  AI_BACKGROUND_QUEUE_WAIT_MS: z.coerce.number().int().min(0).max(3_600_000).default(600_000),
  /** Tokens per person and day (UTC), input and output; 0: no limit. */
  AI_DAILY_TOKENS_PER_USER: z.coerce.number().int().min(0).max(1_000_000_000).default(1_000_000),
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

/** Container Apps and App Service set these. */
export const runsInAzure = (env: Record<string, string | undefined>): boolean =>
  Boolean(env.CONTAINER_APP_NAME || env.CONTAINER_APP_JOB_NAME || env.WEBSITE_SITE_NAME);

/** Reads and checks the configuration. Refuses unsafe combinations (todo-later E18). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = schema.parse(withoutEmpty(env));
  const refuse = (message: string) => {
    throw new Error(message);
  };
  if (c.NODE_ENV === "production") {
    if (c.AUTH_MODE === "dev") refuse("AUTH_MODE=dev is not allowed with NODE_ENV=production.");
    if (c.AI_PROVIDER === "mock") refuse("AI_PROVIDER=mock is not allowed with NODE_ENV=production.");
    if (c.AI_PROVIDER === "anthropic")
      refuse("AI_PROVIDER=anthropic is not allowed with NODE_ENV=production.");
    if (c.STORE !== "sql") refuse("NODE_ENV=production needs STORE=sql.");
    if (c.SQL_AUTH !== "entra") refuse("NODE_ENV=production needs SQL_AUTH=entra (no database passwords).");
    if (c.SQL_TRUST_SERVER_CERTIFICATE) {
      refuse("SQL_TRUST_SERVER_CERTIFICATE=true is not allowed with NODE_ENV=production.");
    }
    if (c.SEED_DEMO || c.SEED_SYNTHETIC_PROJECTS > 0) {
      refuse("Demo data (SEED_DEMO, SEED_SYNTHETIC_PROJECTS) is not allowed with NODE_ENV=production.");
    }
  }
  // Dev sign-in never runs in Azure, whatever NODE_ENV says.
  const inAzure = runsInAzure(env);
  if (c.AUTH_MODE === "dev" && inAzure) refuse("AUTH_MODE=dev is not allowed in Azure.");
  if (c.AI_PROVIDER === "anthropic") {
    // The Claude API processes data in the USA or globally (decision D3: only the EU), so
    // it may see fictional data only: a developer's machine with demo projects in memory.
    if (inAzure) refuse("AI_PROVIDER=anthropic is not allowed in Azure.");
    if (c.STORE !== "memory") refuse("AI_PROVIDER=anthropic needs STORE=memory (tests with fictional data).");
    if (!c.ANTHROPIC_API_KEY) refuse("AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY in the environment.");
  }
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
