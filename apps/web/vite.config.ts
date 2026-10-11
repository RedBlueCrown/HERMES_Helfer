import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Explicit IPv4: "localhost" resolves to ::1 on some systems (e.g. GitHub runners).
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The end-to-end tests run a second API for the test environment (playwright.config.ts).
    proxy: { "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3001" },
  },
  build: {
    // Generated for error analysis but not referenced from the bundle.
    sourcemap: "hidden",
    // Fluent UI and React in one chunk; splitting is a later optimisation.
    chunkSizeWarningLimit: 1100,
  },
});
