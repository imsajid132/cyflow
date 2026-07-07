import { Fragment, useEffect, useRef, useState } from "react";
import type { ErrorHandler, ModuleNode, RouteDef, StoredExecution, StoredExecutionStep } from "@cyflow/shared";
import type { Connection } from "../../store/types";
import { ModuleIcon } from "../ModuleIcon";
import { StatusChip } from "../StatusChip";
import { MappingToken } from "../MappingToken";
import { Button } from "../Button";
import { findApp, findModule } from "../../data/catalog";
import { outputFields, manualSample } from "../../scenario/outputs";
import { valuePreview } from "../../lib/datastore";
import { DEFAULT_TRIGGER } from "../../scenario/localEngine";
import { PlayIcon, XIcon, ChevronRightIcon, CopyIcon } from "../icons";
import { RouteEditor } from "./RouteEditor";
import { FilterEditor } from "./FilterEditor";
import { ErrorHandlerEditor } from "./ErrorHandlerEditor";
import { ConnectionSelector } from "../connections/ConnectionSelector";

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
function preview(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  const s = String(v);
  return s.length > 20 ? `${s.slice(0, 20)}…` : s;
}

export interface UpstreamModule {
  id: string;
  label: string;
  number: number;
  node: ModuleNode;
}

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

interface NodeRef {
  id: string;
  label: string;
  number: number;
}

