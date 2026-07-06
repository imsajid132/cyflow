import { Fragment, useEffect, useState } from "react";
import type { ModuleNode, StoredExecutionStep } from "@cyflow/shared";
import type { Connection } from "../../store/types";
import { ModuleIcon } from "../ModuleIcon";
import { StatusChip } from "../StatusChip";
import { MappingToken } from "../MappingToken";
import { Button } from "../Button";
import { findApp, findModule } from "../../data/catalog";
import { PlayIcon, XIcon } from "../icons";

function TokenPreview({ value }: { value: string }) {
  const parts = value.split(/(\{\{[^}]+\}\})/g).filter((p) => p !== "");
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("{{") ? <MappingToken key={i}>{part}</MappingToken> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

interface Props {
  module: ModuleNode;
  moduleNumber: number;
  predecessorId: string | null;
  connections: Connection[];
  step?: StoredExecutionStep;
  onSave: (params: Record<string, unknown>) => void;
  onConnection: (connectionId: string | null) => void;
  onTest: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ModuleConfigPanel({
  module,
  moduleNumber,
  predecessorId,
  connections,
  step,
  onSave,
  onConnection,
  onTest,
  onDelete,
  onClose,
}: Props) {
  const app = findApp(module.app);
  const def = findModule(module.app, module.operation);
  const [params, setParams] = useState<Record<string, unknown>>({ ...module.params });

  useEffect(() => {
    setParams({ ...module.params });
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const appConnections = connections.filter((c) => c.appKey === module.app);

  const setField = (key: string, value: unknown) => setParams((p) => ({ ...p, [key]: value }));
  const insertMapping = (key: string) => {
    const token = predecessorId ? `{{${predecessorId}.}}` : "{{1.}}";
    setField(key, `${String(params[key] ?? "")}${token}`);
  };

  return (
    <aside className="panel glass" aria-label="Module configuration">
      <div className="panel__head">
        <div className="panel__icon">
          <ModuleIcon app={module.app} operation={module.operation} sw={1.8} />
        </div>
        <div style={{ flex: 1 }}>
          <h2>{def?.name ?? module.operation}</h2>
          <span>
            {app?.name ?? module.app} · module #{moduleNumber}
          </span>
        </div>
        <button className="modal__x" onClick={onClose} aria-label="Close">
          <XIcon />
        </button>
      </div>

      {step ? (
        <div className="panel__status">
          <StatusChip kind={step.status === "error" ? "failed" : "success"}>
            {step.status === "error" ? "Failed" : "Succeeded"}
          </StatusChip>
          <span className="chip">{step.operations} op{step.operations === 1 ? "" : "s"}</span>
          <span className="chip">{step.ms}ms</span>
        </div>
      ) : null}

      <div className="panel__body">
        {app?.auth ? (
          <div className="field">
            <label htmlFor="conn">Connection</label>
            <select
              className="input"
              id="conn"
              value={module.connectionId ?? ""}
              onChange={(e) => onConnection(e.target.value || null)}
            >
              <option value="">Select a connection…</option>
              {appConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__new">Add a new connection…</option>
            </select>
            <span className="hint">Credentials stay encrypted in your vault.</span>
          </div>
        ) : null}

        {(def?.params ?? []).length === 0 ? (
          <div className="field">
            <span className="hint">This module has no parameters.</span>
          </div>
        ) : null}

        {(def?.params ?? []).map((field) => {
          const value = String(params[field.key] ?? "");
          return (
            <div className="field" key={field.key}>
              <label htmlFor={`f_${field.key}`}>{field.label}</label>
              {field.type === "select" ? (
                <select
                  className="input"
                  id={`f_${field.key}`}
                  value={value}
                  onChange={(e) => setField(field.key, e.target.value)}
                >
                  {(field.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  className="input"
                  id={`f_${field.key}`}
                  rows={3}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(e) => setField(field.key, e.target.value)}
                />
              ) : (
                <input
                  className="input"
                  id={`f_${field.key}`}
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setField(field.key, field.type === "number" ? Number(e.target.value) : e.target.value)
                  }
                />
              )}
              {field.mappable ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button className="token" type="button" onClick={() => insertMapping(field.key)}>
                    + insert mapping
                  </button>
                  {value.includes("{{") ? (
                    <span className="mapfield" style={{ flex: 1, minWidth: 120 }}>
                      <TokenPreview value={value} />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {step ? (
          <>
            <div className="field">
              <label>Input bundles · module {moduleNumber}</label>
              <div className="kv" style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(step.input, null, 2)}
              </div>
            </div>
            <div className="field">
              <label>{step.error ? "Error" : `Output bundles · module ${moduleNumber}`}</label>
              <div className="kv" style={{ whiteSpace: "pre-wrap" }}>
                {step.error ? step.error : JSON.stringify(step.output, null, 2)}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="panel__foot" style={{ flexWrap: "wrap" }}>
        <Button variant="ghost" icon={<PlayIcon width={14} height={14} />} onClick={onTest}>
          Test
        </Button>
        <Button variant="ghost" onClick={onDelete}>
          Delete
        </Button>
        <Button variant="primary" onClick={() => onSave(params)}>
          Save
        </Button>
      </div>
    </aside>
  );
}
