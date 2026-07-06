import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Allow room for the real DNS-failure path (http://*.invalid) to reject.
    testTimeout: 15000,
  },
});
