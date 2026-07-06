import { useState } from "react";
import { useStore } from "../../store/appStore";
import { Toggle } from "../ui";

export function SettingsPage() {
  const store = useStore();
  const [reduced, setReduced] = useState(false);
  const [notify, setNotify] = useState(true);

  return (
    <>
      <div className="page__head">
        <div className="page__title">
          <h1>Settings</h1>
          <p>Workspace preferences and security.</p>
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2>Workspace</h2>
        </div>
        <div className="panel glass" style={{ padding: 20 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="ws">Workspace name</label>
            <input className="input" id="ws" defaultValue={store.workspace} />
          </div>
          <div className="field">
            <label htmlFor="region">Region</label>
            <select className="input" id="region" defaultValue="eu">
              <option value="eu">EU (Frankfurt)</option>
              <option value="us">US (Virginia)</option>
            </select>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2>Preferences</h2>
        </div>
        <div className="panel glass" style={{ padding: 8 }}>
          <div className="trow" style={{ gridTemplateColumns: "1fr auto", border: "none" }}>
            <div>
              <b>Reduced motion</b>
              <div className="muted">Minimise the "Run once" replay animation.</div>
            </div>
            <Toggle on={reduced} onChange={setReduced} label="Reduced motion" />
          </div>
          <div className="trow" style={{ gridTemplateColumns: "1fr auto", border: "none" }}>
            <div>
              <b>Execution notifications</b>
              <div className="muted">Notify me when a scenario run fails.</div>
            </div>
            <Toggle on={notify} onChange={setNotify} label="Notifications" />
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section__head">
          <h2>Security</h2>
        </div>
        <div className="panel glass" style={{ padding: 20 }}>
          <p className="muted" style={{ margin: 0 }}>
            Connection credentials are encrypted at rest with AES-256-GCM and decrypted only inside
            the worker at run time. Execution snapshots are redacted, and secrets are never logged or
            sent to the browser.
          </p>
        </div>
      </div>
    </>
  );
}
