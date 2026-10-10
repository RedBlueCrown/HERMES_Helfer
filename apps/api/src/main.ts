import type { TokenCredential } from "@azure/identity";
import { MODEL } from "@hermes-helfer/core";
import { AzureOpenAiProvider, entraTokenSource } from "./agents/azure-openai-provider";
import { MockProvider } from "./agents/mock-provider";
import type { AiProvider } from "./agents/provider";
import { createDevAuthenticator, createEntraAuthenticator } from "./auth";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { ProjectRepository } from "./projects/repository";
import { DEV_USERS } from "./seed/dev-users";
import { seedDemo, seedSynthetic } from "./seed/seed";
import { buildServer } from "./server";
import { createStore } from "./store/create-store";
import { azureCredential } from "./util/azure-credential";

const config = loadConfig();
const log = createLogger(config);

let credential: Promise<TokenCredential> | undefined;
const getCredential = () =>
  (credential ??= azureCredential({
    managedIdentityOnly: config.NODE_ENV === "production",
    clientId: config.AZURE_CLIENT_ID,
  }));

const store = await createStore(config, log, getCredential);
const repo = new ProjectRepository(store, MODEL, {
  // todo-later E11: alert ISM and SOC instead of only logging.
  onCorruptProject: (projectId, result) =>
    log.error({ projectId, result }, "project failed integrity check and is not served"),
});
await repo.load();

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
        entraTokenSource(getCredential),
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
  store,
  provider,
  authenticator,
  logger: log,
  ...(config.AUTH_MODE === "dev" ? { devUsers: DEV_USERS } : {}),
});

if (config.AUTH_MODE === "dev")
  log.warn("AUTH_MODE=dev: sign-in with fictional dev users. Never use in production.");

if (config.SEED_DEMO && (await repo.all()).length === 0) {
  await seedDemo(repo);
  log.info("seeded demo projects");
}
if (config.SEED_SYNTHETIC_PROJECTS > 0) {
  await seedSynthetic(repo, config.SEED_SYNTHETIC_PROJECTS);
}
const recovered = await runs.recover();
if (recovered) log.warn({ recovered }, "closed agent runs interrupted by a restart");

const shutdown = async (signal: string) => {
  log.info({ signal }, "shutting down");
  await app.close();
  await Promise.race([runs.idle(), new Promise((r) => setTimeout(r, 10_000))]);
  await store.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.HOST, port: config.PORT });
