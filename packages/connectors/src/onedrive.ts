import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { apiJson, buildUrl, requireCredential } from "./util";

/** OneDrive connector (production, Microsoft Graph). Auth: Microsoft OAuth2. */

const DRIVE = "https://graph.microsoft.com/v1.0/me/drive";
const tok = (ctx: ExecutionContext) => requireCredential(ctx, ["access_token", "accessToken", "token"], "OneDrive");
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}
/** Graph addresses items either by id (items/{id}) or by path (root:/path:). */
function itemRef(pathOrId: string, byPath: boolean): string {
  return byPath ? `${DRIVE}/root:/${encodeURI(pathOrId.replace(/^\//, ""))}` : `${DRIVE}/items/${pathOrId}`;
}

export const onedriveApp: App = {
  key: "onedrive",
  name: "OneDrive",
  auth: { type: "oauth2" },
  modules: {
    list_children: m("list_children", "List a folder", "search", z.object({ path: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { path?: string };
      const url = q.path && q.path !== "/" ? `${itemRef(q.path, true)}:/children` : `${DRIVE}/root/children`;
      const json = await apiJson<{ value?: unknown[]; "@odata.nextLink"?: string }>({ method: "GET", url, headers: bearer(tok(ctx)) });
      return [{ items: json.value ?? [], nextLink: json["@odata.nextLink"] } as Bundle];
    }),
    get_item: m("get_item", "Get an item", "search", z.object({ itemId: z.string() }), async (_i, p, ctx) => {
      const { itemId } = p as { itemId: string };
      return [await apiJson<Bundle>({ method: "GET", url: `${DRIVE}/items/${itemId}`, headers: bearer(tok(ctx)) })];
    }),
    search: m("search", "Search files", "search", z.object({ query: z.string() }), async (_i, p, ctx) => {
      const { query } = p as { query: string };
      const json = await apiJson<{ value?: unknown[] }>({ method: "GET", url: `${DRIVE}/root/search(q='${encodeURIComponent(query)}')`, headers: bearer(tok(ctx)) });
      return [{ items: json.value ?? [] } as Bundle];
    }),
    upload_file: m("upload_file", "Upload a small file", "action", z.object({ path: z.string(), content: z.string(), contentType: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { path: string; content: string; contentType?: string };
      const res = await fetch(`${itemRef(q.path, true)}:/content`, { method: "PUT", headers: { ...bearer(tok(ctx)), "content-type": q.contentType ?? "text/plain" }, body: q.content });
      const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string; webUrl?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(`OneDrive ${res.status}: ${json.error?.message ?? res.statusText}`);
      return [{ id: json.id, name: json.name, webUrl: json.webUrl } as Bundle];
    }),
    download_file: m("download_file", "Download a file", "search", z.object({ itemId: z.string() }), async (_i, p, ctx) => {
      const { itemId } = p as { itemId: string };
      const res = await fetch(`${DRIVE}/items/${itemId}/content`, { headers: bearer(tok(ctx)) });
      if (!res.ok) throw new Error(`OneDrive ${res.status}: ${res.statusText}`);
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return [{ itemId, base64 } as Bundle];
    }),
    create_folder: m("create_folder", "Create a folder", "action", z.object({ parentPath: z.string().optional(), name: z.string() }), async (_i, p, ctx) => {
      const q = p as { parentPath?: string; name: string };
      const url = q.parentPath && q.parentPath !== "/" ? `${itemRef(q.parentPath, true)}:/children` : `${DRIVE}/root/children`;
      const json = await apiJson<{ id?: string; name?: string }>({ method: "POST", url, headers: bearer(tok(ctx)), body: { name: q.name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" } });
      return [{ id: json.id, name: json.name } as Bundle];
    }),
    delete_item: m("delete_item", "Delete an item", "action", z.object({ itemId: z.string() }), async (_i, p, ctx) => {
      const { itemId } = p as { itemId: string };
      await apiJson({ method: "DELETE", url: `${DRIVE}/items/${itemId}`, headers: bearer(tok(ctx)) });
      return [{ deleted: true, itemId } as Bundle];
    }),
  },
};
