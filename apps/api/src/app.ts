import express, { type Request, type Response } from "express";
import cors from "cors";
import type { ApiStore } from "./store";

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

  app.get("/connections", h(async (_req, res) => {
    res.json(await store.listConnections());
  }));

  app.get("/data-stores", h(async (_req, res) => {
    res.json(await store.listDataStores());
  }));

  return app;
}
