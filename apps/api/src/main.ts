/**
 * Cyflow API bootstrap. Deployable separately from the Vercel frontend.
 *
 *   pnpm --filter @cyflow/api start
 *
 * Env: DATABASE_URL (Postgres — when set, uses real persistence),
 * CYFLOW_ENCRYPTION_KEY (optional, for connections), PORT (default 3001).
 * With no DATABASE_URL the API runs an in-memory store (great for local dev /
 * demos; data is not persisted).
 */
import { createApp } from "./app";
import { InMemoryApiStore } from "./store";
import { PrismaApiStore } from "./prismaStore";
import type { ApiStore } from "./store";
import type { ScenarioDTO } from "./types";

function demoSeed(): ScenarioDTO[] {
  const now = new Date().toISOString();
  return [
    {
      id: "scn_demo",
      name: "Webhook → Delay (demo)",
      status: "ACTIVE",
      schedule: { type: "manual" },
      blueprint: {
        modules: [
          { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
          { id: "2", app: "core", operation: "sleep", kind: "action", params: { seconds: 0 }, next: null },
        ],
      },
      updatedAt: now,
    },
    {
      id: "scn_iterate",
      name: "Iterate items (demo)",
      status: "PAUSED",
      schedule: { type: "interval", minutes: 15 },
      blueprint: {
        modules: [
          { id: "1", app: "webhook", operation: "custom_webhook", kind: "trigger", params: {}, next: "2" },
          { id: "2", app: "flow", operation: "iterator", kind: "iterator", params: { array: "{{1.body.items}}" }, next: null },
        ],
      },
      updatedAt: now,
    },
  ];
}

async function main(): Promise<void> {
  let store: ApiStore;
  if (process.env.DATABASE_URL) {
    const prismaStore = new PrismaApiStore();
    await prismaStore.init();
    store = prismaStore;
    console.log("[api] persistence: Postgres (DATABASE_URL set)");
  } else {
    store = new InMemoryApiStore(demoSeed());
    console.warn("[api] persistence: in-memory (set DATABASE_URL for real persistence)");
  }

  const app = createApp(store);
  const port = Number(process.env.PORT ?? 3001);
  app.listen(port, () => {
    console.log(`[api] Cyflow API listening on :${port}`);
  });
}

main().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});
