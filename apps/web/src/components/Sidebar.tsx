import { useStore } from "../store/appStore";
import type { ViewName } from "../store/types";
import { ThemeToggle } from "./ThemeToggle";
import {
  DashboardIcon,
  ScenariosIcon,
  TemplateIcon,
  ConnectionsIcon,
  ExecutionsIcon,
  DataStoreIcon,
  SettingsIcon,
} from "./icons";

interface NavDef {
  view: ViewName;
  label: string;
  icon: JSX.Element;
}

const NAV: NavDef[] = [
  { view: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  { view: "scenarios", label: "Scenarios", icon: <ScenariosIcon /> },
  { view: "templates", label: "Templates", icon: <TemplateIcon /> },
  { view: "connections", label: "Connections", icon: <ConnectionsIcon /> },
  { view: "executions", label: "Executions", icon: <ExecutionsIcon /> },
  { view: "datastores", label: "Data stores", icon: <DataStoreIcon /> },
  { view: "settings", label: "Settings", icon: <SettingsIcon /> },
];

export function Sidebar() {
  const store = useStore();

  const badge: Partial<Record<ViewName, number>> = {
    scenarios: store.scenarios.length,
    connections: store.connections.length,
    executions: store.executions.length,
  };

  return (
    <aside className="sidebar glass" aria-label="Navigation">
      <div className="sidebar__brand">
        <div className="sidebar__logo">C</div>
        <span className="sidebar__word">Cyflow</span>
      </div>

      <div className="sidebar__section">Workspace</div>
      {NAV.map((n) => (
        <button
          key={n.view}
          className={`navitem${store.view === n.view ? " is-active" : ""}`}
          onClick={() => store.navigate(n.view)}
          aria-current={store.view === n.view ? "page" : undefined}
        >
          {n.icon}
          <span>{n.label}</span>
          {badge[n.view] !== undefined ? (
            <span className="navitem__badge">{badge[n.view]}</span>
          ) : null}
        </button>
      ))}

      <div className="sidebar__spacer" />
      <ThemeToggle />
      <div className="sidebar__user">
        <div className="sidebar__avatar">A</div>
        <div>
          <div style={{ fontSize: ".82rem", fontWeight: 600 }}>Ada Lovelace</div>
          <small>{store.workspace}</small>
        </div>
      </div>
    </aside>
  );
}
