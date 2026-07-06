import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { StatusPill, EmptyState } from "../ui";
import { ExecutionsIcon, ChevronRightIcon } from "../icons";
import { nodeMeta } from "../../scenario/model";
import { timeAgo, clockTime, durationOf, formatDuration } from "../../lib/format";
import type { ExecutionEntry } from "../../store/types";

const COLS = "96px minmax(0, 1.6fr) 130px 116px 104px 60px 132px";

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
        <div className="table glass exectable">
          <div className="trow is-head" style={{ gridTemplateColumns: COLS }}>
            <span>Status</span>
            <span>Scenario</span>
            <span>Trigger</span>
            <span>Started</span>
            <span className="num">Duration</span>
            <span className="num">Ops</span>
            <span />
          </div>
          {store.executions.map((e, i) => {
            const wall = durationOf(e.execution);
            const stepMs = e.execution.steps.reduce((a, s) => a + (s.ms || 0), 0);
            const dur = wall || stepMs;
            const failed = e.execution.status === "FAILED";
            const stepCount = e.execution.steps.length;
            const open = () => store.openExecution(e.execution.id);
            return (
              <div
                className={`trow${failed ? " is-failed" : ""}`}
                style={{ gridTemplateColumns: COLS }}
                key={e.execution.id || i}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(ev) => (ev.key === "Enter" ? open() : undefined)}
              >
                <StatusPill status={e.execution.status} />
                <div className="trow__main">
                  <div className="trow__icon">
                    <ModuleIcon app={e.blueprint?.modules[0]?.app ?? "webhook"} operation="" sw={1.7} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.scenarioName}
                    </b>
                    <span className={`exec__sub${failed ? " is-err" : ""}`}>
                      {failed
                        ? e.execution.error ?? "Run failed — open to debug"
                        : stepCount > 0
                          ? `${stepCount} step${stepCount === 1 ? "" : "s"}`
                          : "no step data"}
                    </span>
                  </div>
                </div>
                <span className="muted">{triggerLabel(e)}</span>
                <span className="muted" title={clockTime(e.ranAt)}>{timeAgo(e.ranAt)}</span>
                <span className="num muted" title={`Finished ${clockTime(e.execution.finishedAt)}`}>
                  {dur > 0 ? formatDuration(dur) : "—"}
                </span>
                <span className="num muted">{e.execution.operations}</span>
                <span className="replaybtn">
                  Open replay <ChevronRightIcon width={13} height={13} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
