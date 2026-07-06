import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    // Transform the workspace engine source (TS) rather than treating it as an
    // externalised node_module. `functions` is inlined too (engine imports it).
    server: { deps: { inline: ["engine", "functions", "@cyflow/shared"] } },
  },
});
