import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Blueprint, StoredExecutionStep } from "@cyflow/shared";
import { useStore } from "../../store/appStore";
import { layoutScenario, NODE_W } from "../../scenario/layout";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useReplay } from "../../hooks/useReplay";
import { useCanvasControls } from "../../hooks/useCanvasControls";
import { ModuleBubble } from "../ModuleBubble";
import { Button } from "../Button";
import { StatusPill } from "../ui";
import { ArrowLeftIcon, PlayIcon, MinusIcon, PlusIcon, FitIcon, BoltIcon, ScenariosIcon, ResetIcon } from "../icons";
import { ReplayInspector } from "./ReplayInspector";
import { PerformanceModal, slowSet, type PerfRow } from "./PerformanceModal";
import { durationOf, formatDuration } from "../../lib/format";

/** Reconstruct a linear blueprint from steps when the scenario is unavailable. */
function syntheticBlueprint(steps: StoredExecutionStep[]): Blueprint {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  return {
    modules: ordered.map((s, i) => ({
      id: s.moduleNodeId,
      app: "core",
      operation: "",
      kind: i === 0 ? "trigger" : "action",
      params: {},
      next: ordered[i + 1]?.moduleNodeId ?? null,
    })),
  };
}

const SpeedIcon = ({ x }: { x: number }) => <span className="mono" style={{ fontSize: ".72rem" }}>{x}×</span>;

