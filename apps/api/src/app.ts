import express, { type Request, type Response } from "express";
import path from "node:path";
import cors from "cors";
import {
  ConnectionService,
  EncryptionService,
  GOOGLE_APPS,
  GOOGLE_LABELS,
  googleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleEmail,
  makeOAuthState,
  readOAuthState,
  tokensToCredentials,
  type GoogleConfig,
  MICROSOFT_APPS,
  MICROSOFT_LABELS,
  microsoftAuthorizeUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftEmail,
  makeMicrosoftState,
  readMicrosoftState,
  type MicrosoftConfig,
} from "@cyflow/connections";
import type { ApiStore } from "./store";
import { validateConnectionCredentials } from "./apps";
import type { ConfigStatus } from "./config";

/** Everything the Google OAuth routes need (built server-side; secrets stay here). */
export interface GoogleRuntime {
  config: GoogleConfig | null;
  encryption: EncryptionService;
  connections: ConnectionService;
  /** Which user new connections are saved for (single-admin ⇒ the admin user). */
  userId: string;
}

/** Everything the Microsoft OAuth routes need (client secret stays server-side). */
export interface MicrosoftRuntime {
  config: MicrosoftConfig | null;
  encryption: EncryptionService;
  connections: ConnectionService;
  userId: string;
}

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
  /** Enables the real Google OAuth routes when provided. */
  google?: GoogleRuntime;
  /** Enables the real Microsoft OAuth routes when provided. */
  microsoft?: MicrosoftRuntime;
  /** Redacted config status + optional live DB ping, surfaced on GET /health. */
  health?: {
    status: ConfigStatus;
    checkDatabase?: () => Promise<boolean>;
  };
  /**
   * When set, the built frontend in this directory is served from the same
   * origin as the API (single-domain deploy): static assets + an SPA fallback
   * that returns index.html for non-API navigations. Left unset (tests, local
   * API-only dev) the API behaves exactly as before — no static serving.
   */
  webDir?: string;
}

/** Top-level route prefixes owned by the API — never served the SPA shell. */
const API_PREFIXES = [
  "/health",
  "/hooks",
  "/oauth",
  "/scenarios",
  "/executions",
  "/connections",
  "/apps",
  "/data-stores",
  "/api",
];

