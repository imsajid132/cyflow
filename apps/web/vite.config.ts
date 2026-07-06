import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The Cyflow engine, expression engine, and shared types are framework-agnostic
// and browser-safe, so the UI imports them directly (aliased to their TS source)
// and runs the REAL engine for "Run Once". apps/web stays npm-standalone.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@cyflow/shared": fromHere("../../packages/shared/src/index.ts"),
      functions: fromHere("../../packages/functions/src/index.ts"),
      engine: fromHere("../../packages/engine/src/index.ts"),
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: { allow: [fromHere("../../")] },
  },
});
