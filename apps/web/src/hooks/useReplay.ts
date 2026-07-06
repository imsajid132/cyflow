import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { StoredExecutionStep } from "@cyflow/shared";
import type { NodeStatus } from "./useRunOnce";

interface ReplayArgs {
  steps: StoredExecutionStep[];
  pathForPair: (fromId: string, toId: string) => SVGPathElement | null;
  packetRef: MutableRefObject<SVGCircleElement | null>;
  reducedRef: MutableRefObject<boolean>;
}

/**
 * Deterministic playback of a RECORDED execution (no engine). Steps in `order`
 * light up one by one; the current step is highlighted; a packet travels the
 * connector between consecutive steps. Supports play / pause / step / speed.
 */
export function useReplay({ steps, pathForPair, packetRef, reducedRef }: ReplayArgs) {
  const total = steps.length;
  // Debug mode: a failed run opens focused on the failed step, not the trigger.
  const failedIndex = steps.findIndex((s) => s.status === "error");
  const initialCursor = failedIndex >= 0 ? failedIndex : 0;
  const [cursor, setCursor] = useState(initialCursor);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const rafId = useRef<number | null>(null);

  // Re-focus (and stop) whenever a different execution is loaded.
  useEffect(() => {
    setPlaying(false);
    const fi = steps.findIndex((s) => s.status === "error");
    setCursor(fi >= 0 ? fi : 0);
  }, [steps]);

  const statuses = useMemo(() => {
    const map: Record<string, NodeStatus> = {};
    steps.forEach((s, i) => {
      map[s.moduleNodeId] = i <= cursor ? (s.status === "error" ? "error" : "success") : "idle";
    });
    return map;
  }, [steps, cursor]);

  const currentId = steps[cursor]?.moduleNodeId ?? null;

  const clearRaf = () => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };
  const hidePacket = () => {
    if (packetRef.current) packetRef.current.style.opacity = "0";
  };

  const animatePacket = useCallback(
    (fromId: string | undefined, toId: string | undefined, done: () => void) => {
      const path = fromId && toId ? pathForPair(fromId, toId) : null;
      const packet = packetRef.current;
      if (reducedRef.current || !path || !packet) {
        done();
        return;
      }
      const len = path.getTotalLength();
      const dur = 520 / speedRef.current;
      let start: number | null = null;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const t = Math.min((ts - start) / dur, 1);
        const p = path.getPointAtLength(len * t);
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
    },
    [pathForPair, packetRef, reducedRef],
  );

  // Advance while playing: schedule the next step, animate the packet into it.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= total - 1) {
      setPlaying(false);
      return;
    }
    const from = steps[cursor]?.moduleNodeId;
    const to = steps[cursor + 1]?.moduleNodeId;
    const hold = 480 / speedRef.current;
    const t = setTimeout(() => {
      animatePacket(from, to, () => setCursor((c) => Math.min(total - 1, c + 1)));
    }, hold);
    return () => clearTimeout(t);
  }, [playing, cursor, speed, total, steps, animatePacket]);

  useEffect(() => clearRaf, []);

  const play = () => {
    clearRaf();
    hidePacket();
    setCursor((c) => (c >= total - 1 ? 0 : c));
    setPlaying(true);
  };
  const pause = () => {
    clearRaf();
    hidePacket();
    setPlaying(false);
  };
  const toggle = () => (playing ? pause() : play());
  const stepForward = () => {
    pause();
    setCursor((c) => Math.min(total - 1, c + 1));
  };
  const stepBack = () => {
    pause();
    setCursor((c) => Math.max(0, c - 1));
  };
  const scrubTo = (i: number) => {
    pause();
    setCursor(Math.max(0, Math.min(total - 1, i)));
  };

  return { cursor, currentId, playing, speed, setSpeed, statuses, play, pause, toggle, stepForward, stepBack, scrubTo };
}
