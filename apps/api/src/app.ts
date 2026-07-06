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

/**
 * Build the Cyflow REST API over an ApiStore. Pure: the same routes serve the
 * Prisma store in production and the in-memory store in tests.
 */
export function createApp(store: ApiStore) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", service: "cyflow-api" });
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
