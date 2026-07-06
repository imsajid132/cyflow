import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

const clampZoom = (z: number) => Math.min(1.4, Math.max(0.35, z));

/** Shared zoom/pan/fit behaviour for a flow stage (wheel zooms toward the cursor). */
export function useCanvasControls(
  width: number,
  height: number,
  stageRef: MutableRefObject<HTMLDivElement | null>,
) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

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
  }, [stageRef]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || width === 0) return;
    const zw = (stage.clientWidth - 90) / width;
    const zh = (stage.clientHeight - 90) / height;
    setZoom(clampZoom(Math.min(1, zw, zh)));
    setPan({ x: 0, y: 0 });
  }, [width, height, stageRef]);

  const zoomIn = () => setZoom((z) => clampZoom(z + 0.1));
  const zoomOut = () => setZoom((z) => clampZoom(z - 0.1));

  const dragging = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest(".node, .chrome, .statusbar, .dockpanel, .playbar")) return;
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    setGrabbing(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragging.current) setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };
  const onPointerUp = () => {
    dragging.current = null;
    setGrabbing(false);
  };

  const worldStyle: CSSProperties = {
    left: "50%",
    top: "50%",
    transformOrigin: "center",
    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    width,
    height,
  };

  return {
    zoom,
    grabbing,
    worldStyle,
    fit,
    zoomIn,
    zoomOut,
    stageHandlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