interface Props {
  module: ModuleNode;
  moduleNumber: number;
  predecessorId: string | null;
  upstream: UpstreamModule[];
  allNodes: NodeRef[];
  connections: Connection[];
  dataStores: { id: string; name: string }[];
  webhookUrl?: string;
  step?: StoredExecutionStep;
  execution?: StoredExecution | null;
  onSave: (params: Record<string, unknown>) => void;
  onConnection: (connectionId: string | null) => void;
  onAddConnection: () => void;
  onFilter: (filter: unknown | null) => void;
  onError: (handler: ErrorHandler | null) => void;
  onAddRoute: () => void;
  onUpdateRoute: (index: number, patch: Partial<RouteDef>) => void;
  onRemoveRoute: (index: number) => void;
  onTest: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ModuleConfigPanel({
  module,
  moduleNumber,
  predecessorId,
  upstream,
  allNodes,
  connections,
  dataStores,
  webhookUrl,
  step,
  execution,
  onSave,
  onConnection,
  onAddConnection,
  onFilter,
  onError,
  onAddRoute,
  onUpdateRoute,
  onRemoveRoute,
  onTest,
  onDelete,
  onClose,
}: Props) {
  const app = findApp(module.app);
  const def = findModule(module.app, module.operation);
  const [params, setParams] = useState<Record<string, unknown>>({ ...module.params });
  const [activeField, setActiveField] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [tab, setTab] = useState<"output" | "input">("output");
  const [bundleIdx, setBundleIdx] = useState(0);

  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const pendingCursor = useRef<{ key: string; pos: number } | null>(null);

  useEffect(() => {
    setParams({ ...module.params });
    setActiveField(null);
    setBundleIdx(0);
  }, [module.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pc = pendingCursor.current;
    if (pc) {
      const el = inputRefs.current[pc.key];
      if (el) {
        el.focus();
        el.setSelectionRange(pc.pos, pc.pos);
      }
      pendingCursor.current = null;
    }
  });

  const mappableFields = (def?.params ?? []).filter((f) => f.mappable);
  const setField = (key: string, value: unknown) => setParams((p) => ({ ...p, [key]: value }));

  const sampleValue = (node: ModuleNode, field: string): unknown => {
    const s = execution?.steps.find((x) => x.moduleNodeId === node.id);
    if (s && s.output.length > 0) {
      const v = getPath(s.output[0], field);
      if (v !== undefined) return v;
    }
    if (node.app === "webhook") return getPath(DEFAULT_TRIGGER[0], field);
    if (node.app === "manual") {
      const sample = manualSample(node);
      return sample ? getPath(sample, field) : undefined;
    }
    return undefined;
  };
  const focusField = (key: string) => {
    setActiveField(key);
    setShowMap(true);
  };
  const copyJson = () => {
    void navigator.clipboard?.writeText(JSON.stringify(bundle ?? {}, null, 2));
  };

  const insertToken = (token: string) => {
    const key = activeField ?? mappableFields[0]?.key;
    if (!key) return;
    const el = inputRefs.current[key];
    const current = String(params[key] ?? "");
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setField(key, next);
    pendingCursor.current = { key, pos: start + token.length };
  };

  const bundles = step ? (tab === "input" ? step.input : step.output) : [];
  const bundle = bundles[Math.min(bundleIdx, Math.max(bundles.length - 1, 0))];

  const isRouter = module.kind === "router";
  const isTrigger = module.kind === "trigger";
  const isDataStore = module.app === "datastore";

  return (
    <aside className="panel glass" aria-label="Module configuration">
      <div className="panel__head">
        <div className="panel__icon">
          <ModuleIcon app={module.app} operation={module.operation} sw={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{def?.name ?? module.operation}</h2>
          <span>
            {app?.name ?? module.app} · #{moduleNumber}
          </span>
        </div>
        <button className="modal__x" onClick={onClose} aria-label="Close">
          <XIcon />
        </button>
      </div>

      {step ? (
        <div className="panel__status">
          <StatusChip kind={step.status === "error" ? "failed" : "success"}>{step.status === "error" ? "Failed" : "Succeeded"}</StatusChip>
          <span className="chip">{step.operations} op{step.operations === 1 ? "" : "s"}</span>
          <span className="chip">{step.ms}ms</span>
        </div>
      ) : null}

      <div className="panel__body">
        {isTrigger && module.app === "webhook" && webhookUrl ? (
          <div className="field">
            <label>Webhook URL</label>
            <div className="webhookurl">
              <input className="input mono" readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              <button className="rowbtn" title="Copy webhook URL" aria-label="Copy webhook URL" onClick={() => void navigator.clipboard?.writeText(webhookUrl)}>
                <CopyIcon />
              </button>
            </div>
            <span className="hint">POST here to run this scenario. The request body, headers, and query become the trigger bundle.</span>
          </div>
        ) : null}

        {isTrigger && module.app === "schedule" ? (
          <div className="field">
            <label>Schedule</label>
            <span className="hint">This scenario runs on a schedule. Set the interval with the “Schedule” button in the top bar.</span>
          </div>
        ) : null}

        {isTrigger && module.app === "manual" ? (
          <div className="field">
            <span className="hint">Run this scenario by hand with “Run once”. The sample below is the test bundle passed to the next module.</span>
          </div>
        ) : null}

        {isDataStore ? (
          <div className="field">
            <label htmlFor="ds-store">Data store</label>
            <select
              className="input"
              id="ds-store"
              value={String(params.store ?? dataStores[0]?.name ?? "")}
              onChange={(e) => setField("store", e.target.value)}
            >
              {dataStores.length === 0 ? <option value="">Default store</option> : null}
              {dataStores.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>
        ) : null}

        {app?.auth ? (
          <ConnectionSelector
            appKey={module.app}
            connections={connections}
            value={module.connectionId ?? null}
            onSelect={onConnection}
            onAddNew={onAddConnection}
          />
        ) : null}

        {isRouter ? (
          <RouteEditor
            key={module.id}
            routes={module.routes ?? []}
            routerId={module.id}
            nodes={allNodes}
            onAdd={onAddRoute}
            onUpdate={onUpdateRoute}
            onRemove={onRemoveRoute}
          />
        ) : null}

        {!isRouter && (def?.params ?? []).length === 0 ? <div className="field"><span className="hint">This module has no parameters.</span></div> : null}

        {!isRouter && (def?.params ?? []).map((field) => {
          const value = String(params[field.key] ?? "");
          const common = {
            id: `f_${field.key}`,
            className: "input" + (field.mappable ? " mono" : ""),
            value,
            placeholder: field.placeholder,
            onFocus: () => focusField(field.key),
            ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
              inputRefs.current[field.key] = el;
            },
          };
          return (
            <div className="field" key={field.key}>
              <label htmlFor={`f_${field.key}`}>{field.label}</label>
              {field.type === "select" ? (
                <select className="input" id={`f_${field.key}`} value={value} onChange={(e) => setField(field.key, e.target.value)} onFocus={() => focusField(field.key)}>
                  {(field.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea {...common} rows={3} onChange={(e) => setField(field.key, e.target.value)} />
              ) : (
                <input {...common} type={field.type === "number" ? "number" : "text"} onChange={(e) => setField(field.key, field.type === "number" ? Number(e.target.value) : e.target.value)} />
              )}
              {field.mappable && value.includes("{{") ? (
                <span className="mapfield"><TokenPreview value={value} /></span>
              ) : null}
            </div>
          );
        })}

        {mappableFields.length > 0 && upstream.length > 0 ? (
          <div className="field">
            <button className="mapping__toggle" onClick={() => setShowMap((s) => !s)}>
              <ChevronRightIcon width={13} height={13} style={{ transform: showMap ? "rotate(90deg)" : "none", transition: "transform .12s" }} />
              Mappings from earlier modules
            </button>
            {showMap ? (
              <div className="mapping">
                <span className="hint">
                  {activeField
                    ? `Inserting into “${def?.params.find((p) => p.key === activeField)?.label ?? activeField}” — click a value.`
                    : "Click a field above, then a value to insert it."}
                </span>
                {upstream.map((u) => {
                  const fields = outputFields(u.node, execution?.steps.find((s) => s.moduleNodeId === u.id));
                  return (
                    <div className="mapping__mod" key={u.id}>
                      <div className="mapping__modhead">
                        <span className="mapping__num">{u.number}</span>
                        {u.label}
                      </div>
                      <div className="mapping__rows">
                        {fields.length === 0 ? <span className="muted" style={{ fontSize: ".72rem" }}>no outputs</span> : null}
                        {fields.map((f) => {
                          const val = sampleValue(u.node, f);
                          return (
                            <button
                              key={f}
                              className="maprow"
                              title={`{{${u.id}.${f}}}`}
                              onClick={() => insertToken(`{{${u.id}.${f}}}`)}
                            >
                              <span className="maprow__field">{f}</span>
                              {val !== undefined ? <span className="maprow__val">{preview(val)}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {!isRouter && !isTrigger ? (
          <div className="field">
            <label>Filter — condition on the link to the next module</label>
            {module.filter != null ? (
              <FilterEditor value={module.filter} onChange={onFilter} />
            ) : (
              <button className="token" type="button" onClick={() => onFilter({ left: "", operator: "equals", right: "" })}>+ add filter</button>
            )}
          </div>
        ) : null}

        {!isRouter && !isTrigger ? (
          <ErrorHandlerEditor key={module.id} value={module.errorHandler ?? null} onChange={onError} />
        ) : null}

        {step?.routes && step.routes.length > 0 ? (
          <div className="field">
            <label>Branches (this run)</label>
            {step.routes.map((r, i) => (
              <div className="branchrow" key={i}>
                <b>{r.label ?? `Route ${i + 1}`}</b>
                <span className="muted mono">{r.bundles} bundle{r.bundles === 1 ? "" : "s"}</span>
                {r.bundles === 0 ? <span className="chip">skipped</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {step?.errorOutcome ? (
          <div className="field">
            <label>Error handling (this run)</label>
            <StatusChip kind="success">
              {step.errorOutcome.type} · handled {step.errorOutcome.handled}
            </StatusChip>
          </div>
        ) : null}

        {step && isDataStore ? (
          <div className="field">
            <label>Data store operation</label>
            <div className="metagrid">
              <span className="muted">Operation</span>
              <span>{def?.name ?? module.operation}</span>
              {(() => {
                const out = step.output?.[0] as Record<string, unknown> | undefined;
                if (!out) return null;
                return (
                  <>
                    {"key" in out ? (<><span className="muted">Key</span><span className="mono">{String(out.key)}</span></>) : null}
                    {"value" in out ? (<><span className="muted">Value</span><span className="mono">{valuePreview(out.value)}</span></>) : null}
                    {"found" in out ? (<><span className="muted">Found</span><span className="mono">{String(out.found)}</span></>) : null}
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

        {step ? (
          <div className="field">
            <div className="inspector__tabs">
              <button className={`inspector__tab${tab === "output" ? " is-active" : ""}`} onClick={() => { setTab("output"); setBundleIdx(0); }}>
                Output
              </button>
              <button className={`inspector__tab${tab === "input" ? " is-active" : ""}`} onClick={() => { setTab("input"); setBundleIdx(0); }}>
                Input
              </button>
              <span className="inspector__count">{bundles.length} bundle{bundles.length === 1 ? "" : "s"}</span>
              <button className="inspector__copy" onClick={copyJson} title="Copy JSON" aria-label="Copy JSON">
                <CopyIcon width={14} height={14} />
              </button>
            </div>
            {step.error && tab === "output" ? (
              <div className="kv" style={{ whiteSpace: "pre-wrap" }}>{step.error}</div>
            ) : (
              <>
                {bundles.length > 1 ? (
                  <div className="inspector__pager">
                    <button className="chrome__btn" style={{ color: "var(--ink)" }} onClick={() => setBundleIdx((i) => Math.max(0, i - 1))} aria-label="Previous bundle">‹</button>
                    <span className="mono">Bundle {Math.min(bundleIdx, bundles.length - 1) + 1} / {bundles.length}</span>
                    <button className="chrome__btn" style={{ color: "var(--ink)" }} onClick={() => setBundleIdx((i) => Math.min(bundles.length - 1, i + 1))} aria-label="Next bundle">›</button>
                  </div>
                ) : null}
                <div className="kv" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(bundle ?? {}, null, 2)}</div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="panel__foot" style={{ flexWrap: "wrap" }}>
        <Button variant="ghost" icon={<PlayIcon width={14} height={14} />} onClick={onTest}>Test</Button>
        <Button variant="ghost" onClick={onDelete}>Delete</Button>
        <Button variant="primary" onClick={() => onSave(params)}>Save</Button>
      </div>
    </aside>
  );
}
