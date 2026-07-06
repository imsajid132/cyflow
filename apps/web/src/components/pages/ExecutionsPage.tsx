import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { StatusPill, EmptyState } from "../ui";
import { ExecutionsIcon } from "../icons";
import { timeAgo } from "../../lib/format";

export function ExecutionsPage() {
  const store = useStore();

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Executions</h1>
          <p>History of scenario runs and their operations.</p>
        </div>
      </div>

      {store.executions.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={<ExecutionsIcon />}
            title="No executions yet"
            message="Run a scenario with 'Run once' and its execution will appear here."
          />
        </div>
      ) : (
        <div className="table glass">
          <div className="trow is-head" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
            <span>Scenario</span>
            <span>Steps</span>
            <span>Operations</span>
            <span>When</span>
            <span>Status</span>
          </div>
          {store.executions.map((e, i) => (
            <div
              className="trow"
              style={{ gridTemplateColumns: "1fr auto auto auto auto" }}
              key={i}
              role="button"
              tabIndex={0}
              onClick={() => store.navigate("builder", e.scenarioId)}
              onKeyDown={(ev) => (ev.key === "Enter" ? store.navigate("builder", e.scenarioId) : undefined)}
            >
              <div className="trow__main">
                <div className="trow__icon">
                  <ModuleIcon app="webhook" operation="" sw={1.7} />
                </div>
                <b>{e.scenarioName}</b>
              </div>
              <span className="muted mono">{e.execution.steps.length || "—"}</span>
              <span className="muted mono">{e.execution.operations}</span>
              <span className="muted">{timeAgo(e.ranAt)}</span>
              <StatusPill status={e.execution.status} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
