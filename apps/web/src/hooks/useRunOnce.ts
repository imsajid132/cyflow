import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

export type NodeStatus = "idle" | "running" | "success" | "error";

interface RunOnceArgs {
  /** Number of modules in the chain. */
  count: number;
  /** DOM refs to each connector <path> (length count - 1). */
  pathRefs: MutableRefObject<(SVGPathElement | null)[]>;
  /** DOM ref to the travelling packet <circle>. */
  packetRef: MutableRefObject<SVGCircleElement | null>;
  /** Latest `prefers-reduced-motion` value, read imperatively. */
  reducedRef: MutableRefObject<boolean>;
  /** Selection follows the active module during a run (Make behaviour). */
  onSelect: (index: number) => void;
}

/**
 * The "Run once" replay controller. Mirrors the prototype exactly: each module
 * lights up (running glow), settles to success while the operations counter
 * ticks, then a lime packet travels the link to the next module. Under reduced
 * motion the travelling glow is skipped and states resolve near-instantly.
 */
export function useRunOnce({ count, pathRefs, packetRef, reducedRef, onSelect }: RunOnceArgs) {
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

  const reset = useCallback(() => {
    if (runningRef.current) return;
    clearTimers();
    setStatuses(Array(count).fill("idle"));
    setOps(0);
    hidePacket();
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

  const run = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    clearTimers();
    setStatuses(Array(count).fill("idle"));
    setOps(0);
    hidePacket();

    let opsCount = 0;
    const runNode = (i: number) => {
      setStatuses((prev) => prev.map((s, idx) => (idx === i ? "running" : s)));
      onSelect(i);
      const hold = reducedRef.current ? 120 : 520;
      const t = setTimeout(() => {
        setStatuses((prev) => prev.map((s, idx) => (idx === i ? "success" : s)));
        opsCount += 1;
        setOps(opsCount);
        if (i < count - 1) {
          animatePacket(i, () => runNode(i + 1));
        } else {
          runningRef.current = false;
          setIsRunning(false);
        }
      }, hold);
      timers.current.push(t);
    };
    runNode(0);
  }, [count, onSelect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up any in-flight timers / animation frames on unmount.
  useEffect(() => clearTimers, []);

  return { statuses, ops, isRunning, run, reset };
}
