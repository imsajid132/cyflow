import { useEffect, useRef, useState } from "react";

/**
 * Tracks `prefers-reduced-motion`. Returns the current boolean for rendering,
 * and exposes a ref so imperative animation code (rAF loops in timers) can read
 * the latest value without capturing a stale closure.
 */
export function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { reduced, reducedRef };
}
