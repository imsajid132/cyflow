import type { Bundle, OperationRunner } from "@cyflow/shared";

/**
 * The key the walker uses to hand an aggregator ALL of its collected input
 * bundles in a single wrapper bundle. It never appears in persisted snapshots
 * (those record each module's real input via `ModuleResult.input`).
 */
export const AGGREGATE_INPUT_KEY = "__bundles";

function getPath(target: unknown, path: string): unknown {
  if (!path) return target;
  let cur: unknown = target;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function incoming(inputBundle: Bundle): Bundle[] {
  const raw = inputBundle[AGGREGATE_INPUT_KEY];
  return Array.isArray(raw) ? (raw as Bundle[]) : [];
}

/**
 * Router — passes each incoming bundle through unchanged. The walker fans the
 * output to each route (every route whose filter matches receives the bundle).
 * Router is free flow-control: it consumes no operations.
 */
export const router: OperationRunner = async (inputBundle) => [inputBundle];

/**
 * Iterator — splits an array (from params/mapping) into one bundle per element.
 * Each emitted bundle carries the element under `value` plus its `index` and
 * the source `total` (item index + source metadata). The engine already
 * multiplexes N output bundles into N downstream runs, so no walker change is
 * needed for iteration.
 */
export const iterator: OperationRunner = async (_input, params) => {
  const arr = (params as { array?: unknown }).array;
  if (!Array.isArray(arr)) {
    throw new Error('iterator: "array" did not resolve to an array');
  }
  return arr.map((item, index) => ({ value: item, index, total: arr.length }));
};

/**
 * Array aggregator — collapses all incoming bundles into ONE bundle
 * `{ array: [...] }`. With a `field`, collects that path from each bundle;
 * otherwise collects the whole bundles.
 */
export const arrayAggregator: OperationRunner = async (input, params) => {
  const bundles = incoming(input);
  const field = (params as { field?: string }).field;
  const array = field ? bundles.map((b) => getPath(b, field)) : bundles;
  return [{ array }];
};

/**
 * Text aggregator — joins a mapped field from every incoming bundle into one
 * string with a separator (default ", ").
 */
export const textAggregator: OperationRunner = async (input, params) => {
  const bundles = incoming(input);
  const p = params as { value?: string; separator?: string };
  const separator = p.separator ?? ", ";
  const value = p.value ?? "";
  return [{ text: bundles.map((b) => stringify(getPath(b, value))).join(separator) }];
};

/**
 * Numeric aggregator — reduces a numeric field across all incoming bundles.
 * `count` counts bundles; sum/average/min/max operate on the `value` field.
 */
export const numericAggregator: OperationRunner = async (input, params) => {
  const bundles = incoming(input);
  const p = params as { value?: string; operation?: string };
  const op = p.operation ?? "count";
  const nums = p.value
    ? bundles
        .map((b) => Number(getPath(b, p.value as string)))
        .filter((n) => !Number.isNaN(n))
    : [];

  let result: number | null;
  switch (op) {
    case "count":
      result = bundles.length;
      break;
    case "sum":
      result = nums.reduce((a, b) => a + b, 0);
      break;
    case "average":
      result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      break;
    case "min":
      result = nums.length ? Math.min(...nums) : null;
      break;
    case "max":
      result = nums.length ? Math.max(...nums) : null;
      break;
    default:
      throw new Error(`numericAggregator: unknown operation "${op}"`);
  }
  return [{ result }];
};
