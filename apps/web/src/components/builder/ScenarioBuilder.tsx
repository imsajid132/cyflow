import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StoredExecution } from "@cyflow/shared";
import { useStore } from "../../store/appStore";
import type { Schedule } from "../../store/types";
import { deriveModules } from "../../scenario/model";
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
import { ConnectorLinks } from "../ConnectorLinks";
import { Button } from "../Button";
import { StatusPill } from "../ui";
import {
  ArrowLeftIcon,
  PlayIcon,
  CalendarIcon,
  PlusIcon,
  MinusIcon,
  FitIcon,
} from "../icons";
import { ModuleConfigPanel } from "./ModuleConfigPanel";
import { ModulePicker } from "./ModulePicker";
import { ScheduleModal } from "./ScheduleModal";

interface AddPos {
  x: number;
  y: number;
  afterId: string | null;
}

const clampZoom = (z: number) => Math.min(1.4, Math.max(0.4, z));

export function ScenarioBuilder() {
  const store = useStore();
  const scenario = store.scenarioById(store.selectedScenarioId);

  const flowRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const packetRef = useRef<SVGCircleElement | null>(null);

  const [paths, setPaths] = useState<string[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [adds, setAdds] = useState<AddPos[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<StoredExecution | null>(null);
  const [picker, setPicker] = useState<{ afterId: string | null } | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const modules = useMemo(
    () => (scenario ? deriveModules(scenario.blueprint) : []),
    [scenario?.blueprint], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const moduleIds = useMemo(() => modules.map((m) => m.node.id), [modules]);
  const { reducedRef } = useReducedMotion();

  const execute = useCallback(
    () => runOnce(scenario!.blueprint),
    [scenario], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onExecution = useCallback(
    (exec: StoredExecution | null) => {
      setExecution(exec);
      if (exec && scenario) store.recordExecution(scenario.id, exec);
    },
    [scenario, store],
  );

  const onSelectIndex = useCallback(
    (i: number) => setSelectedId(moduleIds[i] ?? null),
    [moduleIds],
  );

  const { statuses, ops, isRunning, run } = useRunOnce({
    moduleIds,
    execute,
    pathRefs,
    packetRef,
    reducedRef,
    onSelect: onSelectIndex,
    onExecution,
  });

  // ---- geometry (unscaled, zoom-compensated) ----
  const drawLinks = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const fr = flow.getBoundingClientRect();
    const z = zoom || 1;
    const nextPaths: string[] = [];
    const nextAdds: AddPos[] = [];

    const centre = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - fr.left + r.width / 2) / z,
        y: (r.top - fr.top + r.height / 2) / z,
        rad: r.width / 2 / z,
      };
    };

    for (let i = 0; i < modules.length - 1; i++) {
      const a = bubbleRefs.current[i];
      const b = bubbleRefs.current[i + 1];
      if (!a || !b) {
        nextPaths.push("");
        continue;
      }
      const ca = centre(a);
      const cb = centre(b);
      const x1 = ca.x + ca.rad + 2;
      const x2 = cb.x - cb.rad - 2;
      const mx = (x1 + x2) / 2;
      nextPaths.push(`M ${x1} ${ca.y} C ${mx} ${ca.y} ${mx} ${cb.y} ${x2} ${cb.y}`);
      nextAdds.push({ x: (x1 + x2) / 2, y: (ca.y + cb.y) / 2, afterId: modules[i].node.id });
    }

    // end (append) button
    const last = bubbleRefs.current[modules.length - 1];
    if (last) {
      const cl = centre(last);
      nextAdds.push({ x: cl.x + cl.rad + 44, y: cl.y, afterId: modules[modules.length - 1].node.id });
    }

    setPaths(nextPaths);
    setAdds(nextAdds);
    setSize({ w: fr.width / z, h: fr.height / z });
  }, [modules, zoom]);

  useLayoutEffect(() => {
    drawLinks();
  }, [drawLinks]);

  useEffect(() => {
    const onResize = () => drawLinks();
    window.addEventListener("resize", onResize);
    if (document.fonts?.ready) document.fonts.ready.then(drawLinks).catch(() => {});
    return () => window.removeEventListener("resize", onResize);
  }, [drawLinks]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const flow = flowRef.current;
    if (!stage || !flow) return;
    const flowW = flow.scrollWidth / (zoom || 1);
    const stageW = stage.clientWidth;
    const next = clampZoom(Math.min(1, (stageW - 120) / Math.max(flowW, 1)));
    setZoom(next);
    setPan({ x: 0, y: 0 });
  }, [zoom]);

  // fit when the scenario / module count changes
  useEffect(() => {
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, [scenario?.id, modules.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pan ----
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".node, .addbtn, .chrome, .statusbar, .dockpanel")) return;
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
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

  const selectedModule = modules.find((m) => m.node.id === selectedId);
  const selectedIdx = modules.findIndex((m) => m.node.id === selectedId);
  const selectedStep = execution?.steps.find((s) => s.moduleNodeId === selectedId);

  const worldStyle: React.CSSProperties = {
    left: "50%",
    top: "50%",
    transformOrigin: "center",
    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
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
        </div>
        <div className="builder__actions">
          <Button variant="ghost" icon={<CalendarIcon width={15} height={15} />} onClick={() => setScheduling(true)}>
            Schedule
          </Button>
          <Button
            variant="ghost"
            onClick={() => store.updateScenario(scenario.id, { status: scenario.status === "DRAFT" ? "ACTIVE" : scenario.status })}
          >
            Save
          </Button>
          <Button variant="primary" icon={<PlayIcon width={15} height={15} />} onClick={run} disabled={isRunning || modules.length === 0}>
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

        {modules.length === 0 ? (
          <div className="builder__empty">
            <div style={{ textAlign: "center" }}>
              <button className="addbtn" style={{ width: 56, height: 56, margin: "0 auto 12px", position: "static" }} onClick={() => setPicker({ afterId: null })} aria-label="Add first module">
                <PlusIcon width={22} height={22} />
              </button>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem" }}>
                Add your first module
              </div>
              <div className="muted">Start with a trigger, like a Webhook.</div>
            </div>
          </div>
        ) : (
          <div className="world" style={worldStyle}>
            <div className="flow" ref={flowRef}>
              <ConnectorLinks paths={paths} width={size.w} height={size.h} pathRefs={pathRefs} packetRef={packetRef} />
              {modules.map((m, i) => (
                <ModuleBubble
                  key={m.node.id}
                  module={m}
                  status={statuses[i]}
                  selected={selectedId === m.node.id}
                  onSelect={() => setSelectedId(m.node.id)}
                  bubbleRef={(el) => {
                    bubbleRefs.current[i] = el;
                  }}
                />
              ))}
              {adds.map((a, i) => (
                <button
                  key={i}
                  className="addbtn"
                  style={{ position: "absolute", left: a.x, top: a.y, transform: "translate(-50%, -50%)" }}
                  onClick={() => setPicker({ afterId: a.afterId })}
                  aria-label="Add a module"
                >
                  <PlusIcon width={16} height={16} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* zoom controls */}
        <div className="chrome chrome--zoom">
          <button className="chrome__btn" onClick={() => setZoom((z) => clampZoom(z - 0.1))} aria-label="Zoom out">
            <MinusIcon />
          </button>
          <span className="chrome__z">{Math.round(zoom * 100)}%</span>
          <button className="chrome__btn" onClick={() => setZoom((z) => clampZoom(z + 0.1))} aria-label="Zoom in">
            <PlusIcon />
          </button>
        </div>
        {/* mini toolbar */}
        <div className="chrome chrome--tools">
          <button className="chrome__btn" onClick={fit} aria-label="Fit to screen">
            <FitIcon />
          </button>
        </div>

        {selectedModule ? (
          <div className="dockpanel">
            <ModuleConfigPanel
              module={selectedModule.node}
              moduleNumber={selectedIdx + 1}
              predecessorId={selectedIdx > 0 ? modules[selectedIdx - 1].node.id : null}
              connections={store.connections}
              step={selectedStep}
              onSave={(params) =>
                store.updateScenario(scenario.id, { blueprint: updateModuleParams(scenario.blueprint, selectedModule.node.id, params) })
              }
              onConnection={(connId) => {
                if (connId === "__new") {
                  store.navigate("connections");
                  return;
                }
                store.updateScenario(scenario.id, { blueprint: updateModuleConnection(scenario.blueprint, selectedModule.node.id, connId) });
              }}
              onTest={run}
              onDelete={() => {
                store.updateScenario(scenario.id, { blueprint: removeModule(scenario.blueprint, selectedModule.node.id) });
                setSelectedId(null);
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        ) : null}
      </div>

      {picker ? (
        <ModulePicker onPick={(app, op) => addModule(app, op, picker.afterId)} onClose={() => setPicker(null)} />
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
    </div>
  );
}
