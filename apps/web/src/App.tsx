import { useMemo, useState } from "react";
import type { StoredExecution } from "@cyflow/shared";
import { LeftRail } from "./components/LeftRail";
import { Canvas } from "./components/Canvas";
import { ConfigPanel } from "./components/ConfigPanel";
import { deriveModules } from "./scenario/model";
import { sampleBlueprint, sampleTrigger } from "./scenario/sampleScenario";

/**
 * Cyflow scenario builder shell: glass app rail, lime-world canvas, and the
 * right config panel. Bubbles + links are rendered from a real blueprint;
 * "Run Once" executes it through the actual engine and the panel inspects the
 * resulting execution snapshots. Selection is shared — clicking a bubble (or the
 * replay advancing) updates which module the panel shows.
 */
export default function App() {
  const blueprint = sampleBlueprint;
  const modules = useMemo(() => deriveModules(blueprint), [blueprint]);

  const [selectedIndex, setSelectedIndex] = useState(modules.length - 1);
  const [execution, setExecution] = useState<StoredExecution | null>(null);

  const selected = modules[selectedIndex];
  const selectedStep = execution?.steps.find((s) => s.moduleNodeId === selected.node.id);

  return (
    <div className="app">
      <LeftRail />
      <Canvas
        blueprint={blueprint}
        trigger={sampleTrigger}
        modules={modules}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onExecution={setExecution}
      />
      <ConfigPanel
        module={selected.node}
        number={selected.number}
        label={selected.label}
        step={selectedStep}
      />
    </div>
  );
}
