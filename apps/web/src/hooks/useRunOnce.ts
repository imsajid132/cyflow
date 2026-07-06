import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { StoredExecution } from "@cyflow/shared";

export type NodeStatus = "idle" | "running" | "success" | "error";

interface RunOnceArgs {
  /** All module ids (used to reset statuses). */
  order: string[];
  /** Runs the real engine and returns a persisted-style Execution. */
  execute: () => Promise<StoredExecution>;
  /** DOM ref to the travelling packet <circle>. */
  packetRef: MutableRefObject<SVGCircleElement | null>;
  /** Resolve the connector <path> between two modules (for the packet). */
  pathForPair: (fromId: string, toId: string) => SVGPathElement | null;
  reducedRef: MutableRefObject<boolean>;
  /** Selection follows the active module during the replay. */
  onSelect: (moduleId: string) => void;
  onExecution: (execution: StoredExecution | null) => void;
}

/**
 * Branch-aware "Run once" replay. Runs the real engine, then walks the
 * execution's steps in order: each module lights up, settles to success/error,
 * the operations counter advances by that step's real count, and a lime packet
 * travels the connector to the next module (when a direct edge exists — across a
 * branch jump it simply advances). Reduced motion skips the packet.
 */
export function useRunOnce({
  order,
  execute,
  packetRef,
  pathForPair,
  reducedRef,
  onSelect,
  onExecution,
}: RunOnceArgs) {
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>({});
  const [ops, setOps] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const runningRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafId = useRef<number | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };
  const hidePacket = () => {
    if (packetRef.current) packetRef.current.style.opacity = "0";
  };
  const setStatus = (id: string, value: NodeStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: value }));

  const animatePacket = (path: SVGPathElement | null, done: () => void) => {
    const packet = packetRef.current;
    if (reducedRef.current || !path || !packet) {
      done();
      return;
    }
    const total = path.getTotalLength();
    const duration = 560;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const p = path.getPointAtLength(total * t);
      packet.setAttribute("cx", String(p.x));
      packet.setAttribute("cy", String(p.y));
      packet.style.opacity = "1";
      if (t < 1) rafId.current = requestAnimationFrame(step);
      else {
        packet.style.opacity = "0";
        done();
      }
    };
    rafId.current = requestAnimationFrame(step);
  };

  const finish = (execution: StoredExecution) => {
    runningRef.current = false;
    setIsRunning(false);
    onExecution(execution);
  };

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    clearTimers();
    setStatuses(Object.fromEntries(order.map((id) => [id, "idle"])));
    setOps(0);
    hidePacket();
    onExecution(null);

    let execution: StoredExecution;
    try {
      execution = await execute();
    } catch {
      runningRef.current = false;
      setIsRunning(false);
      return;
    }

    const steps = execution.steps;
    let opsAcc = 0;
    const animateStep = (k: number) => {
      if (k >= steps.length) {
        finish(execution);
        return;
      }
      const step = steps[k];
      setStatus(step.moduleNodeId, "running");
      onSelect(step.moduleNodeId);
      const hold = reducedRef.current ? 90 : 460;
      const t = setTimeout(() => {
        const errored = step.status === "error";
        setStatus(step.moduleNodeId, errored ? "error" : "success");
        opsAcc += step.operations;
        setOps(opsAcc);
        if (errored) {
          finish(execution);
          return;
        }
        if (k < steps.length - 1) {
          const path = pathForPair(step.moduleNodeId, steps[k + 1].moduleNodeId);
          animatePacket(path, () => animateStep(k + 1));
        } else {
          finish(execution);
        }
      }, hold);
      timers.current.push(t);
    };
    animateStep(0);
  }, [order, execute, onSelect, onExecution, pathForPair]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => clearTimers, []);

  return { statuses, ops, isRunning, run };
}
