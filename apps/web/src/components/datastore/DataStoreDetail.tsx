import { useMemo, useState } from "react";
import { useStore } from "../../store/appStore";
import { Button, EmptyState } from "../ui";
import { ArrowLeftIcon, PlusIcon, SearchIcon, TrashIcon, CopyIcon, DataStoreIcon } from "../icons";
import { timeAgo } from "../../lib/format";
import { valuePreview, valueType } from "../../lib/datastore";
import { RecordModal } from "./RecordModal";
import type { DataRecord } from "../../store/types";

const COLS = "minmax(0, 1.2fr) minmax(0, 1.4fr) 92px 110px 96px";

export function DataStoreDetail({ storeId, onBack }: { storeId: string; onBack: () => void }) {
  const store = useStore();
  const ds = store.dataStoreById(storeId);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{ mode: "create" | "edit"; existing?: DataRecord } | null>(null);

  const records = useMemo(() => {
    if (!ds) return [];
    const q = query.trim().toLowerCase();
    if (!q) return ds.records;
    return ds.records.filter(
      (r) => r.key.toLowerCase().includes(q) || JSON.stringify(r.value).toLowerCase().includes(q),
    );
  }, [ds, query]);

  if (!ds) {
    return (
      <div className="page__head">
        <div className="page__title">
          <h1>Data store not found</h1>
        </div>
        <Button variant="ghost" icon={<ArrowLeftIcon width={15} height={15} />} onClick={onBack}>Back</Button>
      </div>
    );
  }

  const copy = (v: unknown) => void navigator.clipboard?.writeText(typeof v === "string" ? v : JSON.stringify(v, null, 2));

  return (
    <>
      <div className="page__head">
        <div className="page__title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="builder__back" onClick={onBack} aria-label="Back to data stores" style={{ flex: "none" }}>
            <ArrowLeftIcon />
          </button>
          <div>
            <h1>{ds.name}</h1>
            <p>{ds.records.length} record{ds.records.length === 1 ? "" : "s"} · updated {timeAgo(ds.updatedAt)}</p>
          </div>
        </div>
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setModal({ mode: "create" })}>
          Add record
        </Button>
      </div>

      <div className="topbar__search" style={{ maxWidth: 420, margin: "0 4px 16px" }}>
        <SearchIcon />
        <input className="input" placeholder="Search keys and values…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {ds.records.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={<DataStoreIcon />}
            title="No records yet"
            message="Add a record here, or write to this store from a scenario with a Data store module."
          />
        </div>
      ) : (
        <div className="table glass exectable">
          <div className="trow is-head" style={{ gridTemplateColumns: COLS }}>
            <span>Key</span>
            <span>Value</span>
            <span>Type</span>
            <span>Updated</span>
            <span />
          </div>
          {records.map((r) => (
            <div className="trow" style={{ gridTemplateColumns: COLS }} key={r.key}>
              <span className="mono" style={{ fontWeight: 600 }} title={r.key}>{r.key}</span>
              <span className="mono muted" title={JSON.stringify(r.value)}>{valuePreview(r.value)}</span>
              <span><span className="chip">{valueType(r.value)}</span></span>
              <span className="muted">{timeAgo(r.updatedAt)}</span>
              <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button className="rowbtn" title="Copy key" aria-label="Copy key" onClick={() => copy(r.key)}><CopyIcon /></button>
                <button className="rowbtn" title="Edit" aria-label="Edit record" onClick={() => setModal({ mode: "edit", existing: r })}>✎</button>
                <button className="rowbtn is-danger" title="Delete" aria-label="Delete record" onClick={() => store.deleteRecord(storeId, r.key)}><TrashIcon /></button>
              </span>
            </div>
          ))}
          {records.length === 0 ? <div className="trow" style={{ gridTemplateColumns: "1fr" }}><span className="muted">No records match "{query}".</span></div> : null}
        </div>
      )}

      {modal ? <RecordModal storeId={storeId} mode={modal.mode} existing={modal.existing} onClose={() => setModal(null)} /> : null}
    </>
  );
}
