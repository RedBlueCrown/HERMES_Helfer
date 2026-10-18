import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke test: starts the API (dev sign-in, mock model, demo data,
// in memory) and the Vite dev server, then drives the app in Chromium. A second
// pair runs as the test environment does (infra/test.bicepparam): no demo data,
// separation of duties off, so one person can try every role, and the
// Projektablage may be a private OneDrive.
const api = (port: number, env: Record<string, string>) => ({
  command: "npx tsx src/main.ts",
  cwd: "../api",
  url: `http://127.0.0.1:${port}/api/health`,
  env: {
    NODE_ENV: "development",
    AUTH_MODE: "dev",
    AI_PROVIDER: "mock",
    MOCK_AI_LATENCY_MS: "400",
    LOG_LEVEL: "warn",
    PORT: String(port),
    ...env,
  },
  stdout: "pipe" as const,
  reuseExistingServer: false,
  timeout: 60_000,
});
const web = (port: number, apiPort: number) => ({
  command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
  url: `http://127.0.0.1:${port}`,
  env: { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
  stdout: "pipe" as const,
  reuseExistingServer: false,
  timeout: 60_000,
});
const chrome = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } };

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    locale: "de-CH",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /staging\.spec\.ts/, use: chrome },
    {
      name: "testumgebung",
      testMatch: /staging\.spec\.ts/,
      use: { ...chrome, baseURL: "http://127.0.0.1:5174" },
    },
  ],
  webServer: [
    api(3001, { SEED_DEMO: "true", SEED_SYNTHETIC_PROJECTS: "40" }),
    web(5173, 3001),
    api(3002, {
      SEPARATION_OF_DUTIES: "false",
      DOCUMENT_STORAGE_HOSTS: "*.sharepoint.com,onedrive.live.com,1drv.ms",
    }),
    web(5174, 3002),
  ],
});
