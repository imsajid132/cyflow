/**
 * A simple visual filter builder — left / operator / right — saved into the
 * engine's FilterCondition shape ({ left, operator, right? }). Groups (and/or)
 * aren't authored here; an existing group is edited via its first condition.
 */
type Op = "equals" | "notEquals" | "contains" | "greater" | "less" | "exists" | "empty";

const OPERATORS: { value: Op; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "greater", label: "greater than" },
  { value: "less", label: "less than" },
  { value: "exists", label: "exists" },
  { value: "empty", label: "is empty" },
];
const NO_RIGHT = new Set<Op>(["exists", "empty"]);

interface Condition {
  left: string;
  operator: Op;
  right: string;
}

function toCondition(value: unknown): Condition {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const c = Array.isArray(v.conditions) ? ((v.conditions[0] as Record<string, unknown>) ?? {}) : v;
    return {
      left: String(c.left ?? ""),
      operator: (c.operator as Op) ?? "equals",
      right: c.right !== undefined ? String(c.right) : "",
    };
  }
  return { left: "", operator: "equals", right: "" };
}

export function FilterEditor({ value, onChange }: { value: unknown | null; onChange: (filter: unknown | null) => void }) {
  const cond = toCondition(value);

  const emit = (patch: Partial<Condition>) => {
    const next = { ...cond, ...patch };
    const out: { left: string; operator: Op; right?: string } = { left: next.left, operator: next.operator };
    if (!NO_RIGHT.has(next.operator)) out.right = next.right;
    onChange(out);
  };

  return (
    <div className="filteredit">
      <input
        className="input mono"
        placeholder="{{1.body.email}}"
        value={cond.left}
        onChange={(e) => emit({ left: e.target.value })}
        aria-label="Left value"
      />
      <select className="input" value={cond.operator} onChange={(e) => emit({ operator: e.target.value as Op })} aria-label="Operator">
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {!NO_RIGHT.has(cond.operator) ? (
        <input
          className="input mono"
          placeholder="value or {{2.x}}"
          value={cond.right}
          onChange={(e) => emit({ right: e.target.value })}
          aria-label="Right value"
        />
      ) : null}
      <button className="token" type="button" onClick={() => onChange(null)}>
        Remove filter
      </button>
    </div>
  );
}
