import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("true")
  .transform((v) => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  AUTH_MODE: z.enum(["entra", "dev"]).default("dev"),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_API_CLIENT_ID: z.string().optional(),
  ENTRA_REQUIRED_SCOPE: z.string().default("access_as_user"),
  DATA_DIR: z.string().optional(),
  SEED_DEMO: bool,
  SEED_SYNTHETIC_PROJECTS: z.coerce.number().int().min(0).max(5000).default(0),
  AI_PROVIDER: z.enum(["mock", "azure-openai"]).default("mock"),
  MOCK_AI_LATENCY_MS: z.coerce.number().int().min(0).max(60_000).default(1200),
  AZURE_OPENAI_ENDPOINT: z.url().optional(),
  AZURE_OPENAI_DEPLOYMENT_DRAFT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT_CHAT: z.string().optional(),
  AZURE_OPENAI_API_VERSION: z.string().default("2024-10-21"),
  AZURE_OPENAI_REGION_LABEL: z.string().default("EU"),
  WEB_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

/** Reads and checks the configuration. Refuses unsafe combinations (todo-later E18). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = schema.parse(env);
  if (c.NODE_ENV === "production" && c.AUTH_MODE === "dev") {
    throw new Error("AUTH_MODE=dev is not allowed with NODE_ENV=production.");
  }
  if (c.NODE_ENV === "production" && c.AI_PROVIDER === "mock") {
    throw new Error("AI_PROVIDER=mock is not allowed with NODE_ENV=production.");
  }
  if (c.AUTH_MODE === "entra" && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_CLIENT_ID)) {
    throw new Error("AUTH_MODE=entra needs ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID.");
  }
  if (
    c.AI_PROVIDER === "azure-openai" &&
    (!c.AZURE_OPENAI_ENDPOINT || !c.AZURE_OPENAI_DEPLOYMENT_DRAFT || !c.AZURE_OPENAI_DEPLOYMENT_CHAT)
  ) {
    throw new Error(
      "AI_PROVIDER=azure-openai needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT_DRAFT and AZURE_OPENAI_DEPLOYMENT_CHAT.",
    );
  }
  return c;
}
