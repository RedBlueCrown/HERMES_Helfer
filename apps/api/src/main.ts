import { MODEL } from "@hermes-helfer/core";
import { AzureOpenAiProvider, entraTokenSource } from "./agents/azure-openai-provider";
import { MockProvider } from "./agents/mock-provider";
import type { AiProvider } from "./agents/provider";
import { createDevAuthenticator, createEntraAuthenticator } from "./auth";
import { loadConfig } from "./config";
import { ProjectRepository } from "./projects/repository";
import { DEV_USERS } from "./seed/dev-users";
import { seedDemo, seedSynthetic } from "./seed/seed";
import { buildServer } from "./server";
import { MemoryEventStore } from "./store/event-store";

const config = loadConfig();

const corrupt: string[] = [];
const store = new MemoryEventStore({
  ...(config.DATA_DIR ? { dataDir: config.DATA_DIR } : {}),
  onCorruptProject: (projectId) => corrupt.push(projectId),
});
const repo = new ProjectRepository(store, MODEL);

const provider: AiProvider =
  config.AI_PROVIDER === "mock"
    ? new MockProvider(config.MOCK_AI_LATENCY_MS)
    : new AzureOpenAiProvider(
        {
          endpoint: config.AZURE_OPENAI_ENDPOINT!,
          draftDeployment: config.AZURE_OPENAI_DEPLOYMENT_DRAFT!,
          chatDeployment: config.AZURE_OPENAI_DEPLOYMENT_CHAT!,
          apiVersion: config.AZURE_OPENAI_API_VERSION,
          regionLabel: config.AZURE_OPENAI_REGION_LABEL,
        },
        entraTokenSource(),
      );

const authenticator =
  config.AUTH_MODE === "dev"
    ? createDevAuthenticator(DEV_USERS)
    : createEntraAuthenticator({
        tenantId: config.ENTRA_TENANT_ID!,
        clientId: config.ENTRA_API_CLIENT_ID!,
        requiredScope: config.ENTRA_REQUIRED_SCOPE,
      });

const { app, runs } = await buildServer({
  config,
  repo,
  provider,
  authenticator,
  ...(config.AUTH_MODE === "dev" ? { devUsers: DEV_USERS } : {}),
});

for (const projectId of corrupt) {
  // todo-later E11: alert ISM and SOC instead of only logging.
  app.log.error(
    { projectId, result: store.quarantined.get(projectId) },
    "project failed integrity check and is not served",
  );
}
if (config.AUTH_MODE === "dev")
  app.log.warn("AUTH_MODE=dev: sign-in with fictional dev users. Never use in production.");

if (config.SEED_DEMO && repo.all().length === 0) {
  await seedDemo(repo);
  app.log.info("seeded demo projects");
}
if (config.SEED_SYNTHETIC_PROJECTS > 0) {
  await seedSynthetic(repo, config.SEED_SYNTHETIC_PROJECTS);
}
const recovered = await runs.recover();
if (recovered) app.log.warn({ recovered }, "closed agent runs interrupted by a restart");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await Promise.race([runs.idle(), new Promise((r) => setTimeout(r, 10_000))]);
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
