import { useState } from "react";
import { useStore } from "../../store/appStore";
import { ModuleIcon } from "../ModuleIcon";
import { Button, Modal } from "../ui";
import { PlusIcon, ConnectionsIcon } from "../icons";
import { CATALOG } from "../../data/catalog";
import { timeAgo } from "../../lib/format";

export function ConnectionsPage() {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const authApps = CATALOG.filter((a) => a.auth);

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Connections</h1>
          <p>Your encrypted app credentials (bring-your-own-API).</p>
        </div>
        <Button variant="primary" icon={<PlusIcon width={16} height={16} />} onClick={() => setAdding(true)}>
          Add connection
        </Button>
      </div>

      <div className="table glass">
        <div className="trow is-head" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
          <span>Connection</span>
          <span>App</span>
          <span>Added</span>
        </div>
        {store.connections.map((c) => (
          <div className="trow" style={{ gridTemplateColumns: "1fr 1fr auto" }} key={c.id}>
            <div className="trow__main">
              <div className="trow__icon">
                <ModuleIcon app={c.appKey} operation="" sw={1.7} />
              </div>
              <b>{c.name}</b>
            </div>
            <span className="muted" style={{ textTransform: "capitalize" }}>{c.appKey}</span>
            <span className="muted">{timeAgo(c.createdAt)}</span>
          </div>
        ))}
      </div>

      {adding ? (
        <Modal title="Add a connection" onClose={() => setAdding(false)} width={560}>
          <p className="muted" style={{ marginTop: 0 }}>
            Cyflow uses bring-your-own-API connections. Credentials are encrypted at rest and
            decrypted only inside the worker at run time — never entered or stored in the browser.
            Pick an app to start the connect flow.
          </p>
          <div className="picker__apps" style={{ marginTop: 14 }}>
            {authApps.map((a) => (
              <div className="appTile" key={a.key} onClick={() => setAdding(false)}>
                <span className="appTile__icon">
                  <ModuleIcon app={a.key} operation={a.modules[0]?.operation ?? ""} sw={1.7} />
                </span>
                <span className="appTile__name">{a.name}</span>
                <span className="muted" style={{ fontSize: ".68rem", textTransform: "uppercase" }}>
                  {a.auth}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {store.connections.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">
            <ConnectionsIcon />
          </div>
          <h3>No connections yet</h3>
          <p>Connect an app to use it in your scenarios.</p>
        </div>
      ) : null}
    </>
  );
}
