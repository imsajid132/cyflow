import { useState } from "react";
import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { Button } from "../ui";
import { PlusIcon, ConnectionsIcon, TrashIcon } from "../icons";
import { findApp } from "../../data/catalog";
import { timeAgo } from "../../lib/format";
import { ConnectionModal } from "../connections/ConnectionModal";
import type { Connection } from "../../store/types";

export function ConnectionsPage() {
  const store = useStore();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; existing?: Connection } | null>(null);

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Connections</h1>
          <p>Your encrypted app credentials (bring-your-own-API).</p>
        </div>
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setModal({ mode: "create" })}>
          Add connection
        </Button>
      </div>

      {store.connections.length > 0 ? (
        <div className="table glass">
          <div className="trow is-head" style={{ gridTemplateColumns: "1.3fr 1fr 1fr auto 76px" }}>
            <span>Connection</span>
            <span>App</span>
            <span>Secret</span>
            <span>Added</span>
            <span />
          </div>
          {store.connections.map((c) => {
            const app = findApp(c.appKey);
            const isOAuth = app?.auth === "oauth2";
            return (
              <div className="trow" style={{ gridTemplateColumns: "1.3fr 1fr 1fr auto 76px" }} key={c.id}>
                <div className="trow__main">
                  <div className="trow__icon">
                    <ModuleIcon app={c.appKey} operation="" sw={1.7} />
                  </div>
                  <b>{c.name}</b>
                </div>
                <span className="muted">{app?.name ?? c.appKey}</span>
                <span className="secretdot">
                  {isOAuth ? "OAuth token " : "•••••••••• "}
                  <span className="muted" style={{ fontSize: ".68rem" }}>encrypted</span>
                </span>
                <span className="muted">{timeAgo(c.createdAt)}</span>
                <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button className="rowbtn" title="Edit" aria-label="Edit connection" onClick={() => setModal({ mode: "edit", existing: c })}>
                    ✎
                  </button>
                  <button className="rowbtn is-danger" title="Delete" aria-label="Delete connection" onClick={() => void store.deleteConnection(c.id)}>
                    <TrashIcon />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="empty__icon">
            <ConnectionsIcon />
          </div>
          <h3>No connections yet</h3>
          <p>Connect an app to use it in your scenarios. Credentials are encrypted at rest and never shown again.</p>
          <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setModal({ mode: "create" })}>
            Add connection
          </Button>
        </div>
      )}

      {modal ? <ConnectionModal mode={modal.mode} existing={modal.existing} onClose={() => setModal(null)} /> : null}
    </>
  );
}
