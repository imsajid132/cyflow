import { useState } from "react";
import type { RouteDef } from "@cyflow/shared";
import { FilterEditor } from "./FilterEditor";
import { TrashIcon, PlusIcon } from "../icons";

interface NodeRef {
  id: string;
  label: string;
  number: number;
}

/**
 * Router route CRUD. Each route has a label, an optional filter condition, and a
 * target module. Saved into ModuleNode.routes (RouteDef[]) — the shape the
 * engine already runs.
 */
export function RouteEditor({
  routes,
  routerId,
  nodes,
  onAdd,
  onUpdate,
  onRemove,
}: {
  routes: RouteDef[];
  routerId: string;
  nodes: NodeRef[];
  onAdd: () => void;
  onUpdate: (index: number, patch: Partial<RouteDef>) => void;
  onRemove: (index: number) => void;
}) {
  const [openFilters, setOpenFilters] = useState<Set<number>>(new Set());
  const targets = nodes.filter((n) => n.id !== routerId);

  const toggleFilter = (i: number) =>
    setOpenFilters((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="field">
      <label>Routes</label>
      {routes.length === 0 ? <span className="hint">No routes yet — add one below.</span> : null}
      {routes.map((r, i) => {
        const showFilter = openFilters.has(i) || r.filter != null;
        return (
          <div className="routerow" key={i}>
            <div className="routerow__head">
              <span className="mapping__num">{i + 1}</span>
              <input
                className="input"
                placeholder={`Route ${i + 1} label`}
                value={r.label ?? ""}
                onChange={(e) => onUpdate(i, { label: e.target.value })}
                aria-label={`Route ${i + 1} label`}
              />
              <button className="rowbtn is-danger" title="Delete route" aria-label="Delete route" onClick={() => onRemove(i)}>
                <TrashIcon />
              </button>
            </div>
            <div className="routerow__body">
              <label className="routerow__lbl">Target</label>
              <select
                className="input"
                value={r.next ?? ""}
                onChange={(e) => onUpdate(i, { next: e.target.value || null })}
                aria-label={`Route ${i + 1} target`}
              >
                <option value="">— empty (add on canvas) —</option>
                {targets.map((n) => (
                  <option key={n.id} value={n.id}>{n.number}. {n.label}</option>
                ))}
              </select>
            </div>
            {showFilter ? (
              <FilterEditor value={r.filter ?? null} onChange={(f) => onUpdate(i, { filter: f })} />
            ) : (
              <button className="token" type="button" onClick={() => toggleFilter(i)}>+ add filter</button>
            )}
          </div>
        );
      })}
      <button className="token" type="button" onClick={onAdd} style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <PlusIcon width={12} height={12} /> Add route
      </button>
    </div>
  );
}
