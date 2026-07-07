import { useState } from "react";
import { Button } from "../ui";
import { api, apiEnabled, type AuthFieldDTO } from "../../store/api";

/**
 * Reusable credential form for api_key / bearer / basic / custom connectors:
 * renders the auth fields and a "Test connection" button that calls the real
 * server-side `POST /connections/test`. Credentials are lifted to the parent.
 */
export function ApiKeyConnectionForm({
  appKey,
  fields,
  creds,
  onChange,
  editMode,
}: {
  appKey: string;
  fields: AuthFieldDTO[];
  creds: Record<string, string>;
  onChange: (creds: Record<string, string>) => void;
  editMode?: boolean;
}) {
  const [test, setTest] = useState<{ loading: boolean; ok?: boolean; message?: string }>({ loading: false });

  const runTest = async () => {
    setTest({ loading: true });
    if (!apiEnabled) {
      setTest({ loading: false, ok: false, message: "Testing needs a running API (set VITE_CYFLOW_API_URL)." });
      return;
    }
    try {
      const r = await api.testConnection(appKey, creds);
      setTest({ loading: false, ok: r.ok, message: r.message });
    } catch (e) {
      setTest({ loading: false, ok: false, message: String((e as Error).message) });
    }
  };

  return (
    <>
      {fields.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`cred-${f.key}`}>{f.label}</label>
          <input
            id={`cred-${f.key}`}
            className="input mono"
            type={f.type === "password" ? "password" : "text"}
            autoComplete="off"
            placeholder={editMode ? "•••••••• (leave blank to keep)" : undefined}
            value={creds[f.key] ?? ""}
            onChange={(e) => onChange({ ...creds, [f.key]: e.target.value })}
          />
        </div>
      ))}
      <div className="field">
        <Button variant="ghost" onClick={runTest} disabled={test.loading}>
          {test.loading ? "Testing…" : "Test connection"}
        </Button>
        {test.message ? (
          <div className={`oauth-note${test.ok ? " is-ok" : ""}`}>{test.ok ? "✓ " : "⚠ "}{test.message}</div>
        ) : (
          <span className="hint">Encrypted with AES-256-GCM at rest. Never displayed again after saving.</span>
        )}
      </div>
    </>
  );
}
