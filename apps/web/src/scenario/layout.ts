import type { Blueprint, ModuleNode } from "@cyflow/shared";
import { nodeMeta } from "./model";

export interface LaidOutNode {
  node: ModuleNode;
  number: number;
  label: string;
  sub: string;
  col: number;
  row: number;
  x: number;
  y: number;
}

export interface LaidOutEdge {
  key: string;
  fromId: string;
  toId: string;
  d: string;
  midX: number;
  midY: number;
  label?: string;
  router: boolean;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
}

export const NODE_W = 120;
export const BUBBLE = 88;
const RAD = BUBBLE / 2;
const COL_W = 224;
const ROW_H = 156;
const PAD = 56;

const OP_SYMBOL: Record<string, string> = {
  equals: "=",
  notEquals: "≠",
  greater: ">",
  less: "<",
  contains: "∋",
  exists: "exists",
  empty: "empty",
};

/** Short, human label for a link/route filter. */
export function formatFilter(filter: unknown): string | undefined {
  if (!filter || typeof filter !== "object") return undefined;
  const f = filter as Record<string, unknown>;
  if (Array.isArray(f.conditions)) {
    return String(f.combinator ?? "and").toUpperCase();
  }
  const left = String(f.left ?? "");
  const op = OP_SYMBOL[String(f.operator ?? "")] ?? String(f.operator ?? "");
  const right = f.right !== undefined ? ` ${String(f.right)}` : "";
  const shortLeft = left.replace(/^\{\{|\}\}$/g, "");
  if (op === "exists" || op === "empty") return `${shortLeft} ${op}`;
  return `${shortLeft} ${op}${right}`.trim();
}

/**
 * Lay a blueprint out as a 2-D tree: column = depth from the trigger, row =
 * branch lane (Routers stack their routes into new lanes). Bubble coordinates
 * and connector paths are computed directly (no DOM measurement), so it is
 * robust under zoom/pan.
 */
export function layoutScenario(blueprint: Blueprint): Layout {
  const byId = new Map<string, ModuleNode>(blueprint.modules.map((m) => [m.id, m]));
  const pos = new Map<string, { col: number; row: number; number: number }>();
  const first = blueprint.modules[0];
  let maxRow = 0;
  let counter = 0;

  const place = (id: string | null | undefined, col: number, row: number): void => {
    if (!id) return;
    const m = byId.get(id);
    if (!m || pos.has(id)) return;
    counter += 1;
    pos.set(id, { col, row, number: counter });
    const children =
      m.routes && m.routes.length > 0 ? m.routes.map((r) => r.next) : [m.next];
    children.forEach((childId, i) => {
      const childRow = i === 0 ? row : (maxRow += 1);
      place(childId, col + 1, childRow);
    });
  };
  if (first) place(first.id, 0, 0);

  let maxCol = 0;
  const nodes: LaidOutNode[] = [];
  for (const [id, p] of pos) {
    const node = byId.get(id)!;
    const meta = nodeMeta(node);
    maxCol = Math.max(maxCol, p.col);
    nodes.push({
      node,
      number: p.number,
      label: meta.label,
      sub: meta.sub,
      col: p.col,
      row: p.row,
      x: PAD + p.col * COL_W,
      y: PAD + p.row * ROW_H,
    });
  }
  nodes.sort((a, b) => a.number - b.number);

  const centre = (id: string) => {
    const p = pos.get(id)!;
    return { cx: PAD + p.col * COL_W + NODE_W / 2, cy: PAD + p.row * ROW_H + RAD };
  };

  const edges: LaidOutEdge[] = [];
  const addEdge = (fromId: string, toId: string | null, label: string | undefined, router: boolean) => {
    if (!toId || !pos.has(toId)) return;
    const a = centre(fromId);
    const b = centre(toId);
    const x1 = a.cx + RAD + 2;
    const y1 = a.cy;
    const x2 = b.cx - RAD - 2;
    const y2 = b.cy;
    const mx = (x1 + x2) / 2;
    edges.push({
      key: `${fromId}->${toId}`,
      fromId,
      toId,
      d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
      midX: (x1 + x2) / 2,
      midY: (y1 + y2) / 2,
      label,
      router,
    });
  };

  for (const [id, _p] of pos) {
    void _p;
    const m = byId.get(id)!;
    if (m.routes && m.routes.length > 0) {
      m.routes.forEach((r) => addEdge(id, r.next, r.label ?? formatFilter(r.filter) ?? "route", true));
    } else if (m.next) {
      addEdge(id, m.next, m.filter ? formatFilter(m.filter) : undefined, false);
    }
  }

  return {
    nodes,
    edges,
    width: PAD * 2 + (maxCol + 1) * COL_W,
    height: PAD * 2 + (maxRow + 1) * ROW_H,
  };
}
