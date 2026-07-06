import { parseExpression, type Node } from "./parser";
import { FUNCTIONS } from "./functions";

/**
 * The mapping scope: module id/key → that module's output bundle (or any value).
 * The engine builds this from prior module outputs + the current bundle.
 */
export type MappingScope = Record<string, unknown>;

function resolvePath(scope: MappingScope, root: string, segments: string[]): unknown {
  let cur: unknown = Object.prototype.hasOwnProperty.call(scope, root) ? scope[root] : undefined;
  for (const seg of segments) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function evaluateNode(node: Node, scope: MappingScope): unknown {
  switch (node.type) {
    case "literal":
      return node.value;
    case "path":
      return resolvePath(scope, node.root, node.segments);
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function "${node.name}()"`);
      const args = node.args.map((n) => evaluateNode(n, scope));
      return fn(args);
    }
  }
}

/** Parse + evaluate a single expression (the text inside `{{ }}`). */
export function evaluateExpression(expr: string, scope: MappingScope): unknown {
  return evaluateNode(parseExpression(expr), scope);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

type Segment = { text: string } | { expr: string };

/** Split a string into literal text and `{{ expr }}` tokens (quote-aware). */
function splitTemplate(input: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let text = "";
  while (i < input.length) {
    if (input[i] === "{" && input[i + 1] === "{") {
      if (text) {
        segments.push({ text });
        text = "";
      }
      i += 2;
      let expr = "";
      let quote: string | null = null;
      while (i < input.length) {
        const c = input[i];
        if (quote) {
          expr += c;
          if (c === "\\") {
            expr += input[i + 1] ?? "";
            i += 2;
            continue;
          }
          if (c === quote) quote = null;
          i++;
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          expr += c;
          i++;
          continue;
        }
        if (c === "}" && input[i + 1] === "}") {
          i += 2;
          break;
        }
        expr += c;
        i++;
      }
      segments.push({ expr });
    } else {
      text += input[i];
      i++;
    }
  }
  if (text) segments.push({ text });
  return segments;
}

/**
 * Evaluate a string that may contain `{{ }}` tokens.
 * - No tokens → returned unchanged (plain strings pass through).
 * - Exactly one token and nothing else → the raw resolved VALUE (type preserved:
 *   object / array / number / boolean / null / undefined).
 * - Tokens mixed with text → each token stringified and concatenated.
 */
export function evaluateTemplate(input: string, scope: MappingScope): unknown {
  if (!input.includes("{{")) return input;
  const segments = splitTemplate(input);
  if (segments.length === 1 && "expr" in segments[0]) {
    return evaluateExpression(segments[0].expr, scope);
  }
  return segments
    .map((s) => ("text" in s ? s.text : stringify(evaluateExpression(s.expr, scope))))
    .join("");
}

/** Recursively resolve every string in a value (objects/arrays walked). */
export function resolveValue(value: unknown, scope: MappingScope): unknown {
  if (typeof value === "string") return evaluateTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, scope));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, scope);
    return out;
  }
  return value;
}

/** Resolve a module's params tree against the mapping scope. */
export function resolveParamsTree(
  params: Record<string, unknown>,
  scope: MappingScope,
): Record<string, unknown> {
  return resolveValue(params, scope) as Record<string, unknown>;
}
