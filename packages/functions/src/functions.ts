/**
 * The whitelisted function table. Each function receives already-evaluated
 * argument VALUES. This is the only place expressions can invoke behaviour —
 * there is no dynamic dispatch to arbitrary code.
 */

export type Fn = (args: unknown[]) => unknown;

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function asNumber(v: unknown, fn: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) throw new Error(`${fn}(): "${String(v)}" is not a number`);
  return n;
}

/** Read a dot-path (e.g. "a.b.0.c") out of a value; missing → undefined. */
function getPath(target: unknown, key: string): unknown {
  if (target == null) return undefined;
  let cur: unknown = target;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(v: unknown, fn: string): Date {
  const d = v instanceof Date ? v : new Date(typeof v === "number" ? v : String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`${fn}(): invalid date "${String(v)}"`);
  return d;
}

/** UTC-based date formatting so results are deterministic across machines. */
function formatDate(d: Date, fmt: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    MM: pad(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => tokens[t]);
}

function arity(name: string, args: unknown[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min}-${max}`;
    throw new Error(`${name}() expects ${want} argument(s), got ${args.length}`);
  }
}

export const FUNCTIONS: Record<string, Fn> = {
  /** get(target; "a.b.c") — read a nested path out of a value. */
  get: (a) => {
    arity("get", a, 2, 2);
    return getPath(a[0], asString(a[1]));
  },
  /** map(array; "key") — pull `key` from every element. */
  map: (a) => {
    arity("map", a, 2, 2);
    if (!Array.isArray(a[0])) throw new Error("map(): first argument is not an array");
    const key = asString(a[1]);
    return (a[0] as unknown[]).map((item) => getPath(item, key));
  },
  /** concat(...) — join all arguments as strings. */
  concat: (a) => a.map(asString).join(""),
  upper: (a) => {
    arity("upper", a, 1, 1);
    return asString(a[0]).toUpperCase();
  },
  lower: (a) => {
    arity("lower", a, 1, 1);
    return asString(a[0]).toLowerCase();
  },
  trim: (a) => {
    arity("trim", a, 1, 1);
    return asString(a[0]).trim();
  },
  /** replace(text; search; replacement) — replace all occurrences. */
  replace: (a) => {
    arity("replace", a, 3, 3);
    return asString(a[0]).split(asString(a[1])).join(asString(a[2]));
  },
  /** formatDate(date; "YYYY-MM-DD HH:mm:ss") — UTC tokens. */
  formatDate: (a) => {
    arity("formatDate", a, 2, 2);
    return formatDate(toDate(a[0], "formatDate"), asString(a[1]));
  },
  add: (a) => {
    arity("add", a, 2, 2);
    return asNumber(a[0], "add") + asNumber(a[1], "add");
  },
  subtract: (a) => {
    arity("subtract", a, 2, 2);
    return asNumber(a[0], "subtract") - asNumber(a[1], "subtract");
  },
  multiply: (a) => {
    arity("multiply", a, 2, 2);
    return asNumber(a[0], "multiply") * asNumber(a[1], "multiply");
  },
  divide: (a) => {
    arity("divide", a, 2, 2);
    const divisor = asNumber(a[1], "divide");
    if (divisor === 0) throw new Error("divide(): division by zero");
    return asNumber(a[0], "divide") / divisor;
  },
  /** default(value; fallback) — fallback when value is null/undefined/"". */
  default: (a) => {
    arity("default", a, 2, 2);
    const v = a[0];
    return v === null || v === undefined || v === "" ? a[1] : v;
  },
  /** now() — current time (rarely used in tests; here for completeness). */
  now: (a) => {
    arity("now", a, 0, 0);
    return new Date();
  },
};