export function ExecutionReplay() {
  const store = useStore();
  const entry = store.executionById(store.selectedExecutionId);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const packetRef = useRef<SVGCircleElement | null>(null);
  const pathMap = useRef<Map<string, SVGPathElement | null>>(new Map());
  const { reducedRef } = useReducedMotion();
  const [perfOpen, setPerfOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const steps = useMemo(
    () => (entry ? [...entry.execution.steps].sort((a, b) => a.order - b.order) : []),
    [entry],
  );
  const blueprint = useMemo<Blueprint>(
    () => entry?.blueprint ?? store.scenarioById(entry?.scenarioId ?? null)?.blueprint ?? syntheticBlueprint(steps),
    [entry, store, steps],
  );
  const layout = useMemo(() => layoutScenario(blueprint), [blueprint]);

  const nodesById = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout]);
  const stepIndexById = useMemo(() => new Map(steps.map((s, i) => [s.moduleNodeId, i])), [steps]);

  const pathForPair = useCallback((from: string, to: string) => pathMap.current.get(`${from}->${to}`) ?? null, []);
  const replay = useReplay({ steps, pathForPair, packetRef, reducedRef });
  const controls = useCanvasControls(layout.width, layout.height, stageRef);

  useEffect(() => {
    const t = setTimeout(controls.fit, 40);
    return () => clearTimeout(t);
  }, [layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const skippedEdges = useMemo(() => {
    const set = new Set<string>();
    for (const s of steps) for (const r of s.routes ?? []) if (r.bundles === 0 && r.next) set.add(`${s.moduleNodeId}->${r.next}`);
    return set;
  }, [steps]);

  const perfRows: PerfRow[] = useMemo(
    () => layout.nodes.map((n) => ({ label: n.label, number: n.number, ms: steps[stepIndexById.get(n.node.id) ?? -1]?.ms ?? 0 })),
    [layout, steps, stepIndexById],
  );
  const slow = useMemo(() => slowSet(perfRows), [perfRows]);
  const totalMs = entry ? durationOf(entry.execution) : 0;

  if (!entry) {
    return (
      <div className="builder">
        <div className="builder__bar glass">
          <button className="builder__back" onClick={() => store.navigate("executions")} aria-label="Back">
            <ArrowLeftIcon />
          </button>
          <span className="builder__name">Execution not found</span>
        </div>
        <div className="builder__stage" />
      </div>
    );
  }

  const failedStep = steps.find((s) => s.status === "error");
  const failedModule = failedStep ? blueprint.modules.find((m) => m.id === failedStep.moduleNodeId) : undefined;
  const canResume = Boolean(failedModule?.errorHandler);

  const rerun = async () => {
    setBusy(true);
    try {
      const exec = await store.runOnce(entry.scenarioId, blueprint);
      store.openExecution(exec.id);
    } finally {
      setBusy(false);
    }
  };

  const selectedStep = steps[replay.cursor];
  const selectedNode = selectedStep ? nodesById.get(selectedStep.moduleNodeId) : undefined;
  const total = steps.length;
  const status = entry.execution.status;

  return (
    <div className="builder">
      <div className="builder__bar glass">
        <button className="builder__back" onClick={() => store.navigate("executions")} aria-label="Back to executions">
          <ArrowLeftIcon />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="builder__name" style={{ pointerEvents: "none" }}>{entry.scenarioName}</div>
        </div>
        <div className="builder__status">
          <StatusPill status={status} />
          <span className="muted mono" style={{ fontSize: ".72rem" }}>{formatDuration(totalMs)}</span>
        </div>
        <div className="builder__actions">
          <Button variant="ghost" icon={<BoltIcon width={14} height={14} />} onClick={() => setPerfOpen(true)}>Performance</Button>
          <Button variant="ghost" icon={<ScenariosIcon width={15} height={15} />} onClick={() => store.navigate("builder", entry.scenarioId)}>Open in builder</Button>
          {status === "FAILED" && canResume ? (
            <Button variant="ghost" onClick={rerun} disabled={busy} title="Re-runs with the error handler in place">Resume</Button>
          ) : null}
          <Button variant="primary" icon={<ResetIcon width={14} height={14} />} onClick={rerun} disabled={busy}>
            {status === "FAILED" ? "Retry" : "Run again"}
          </Button>
        </div>
      </div>

      <div
        className={`builder__stage${controls.grabbing ? " is-grabbing" : ""}`}
        ref={stageRef}
        {...controls.stageHandlers}
      >
        <div className={`statusbar${status === "FAILED" ? " is-failed" : ""}`}>
          <span className="dot" />
          {status === "FAILED" ? "Failed" : "Success"}
          {total > 0 ? (
            <>
              <span>·</span>
              <span className="n">module {Math.min(replay.cursor + 1, total)} / {total}</span>
              <span className="statusbar__prog"><span style={{ width: `${((replay.cursor + 1) / total) * 100}%` }} /></span>
            </>
          ) : null}
        </div>

        {total === 0 ? (
          <div className="builder__empty">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>No step data for this run</div>
              <div className="muted">Run this scenario again to capture a replay.</div>
            </div>
          </div>
        ) : (
          <div className="world" style={controls.worldStyle}>
            <div className="flow" style={{ width: layout.width, height: layout.height }}>
              <svg className="links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
                {layout.edges.map((e) => (
                  <path
                    key={e.key}
                    className={`${e.stub ? "stub" : ""}${skippedEdges.has(e.key) ? " skipped" : ""}`.trim() || undefined}
                    d={e.d}
                    ref={(el) => pathMap.current.set(e.key, el)}
                  />
                ))}
                <circle className="packet" r={7} ref={packetRef} />
              </svg>

              {layout.nodes.map((n) => (
                <div className="bubblewrap" key={n.node.id} style={{ left: n.x, top: n.y, width: NODE_W }}>
                  <ModuleBubble
                    module={n}
                    status={replay.statuses[n.node.id] ?? "idle"}
                    selected={replay.currentId === n.node.id}
                    onSelect={() => replay.scrubTo(stepIndexById.get(n.node.id) ?? replay.cursor)}
                  />
                  {slow.has(n.number) && perfRows.find((r) => r.number === n.number)!.ms > 0 ? (
                    <span className="slowchip">{formatDuration(perfRows.find((r) => r.number === n.number)!.ms)}</span>
                  ) : null}
                </div>
              ))}

              {layout.edges.map((e) =>
                e.label ? (
                  <div key={`l_${e.key}`} className={`edgelabel${e.router ? " edgelabel--router" : ""}${skippedEdges.has(e.key) ? " skipped" : ""}`} style={{ left: e.midX, top: e.midY - 26 }}>
                    {e.label}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="chrome chrome--zoom">
          <button className="chrome__btn" onClick={controls.zoomOut} aria-label="Zoom out"><MinusIcon /></button>
          <span className="chrome__z">{Math.round(controls.zoom * 100)}%</span>
          <button className="chrome__btn" onClick={controls.zoomIn} aria-label="Zoom in"><PlusIcon /></button>
        </div>
        <div className="chrome chrome--tools">
          <button className="chrome__btn" onClick={controls.fit} aria-label="Fit to screen"><FitIcon /></button>
        </div>

        {/* playback bar */}
        {total > 0 ? (
          <div className="playbar">
            <button className="chrome__btn" onClick={replay.stepBack} aria-label="Step back" disabled={replay.cursor <= 0}>‹</button>
            <button className="playbar__play" onClick={replay.toggle} aria-label={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? <span style={{ fontSize: 15 }}>❚❚</span> : <PlayIcon width={16} height={16} />}
            </button>
            <button className="chrome__btn" onClick={replay.stepForward} aria-label="Step forward" disabled={replay.cursor >= total - 1}>›</button>
            <input
              className="playbar__scrub"
              type="range"
              min={0}
              max={total - 1}
              value={replay.cursor}
              onChange={(e) => replay.scrubTo(Number(e.target.value))}
              aria-label="Timeline"
            />
            <div className="playbar__speed">
              {[0.5, 1, 2, 4].map((x) => (
                <button key={x} className={`playbar__spd${replay.speed === x ? " is-active" : ""}`} onClick={() => replay.setSpeed(x)}>
                  <SpeedIcon x={x} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedStep && selectedNode ? (
          <div className="dockpanel">
            <ReplayInspector
              step={selectedStep}
              app={selectedNode.node.app}
              operation={selectedNode.node.operation}
              title={selectedNode.label}
              number={selectedNode.number}
            />
          </div>
        ) : null}
      </div>

      {perfOpen ? <PerformanceModal rows={perfRows} totalMs={totalMs} onClose={() => setPerfOpen(false)} /> : null}
    </div>
  );
}
