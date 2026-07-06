import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, gapi, googleTestConnection, withQuery } from "./google-common";

/** Google Contacts connector (production, People API). Auth: Google OAuth2. */

const BASE = "https://people.googleapis.com/v1";
const FIELDS = "names,emailAddresses,phoneNumbers,organizations";
const tok = (ctx: ExecutionContext) => accessToken(ctx, "Google Contacts");

function m(k: string, name: string, kind: ModuleDef["kind"], params: z.ZodTypeAny, run: ModuleDef["run"]): ModuleDef {
  return { key: k, name, kind, params, run };
}

export const googleContactsApp: App = {
  key: "contacts",
  name: "Google Contacts",
  auth: { type: "oauth2" },
  modules: {
    list_contacts: m("list_contacts", "List contacts", "search", z.object({ pageSize: z.number().optional(), pageToken: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { pageSize?: number; pageToken?: string };
      const json = await gapi<{ connections?: unknown[]; nextPageToken?: string; totalPeople?: number }>({
        method: "GET",
        url: withQuery(`${BASE}/people/me/connections`, { personFields: FIELDS, pageSize: q.pageSize ?? 100, pageToken: q.pageToken }),
        token: tok(ctx),
      });
      return [{ contacts: json.connections ?? [], nextPageToken: json.nextPageToken, total: json.totalPeople } as Bundle];
    }),
    get_contact: m("get_contact", "Get a contact", "search", z.object({ resourceName: z.string() }), async (_i, p, ctx) => {
      const { resourceName } = p as { resourceName: string };
      return [await gapi<Bundle>({ method: "GET", url: withQuery(`${BASE}/${resourceName}`, { personFields: FIELDS }), token: tok(ctx) })];
    }),
    search_contacts: m("search_contacts", "Search contacts", "search", z.object({ query: z.string(), pageSize: z.number().optional() }), async (_i, p, ctx) => {
      const q = p as { query: string; pageSize?: number };
      const json = await gapi<{ results?: unknown[] }>({ method: "GET", url: withQuery(`${BASE}/people:searchContacts`, { query: q.query, readMask: FIELDS, pageSize: q.pageSize ?? 25 }), token: tok(ctx) });
      return [{ results: json.results ?? [] } as Bundle];
    }),
    create_contact: m("create_contact", "Create a contact", "action", z.object({ givenName: z.string(), familyName: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }), async (_i, p, ctx) => {
      const q = p as { givenName: string; familyName?: string; email?: string; phone?: string };
      const body: Record<string, unknown> = { names: [{ givenName: q.givenName, familyName: q.familyName }] };
      if (q.email) body.emailAddresses = [{ value: q.email }];
      if (q.phone) body.phoneNumbers = [{ value: q.phone }];
      return [await gapi<Bundle>({ method: "POST", url: `${BASE}/people:createContact`, token: tok(ctx), body })];
    }),
    delete_contact: m("delete_contact", "Delete a contact", "action", z.object({ resourceName: z.string() }), async (_i, p, ctx) => {
      const { resourceName } = p as { resourceName: string };
      await gapi({ method: "DELETE", url: `${BASE}/${resourceName}:deleteContact`, token: tok(ctx) });
      return [{ deleted: true, resourceName } as Bundle];
    }),
  },
  testConnection: googleTestConnection,
};
