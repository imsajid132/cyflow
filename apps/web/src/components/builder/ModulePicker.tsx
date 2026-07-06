import { useMemo, useState } from "react";
import { Modal } from "../ui";
import { ModuleIcon } from "../ModuleIcon";
import { SearchIcon, ChevronRightIcon } from "../icons";
import { CATALOG, CATEGORIES, type CatalogApp } from "../../data/catalog";

const RECENT = ["http", "telegram", "openai", "slack"];

export function ModulePicker({
  onPick,
  onClose,
}: {
  onPick: (appKey: string, operation: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [selected, setSelected] = useState<CatalogApp | null>(null);

  const apps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((a) => {
      const inCat = category === "All" || a.category === category;
      const match =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.modules.some((m) => m.name.toLowerCase().includes(q));
      return inCat && match;
    });
  }, [query, category]);

  return (
    <Modal title={selected ? selected.name : "Add a module"} onClose={onClose} width={720}>
      {selected ? (
        <div>
          <button className="actionrow" onClick={() => setSelected(null)} style={{ background: "none", border: "none", padding: "0 0 12px", cursor: "pointer" }}>
            <span className="muted">← All apps</span>
          </button>
          {selected.modules.map((m) => (
            <div key={m.operation} className="actionrow" onClick={() => onPick(selected.key, m.operation)}>
              <span className="actionrow__icon">
                <ModuleIcon app={selected.key} operation={m.operation} sw={1.7} />
              </span>
              <div style={{ flex: 1 }}>
                <b>{m.name}</b>
                <span className="muted" style={{ textTransform: "capitalize" }}>{m.kind}</span>
              </div>
              <ChevronRightIcon />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="picker__search topbar__search" style={{ maxWidth: "none" }}>
            <SearchIcon />
            <input
              className="input"
              autoFocus
              placeholder="Search apps and actions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {!query ? (
            <div className="picker__recent">
              <span className="muted" style={{ fontSize: ".75rem", alignSelf: "center", marginRight: 4 }}>
                Recent:
              </span>
              {RECENT.map((k) => {
                const app = CATALOG.find((a) => a.key === k);
                if (!app) return null;
                return (
                  <span className="chip" key={k} onClick={() => setSelected(app)}>
                    {app.name}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="picker__grid">
            <div className="picker__cats">
              <button className={`picker__cat${category === "All" ? " is-active" : ""}`} onClick={() => setCategory("All")}>
                All apps
              </button>
              {CATEGORIES.map((c) => (
                <button key={c} className={`picker__cat${category === c ? " is-active" : ""}`} onClick={() => setCategory(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="picker__apps">
              {apps.map((a) => (
                <div className="appTile" key={a.key} onClick={() => setSelected(a)}>
                  <span className="appTile__icon">
                    <ModuleIcon app={a.key} operation={a.modules[0]?.operation ?? ""} sw={1.7} />
                  </span>
                  <span className="appTile__name">{a.name}</span>
                </div>
              ))}
              {apps.length === 0 ? <div className="muted" style={{ padding: 12 }}>No apps match "{query}".</div> : null}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
