import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoredExecution } from "@cyflow/shared";
import { useStore } from "../../store/appStore";
import type { Schedule } from "../../store/types";
import { layoutScenario, NODE_W } from "../../scenario/layout";
import { runOnce } from "../../scenario/localEngine";
import {
  insertModule,
  makeNode,
  removeModule,
  updateModuleConnection,
  updateModuleParams,
} from "../../scenario/blueprintOps";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { useRunOnce } from "../../hooks/useRunOnce";
import { ModuleBubble } from "../ModuleBubble";
import { Button } from "../Button";
import { StatusPill } from "../ui";
import { ArrowLeftIcon, PlayIcon, CalendarIcon, PlusIcon, MinusIcon, FitIcon, CheckIcon, ExecutionsIcon } from "../icons";
import { ModuleConfigPanel } from "./ModuleConfigPanel";
import { ModulePicker } from "./ModulePicker";
import { ScheduleModal } from "./ScheduleModal";
import { HistoryModal } from "./HistoryModal";

const clampZoom = (z: number) => Math.min(1.4, Math.max(0.35, z));

export function ScenarioBuilder() {
  const store = useStore();
  const scenario = store.scenarioById(store.selectedScenarioId);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const packetRef = useRef<SVGCircleElement | null>(null);
  const pathMap = useRef<Map<string, SVGPathElement | null>>(new Map());

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<StoredExecution | null>(null);
  const [picker, setPicker] = useState<{ afterId: string | null } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [history, setHistory] = useState(false);

  const layout = useMemo(
    () => (scenario ? layoutScenario(scenario.blueprint) : { nodes: [], edges: [], width: 0, height: 0 }),
    [scenario?.blueprint], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const order = useMemo(() => layout.nodes.map((n) => n.node.id), [layout]);
  const { reducedRef } = useReducedMotion();

  const execute = useCallback(() => runOnce(scenario!.blueprint), [scenario]); // eslint-disable-line react-hooks/exhaustive-deps
  const pathForPair = useCallback((from: string, to: string) => pathMap.current.get(`${from}->${to}`) ?? null, []);
  const onExecution = useCallback(
    (exec: StoredExecution | null) => {
      setExecution(exec);
      if (exec && scenario) store.recordExecution(scenario.id, exec);
    },
    [scenario, store],
  );

  const { statuses, ops, isRunning, run } = useRunOnce({
    order,
    execute,
    packetRef,
    pathForPair,
    reducedRef,
    onSelect: setSelectedId,
    onExecution,
  });

  // fit-to-screen from the computed layout size (no DOM measurement)
  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || layout.width === 0) return;
    const zw = (stage.clientWidth - 90) / layout.width;
    const zh = (stage.clientHeight - 90) / layout.height;
    setZoom(clampZoom(Math.min(1, zw, zh)));
    setPan({ x: 0, y: 0 });
  }, [layout.width, layout.height]);

  useEffect(() => {
    const t = setTimeout(fit, 40);
    return () => clearTimeout(t);
  }, [scenario?.id, layout.width, layout.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // pan
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".node, .addbtn, .chrome, .statusbar, .dockpanel")) return;
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  if (!scenario) {
    return (
      <div className="builder">
        <div className="builder__bar glass">
          <button className="builder__back" onClick={() => store.navigate("scenarios")} aria-label="Back">
            <ArrowLeftIcon />
          </button>
          <span className="builder__name">Scenario not found</span>
        </div>
        <div className="builder__stage" />
      </div>
    );
  }

  const addModule = (appKey: string, operation: string, afterId: string | null) => {
    const node = makeNode(scenario.blueprint, appKey, operation);
    store.updateScenario(scenario.id, { blueprint: insertModule(scenario.blueprint, afterId, node) });
    setSelectedId(node.id);
    setPicker(null);
  };

  const fromIds = new Set(layout.edges.map((e) => e.fromId));
  const leaves = layout.nodes.filter(
    (n) => !fromIds.has(n.node.id) && !(n.node.routes && n.node.routes.length),
  );

  const selectedNode = layout.nodes.find((n) => n.node.id === selectedId);
  const predecessorId = layout.edges.find((e) => e.toId === selectedId)?.fromId ?? null;
  const upstream = selectedNode ? layout.nodes.filter((n) => n.number < selectedNode.number) : [];
  const selectedStep = execution?.steps.find((s) => s.moduleNodeId === selectedId);

  const worldStyle: React.CSSProperties = {
    left: "50%",
    top: "50%",
    transformOrigin: "center",
    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    width: layout.width,
    height: layout.height,
  };

  return (
    <div className="builder">
      <div className="builder__bar glass">
        <button className="builder__back" onClick={() => store.navigate("scenarios")} aria-label="Back to scenarios">
          <ArrowLeftIcon />
        </button>
        <input
          className="builder__name"
          value={scenario.name}
          onChange={(e) => store.updateScenario(scenario.id, { name: e.target.value })}
          aria-label="Scenario name"
        />
        <div className="builder__status">
          <StatusPill status={scenario.status} />
          <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <CheckIcon sw={2.4} width={13} height={13} /> Saved
          </span>
        </div>
        <div className="builder__actions">
          <Button variant="ghost" icon={<ExecutionsIcon width={15} height={15} />} onClick={() => setHistory(true)}>
            History
          </Button>
          <Button variant="ghost" icon={<CalendarIcon width={15} height={15} />} onClick={() => setScheduling(true)}>
            Schedule
          </Button>
          <Button variant="primary" icon={<PlayIcon width={15} height={15} />} onClick={run} disabled={isRunning || layout.nodes.length === 0}>
            Run once
          </Button>
        </div>
      </div>

      <div
        className="builder__stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {(isRunning || execution) && (
          <div className={`statusbar${isRunning ? " is-running" : execution?.status === "FAILED" ? " is-failed" : ""}`}>
            <span className="dot" />
            {isRunning ? "Running…" : execution?.status === "FAILED" ? "Failed" : "Success"}
            {!isRunning && execution ? (
              <>
                <span>·</span>
                <span className="n">{ops} operations</span>
              </>
            ) : null}
          </div>
        )}

        {layout.nodes.length === 0 ? (
          <div className="builder__empty">
            <div style={{ textAlign: "center" }}>
              <button className="addbtn" style={{ position: "static", width: 56, height: 56, margin: "0 auto 12px" }} onClick={() => setPicker({ afterId: null })} aria-label="Add first module">
                <PlusIcon width={22} height={22} />
              </button>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>Add your first module</div>
              <div className="muted">Start with a trigger, like a Webhook.</div>
            </div>
          </div>
        ) : (
          <div className="world" style={worldStyle}>
            <div className="flow" style={{ width: layout.width, height: layout.height }}>
              <svg className="links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
                {layout.edges.map((e) => (
                  <path key={e.key} d={e.d} ref={(el) => pathMap.current.set(e.key, el)} />
                ))}
                <circle className="packet" r={7} ref={packetRef} />
              </svg>

              {layout.nodes.map((n) => (
                <div className="bubblewrap" key={n.node.id} style={{ left: n.x, top: n.y, width: NODE_W }}>
                  <ModuleBubble
                    module={n}
                    status={statuses[n.node.id] ?? "idle"}
                    selected={selectedId === n.node.id}
                    onSelect={() => setSelectedId(n.node.id)}
                  />
                </div>
              ))}

              {layout.edges.map((e) =>
                e.label ? (
                  <div key={`l_${e.key}`} className={`edgelabel${e.router ? " edgelabel--router" : ""}`} style={{ left: e.midX, top: e.midY - 26 }}>
                    {e.label}
                  </div>
                ) : null,
              )}

              {layout.edges
                .filter((e) => !e.router)
                .map((e) => (
                  <button key={`a_${e.key}`} className="addbtn" style={{ left: e.midX, top: e.midY, transform: "translate(-50%, -50%)" }} onClick={() => setPicker({ afterId: e.fromId })} aria-label="Add a module">
                    <PlusIcon width={15} height={15} />
                  </button>
                ))}

              {leaves.map((n) => (
                <button key={`e_${n.node.id}`} className="addbtn" style={{ left: n.x + NODE_W / 2 + 44 + 22, top: n.y + 44, transform: "translate(-50%, -50%)" }} onClick={() => setPicker({ afterId: n.node.id })} aria-label="Add a module">
                  <PlusIcon width={15} height={15} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="chrome chrome--zoom">
          <button className="chrome__btn" onClick={() => setZoom((z) => clampZoom(z - 0.1))} aria-label="Zoom out">
            <MinusIcon />
          </button>
          <span className="chrome__z">{Math.round(zoom * 100)}%</span>
          <button className="chrome__btn" onClick={() => setZoom((z) => clampZoom(z + 0.1))} aria-label="Zoom in">
            <PlusIcon />
          </button>
        </div>
        <div className="chrome chrome--tools">
          <button className="chrome__btn" onClick={fit} aria-label="Fit to screen">
            <FitIcon />
          </button>
        </div>

        {selectedNode ? (
          <div className="dockpanel">
            <ModuleConfigPanel
              module={selectedNode.node}
              moduleNumber={selectedNode.number}
              predecessorId={predecessorId}
              upstream={upstream.map((u) => ({ id: u.node.id, label: u.label, number: u.number, node: u.node }))}
              connections={store.connections}
              step={selectedStep}
              onSave={(params) => store.updateScenario(scenario.id, { blueprint: updateModuleParams(scenario.blueprint, selectedNode.node.id, params) })}
              onConnection={(connId) => {
                if (connId === "__new") {
                  store.navigate("connections");
                  return;
                }
                store.updateScenario(scenario.id, { blueprint: updateModuleConnection(scenario.blueprint, selectedNode.node.id, connId) });
              }}
              onTest={run}
              onDelete={() => {
                store.updateScenario(scenario.id, { blueprint: removeModule(scenario.blueprint, selectedNode.node.id) });
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : null}
      </div>

      {picker ? <ModulePicker onPick={(app, op) => addModule(app, op, picker.afterId)} onClose={() => setPicker(null)} /> : null}
      {scheduling ? (
        <ScheduleModal
          schedule={scenario.schedule}
          active={scenario.status === "ACTIVE"}
          onRunOnce={() => {
            setScheduling(false);
            run();
          }}
          onSave={(schedule: Schedule, on: boolean) => {
            store.updateScenario(scenario.id, { schedule, status: on ? "ACTIVE" : "PAUSED" });
            setScheduling(false);
          }}
          onClose={() => setScheduling(false)}
        />
      ) : null}
      {history ? <HistoryModal scenarioId={scenario.id} onClose={() => setHistory(false)} /> : null}
    </div>
  );
}
