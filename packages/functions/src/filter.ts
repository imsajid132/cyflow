import { evaluateTemplate, type MappingScope } from "./resolve";

/**
 * Connection-level filters (Phase 5). A filter sits on the link between two
 * modules and decides, per bundle, whether that bundle continues. Operands are
 * mapping expressions resolved with the same engine as params, so a condition
 * can compare `{{2.body.age}}` against a literal or another mapping.
 */

export type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "greater"
  | "less"
  | "exists"
  | "empty";

export interface FilterCondition {
  /** Left operand — a mapping expression or literal string. */
  left: string;
  operator: FilterOperator;
  /** Right operand — omitted for `exists` / `empty`. */
  right?: string;
}

export interface FilterGroup {
  combinator: "and" | "or";
  conditions: Array<FilterCondition | FilterGroup>;
}

export type Filter = FilterCondition | FilterGroup;

function isGroup(f: Filter): f is FilterGroup {
  return (
    typeof (f as FilterGroup).combinator === "string" &&
    Array.isArray((f as FilterGroup).conditions)
  );
}

function resolveOperand(expr: string | undefined, scope: MappingScope): unknown {
  if (expr === undefined) return undefined;
  return evaluateTemplate(expr, scope);
}

/** Loose equality: 18 == "18", otherwise string compare. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function evalCondition(c: FilterCondition, scope: MappingScope): boolean {
  const left = resolveOperand(c.left, scope);

  switch (c.operator) {
    case "exists":
      return left !== undefined && left !== null;
    case "empty":
      return isEmpty(left);
    case "equals":
      return looseEquals(left, resolveOperand(c.right, scope));
    case "notEquals":
      return !looseEquals(left, resolveOperand(c.right, scope));
    case "contains": {
      const right = resolveOperand(c.right, scope);
      if (Array.isArray(left)) return left.some((x) => looseEquals(x, right));
      return String(left ?? "").includes(String(right ?? ""));
    }
    case "greater":
      return Number(left) > Number(resolveOperand(c.right, scope));
    case "less":
      return Number(left) < Number(resolveOperand(c.right, scope));
    default:
      throw new Error(`Unknown filter operator "${(c as FilterCondition).operator}"`);
  }
}

/** Evaluate a filter (single condition or and/or group) against a scope. */
export function evaluateFilter(filter: Filter, scope: MappingScope): boolean {
  if (isGroup(filter)) {
    return filter.combinator === "and"
      ? filter.conditions.every((c) => evaluateFilter(c, scope))
      : filter.conditions.some((c) => evaluateFilter(c, scope));
  }
  return evalCondition(filter, scope);
}
