import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    // Generated for error analysis but not referenced from the bundle.
    sourcemap: "hidden",
    // Fluent UI and React in one chunk; splitting is a later optimisation.
    chunkSizeWarningLimit: 1100,
  },
});
