import { useState } from "react";
import { useStore } from "../../store/appStore";
import { Button, EmptyState } from "../ui";
import { DataStoreIcon, PlusIcon, TrashIcon, ChevronRightIcon } from "../icons";
import { timeAgo } from "../../lib/format";
import { CreateStoreModal } from "../datastore/CreateStoreModal";
import { DataStoreDetail } from "../datastore/DataStoreDetail";

export function DataStoresPage() {
  const store = useStore();
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("ds"));
  const [creating, setCreating] = useState(false);

  if (openId) return <DataStoreDetail storeId={openId} onBack={() => setOpenId(null)} />;

  const linkedNames = store.scenarios
    .filter((s) => s.blueprint.modules.some((m) => m.app === "datastore"))
    .map((s) => s.name);

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Data stores</h1>
          <p>Built-in key-value storage your scenarios can read and write.</p>
        </div>
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setCreating(true)}>
          Create data store
        </Button>
      </div>

      {store.dataStores.length === 0 ? (
        <div className="glass">
          <EmptyState
            icon={<DataStoreIcon />}
            title="No data stores yet"
            message="Create a key-value data store your scenarios can read and write with Data store modules."
          />
          <div style={{ textAlign: "center", paddingBottom: 24 }}>
            <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setCreating(true)}>
              Create data store
            </Button>
          </div>
        </div>
      ) : (
        <div className="cards">
          {store.dataStores.map((ds) => (
            <div
              className="scard glass"
              key={ds.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(ds.id)}
              onKeyDown={(e) => (e.key === "Enter" ? setOpenId(ds.id) : undefined)}
            >
              <div className="scard__top">
                <div className="scard__mini">
                  <DataStoreIcon sw={1.8} />
                </div>
                <div className="scard__title" style={{ flex: 1 }}>{ds.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  {store.dataStores.length > 1 ? (
                    <button className="rowbtn is-danger" title="Delete store" aria-label="Delete data store" onClick={() => store.deleteDataStore(ds.id)}>
                      <TrashIcon />
                    </button>
                  ) : null}
                  <ChevronRightIcon width={16} height={16} />
                </div>
              </div>
              <div className="scard__meta">
                <span>Records <b>{ds.records.length}</b></span>
                <span>Updated <b>{timeAgo(ds.updatedAt)}</b></span>
                <span>Linked <b>{linkedNames.length}</b></span>
              </div>
              {linkedNames.length > 0 ? (
                <div className="muted" style={{ fontSize: ".72rem" }}>
                  Used by {linkedNames.slice(0, 2).join(", ")}{linkedNames.length > 2 ? ` +${linkedNames.length - 2}` : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <CreateStoreModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </>
  );
}
