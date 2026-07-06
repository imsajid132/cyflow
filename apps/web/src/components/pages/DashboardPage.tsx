import { useStore } from "../../store/appStore";
import { ScenarioCard } from "../ScenarioCard";
import { StatusPill } from "../ui";
import { ModuleIcon } from "../ModuleIcon";
import { timeAgo } from "../../lib/format";

export function DashboardPage() {
  const store = useStore();
  const active = store.scenarios.filter((s) => s.status === "ACTIVE").length;
  const totalOps = store.scenarios.reduce((n, s) => n + (s.operations ?? 0), 0);
  const recent = store.scenarios.slice(0, 3);

  const stats = [
    { label: "Scenarios", value: store.scenarios.length, sub: `${active} active` },
    { label: "Operations", value: totalOps, sub: "this cycle" },
    { label: "Executions", value: store.executions.length, sub: "recent" },
    { label: "Connections", value: store.connections.length, sub: "connected apps" },
  ];

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Dashboard</h1>
          <p>Overview of your automation workspace.</p>
        </div>
      </div>

      <div className="stats">
        {stats.map((s) => (
          <div className="stat glass" key={s.label}>
            <div className="stat__label">{s.label}</div>
            <div className="stat__value">{s.value}</div>
            <div className="stat__sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section__head">
          <h2>Recent scenarios</h2>
          <a onClick={() => store.navigate("scenarios")}>View all</a>
        </div>
        <div className="cards">
          {recent.map((s) => (
            <ScenarioCard key={s.id} scenario={s} onOpen={() => store.navigate("builder", s.id)} />
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2>Recent executions</h2>
          <a onClick={() => store.navigate("executions")}>View all</a>
        </div>
        <div className="table glass">
          {store.executions.slice(0, 5).map((e, i) => (
            <div className="trow" style={{ gridTemplateColumns: "1fr auto auto auto" }} key={i}>
              <div className="trow__main">
                <div className="trow__icon">
                  <ModuleIcon app="flow" operation="router" sw={1.8} />
                </div>
                <b>{e.scenarioName}</b>
              </div>
              <span className="muted mono">{e.execution.operations} ops</span>
              <span className="muted">{timeAgo(e.ranAt)}</span>
              <StatusPill status={e.execution.status} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
