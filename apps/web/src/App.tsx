import { useState } from "react";
import { MODULES } from "./data/modules";
import { LeftRail } from "./components/LeftRail";
import { Canvas } from "./components/Canvas";
import { ConfigPanel } from "./components/ConfigPanel";

/**
 * Cyflow scenario builder shell: glass app rail, lime-world canvas, and the
 * right config panel. Selection is shared — clicking a bubble (or the replay
 * advancing) updates which module the panel shows.
 */
export default function App() {
  // Telegram (the last module) is selected by default, matching the prototype.
  const [selectedIndex, setSelectedIndex] = useState(MODULES.length - 1);

  return (
    <div className="app">
      <LeftRail />
      <Canvas modules={MODULES} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      <ConfigPanel module={MODULES[selectedIndex]} />
    </div>
  );
}
