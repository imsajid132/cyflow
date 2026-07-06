import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Allow room for the real DNS-failure path (http://*.invalid) to reject.
    testTimeout: 15000,
    // Transform the workspace `functions` source (TS) rather than externalising it.
    server: { deps: { inline: ["functions"] } },
  },
});
