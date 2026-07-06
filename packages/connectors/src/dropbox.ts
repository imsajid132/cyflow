import { z } from "zod";
import type { App, ModuleDef, TestConnectionResult } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, compact, requireCredential } from "./util";

/** Dropbox connector (production). Auth: OAuth2 access token (bearer). */

const RPC = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["token", "access_token"], "Dropbox");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function m(key: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key, name, kind, params, run };
}

async function testConnection(credentials: Record<string, unknown>): Promise<TestConnectionResult> {
  const token = (typeof credentials.access_token === "string" && credentials.access_token) || (typeof credentials.token === "string" && credentials.token) || "";
  if (!token) return { ok: false, message: "Missing access token." };
  try {
    const me = await apiJson<{ name?: { display_name?: string }; email?: string }>({ method: "POST", url: `${RPC}/users/get_current_account`, headers: bearer(token) });
    return { ok: true, message: `Connected as ${me.name?.display_name ?? me.email ?? "Dropbox account"}` };
  } catch (e) {
    return { ok: false, message: String((e as Error).message) };
  }
}

export const dropboxApp: App = {
  key: "dropbox",
  name: "Dropbox",
  auth: { type: "api_key", fields: [{ key: "token", label: "Access token", type: "password", required: true }] },
  modules: {
    list_folder: m("list_folder", "List a folder", "search", z.object({ path: z.string() }), async (_i, p, ctx) => {
      const { path } = p as { path: string };
      const json = await apiJson<{ entries?: unknown[]; cursor?: string; has_more?: boolean }>({ method: "POST", url: `${RPC}/files/list_folder`, headers: bearer(tok(ctx)), body: { path: path === "/" ? "" : path } });
      return [{ entries: json.entries ?? [], cursor: json.cursor, hasMore: json.has_more ?? false } as Bundle];
    }),
    get_metadata: m("get_metadata", "Get metadata", "search", z.object({ path: z.string() }), async (_i, p, ctx) => {
      const { path } = p as { path: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${RPC}/files/get_metadata`, headers: bearer(tok(ctx)), body: { path } })];
    }),
    create_folder: m("create_folder", "Create a folder", "action", z.object({ path: z.string() }), async (_i, p, ctx) => {
      const { path } = p as { path: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${RPC}/files/create_folder_v2`, headers: bearer(tok(ctx)), body: { path } })];
    }),
    delete_file: m("delete_file", "Delete a file/folder", "action", z.object({ path: z.string() }), async (_i, p, ctx) => {
      const { path } = p as { path: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${RPC}/files/delete_v2`, headers: bearer(tok(ctx)), body: { path } })];
    }),
    move_file: m("move_file", "Move a file", "action", z.object({ fromPath: z.string(), toPath: z.string() }), async (_i, p, ctx) => {
      const q = p as { fromPath: string; toPath: string };
      return [await apiJson<Bundle>({ method: "POST", url: `${RPC}/files/move_v2`, headers: bearer(tok(ctx)), body: { from_path: q.fromPath, to_path: q.toPath, autorename: true } })];
    }),
    upload_file: m("upload_file", "Upload a file", "action", z.object({ path: z.string(), content: z.string(), mode: z.enum(["add", "overwrite"]).optional() }), async (_i, p, ctx) => {
      const q = p as { path: string; content: string; mode?: string };
      const res = await fetch(`${CONTENT}/files/upload`, {
        method: "POST",
        headers: { ...bearer(tok(ctx)), "content-type": "application/octet-stream", "dropbox-api-arg": JSON.stringify(compact({ path: q.path, mode: q.mode ?? "overwrite", mute: true })) },
        body: q.content ?? "",
      });
      const json = (await res.json().catch(() => ({}))) as { error_summary?: string; id?: string; name?: string };
      if (!res.ok) throw new Error(`Dropbox ${res.status}: ${json.error_summary ?? res.statusText}`);
      return [{ id: json.id, name: json.name, path: q.path } as Bundle];
    }),
    download_file: m("download_file", "Download a file", "search", z.object({ path: z.string() }), async (_i, p, ctx) => {
      const { path } = p as { path: string };
      const res = await fetch(`${CONTENT}/files/download`, { method: "POST", headers: { ...bearer(tok(ctx)), "dropbox-api-arg": JSON.stringify({ path }) } });
      if (!res.ok) throw new Error(`Dropbox ${res.status}: ${res.statusText}`);
      const meta = res.headers.get("dropbox-api-result");
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return [{ path, base64, metadata: meta ? JSON.parse(meta) : undefined } as Bundle];
    }),
  },
  testConnection,
};