function isApiPath(p: string): boolean {
  return API_PREFIXES.some((pre) => p === pre || p.startsWith(pre + "/"));
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

  // ---- public: built frontend (single-domain deploy) ----
  // Serves existing static files only (index.html at "/", hashed assets). A
  // request that isn't a file (e.g. /scenarios) falls through to the API routes.
  if (options.webDir) {
    app.use(express.static(options.webDir));
  }

  // ---- public: health ----
  app.get("/health", h(async (_req: Request, res: Response) => {
    const base = { status: "ok", service: "cyflow-api", auth: Boolean(adminToken) };
    if (!options.health) {
      res.json(base);
      return;
    }
    let database = options.health.status.database;
    if (options.health.checkDatabase) {
      try {
        database = await options.health.checkDatabase();
      } catch {
        database = false;
      }
    }
    res.json({ ...base, config: { ...options.health.status, database } });
  }));

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

  // ---- public: Google OAuth callback (Google → browser → here, no token) ----
  if (options.google) {
    const g = options.google;
    app.get("/oauth/google/callback", h(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const web = g.config?.webUrl?.replace(/\/$/, "");
      const back = (params: string): boolean => {
        if (web) {
          res.redirect(`${web}/?${params}#/connections`);
          return true;
        }
        return false;
      };
      if (!g.config) {
        if (!back("google_error=not_configured")) res.status(400).json({ ok: false, error: "Google OAuth not configured" });
        return;
      }
      if (q.error) {
        if (!back(`google_error=${encodeURIComponent(q.error)}`)) res.status(400).json({ ok: false, error: q.error });
        return;
      }
      const st = readOAuthState(g.encryption, q.state);
      if (!st || !q.code) {
        if (!back("google_error=invalid_state")) res.status(400).json({ ok: false, error: "invalid state" });
        return;
      }
      try {
        const tokens = await exchangeGoogleCode(g.config, q.code);
        const email = await fetchGoogleEmail(tokens.accessToken);
        const creds = tokensToCredentials(tokens, email);
        const label = GOOGLE_LABELS[st.app] ?? st.app;
        const summary = await g.connections.create({
          userId: g.userId,
          appKey: st.app,
          name: `${label}${email ? ` · ${email}` : ""}`,
          credentials: creds as unknown as Record<string, unknown>,
        });
        if (!back(`google=${st.app}`)) res.json({ ok: true, app: st.app, connectionId: summary.id });
      } catch (e) {
        const msg = String((e as Error).message);
        if (!back(`google_error=${encodeURIComponent(msg)}`)) res.status(500).json({ ok: false, error: msg });
      }
    }));
  }

  // ---- public: Microsoft OAuth callback (Microsoft → browser → here, no token) ----
  if (options.microsoft) {
    const ms = options.microsoft;
    app.get("/oauth/microsoft/callback", h(async (req, res) => {
      const q = req.query as Record<string, string | undefined>;
      const web = ms.config?.webUrl?.replace(/\/$/, "");
      const back = (params: string): boolean => {
        if (web) {
          res.redirect(`${web}/?${params}#/connections`);
          return true;
        }
        return false;
      };
      if (!ms.config) {
        if (!back("ms_error=not_configured")) res.status(400).json({ ok: false, error: "Microsoft OAuth not configured" });
        return;
      }
      if (q.error) {
        if (!back(`ms_error=${encodeURIComponent(q.error)}`)) res.status(400).json({ ok: false, error: q.error });
        return;
      }
      const st = readMicrosoftState(ms.encryption, q.state);
      if (!st || !q.code) {
        if (!back("ms_error=invalid_state")) res.status(400).json({ ok: false, error: "invalid state" });
        return;
      }
      try {
        const tokens = await exchangeMicrosoftCode(ms.config, q.code);
        const email = await fetchMicrosoftEmail(tokens.accessToken);
        const creds = tokensToCredentials(tokens, email);
        const label = MICROSOFT_LABELS[st.app] ?? st.app;
        const summary = await ms.connections.create({
          userId: ms.userId,
          appKey: st.app,
          name: `${label}${email ? ` · ${email}` : ""}`,
          credentials: creds as unknown as Record<string, unknown>,
        });
        if (!back(`ms=${st.app}`)) res.json({ ok: true, app: st.app, connectionId: summary.id });
      } catch (e) {
        const msg = String((e as Error).message);
        if (!back(`ms_error=${encodeURIComponent(msg)}`)) res.status(500).json({ ok: false, error: msg });
      }
    }));
  }

  // ---- public: SPA fallback (frontend routes only, never API/OAuth/hooks) ----
  // Runs before the admin guard so loading the app never needs a token; API
  // paths are excluded so they reach their (guarded) handlers below.
  if (options.webDir) {
    const indexHtml = path.join(options.webDir, "index.html");
    app.use((req: Request, res: Response, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (isApiPath(req.path)) return next();
      res.sendFile(indexHtml);
    });
  }

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

  // ---- Google OAuth start (protected; returns the real consent URL) ----
  if (options.google) {
    const g = options.google;
    app.get("/oauth/google/start", h(async (req, res) => {
      const appKey = String(req.query.app ?? "gmail");
      if (!GOOGLE_APPS.has(appKey)) {
        res.status(400).json({ error: "unknown google app" });
        return;
      }
      if (!g.config) {
        res.json({ configured: false, message: "Google OAuth is not configured on the server (set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI)." });
        return;
      }
      const state = makeOAuthState(g.encryption, appKey);
      res.json({ configured: true, authUrl: googleAuthorizeUrl(g.config, appKey, state), message: "Redirect the user to Google to authorize." });
    }));
  }

  // ---- Microsoft OAuth start (protected; returns the real consent URL) ----
  if (options.microsoft) {
    const ms = options.microsoft;
    app.get("/oauth/microsoft/start", h(async (req, res) => {
      const appKey = String(req.query.app ?? "outlook");
      if (!MICROSOFT_APPS.has(appKey)) {
        res.status(400).json({ error: "unknown microsoft app" });
        return;
      }
      if (!ms.config) {
        res.json({ configured: false, message: "Microsoft OAuth is not configured on the server (set MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI)." });
        return;
      }
      const state = makeMicrosoftState(ms.encryption, appKey);
      res.json({ configured: true, authUrl: microsoftAuthorizeUrl(ms.config, appKey, state), message: "Redirect the user to Microsoft to authorize." });
    }));
  }

  // ---- OAuth2 scaffold for other providers (client secrets stay server-side) ----
  app.get("/oauth/:provider/start", h(async (req, res) => {
    res.json(await store.oauthStart(req.params.provider));
  }));

  app.get("/oauth/:provider/callback", h(async (req, res) => {
    res.json(await store.oauthCallback(req.params.provider, req.query as Record<string, unknown>));
  }));

  // ---- data stores (named key-value storage; records are durable) ----
  app.get("/data-stores", h(async (_req, res) => {
    res.json(await store.listDataStores());
  }));

  app.post("/data-stores", h(async (req, res) => {
    const body = req.body ?? {};
    res.status(201).json(await store.createDataStore(String(body.name ?? "New store"), body.id));
  }));

  app.delete("/data-stores/:id", h(async (req, res) => {
    const ok = await store.deleteDataStore(req.params.id);
    if (ok) res.status(204).end();
    else res.status(404).json({ error: "data store not found or not deletable" });
  }));

  app.get("/data-stores/:id/records", h(async (req, res) => {
    const records = await store.listDataStoreRecords(req.params.id);
    if (records) res.json(records);
    else res.status(404).json({ error: "data store not found" });
  }));

  app.post("/data-stores/:id/records", h(async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.key !== "string" || !body.key) {
      res.status(400).json({ error: "key is required" });
      return;
    }
    const record = await store.upsertDataStoreRecord(req.params.id, body.key, body.value);
    if (record) res.status(201).json(record);
    else res.status(404).json({ error: "data store not found" });
  }));

  app.delete("/data-stores/:id/records", h(async (req, res) => {
    const key = String(req.query.key ?? "");
    if (!key) {
      res.status(400).json({ error: "key query param is required" });
      return;
    }
    const ok = await store.deleteDataStoreRecord(req.params.id, key);
    if (ok) res.status(204).end();
    else res.status(404).json({ error: "record not found" });
  }));

  return app;
}
