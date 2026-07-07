import { useState } from "react";
import { useStore } from "../../store/appStore";
import { Modal, Button } from "../ui";
import { ModuleIcon } from "../ModuleIcon";
import { ArrowLeftIcon } from "../icons";
import { CATALOG, findApp } from "../../data/catalog";
import { useAuthFields } from "./authFields";
import { ApiKeyConnectionForm } from "./ApiKeyConnectionForm";
import { OAuthConnectFlow } from "./OAuthConnectFlow";
import type { Connection } from "../../store/types";

const authApps = CATALOG.filter((a) => a.auth);

interface Props {
  mode: "create" | "edit";
  existing?: Connection;
  onClose: () => void;
}

/**
 * Connections-page modal: pick an app, then create (or edit) a connection.
 * Composes the same reusable pieces the builder uses — ApiKeyConnectionForm and
 * the popup-based OAuthConnectFlow — so behaviour is identical everywhere.
 */
export function ConnectionModal({ mode, existing, onClose }: Props) {
  const store = useStore();
  const [step, setStep] = useState<"pick" | "form">(mode === "edit" ? "form" : "pick");
  const [appKey, setAppKey] = useState(existing?.appKey ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const app = findApp(appKey);
  const isOAuth = app?.auth === "oauth2";
  const fields = useAuthFields(appKey);

  const pickApp = (key: string) => {
    setAppKey(key);
    const a = findApp(key);
    setName((n) => n || `${a?.name ?? key} connection`);
    setStep("form");
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give the connection a name.");
      return;
    }
    if (!isOAuth && mode === "create") {
      const missing = fields.find((f) => f.required !== false && !creds[f.key]?.trim());
      if (missing) {
        setError(`${missing.label} is required.`);
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await store.createConnection({ appKey, name: name.trim(), credentials: isOAuth ? {} : creds });
      } else if (existing) {
        const hasNewCreds = Object.values(creds).some((v) => v.trim() !== "");
        await store.updateConnection(existing.id, { name: name.trim(), ...(hasNewCreds ? { credentials: creds } : {}) });
      }
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };

  // OAuth create has no "Create" button — the popup connect flow IS the action.
  const showFooter = step === "form" && !(isOAuth && mode === "create");
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={busy || step === "pick"}>
        {mode === "create" ? "Create connection" : "Save changes"}
      </Button>
    </>
  );

  return (
    <Modal
      title={mode === "edit" ? "Edit connection" : app ? `Connect ${app.name}` : "Add a connection"}
      onClose={onClose}
      width={560}
      footer={showFooter ? footer : undefined}
    >
      {step === "pick" ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Bring-your-own-API. Credentials are encrypted at rest and decrypted only at run time —
            never shown again after saving.
          </p>
          <div className="picker__apps" style={{ marginTop: 14 }}>
            {authApps.map((a) => (
              <div className="appTile" key={a.key} onClick={() => pickApp(a.key)}>
                <span className="appTile__icon">
                  <ModuleIcon app={a.key} operation={a.modules[0]?.operation ?? ""} sw={1.7} />
                </span>
                <span className="appTile__name">{a.name}</span>
                <span className="muted" style={{ fontSize: ".66rem", textTransform: "uppercase" }}>{a.auth}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {mode === "create" ? (
            <button className="mapping__toggle" onClick={() => setStep("pick")} style={{ marginBottom: 10 }}>
              <ArrowLeftIcon width={13} height={13} /> Choose a different app
            </button>
          ) : null}

          <div className="field">
            <label htmlFor="conn-name">Connection name</label>
            <input id="conn-name" className="input" value={name} placeholder="e.g. Production bot" onChange={(e) => setName(e.target.value)} />
          </div>

          {isOAuth ? (
            <>
              {mode === "edit" ? <span className="hint">Re-authorize to refresh this connection's tokens.</span> : null}
              <OAuthConnectFlow appKey={appKey} appName={app?.name ?? appKey} onConnected={() => onClose()} />
            </>
          ) : (
            <ApiKeyConnectionForm appKey={appKey} fields={fields} creds={creds} onChange={setCreds} editMode={mode === "edit"} />
          )}

          {error ? <div className="oauth-note">⚠ {error}</div> : null}
        </>
      )}
    </Modal>
  );
}
