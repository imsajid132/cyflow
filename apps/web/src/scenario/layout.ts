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
  /** True for a dashed stub edge to an empty router route. */
  stub?: boolean;
}

/** Where a canvas "+" adds a module. */
export type AddTarget =
  | { kind: "after"; afterId: string | null }
  | { kind: "route"; routerId: string; routeIndex: number };

export interface AddSlot {
  key: string;
  x: number;
  y: number;
  target: AddTarget;
}

export interface Layout {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  addSlots: AddSlot[];
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
interface RouteStub {
  routerId: string;
  routeIndex: number;
  col: number;
  row: number;
  label?: string;
}

function routeLabel(route: { label?: string; filter?: unknown }, index: number): string {
  return route.label || formatFilter(route.filter) || `Route ${index + 1}`;
}

export function layoutScenario(blueprint: Blueprint): Layout {
  const byId = new Map<string, ModuleNode>(blueprint.modules.map((m) => [m.id, m]));
  const pos = new Map<string, { col: number; row: number; number: number }>();
  const stubs: RouteStub[] = [];
  const first = blueprint.modules[0];
  let maxRow = 0;
  let counter = 0;

  const place = (id: string | null | undefined, col: number, row: number): void => {
    if (!id) return;
    const m = byId.get(id);
    if (!m || pos.has(id)) return;
    counter += 1;
    pos.set(id, { col, row, number: counter });

    if (m.kind === "router") {
      const routes = m.routes ?? [];
      if (routes.length === 0) {
        stubs.push({ routerId: id, routeIndex: -1, col: col + 1, row });
        return;
      }
      routes.forEach((r, i) => {
        const laneRow = i === 0 ? row : (maxRow += 1);
        if (r.next && byId.has(r.next)) place(r.next, col + 1, laneRow);
        else stubs.push({ routerId: id, routeIndex: i, col: col + 1, row: laneRow, label: routeLabel(r, i) });
      });
    } else if (m.next) {
      place(m.next, col + 1, row);
    }
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
  for (const s of stubs) maxCol = Math.max(maxCol, s.col);
  nodes.sort((a, b) => a.number - b.number);

  const centre = (id: string) => {
    const p = pos.get(id)!;
    return { cx: PAD + p.col * COL_W + NODE_W / 2, cy: PAD + p.row * ROW_H + RAD };
  };
  const stubCentre = (s: RouteStub) => ({ cx: PAD + s.col * COL_W + NODE_W / 2, cy: PAD + s.row * ROW_H + RAD });

  const edges: LaidOutEdge[] = [];
  const bezier = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2;
    return { d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
  };
  const addEdge = (fromId: string, toId: string, label: string | undefined, router: boolean) => {
    const a = centre(fromId);
    const b = centre(toId);
    const g = bezier(a.cx + RAD + 2, a.cy, b.cx - RAD - 2, b.cy);
    edges.push({ key: `${fromId}->${toId}`, fromId, toId, ...g, label, router });
  };

  for (const [id] of pos) {
    const m = byId.get(id)!;
    if (m.kind === "router" && m.routes) {
      m.routes.forEach((r, i) => {
        if (r.next && pos.has(r.next)) addEdge(id, r.next, routeLabel(r, i), true);
      });
    } else if (m.next && pos.has(m.next)) {
      addEdge(id, m.next, m.filter ? formatFilter(m.filter) : undefined, false);
    }
  }

  // Dashed stub edges into empty routes, each with a route add-slot.
  const addSlots: AddSlot[] = [];
  for (const s of stubs) {
    const a = centre(s.routerId);
    const b = stubCentre(s);
    const g = bezier(a.cx + RAD + 2, a.cy, b.cx - RAD - 2, b.cy);
    edges.push({
      key: `stub_${s.routerId}_${s.routeIndex}`,
      fromId: s.routerId,
      toId: `stub_${s.routerId}_${s.routeIndex}`,
      ...g,
      label: s.label ?? (s.routeIndex < 0 ? "+ route" : "empty route"),
      router: true,
      stub: true,
    });
    addSlots.push({
      key: `route_${s.routerId}_${s.routeIndex}`,
      x: b.cx,
      y: b.cy,
      target: { kind: "route", routerId: s.routerId, routeIndex: s.routeIndex },
    });
  }

  // Midpoint "+" on every non-router link (insert after the source).
  for (const e of edges) {
    if (!e.router) addSlots.push({ key: `after_${e.key}`, x: e.midX, y: e.midY, target: { kind: "after", afterId: e.fromId } });
  }

  // End "+" after every non-router leaf (routers manage adds via routes).
  const hasOutgoing = new Set(edges.map((e) => e.fromId));
  for (const n of nodes) {
    if (n.node.kind === "router" || hasOutgoing.has(n.node.id)) continue;
    addSlots.push({
      key: `end_${n.node.id}`,
      x: n.x + NODE_W / 2 + RAD + 44,
      y: n.y + RAD,
      target: { kind: "after", afterId: n.node.id },
    });
  }

  return {
    nodes,
    edges,
    addSlots,
    width: PAD * 2 + (maxCol + 1) * COL_W,
    height: PAD * 2 + (maxRow + 1) * ROW_H,
  };
}
