import { z } from "zod";
import type { App, ModuleDef } from "engine";
import type { Bundle, OperationRunner } from "@cyflow/shared";

/**
 * JSON / CSV utilities (production). Pure, deterministic transforms — no auth,
 * no network. Handy for reshaping data between modules in a scenario.
 */

/** Parse CSV text (RFC-4180-ish: quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // handled by the \n branch
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Serialize rows (arrays or objects) to CSV, quoting where needed. */
export function toCsv(rows: unknown[], delimiter = ","): string {
  if (rows.length === 0) return "";
  const quote = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /["\n\r]|,/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const first = rows[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const headers = Object.keys(first as Record<string, unknown>);
    const lines = [headers.map(quote).join(delimiter)];
    for (const r of rows as Record<string, unknown>[]) lines.push(headers.map((h) => quote(r[h])).join(delimiter));
    return lines.join("\n");
  }
  return (rows as unknown[][]).map((r) => (Array.isArray(r) ? r : [r]).map(quote).join(delimiter)).join("\n");
}

const parseJson: OperationRunner = async (_input, params) => {
  const p = params as { text?: unknown };
  const raw = p.text;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return [{ value } as Bundle];
  } catch (e) {
    throw new Error(`Parse JSON failed: ${(e as Error).message}`);
  }
};

const toJson: OperationRunner = async (_input, params) => {
  const p = params as { value?: unknown; pretty?: unknown };
  const text = JSON.stringify(p.value ?? null, null, p.pretty ? 2 : 0);
  return [{ text } as Bundle];
};

const csvToRows: OperationRunner = async (_input, params) => {
  const p = params as { text?: unknown; delimiter?: unknown; header?: unknown };
  const grid = parseCsv(String(p.text ?? ""), typeof p.delimiter === "string" && p.delimiter ? p.delimiter : ",");
  if (p.header) {
    const [head, ...body] = grid;
    const keys = head ?? [];
    const objects = body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
    return [{ rows: objects, count: objects.length } as Bundle];
  }
  return [{ rows: grid, count: grid.length } as Bundle];
};

const rowsToCsv: OperationRunner = async (_input, params) => {
  const p = params as { rows?: unknown; delimiter?: unknown };
  const rows = Array.isArray(p.rows) ? (p.rows as unknown[]) : [];
  const text = toCsv(rows, typeof p.delimiter === "string" && p.delimiter ? p.delimiter : ",");
  return [{ text } as Bundle];
};

const modules: Record<string, ModuleDef> = {
  parse_json: { key: "parse_json", name: "Parse JSON", kind: "action", params: z.object({ text: z.string() }), run: parseJson },
  to_json: { key: "to_json", name: "Create JSON", kind: "action", params: z.object({ value: z.any(), pretty: z.boolean().optional() }), run: toJson },
  parse_csv: {
    key: "parse_csv",
    name: "Parse CSV",
    kind: "action",
    params: z.object({ text: z.string(), delimiter: z.string().optional(), header: z.boolean().optional() }),
    run: csvToRows,
  },
  to_csv: { key: "to_csv", name: "Create CSV", kind: "action", params: z.object({ rows: z.array(z.any()), delimiter: z.string().optional() }), run: rowsToCsv },
};

export const utilsApp: App = {
  key: "utils",
  name: "JSON / CSV",
  modules,
};
