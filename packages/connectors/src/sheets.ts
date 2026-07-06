import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, ExecutionContext } from "@cyflow/shared";
import { accessToken, gapi, googleTestConnection, withQuery } from "./google-common";

/** Google Sheets connector (production). Auth: Google OAuth2 (Phase B). */

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

const listSpreadsheets: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { query?: string; pageToken?: string; pageSize?: number };
  const q = ["mimeType='application/vnd.google-apps.spreadsheet'", "trashed=false", p.query ? `name contains '${String(p.query).replace(/'/g, "\\'")}'` : ""]
    .filter(Boolean)
    .join(" and ");
  const json = await gapi<{ files?: { id: string; name: string }[]; nextPageToken?: string }>({
    method: "GET",
    url: withQuery(DRIVE, { q, fields: "files(id,name,modifiedTime),nextPageToken", pageSize: p.pageSize ?? 50, pageToken: p.pageToken }),
    token,
  });
  return [{ spreadsheets: json.files ?? [], nextPageToken: json.nextPageToken } as Bundle];
};

const listSheets: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { spreadsheetId: string };
  const json = await gapi<{ sheets?: { properties: { sheetId: number; title: string; index: number } }[] }>({
    method: "GET",
    url: withQuery(`${SHEETS}/${encodeURIComponent(p.spreadsheetId)}`, { fields: "sheets.properties(sheetId,title,index,gridProperties)" }),
    token,
  });
  return [{ sheets: (json.sheets ?? []).map((s) => s.properties) } as Bundle];
};

const readRange: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { spreadsheetId: string; range: string };
  const json = await gapi<{ range?: string; values?: unknown[][] }>({
    method: "GET",
    url: `${SHEETS}/${encodeURIComponent(p.spreadsheetId)}/values/${encodeURIComponent(p.range)}`,
    token,
  });
  return [{ range: json.range, values: json.values ?? [], rowCount: (json.values ?? []).length } as Bundle];
};

const appendRow: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { spreadsheetId: string; range: string; values: unknown[] };
  const json = await gapi<{ updates?: { updatedRange?: string; updatedRows?: number } }>({
    method: "POST",
    url: withQuery(`${SHEETS}/${encodeURIComponent(p.spreadsheetId)}/values/${encodeURIComponent(p.range)}:append`, {
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    }),
    token,
    body: { values: [Array.isArray(p.values) ? p.values : [p.values]] },
  });
  return [{ updatedRange: json.updates?.updatedRange, updatedRows: json.updates?.updatedRows } as Bundle];
};

const updateRange: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { spreadsheetId: string; range: string; values: unknown[][] };
  const json = await gapi<{ updatedRange?: string; updatedCells?: number }>({
    method: "PUT",
    url: withQuery(`${SHEETS}/${encodeURIComponent(p.spreadsheetId)}/values/${encodeURIComponent(p.range)}`, { valueInputOption: "USER_ENTERED" }),
    token,
    body: { values: Array.isArray(p.values) ? p.values : [] },
  });
  return [{ updatedRange: json.updatedRange, updatedCells: json.updatedCells } as Bundle];
};

const searchRows: ModuleDef["run"] = async (_i, params, ctx: ExecutionContext) => {
  const token = accessToken(ctx, "Google Sheets");
  const p = params as { spreadsheetId: string; range: string; column: number; value: string };
  const json = await gapi<{ values?: unknown[][] }>({
    method: "GET",
    url: `${SHEETS}/${encodeURIComponent(p.spreadsheetId)}/values/${encodeURIComponent(p.range)}`,
    token,
  });
  const col = Number(p.column) || 0;
  const needle = String(p.value ?? "").trim();
  const matches = (json.values ?? [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => String(row[col] ?? "").trim() === needle);
  return [{ matches, count: matches.length } as Bundle];
};

export const sheetsApp: App = {
  key: "sheets",
  name: "Google Sheets",
  auth: { type: "oauth2" },
  modules: {
    list_spreadsheets: { key: "list_spreadsheets", name: "List spreadsheets", kind: "search", params: z.object({ query: z.string().optional(), pageToken: z.string().optional(), pageSize: z.number().optional() }), run: listSpreadsheets },
    list_sheets: { key: "list_sheets", name: "List sheets", kind: "search", params: z.object({ spreadsheetId: z.string() }), run: listSheets },
    read_range: { key: "read_range", name: "Read a range", kind: "search", params: z.object({ spreadsheetId: z.string(), range: z.string() }), run: readRange },
    append_row: { key: "append_row", name: "Append a row", kind: "action", params: z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.any()) }), run: appendRow },
    update_range: { key: "update_range", name: "Update a range", kind: "action", params: z.object({ spreadsheetId: z.string(), range: z.string(), values: z.array(z.array(z.any())) }), run: updateRange },
    search_rows: { key: "search_rows", name: "Search rows", kind: "search", params: z.object({ spreadsheetId: z.string(), range: z.string(), column: z.number(), value: z.string() }), run: searchRows },
  },
  testConnection: googleTestConnection,
};
