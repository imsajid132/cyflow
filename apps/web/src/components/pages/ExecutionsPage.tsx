import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { StatusPill, EmptyState } from "../ui";
import { ExecutionsIcon, ChevronRightIcon } from "../icons";
import { nodeMeta } from "../../scenario/model";
import { timeAgo, clockTime, durationOf, formatDuration } from "../../lib/format";
import type { ExecutionEntry } from "../../store/types";

const COLS = "auto 1.3fr 0.9fr auto auto auto 28px";

export function ExecutionsPage() {
  const store = useStore();

  const triggerLabel = (e: ExecutionEntry): string => {
    const bp = e.blueprint ?? store.scenarioById(e.scenarioId)?.blueprint;
    const first = bp?.modules[0];
    return first ? nodeMeta(first).label : "Manual";
  };

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Executions</h1>
          <p>Every scenario run — open one to replay it step by step.</p>
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
          <div className="trow is-head" style={{ gridTemplateColumns: COLS }}>
            <span>Status</span>
            <span>Scenario</span>
            <span>Trigger</span>
            <span>Started</span>
            <span>Duration</span>
            <span>Ops</span>
            <span />
          </div>
          {store.executions.map((e, i) => {
            const dur = durationOf(e.execution);
            return (
              <div
                className="trow"
                style={{ gridTemplateColumns: COLS }}
                key={e.execution.id || i}
                role="button"
                tabIndex={0}
                onClick={() => store.openExecution(e.execution.id)}
                onKeyDown={(ev) => (ev.key === "Enter" ? store.openExecution(e.execution.id) : undefined)}
              >
                <StatusPill status={e.execution.status} />
                <div className="trow__main">
                  <div className="trow__icon">
                    <ModuleIcon app={e.blueprint?.modules[0]?.app ?? "webhook"} operation="" sw={1.7} />
                  </div>
                  <b>{e.scenarioName}</b>
                </div>
                <span className="muted">{triggerLabel(e)}</span>
                <span className="muted" title={clockTime(e.ranAt)}>{timeAgo(e.ranAt)}</span>
                <span className="muted mono" title={`Finished ${clockTime(e.execution.finishedAt)}`}>
                  {dur > 0 ? formatDuration(dur) : "—"}
                </span>
                <span className="muted mono">{e.execution.operations}</span>
                <span className="muted" style={{ display: "grid", placeItems: "center" }}>
                  <ChevronRightIcon width={15} height={15} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
