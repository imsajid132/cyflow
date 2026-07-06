import type { Blueprint, ModuleNode } from "@cyflow/shared";
import { findModule } from "../data/catalog";

/** Next module id = max existing numeric id + 1 (ids are stable, never reused). */
function nextId(blueprint: Blueprint): string {
  const max = blueprint.modules.reduce((m, node) => Math.max(m, Number(node.id) || 0), 0);
  return String(max + 1);
}

/** Build a fresh ModuleNode from the catalog with default params. */
export function makeNode(blueprint: Blueprint, appKey: string, operation: string): ModuleNode {
  const def = findModule(appKey, operation);
  return {
    id: nextId(blueprint),
    app: appKey,
    operation,
    kind: def?.kind ?? "action",
    params: { ...(def?.defaults ?? {}) },
    next: null,
  };
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
