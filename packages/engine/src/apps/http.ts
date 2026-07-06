import { z } from "zod";
import type { App } from "../app";
import { makeRequest } from "../modules/http";

/** Param schema for http.make_request — also drives the Phase 6 UI form. */
export const httpRequestParams = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional().default("GET"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  query: z.record(z.unknown()).optional(),
});

/** HTTP app — make arbitrary HTTP requests. */
export const httpApp: App = {
  key: "http",
  name: "HTTP",
  auth: { type: "none" },
  modules: {
    make_request: {
      key: "make_request",
      name: "Make a request",
      kind: "action",
      params: httpRequestParams,
      run: makeRequest,
    },
  },
};
