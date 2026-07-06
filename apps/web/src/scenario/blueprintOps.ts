import type { Blueprint, ErrorHandler, ModuleNode, RouteDef } from "@cyflow/shared";
import { findModule } from "../data/catalog";

/** Next module id = max existing numeric id + 1 (ids are stable, never reused). */
function nextId(blueprint: Blueprint): string {
  const max = blueprint.modules.reduce((m, node) => Math.max(m, Number(node.id) || 0), 0);
  return String(max + 1);
}

/** Build a fresh ModuleNode from the catalog with default params. */
export function makeNode(blueprint: Blueprint, appKey: string, operation: string): ModuleNode {
  const def = findModule(appKey, operation);
  const kind = def?.kind ?? "action";
  const node: ModuleNode = {
    id: nextId(blueprint),
    app: appKey,
    operation,
    kind,
    params: { ...(def?.defaults ?? {}) },
    next: null,
  };
  // A fresh Router starts with two empty routes (Make-style).
  if (kind === "router") node.routes = [{ next: null }, { next: null }];
  return node;
}

/**
 * Insert a new module into the linear chain after `afterId` (or as the first
 * module when `afterId` is null). Returns a new Blueprint.
 */
export function insertModule(
  blueprint: Blueprint,
  afterId: string | null,
  node: ModuleNode,
): Blueprint {
  const modules = blueprint.modules.map((m) => ({ ...m }));

  if (afterId === null) {
    // New first module — chain to whatever was first.
    const previousFirst = modules[0]?.id ?? null;
    node.next = previousFirst;
    return { modules: [node, ...modules] };
  }

  const after = modules.find((m) => m.id === afterId);
  if (!after) return { modules: [...modules, node] };
  node.next = after.next;
  after.next = node.id;
  // Keep array order roughly chain-order for nicer serialization.
  const idx = modules.indexOf(after);
  modules.splice(idx + 1, 0, node);
  return { modules };
}

/** Remove a module and re-link its predecessor to its successor. */
export function removeModule(blueprint: Blueprint, id: string): Blueprint {
  const modules = blueprint.modules.map((m) => ({ ...m }));
  const target = modules.find((m) => m.id === id);
  if (!target) return { modules };
  for (const m of modules) {
    if (m.next === id) m.next = target.next;
  }
  return { modules: modules.filter((m) => m.id !== id) };
}

/** Replace a module's params. */
export function updateModuleParams(
  blueprint: Blueprint,
  id: string,
  params: Record<string, unknown>,
): Blueprint {
  return {
    modules: blueprint.modules.map((m) => (m.id === id ? { ...m, params } : m)),
  };
}

/** Set a module's connectionId. */
export function updateModuleConnection(
  blueprint: Blueprint,
  id: string,
  connectionId: string | null,
): Blueprint {
  return {
    modules: blueprint.modules.map((m) => (m.id === id ? { ...m, connectionId } : m)),
  };
}

/* ============================================================
   Phase 8 — routers, route filters, and error handlers.
   Routes/filters/errorHandlers live in the blueprint JSON, which persists
   through the scenario API unchanged (no new backend model).
   ============================================================ */

/** Reachable module ids from the first module, following `next` + route targets. */
function reachableIds(blueprint: Blueprint): Set<string> {
  const byId = new Map(blueprint.modules.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const stack = blueprint.modules[0] ? [blueprint.modules[0].id] : [];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const m = byId.get(id)!;
    if (m.routes) for (const r of m.routes) if (r.next) stack.push(r.next);
    if (m.next) stack.push(m.next);
  }
  return seen;
}

/** Drop modules no longer reachable (e.g. after deleting a route). */
export function pruneUnreachable(blueprint: Blueprint): Blueprint {
  const keep = reachableIds(blueprint);
  if (keep.size === blueprint.modules.length) return blueprint;
  return { modules: blueprint.modules.filter((m) => keep.has(m.id)) };
}

/** Append a new empty route to a router. */
export function addRoute(blueprint: Blueprint, routerId: string): Blueprint {
  return {
    modules: blueprint.modules.map((m) =>
      m.id === routerId ? { ...m, routes: [...(m.routes ?? []), { next: null } as RouteDef] } : m,
    ),
  };
}

/** Patch one route (label / filter / next). */
export function updateRoute(
  blueprint: Blueprint,
  routerId: string,
  index: number,
  patch: Partial<RouteDef>,
): Blueprint {
  return {
    modules: blueprint.modules.map((m) => {
      if (m.id !== routerId || !m.routes) return m;
      return { ...m, routes: m.routes.map((r, i) => (i === index ? { ...r, ...patch } : r)) };
    }),
  };
}

/** Remove a route, then prune any modules it orphaned. */
export function removeRoute(blueprint: Blueprint, routerId: string, index: number): Blueprint {
  const modules = blueprint.modules.map((m) =>
    m.id === routerId && m.routes ? { ...m, routes: m.routes.filter((_, i) => i !== index) } : m,
  );
  return pruneUnreachable({ modules });
}

/**
 * Insert a module into a router route. `routeIndex < 0` creates a new route.
 * The new module becomes the head of the route's chain.
 */
export function insertIntoRoute(
  blueprint: Blueprint,
  routerId: string,
  routeIndex: number,
  node: ModuleNode,
): Blueprint {
  const modules: ModuleNode[] = blueprint.modules.map((m) => ({
    ...m,
    routes: m.routes ? m.routes.map((r) => ({ ...r })) : m.routes,
  }));
  const router = modules.find((m) => m.id === routerId);
  if (!router) return { modules: [...modules, node] };
  const routes = router.routes ? [...router.routes] : [];
  if (routeIndex < 0 || routeIndex >= routes.length) {
    node.next = null;
    routes.push({ next: node.id });
  } else {
    node.next = routes[routeIndex].next ?? null;
    routes[routeIndex] = { ...routes[routeIndex], next: node.id };
  }
  router.routes = routes;
  const idx = modules.indexOf(router);
  modules.splice(idx + 1, 0, node);
  return { modules };
}

/** Set (or clear) a module's link filter — the condition on the link into `next`. */
export function setModuleFilter(blueprint: Blueprint, id: string, filter: unknown | null): Blueprint {
  return { modules: blueprint.modules.map((m) => (m.id === id ? { ...m, filter: filter ?? null } : m)) };
}

/** Set (or clear) a module's error handler. */
export function setErrorHandler(blueprint: Blueprint, id: string, handler: ErrorHandler | null): Blueprint {
  return {
    modules: blueprint.modules.map((m) => {
      if (m.id !== id) return m;
      const copy = { ...m };
      if (handler) copy.errorHandler = handler;
      else delete copy.errorHandler;
      return copy;
    }),
  };
}
