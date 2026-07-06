import { z } from "zod";
import type { App } from "engine";
import type { OperationRunner } from "@cyflow/shared";
import { requireCredential, postJson } from "./util";

/** Google Sheets (scaffold) — Append a row. Auth: oauth2 (access token). */
const appendRow: OperationRunner = async (_input, params, ctx) => {
  const accessToken = requireCredential(ctx, ["access_token", "accessToken", "token"], "Google Sheets");
  const p = params as { spreadsheetId?: unknown; range?: unknown; values?: unknown };
  const values = Array.isArray(p.values) ? (p.values as unknown[]) : [];

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${String(p.spreadsheetId)}` +
    `/values/${encodeURIComponent(String(p.range))}:append?valueInputOption=USER_ENTERED`;

  const { ok, status, json } = await postJson(url, { values: [values] }, {
    authorization: `Bearer ${accessToken}`,
  });
  if (!ok) {
    const error = json.error as { message?: string } | undefined;
    throw new Error(`Google Sheets error: ${error?.message ?? status}`);
  }
  const updates = json.updates as { updatedRange?: string; updatedRows?: number } | undefined;
  return [{ updatedRange: updates?.updatedRange, updatedRows: updates?.updatedRows }];
};

export const sheetsApp: App = {
  key: "sheets",
  name: "Google Sheets",
  auth: { type: "oauth2" },
  modules: {
    append_row: {
      key: "append_row",
      name: "Append a row",
      kind: "action",
      params: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
        values: z.array(z.any()),
      }),
      run: appendRow,
    },
  },
};
