import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../store/types";
import { useStore } from "../store/appStore";
import { deriveModules } from "../scenario/model";
import { ModuleIcon } from "./ModuleIcon";
import { StatusPill, Toggle } from "./ui";
import { MoreIcon, ChevronRightIcon, DuplicateIcon, TrashIcon } from "./icons";
import { nextRunLabel, timeAgo } from "../lib/format";

export function ScenarioCard({ scenario, onOpen }: { scenario: Scenario; onOpen: () => void }) {
  const store = useStore();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modules = deriveModules(scenario.blueprint).slice(0, 5);
  const errors = store.executions.filter(
    (e) => e.scenarioId === scenario.id && e.execution.status === "FAILED",
  ).length;

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="scard glass"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : undefined)}
    >
      <div className="scard__top">
        <div className="scard__chain" style={{ flex: 1 }}>
          {modules.length === 0 ? (
            <div className="scard__mini" aria-hidden />
          ) : (
            modules.map((m) => (
              <div className="scard__mini" key={m.node.id}>
                <ModuleIcon app={m.node.app} operation={m.node.operation} sw={1.8} />
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={stop}>
          <Toggle
            on={scenario.status === "ACTIVE"}
            onChange={(on) => store.updateScenario(scenario.id, { status: on ? "ACTIVE" : "PAUSED" })}
            label="Enabled"
          />
          <div className="cardmenu" ref={menuRef}>
            <button className="cardmenu__btn" onClick={() => setMenu((m) => !m)} aria-label="Scenario actions">
              <MoreIcon />
            </button>
            {menu ? (
              <div className="cardmenu__pop">
                <button className="cardmenu__item" onClick={onOpen}>
                  <ChevronRightIcon /> Open
                </button>
                <button className="cardmenu__item" onClick={() => { store.duplicateScenario(scenario.id); setMenu(false); }}>
                  <DuplicateIcon /> Duplicate
                </button>
                <button className="cardmenu__item is-danger" onClick={() => { store.deleteScenario(scenario.id); setMenu(false); }}>
                  <TrashIcon /> Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="scard__title">{scenario.name}</div>

      <div className="scard__meta">
        <span>
          Last run <b>{timeAgo(scenario.lastRunAt)}</b>
        </span>
        <span>
          Next run <b>{scenario.status === "ACTIVE" ? nextRunLabel(scenario.schedule, scenario.lastRunAt) : "paused"}</b>
        </span>
        <span>
          Ops <b>{scenario.operations ?? 0}</b>
        </span>
        <span>
          Errors <b style={errors > 0 ? { color: "var(--danger)" } : undefined}>{errors}</b>
        </span>
      </div>

      <div className="scard__foot">
        <StatusPill status={scenario.status} />
        {scenario.lastStatus ? <StatusPill status={scenario.lastStatus} /> : null}
      </div>
    </div>
  );
}
