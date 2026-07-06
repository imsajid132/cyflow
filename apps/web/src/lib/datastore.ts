/** Human type label for a stored value. */
export function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Compact one-line preview of a stored value. */
export function valuePreview(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 48 ? `"${v.slice(0, 48)}…"` : `"${v}"`;
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 64 ? `${s.slice(0, 64)}…` : s;
  }
  return String(v);
}
