import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StoredExecution } from "@cyflow/shared";
import { useStore } from "../../store/appStore";
import { apiBaseUrl, apiEnabled } from "../../store/api";
import type { Schedule } from "../../store/types";
import type { ErrorHandler, RouteDef } from "@cyflow/shared";
import { layoutScenario, NODE_W, type AddTarget } from "../../scenario/layout";
import {
  addRoute,
  insertIntoRoute,
  insertModule,
  makeNode,
  removeModule,
  removeRoute,
  setErrorHandler,
  setModuleFilter,
  updateModuleConnection,
  updateModuleParams,
  updateRoute,
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
  const [grabbing, setGrabbing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<StoredExecution | null>(null);
  const [picker, setPicker] = useState<{ target: AddTarget } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [history, setHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  const lastUpdated = useRef(scenario?.updatedAt);
  useEffect(() => {
    if (!scenario || lastUpdated.current === scenario.updatedAt) return;
    lastUpdated.current = scenario.updatedAt;
    setSaving(true);
    const t = setTimeout(() => setSaving(false), 700);
    return () => clearTimeout(t);
  }, [scenario?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link / demo hook: ?m=<moduleId> opens that module's config on load.
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("m");
    if (m) setSelectedId(m);
  }, []);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Wheel = zoom toward the pointer (non-passive so we can preventDefault).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const z = zoomRef.current;
      const z2 = clampZoom(z * Math.exp(-e.deltaY * 0.0015));
      const k = z2 / z;
      const p = panRef.current;
      setPan({ x: cx - k * (cx - p.x), y: cy - k * (cy - p.y) });
      setZoom(z2);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const layout = useMemo(
    () => (scenario ? layoutScenario(scenario.blueprint) : { nodes: [], edges: [], addSlots: [], width: 0, height: 0 }),
    [scenario?.blueprint], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const order = useMemo(() => layout.nodes.map((n) => n.node.id), [layout]);
  const { reducedRef } = useReducedMotion();

  const execute = useCallback(
    () => store.runOnce(scenario!.id, scenario!.blueprint),
    [scenario, store],
  );
  const pathForPair = useCallback((from: string, to: string) => pathMap.current.get(`${from}->${to}`) ?? null, []);
  // store.runOnce already records + persists; the builder only tracks the
  // current execution for the inspector.
  const onExecution = useCallback((exec: StoredExecution | null) => setExecution(exec), []);

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
    setGrabbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };
  const onPointerUp = () => {
    dragging.current = null;
    setGrabbing(false);
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

  const patchBlueprint = (blueprint: typeof scenario.blueprint) =>
    store.updateScenario(scenario.id, { blueprint });

  const addModule = (appKey: string, operation: string, target: AddTarget) => {
    const node = makeNode(scenario.blueprint, appKey, operation);
    const blueprint =
      target.kind === "route"
        ? insertIntoRoute(scenario.blueprint, target.routerId, target.routeIndex, node)
        : insertModule(scenario.blueprint, target.afterId, node);
    patchBlueprint(blueprint);
    setSelectedId(node.id);
    setPicker(null);
  };

  const selectedNode = layout.nodes.find((n) => n.node.id === selectedId);
  const predecessorId = layout.edges.find((e) => e.toId === selectedId)?.fromId ?? null;
  const upstream = selectedNode ? layout.nodes.filter((n) => n.number < selectedNode.number) : [];
  const selectedStep = execution?.steps.find((s) => s.moduleNodeId === selectedId);
  const allNodes = layout.nodes.map((n) => ({ id: n.node.id, label: n.label, number: n.number }));

  // Branches that received 0 bundles in the last run (dimmed on the canvas).
  const skippedEdges = new Set<string>();
  for (const s of execution?.steps ?? []) {
    for (const r of s.routes ?? []) {
      if (r.bundles === 0 && r.next) skippedEdges.add(`${s.moduleNodeId}->${r.next}`);
    }
  }

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
          <span className="savestate">
            {saving ? (
              "Saving…"
            ) : (
              <>
                <CheckIcon sw={2.4} width={13} height={13} /> Saved
              </>
            )}
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
        className={`builder__stage${grabbing ? " is-grabbing" : ""}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {(isRunning || execution) && (() => {
          const done = Object.values(statuses).filter((s) => s === "success" || s === "error").length;
          const active = Object.values(statuses).filter((s) => s === "running").length;
          const totalModules = layout.nodes.length;
          const queued = Math.max(0, totalModules - done - active);
          return (
            <div className={`statusbar${isRunning ? " is-running" : execution?.status === "FAILED" ? " is-failed" : ""}`}>
              <span className="dot" />
              {isRunning ? "Running…" : execution?.status === "FAILED" ? "Failed" : "Success"}
              {isRunning ? (
                <>
                  <span>·</span>
                  <span className="n">{Math.min(done + active, totalModules)}/{totalModules}</span>
                  <span className="statusbar__prog"><span style={{ width: `${(done / Math.max(totalModules, 1)) * 100}%` }} /></span>
                  {queued > 0 ? <span className="muted" style={{ color: "rgba(255,255,255,.6)" }}>{queued} queued</span> : null}
                </>
              ) : execution ? (
                <>
                  <span>·</span>
                  <span className="n">{ops} operations</span>
                </>
              ) : null}
            </div>
          );
        })()}

        {layout.nodes.length === 0 ? (
          <div className="builder__empty">
            <div style={{ textAlign: "center" }}>
              <button className="addbtn" style={{ position: "static", width: 56, height: 56, margin: "0 auto 12px" }} onClick={() => setPicker({ target: { kind: "after", afterId: null } })} aria-label="Add first module">
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
                    status={statuses[n.node.id] ?? "idle"}
                    selected={selectedId === n.node.id}
                    onSelect={() => setSelectedId(n.node.id)}
                  />
                </div>
              ))}

              {layout.edges.map((e) =>
                e.label ? (
                  <div
                    key={`l_${e.key}`}
                    className={`edgelabel${e.router ? " edgelabel--router" : ""}${skippedEdges.has(e.key) ? " skipped" : ""}`}
                    style={{ left: e.midX, top: e.midY - 26 }}
                  >
                    {e.label}
                  </div>
                ) : null,
              )}

              {layout.addSlots.map((slot) => (
                <button
                  key={slot.key}
                  className="addbtn"
                  style={{ left: slot.x, top: slot.y, transform: "translate(-50%, -50%)" }}
                  onClick={() => setPicker({ target: slot.target })}
                  aria-label="Add a module"
                >
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
              allNodes={allNodes}
              connections={store.connections}
              dataStores={store.dataStores.map((d) => ({ id: d.id, name: d.name }))}
              webhookUrl={apiEnabled && apiBaseUrl ? `${apiBaseUrl}/hooks/${scenario.id}` : undefined}
              step={selectedStep}
              execution={execution}
              onSave={(params) => patchBlueprint(updateModuleParams(scenario.blueprint, selectedNode.node.id, params))}
              onConnection={(connId) => {
                if (connId === "__new") {
                  store.navigate("connections");
                  return;
                }
                patchBlueprint(updateModuleConnection(scenario.blueprint, selectedNode.node.id, connId));
              }}
              onFilter={(filter) => patchBlueprint(setModuleFilter(scenario.blueprint, selectedNode.node.id, filter))}
              onError={(handler: ErrorHandler | null) => patchBlueprint(setErrorHandler(scenario.blueprint, selectedNode.node.id, handler))}
              onAddRoute={() => patchBlueprint(addRoute(scenario.blueprint, selectedNode.node.id))}
              onUpdateRoute={(index: number, patch: Partial<RouteDef>) => patchBlueprint(updateRoute(scenario.blueprint, selectedNode.node.id, index, patch))}
              onRemoveRoute={(index: number) => patchBlueprint(removeRoute(scenario.blueprint, selectedNode.node.id, index))}
              onTest={run}
              onDelete={() => {
                patchBlueprint(removeModule(scenario.blueprint, selectedNode.node.id));
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : null}
      </div>

      {picker ? (
        <ModulePicker
          context={picker.target.kind === "after" && picker.target.afterId === null ? "trigger" : "action"}
          onPick={(app, op) => addModule(app, op, picker.target)}
          onClose={() => setPicker(null)}
        />
      ) : null}
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
