import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Blueprint, Bundle, StoredExecution } from "@cyflow/shared";
import type { UiModule } from "../scenario/model";
import { runOnce } from "../scenario/localEngine";
import { ModuleBubble } from "./ModuleBubble";
import { ConnectorLinks } from "./ConnectorLinks";
import { Button } from "./Button";
import { PlayIcon, ResetIcon } from "./icons";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useRunOnce } from "../hooks/useRunOnce";

interface CanvasProps {
  blueprint: Blueprint;
  trigger: Bundle[];
  modules: UiModule[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onExecution: (execution: StoredExecution | null) => void;
}

/**
 * The lime-world stage: frosted bubbles joined by ink-black curved links, a
 * header with the scenario title and the "Run Once" / "Reset" controls, and the
 * floating operations meter. Owns connector geometry and drives the real engine
 * replay.
 */
export function Canvas({
  blueprint,
  trigger,
  modules,
  selectedIndex,
  onSelect,
  onExecution,
}: CanvasProps) {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const packetRef = useRef<SVGCircleElement | null>(null);

  const [paths, setPaths] = useState<string[]>(() => Array(Math.max(modules.length - 1, 0)).fill(""));
  const [size, setSize] = useState({ w: 0, h: 0 });

  const { reducedRef } = useReducedMotion();
  const execute = useCallback(() => runOnce(blueprint, trigger), [blueprint, trigger]);
  const moduleIds = modules.map((m) => m.node.id);

  const { statuses, ops, isRunning, run, reset } = useRunOnce({
    moduleIds,
    execute,
    pathRefs,
    packetRef,
    reducedRef,
    onSelect,
    onExecution,
  });

  // Draw ink-black beziers from each bubble's centre to the next.
  const drawLinks = useCallback(() => {
    const flow = flowRef.current;
    if (!flow) return;
    const fr = flow.getBoundingClientRect();
    const next: string[] = [];
    for (let i = 0; i < modules.length - 1; i++) {
      const a = bubbleRefs.current[i];
      const b = bubbleRefs.current[i + 1];
      if (!a || !b) {
        next.push("");
        continue;
      }
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const ax = ra.left - fr.left + ra.width / 2;
      const ay = ra.top - fr.top + ra.height / 2;
      const bx = rb.left - fr.left + rb.width / 2;
      const by = rb.top - fr.top + rb.height / 2;
      const x1 = ax + ra.width / 2 + 4;
      const y1 = ay;
      const x2 = bx - rb.width / 2 - 4;
      const y2 = by;
      const mx = (x1 + x2) / 2;
      next.push(`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
    }
    setSize({ w: fr.width, h: fr.height });
    setPaths(next);
  }, [modules.length]);

  useLayoutEffect(() => {
    drawLinks();
  }, [drawLinks]);

  useEffect(() => {
    window.addEventListener("resize", drawLinks);
    // Fonts can shift bubble metrics; redraw once they load.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(drawLinks).catch(() => {});
    }
    return () => window.removeEventListener("resize", drawLinks);
  }, [drawLinks]);

  // Dev/demo hook: visiting with `?autorun` starts the replay on load.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("autorun")) {
      const t = setTimeout(run, 400);
      return () => clearTimeout(t);
    }
  }, [run]);

  const handleReset = () => {
    reset();
    onSelect(modules.length - 1);
  };

  return (
    <main className="canvas">
      <div className="canvas__head">
        <div className="canvas__title">
          <h1>Enrich leads → Telegram digest</h1>
          <p>Draft · saved 2 min ago</p>
        </div>
        <div className="canvas__actions">
          <Button
            variant="ghost"
            collapsible
            icon={<ResetIcon />}
            onClick={handleReset}
            disabled={isRunning}
          >
            Reset
          </Button>
          <Button
            variant="primary"
            collapsible
            icon={<PlayIcon width={16} height={16} />}
            onClick={run}
            disabled={isRunning}
          >
            Run once
          </Button>
        </div>
      </div>

      <div className="stage">
        <div className="flow" ref={flowRef}>
          <ConnectorLinks
            paths={paths}
            width={size.w}
            height={size.h}
            pathRefs={pathRefs}
            packetRef={packetRef}
          />
          {modules.map((module, i) => (
            <ModuleBubble
              key={module.node.id}
              module={module}
              status={statuses[i]}
              selected={selectedIndex === i}
              onSelect={() => onSelect(i)}
              bubbleRef={(el) => {
                bubbleRefs.current[i] = el;
              }}
            />
          ))}
        </div>

        <div className="opsmeter">
          <span className="n">{ops}</span>
          <span className="lbl">operations this run</span>
        </div>
      </div>
    </main>
  );
}
