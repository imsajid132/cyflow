import express, { type Request, type Response } from "express";
import cors from "cors";
import type { ApiStore } from "./store";
import { validateConnectionCredentials } from "./apps";

type Handler = (req: Request, res: Response) => Promise<void>;

/** Wrap an async handler so rejections become a 500 instead of hanging. */
function h(fn: Handler) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      console.error("[api] request failed:", err);
      if (!res.headersSent) res.status(500).json({ error: String((err as Error)?.message ?? err) });
    });
  };
}

function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return undefined;
}

export interface ApiOptions {
  /** When set, all routes except /health and /hooks require this token. */
  adminToken?: string;
}

/**
 * Build the Cyflow REST API over an ApiStore. Pure: the same routes serve the
 * Prisma store in production and the in-memory store in tests.
 *
 * Single-admin mode: if `adminToken` is set, every route except `/health` and
 * the public webhook receiver (`/hooks/:id`) requires it (Bearer or
 * `x-admin-token`). With no token the API is open (local dev / demo).
 */
export function createApp(store: ApiStore, options: ApiOptions = {}) {
  const adminToken = options.adminToken;
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  // ---- public: health ----
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "cyflow-api", auth: Boolean(adminToken) });
  });

  // ---- public: webhook trigger (runs the scenario's stored blueprint) ----
  const runHook = h(async (req, res) => {
    const scenario = await store.getScenario(req.params.id);
    if (!scenario) {
      res.status(404).json({ error: "scenario not found" });
      return;
    }
    if (scenario.status !== "ACTIVE") {
      res.status(200).json({ ok: false, reason: "scenario is not active" });
      return;
    }
    const headers = { ...(req.headers as Record<string, unknown>) };
    delete headers.authorization;
    delete headers.cookie;
    const trigger = [{ body: req.body ?? {}, headers, query: req.query, method: req.method }];
    const result = await store.runOnce(req.params.id, { trigger });
    res.status(202).json({ ok: true, executionId: result?.executionId, status: result?.status });
  });
  app.post("/hooks/:id", runHook);
  app.get("/hooks/:id", runHook);

  // ---- single-admin guard for everything below ----
  app.use((req: Request, res: Response, next) => {
    if (req.method === "OPTIONS") return next();
    if (!adminToken) return next();
    const provided = bearerToken(req) ?? req.header("x-admin-token");
    if (provided && provided === adminToken) return next();
    res.status(401).json({ error: "admin token required" });
  });

  app.get("/scenarios", h(async (_req, res) => {
    res.json(await store.listScenarios());
  }));

  app.post("/scenarios", h(async (req, res) => {
    res.status(201).json(await store.createScenario(req.body ?? {}));
  }));

  app.get("/scenarios/:id", h(async (req, res) => {
    const scenario = await store.getScenario(req.params.id);
    if (scenario) res.json(scenario);
    else res.status(404).json({ error: "scenario not found" });
  }));

  app.put("/scenarios/:id", h(async (req, res) => {
    const scenario = await store.updateScenario(req.params.id, req.body ?? {});
    if (scenario) res.json(scenario);
    else res.status(404).json({ error: "scenario not found" });
  }));

  app.delete("/scenarios/:id", h(async (req, res) => {
    const ok = await store.deleteScenario(req.params.id);
    if (ok) res.status(204).end();
    else res.status(404).json({ error: "scenario not found" });
  }));

  app.post("/scenarios/:id/run-once", h(async (req, res) => {
    const result = await store.runOnce(req.params.id, req.body ?? {});
    if (result) res.json(result);
    else res.status(404).json({ error: "scenario not found" });
  }));

  app.get("/executions", h(async (_req, res) => {
    res.json(await store.listExecutions());
  }));

  app.get("/executions/:id", h(async (req, res) => {
    const execution = await store.getExecution(req.params.id);
    if (execution) res.json(execution);
    else res.status(404).json({ error: "execution not found" });
  }));

  // ---- connections (secrets are write-only; reads are redacted summaries) ----
  app.get("/connections", h(async (_req, res) => {
    res.json(await store.listConnections());
  }));

  // Validate credentials against the live API before saving.
  app.post("/connections/test", h(async (req, res) => {
    const body = req.body ?? {};
    if (!body.appKey) {
      res.status(400).json({ error: "appKey is required" });
      return;
    }
    res.json(await store.testConnection(body.appKey, body.credentials));
  }));

  app.post("/connections", h(async (req, res) => {
    const body = req.body ?? {};
    if (!body.appKey || !body.name) {
      res.status(400).json({ error: "appKey and name are required" });
      return;
    }
    const invalid = validateConnectionCredentials(body.appKey, body.credentials);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }
    res.status(201).json(await store.createConnection(body));
  }));

  app.put("/connections/:id", h(async (req, res) => {
    const patch = req.body ?? {};
    const summary = await store.updateConnection(req.params.id, patch);
    if (summary) res.json(summary);
    else res.status(404).json({ error: "connection not found" });
  }));

  app.delete("/connections/:id", h(async (req, res) => {
    const ok = await store.deleteConnection(req.params.id);
    if (ok) res.status(204).end();
    else res.status(404).json({ error: "connection not found" });
  }));

  // ---- app directory + auth schemas (drive the connection create form) ----
  app.get("/apps", h(async (_req, res) => {
    res.json(await store.listApps());
  }));

  app.get("/apps/:key/auth", h(async (req, res) => {
    const auth = await store.getAppAuth(req.params.key);
    if (auth) res.json(auth);
    else res.status(404).json({ error: "app not found" });
  }));

  // ---- OAuth2 scaffold (client secrets stay server-side) ----
  app.get("/oauth/:provider/start", h(async (req, res) => {
    res.json(await store.oauthStart(req.params.provider));
  }));

  app.get("/oauth/:provider/callback", h(async (req, res) => {
    res.json(await store.oauthCallback(req.params.provider, req.query as Record<string, unknown>));
  }));

  app.get("/data-stores", h(async (_req, res) => {
    res.json(await store.listDataStores());
  }));

  return app;
}
