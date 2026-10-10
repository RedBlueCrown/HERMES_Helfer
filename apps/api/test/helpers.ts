import { MODEL } from "@hermes-helfer/core";
import { MockProvider } from "../src/agents/mock-provider";
import type { AiProvider } from "../src/agents/provider";
import { createDevAuthenticator, type Authenticator } from "../src/auth";
import { loadConfig } from "../src/config";
import { ProjectRepository } from "../src/projects/repository";
import { DEV_USERS } from "../src/seed/dev-users";
import { seedDemo } from "../src/seed/seed";
import { buildServer } from "../src/server";
import { MemoryEventStore } from "../src/store/memory-event-store";

export async function testServer(
  opts: { provider?: AiProvider; authenticator?: Authenticator; seed?: boolean } = {},
) {
  const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" });
  const store = new MemoryEventStore();
  const repo = new ProjectRepository(store, MODEL);
  if (opts.seed !== false) await seedDemo(repo);
  const server = await buildServer({
    config,
    repo,
    store,
    provider: opts.provider ?? new MockProvider(0),
    authenticator: opts.authenticator ?? createDevAuthenticator(DEV_USERS),
    devUsers: DEV_USERS,
    logger: false,
  });
  const as = (user: string) => ({
    get: (url: string) => server.app.inject({ method: "GET", url, headers: { "x-dev-user": user } }),
    post: (url: string, payload: object = {}) =>
      server.app.inject({ method: "POST", url, payload, headers: { "x-dev-user": user } }),
    put: (url: string, payload: object = {}) =>
      server.app.inject({ method: "PUT", url, payload, headers: { "x-dev-user": user } }),
  });
  return { ...server, store, repo, as };
}
