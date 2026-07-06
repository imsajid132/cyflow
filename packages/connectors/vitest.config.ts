import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // engine is a workspace package consumed as TS source.
    server: { deps: { inline: ["engine", "functions", "@cyflow/shared"] } },
  },
});
