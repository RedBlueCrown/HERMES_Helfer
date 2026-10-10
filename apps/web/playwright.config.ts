import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke test: starts the API (dev sign-in, mock model, demo data,
// in memory) and the Vite dev server, then drives the app in Chromium.
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
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    {
      command: "npx tsx src/main.ts",
      cwd: "../api",
      url: "http://127.0.0.1:3001/api/health",
      env: {
        NODE_ENV: "development",
        AUTH_MODE: "dev",
        AI_PROVIDER: "mock",
        MOCK_AI_LATENCY_MS: "400",
        SEED_DEMO: "true",
        SEED_SYNTHETIC_PROJECTS: "40",
        LOG_LEVEL: "warn",
        PORT: "3001",
      },
      stdout: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      stdout: "pipe",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
