import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { StoredExecution } from "@cyflow/shared";

export type NodeStatus = "idle" | "running" | "success" | "error";

interface RunOnceArgs {
  /** Module ids in chain order (index i ↔ bubble i). */
  moduleIds: string[];
  /** Runs the real engine and returns a persisted-style Execution. */
  execute: () => Promise<StoredExecution>;
  /** DOM refs to each connector <path> (length moduleIds.length - 1). */
  pathRefs: MutableRefObject<(SVGPathElement | null)[]>;
  /** DOM ref to the travelling packet <circle>. */
  packetRef: MutableRefObject<SVGCircleElement | null>;
  /** Latest `prefers-reduced-motion` value, read imperatively. */
  reducedRef: MutableRefObject<boolean>;
  /** Selection follows the active module during a run (Make behaviour). */
  onSelect: (index: number) => void;
  /** Publishes the finished execution so the inspector can read snapshots. */
  onExecution: (execution: StoredExecution | null) => void;
}

/**
 * The "Run Once" replay controller. It runs the REAL engine, then walks the
 * execution's steps: each module lights up (running glow), settles to
 * success/error, the operations counter advances by that step's real operation
 * count (so a fan-out jumps accordingly), and a lime packet travels to the next
 * module. Reduced motion drops the travelling glow and resolves near-instantly.
 */
export function useRunOnce({
  moduleIds,
  execute,
  pathRefs,
  packetRef,
  reducedRef,
  onSelect,
  onExecution,
}: RunOnceArgs) {
  const count = moduleIds.length;
  const [statuses, setStatuses] = useState<NodeStatus[]>(() => Array(count).fill("idle"));
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

  const setStatus = (index: number, value: NodeStatus) =>
    setStatuses((prev) => prev.map((s, i) => (i === index ? value : s)));

  const reset = useCallback(() => {
    if (runningRef.current) return;
    clearTimers();
    setStatuses(Array(count).fill("idle"));
    setOps(0);
    hidePacket();
    onExecution(null);
  }, [count]); // eslint-disable-line react-hooks/exhaustive-deps

  const animatePacket = (linkIndex: number, done: () => void) => {
    const path = pathRefs.current?.[linkIndex];
    const packet = packetRef.current;
    if (reducedRef.current || !path || !packet) {
      done();
      return;
    }
    const total = path.getTotalLength();
    const duration = 620;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const p = path.getPointAtLength(total * t);
      packet.setAttribute("cx", String(p.x));
      packet.setAttribute("cy", String(p.y));
      packet.style.opacity = "1";
      if (t < 1) {
        rafId.current = requestAnimationFrame(step);
      } else {
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
    setStatuses(Array(count).fill("idle"));
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

    const indexOf = new Map(moduleIds.map((id, i) => [id, i]));
    const steps = execution.steps;
    let opsAcc = 0;

    const animateStep = (k: number) => {
      if (k >= steps.length) {
        finish(execution);
        return;
      }
      const step = steps[k];
      const index = indexOf.get(step.moduleNodeId) ?? k;
      setStatus(index, "running");
      onSelect(index);

      const hold = reducedRef.current ? 90 : 480;
      const t = setTimeout(() => {
        const errored = step.status === "error";
        setStatus(index, errored ? "error" : "success");
        opsAcc += step.operations;
        setOps(opsAcc);

        if (errored) {
          finish(execution);
          return;
        }
        if (k < steps.length - 1) {
          animatePacket(index, () => animateStep(k + 1));
        } else {
          finish(execution);
        }
      }, hold);
      timers.current.push(t);
    };

    animateStep(0);
  }, [count, execute, moduleIds, onSelect, onExecution]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up any in-flight timers / animation frames on unmount.
  useEffect(() => clearTimers, []);

  return { statuses, ops, isRunning, run, reset };
}
