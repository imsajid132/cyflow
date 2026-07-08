/**
 * Cyflow API bootstrap. Deployable separately from the Vercel frontend.
 *
 *   pnpm --filter @cyflow/api start
 *
 * Env:
 * DATABASE_URL (Postgres — when set, uses real persistence),
 * CYFLOW_ENCRYPTION_KEY (optional, for connections),
 * PORT (default 3001).
 *
 * With no DATABASE_URL the API runs an in-memory store.
 */

import "dotenv/config";
import { existsSync } from "node:fs";

import { createApp } from "./app";
import { InMemoryApiStore } from "./store";
import { PrismaApiStore } from "./prismaStore";
import type { ApiStore } from "./store";
import type { ScenarioDTO } from "./types";
import { logConfig, readConfigStatus } from "./config";

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
          {
            id: "1",
            app: "webhook",
            operation: "custom_webhook",
            kind: "trigger",
            params: {},
            next: "2",
          },
          {
            id: "2",
            app: "core",
            operation: "sleep",
            kind: "action",
            params: { seconds: 0 },
            next: null,
          },
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
          {
            id: "1",
            app: "webhook",
            operation: "custom_webhook",
            kind: "trigger",
            params: {},
            next: "2",
          },
          {
            id: "2",
            app: "flow",
            operation: "iterator",
            kind: "iterator",
            params: {
              array: "{{1.body.items}}",
            },
            next: null,
          },
        ],
      },
      updatedAt: now,
    },
  ];
}

async function main(): Promise<void> {
  console.log("[api] loading environment...");
  
  logConfig();

  let store: ApiStore;
  let checkDatabase: (() => Promise<boolean>) | undefined;

  if (process.env.DATABASE_URL) {
    const prismaStore = new PrismaApiStore();

    await prismaStore.init();

    store = prismaStore;

    checkDatabase = () => prismaStore.pingDatabase();

    console.log("[api] persistence: Postgres (DATABASE_URL set)");
  } else {
    store = new InMemoryApiStore(demoSeed());

    console.warn(
      "[api] persistence: in-memory (set DATABASE_URL for real persistence)"
    );
  }

  const adminToken =
    process.env.ADMIN_TOKEN ?? process.env.CYFLOW_ADMIN_TOKEN;

  const google =
    store instanceof PrismaApiStore
      ? store.googleRuntime() ?? undefined
      : undefined;

  if (google?.config) {
    console.log("[api] Google OAuth: configured");
  } else if (google) {
    console.warn(
      "[api] Google OAuth: vault ready but GOOGLE_CLIENT_* not set"
    );
  }

  const microsoft =
    store instanceof PrismaApiStore
      ? store.microsoftRuntime() ?? undefined
      : undefined;

  if (microsoft?.config) {
    console.log("[api] Microsoft OAuth: configured");
  } else if (microsoft) {
    console.warn(
      "[api] Microsoft OAuth: vault ready but MICROSOFT_CLIENT_* not set"
    );
  }

  // Single-domain deploy: when the compiled frontend is present (WEB_DIST_DIR,
  // set by hostinger.entry.mjs), the API also serves the UI from "/". Unset in
  // local dev, so the API stays API-only there.
  const webDir = process.env.WEB_DIST_DIR;
  const serveWeb = webDir && existsSync(webDir) ? webDir : undefined;
  if (serveWeb) console.log(`[api] serving frontend from ${serveWeb}`);

  const app = createApp(store, {
    adminToken,
    google,
    microsoft,
    health: {
      status: readConfigStatus(),
      checkDatabase,
    },
    webDir: serveWeb,
  });

  const port = Number(process.env.PORT ?? 3001);

  app.listen(port, () => {
    console.log(
      `[api] Cyflow API listening on :${port}${
        adminToken ? " (admin-protected)" : ""
      }`
    );
  });
}

main().catch((err) => {
  console.error("[api] failed to start:", err);
  process.exit(1);
});