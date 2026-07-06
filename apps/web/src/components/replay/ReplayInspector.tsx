import { useEffect, useMemo, useState } from "react";
import type { StoredExecutionStep } from "@cyflow/shared";
import { ModuleIcon } from "../ModuleIcon";
import { StatusChip } from "../StatusChip";
import { CopyIcon, SearchIcon } from "../icons";
import { formatDuration } from "../../lib/format";

interface Props {
  step: StoredExecutionStep;
  app: string;
  operation: string;
  title: string;
  number: number;
}

function filterJson(value: unknown, query: string): string {
  const json = JSON.stringify(value ?? {}, null, 2);
  const q = query.trim().toLowerCase();
  if (!q) return json;
  const lines = json.split("\n").filter((l) => l.toLowerCase().includes(q));
  return lines.length ? lines.join("\n") : "(no matching lines)";
}

export function ReplayInspector({ step, app, operation, title, number }: Props) {
  const [tab, setTab] = useState<"output" | "input">("output");
  const [bundleIdx, setBundleIdx] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setBundleIdx(0);
    setQuery("");
    setTab(step.status === "error" ? "input" : "output");
  }, [step.moduleNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const bundles = tab === "input" ? step.input : step.output;
  const idx = Math.min(bundleIdx, Math.max(bundles.length - 1, 0));
  const bundle = bundles[idx];
  const headers = bundle && typeof (bundle as Record<string, unknown>).headers === "object"
    ? ((bundle as Record<string, unknown>).headers as Record<string, unknown>)
    : null;
  const json = useMemo(() => filterJson(bundle ?? {}, query), [bundle, query]);

  const copy = () => void navigator.clipboard?.writeText(JSON.stringify(bundle ?? {}, null, 2));

  return (
    <aside className="panel glass" aria-label="Bundle inspector">
      <div className="panel__head">
        <div className="panel__icon">
          <ModuleIcon app={app} operation={operation} sw={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{title}</h2>
          <span>#{number} · order {step.order + 1}</span>
        </div>
      </div>

      <div className="panel__status">
        <StatusChip kind={step.status === "error" ? "failed" : "success"}>
          {step.status === "error" ? "Failed" : "Succeeded"}
        </StatusChip>
        <span className="chip">{step.operations} op{step.operations === 1 ? "" : "s"}</span>
        <span className="chip">{formatDuration(step.ms)}</span>
      </div>

      <div className="panel__body">
        {step.error ? (
          <div className="field">
            <label style={{ color: "var(--danger)" }}>Error</label>
            <div className="kv" style={{ whiteSpace: "pre-wrap", borderColor: "var(--danger)" }}>{step.error}</div>
          </div>
        ) : null}

        {step.routes && step.routes.length > 0 ? (
          <div className="field">
            <label>Branches</label>
            {step.routes.map((r, i) => (
              <div className="branchrow" key={i}>
                <b>{r.label ?? `Route ${i + 1}`}</b>
                <span className="muted mono">{r.bundles} bundle{r.bundles === 1 ? "" : "s"}</span>
                {r.bundles === 0 ? <span className="chip">skipped</span> : null}
              </div>
            ))}
          </div>
        ) : null}

        {step.errorOutcome ? (
          <div className="field">
            <label>Error handling</label>
            <StatusChip kind="success">{step.errorOutcome.type} · handled {step.errorOutcome.handled}</StatusChip>
          </div>
        ) : null}

        <div className="field">
          <div className="inspector__tabs">
            <button className={`inspector__tab${tab === "output" ? " is-active" : ""}`} onClick={() => { setTab("output"); setBundleIdx(0); }}>Output</button>
            <button className={`inspector__tab${tab === "input" ? " is-active" : ""}`} onClick={() => { setTab("input"); setBundleIdx(0); }}>Input</button>
            <span className="inspector__count">{bundles.length} bundle{bundles.length === 1 ? "" : "s"}</span>
            <button className="inspector__copy" onClick={copy} title="Copy JSON" aria-label="Copy JSON"><CopyIcon width={14} height={14} /></button>
          </div>

          {bundles.length > 1 ? (
            <div className="inspector__pager">
              <button className="chrome__btn" style={{ color: "var(--ink)" }} onClick={() => setBundleIdx((i) => Math.max(0, i - 1))} aria-label="Previous bundle">‹</button>
              <span className="mono">Bundle {idx + 1} / {bundles.length}</span>
              <button className="chrome__btn" style={{ color: "var(--ink)" }} onClick={() => setBundleIdx((i) => Math.min(bundles.length - 1, i + 1))} aria-label="Next bundle">›</button>
            </div>
          ) : null}

          <div className="inspector__search topbar__search" style={{ maxWidth: "none", margin: "0 0 8px" }}>
            <SearchIcon />
            <input className="input" placeholder="Search this bundle…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="kv" style={{ whiteSpace: "pre-wrap" }}>{json}</div>
        </div>

        {headers ? (
          <div className="field">
            <label>Headers</label>
            <div className="headers">
              {Object.entries(headers).map(([k, v]) => (
                <div className="headerrow" key={k}>
                  <span className="headerrow__k">{k}</span>
                  <span className="headerrow__v mono">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="field">
          <label>Metadata</label>
          <div className="metagrid">
            <span className="muted">Status</span><span className="mono">{step.status}</span>
            <span className="muted">Duration</span><span className="mono">{formatDuration(step.ms)}</span>
            <span className="muted">Operations</span><span className="mono">{step.operations}</span>
            <span className="muted">Order</span><span className="mono">{step.order + 1}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
