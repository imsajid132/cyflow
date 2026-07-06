import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, compact, gapi, googleTestConnection, withQuery } from "./google-common";

/** Google Tasks connector (production). Auth: Google OAuth2. */

const BASE = "https://tasks.googleapis.com/tasks/v1";
const tok = (ctx: ExecutionContext) => accessToken(ctx, "Google Tasks");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const googleTasksApp: App = {
  key: "tasks",
  name: "Google Tasks",
  auth: { type: "oauth2" },
  modules: {
    list_tasklists: m("list_tasklists", "List task lists", "search", z.object({}), async (_i, _p, ctx) => {
      const json = await gapi<{ items?: unknown[] }>({ method: "GET", url: `${BASE}/users/@me/lists`, token: tok(ctx) });
      return [{ taskLists: json.items ?? [] } as Bundle];
    }),
    list_tasks: m("list_tasks", "List tasks", "search", z.object({ tasklist: z.string(), showCompleted: z.boolean().optional() }), async (_i, p, ctx) => {
      const q = p as { tasklist: string; showCompleted?: boolean };
      const json = await gapi<{ items?: unknown[]; nextPageToken?: string }>({ method: "GET", url: withQuery(`${BASE}/lists/${q.tasklist}/tasks`, { showCompleted: q.showCompleted ?? true }), token: tok(ctx) });
      return [{ tasks: json.items ?? [] } as Bundle];
    }),
    get_task: m("get_task", "Get a task", "search", z.object({ tasklist: z.string(), task: z.string() }), async (_i, p, ctx) => {
      const q = p as { tasklist: string; task: string };
      return [await gapi<Bundle>({ method: "GET", url: `${BASE}/lists/${q.tasklist}/tasks/${q.task}`, token: tok(ctx) })];
    }),
    create_task: m("create_task", "Create a task", "action", z.object({ tasklist: z.string(), title: z.string(), notes: z.string().optional(), due: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { tasklist: string; title: string; notes?: string; due?: string };
      return [await gapi<Bundle>({ method: "POST", url: `${BASE}/lists/${q.tasklist}/tasks`, token: tok(ctx), body: compact({ title: q.title, notes: q.notes, due: q.due }) })];
    }),
    update_task: m("update_task", "Update a task", "action", z.object({ tasklist: z.string(), task: z.string(), title: z.string().optional(), notes: z.string().optional(), status: z.enum(["needsAction", "completed"]).optional() }), async (_i, p, ctx) => {
      const q = p as { tasklist: string; task: string; title?: string; notes?: string; status?: string };
      return [await gapi<Bundle>({ method: "PATCH", url: `${BASE}/lists/${q.tasklist}/tasks/${q.task}`, token: tok(ctx), body: compact({ title: q.title, notes: q.notes, status: q.status }) })];
    }),
    delete_task: m("delete_task", "Delete a task", "action", z.object({ tasklist: z.string(), task: z.string() }), async (_i, p, ctx) => {
      const q = p as { tasklist: string; task: string };
      await gapi({ method: "DELETE", url: `${BASE}/lists/${q.tasklist}/tasks/${q.task}`, token: tok(ctx) });
      return [{ deleted: true, task: q.task } as Bundle];
    }),
  },
  testConnection: googleTestConnection,
};
