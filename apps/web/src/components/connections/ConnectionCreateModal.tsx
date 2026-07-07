import { useState } from "react";
import { Modal, Button } from "../ui";
import { useStore } from "../../store/appStore";
import { findApp } from "../../data/catalog";
import { useAuthFields } from "./authFields";
import { ApiKeyConnectionForm } from "./ApiKeyConnectionForm";
import { OAuthConnectFlow } from "./OAuthConnectFlow";
import type { Connection } from "../../store/types";

/**
 * App-locked connection creation modal (Make.com style). Opened from the module
 * config panel so the user never leaves the builder — on success it hands the
 * new connection back via `onCreated` and the caller auto-selects it.
 */
export function ConnectionCreateModal({
  appKey,
  onClose,
  onCreated,
}: {
  appKey: string;
  onClose: () => void;
  onCreated: (conn: Connection) => void;
}) {
  const store = useStore();
  const app = findApp(appKey);
  const isOAuth = app?.auth === "oauth2";
  const fields = useAuthFields(appKey);
  const [name, setName] = useState(`${app?.name ?? appKey} connection`);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give the connection a name.");
      return;
    }
    const missing = fields.find((f) => f.required !== false && !creds[f.key]?.trim());
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setBusy(true);
    try {
      const conn = await store.createConnection({ appKey, name: name.trim(), credentials: creds });
      onCreated(conn);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Connect ${app?.name ?? appKey}`}
      onClose={onClose}
      width={520}
      footer={
        isOAuth ? undefined : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>Create connection</Button>
          </>
        )
      }
    >
      <div className="field">
        <label htmlFor="ccm-name">Connection name</label>
        <input id="ccm-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production bot" />
      </div>

      {isOAuth ? (
        <OAuthConnectFlow appKey={appKey} appName={app?.name ?? appKey} onConnected={(conn) => onCreated(conn)} />
      ) : (
        <ApiKeyConnectionForm appKey={appKey} fields={fields} creds={creds} onChange={setCreds} />
      )}

      {error ? <div className="oauth-note">⚠ {error}</div> : null}
    </Modal>
  );
}
