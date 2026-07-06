import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    // Inline the TS workspace engine (and its deps) so vitest transforms the
    // source rather than treating it as an externalised node_module.
    server: { deps: { inline: ["engine", "functions", "@cyflow/shared"] } },
  },
});
