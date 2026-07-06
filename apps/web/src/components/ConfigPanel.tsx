import { Fragment } from "react";
import type { ModuleNode, StoredExecutionStep } from "@cyflow/shared";
import { ModuleIcon } from "./ModuleIcon";
import { StatusChip } from "./StatusChip";
import { MappingToken } from "./MappingToken";
import { Button } from "./Button";

interface ConfigPanelProps {
  module: ModuleNode;
  /** 1-based module number in the chain. */
  number: number;
  label: string;
  /** The selected module's snapshot after a run (if any). */
  step?: StoredExecutionStep;
}

/** Render a string value, turning {{ ... }} tokens into mapping chips. */
function ParamValue({ value }: { value: unknown }) {
  if (typeof value !== "string") {
    return <>{JSON.stringify(value)}</>;
  }
  const parts = value.split(/(\{\{[^}]+\}\})/g).filter((p) => p !== "");
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("{{") && part.endsWith("}}") ? (
          <MappingToken key={i}>{part}</MappingToken>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Right-hand config panel — data-driven from the selected blueprint module.
 * Shows the module's identity (app / operation / kind / number), its params
 * with mapping tokens highlighted, and — after a run — the execution inspector
 * (status, operations, duration, input/output bundle snapshots).
 */
export function ConfigPanel({ module, number, label, step }: ConfigPanelProps) {
  const params = Object.entries(module.params ?? {});

  return (
    <aside className="panel glass" aria-label="Module configuration">
      <div className="panel__head">
        <div className="panel__icon">
          <ModuleIcon app={module.app} operation={module.operation} sw={1.8} />
        </div>
        <div>
          <h2>{label}</h2>
          <span>
            {module.operation} · {module.kind}
          </span>
        </div>
      </div>

      <div className="panel__status">
        {step ? (
          <StatusChip kind={step.status === "error" ? "failed" : "success"}>
            {label} · {step.status}
          </StatusChip>
        ) : (
          <span className="chip">Not run yet</span>
        )}
        {step ? <span className="chip">{step.operations} ops</span> : null}
      </div>

      <div className="panel__body">
        <div className="field">
          <label>Module</label>
          <div className="kv">
            <div>
              <span className="k">app:</span> {module.app}
            </div>
            <div>
              <span className="k">operation:</span> {module.operation}
            </div>
            <div>
              <span className="k">kind:</span> {module.kind}
            </div>
            <div>
              <span className="k">module:</span> #{number}
            </div>
          </div>
        </div>

        <div className="field">
          <label>Parameters</label>
          <div className="kv">
            {params.length === 0 ? (
              <div className="k">No parameters</div>
            ) : (
              params.map(([key, value]) => (
                <div key={key}>
                  <span className="k">{key}:</span> <ParamValue value={value} />
                </div>
              ))
            )}
          </div>
        </div>

        {step ? (
          <>
            <div className="field">
              <label>Input bundles · module {number}</label>
              <div className="kv" style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(step.input, null, 2)}
              </div>
            </div>
            <div className="field">
              <label>Output bundles · module {number}</label>
              <div className="kv" style={{ whiteSpace: "pre-wrap" }}>
                {step.error ? step.error : JSON.stringify(step.output, null, 2)}
              </div>
              <span className="hint">
                {step.operations} operation{step.operations === 1 ? "" : "s"} · {step.ms}ms
              </span>
            </div>
          </>
        ) : (
          <div className="field">
            <label>Last run</label>
            <span className="hint">
              Click <strong>Run once</strong> to execute the scenario, then select a bubble to
              inspect its bundles.
            </span>
          </div>
        )}
      </div>

      <div className="panel__foot">
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Save module</Button>
      </div>
    </aside>
  );
}
