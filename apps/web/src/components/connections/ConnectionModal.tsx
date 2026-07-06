import { useEffect, useState } from "react";
import { useStore } from "../../store/appStore";
import { Modal, Button } from "../ui";
import { ModuleIcon } from "../ModuleIcon";
import { ArrowLeftIcon } from "../icons";
import { CATALOG, findApp } from "../../data/catalog";
import { api, apiEnabled, GOOGLE_APPS, type AuthFieldDTO } from "../../store/api";
import type { Connection } from "../../store/types";

const authApps = CATALOG.filter((a) => a.auth);

/** Local fallback fields when no API is available to describe the auth schema. */
function defaultAuthFields(authType?: string, appKey?: string): AuthFieldDTO[] {
  // Apps with custom multi-field auth (offline/demo fallback for the API schema).
  if (appKey === "supabase") {
    return [
      { key: "projectUrl", label: "Project URL", type: "text", required: true },
      { key: "serviceKey", label: "Service role key", type: "password", required: true },
    ];
  }
  if (appKey === "trello") {
    return [
      { key: "apiKey", label: "API key", type: "text", required: true },
      { key: "token", label: "Token", type: "password", required: true },
    ];
  }
  if (appKey === "twilio") {
    return [
      { key: "accountSid", label: "Account SID", type: "text", required: true },
      { key: "authToken", label: "Auth Token", type: "password", required: true },
    ];
  }
  if (appKey === "shopify") {
    return [
      { key: "shop", label: "Shop (mystore or mystore.myshopify.com)", type: "text", required: true },
      { key: "accessToken", label: "Admin API access token", type: "password", required: true },
    ];
  }
  if (appKey === "woocommerce") {
    return [
      { key: "storeUrl", label: "Store URL", type: "text", required: true },
      { key: "consumerKey", label: "Consumer key", type: "text", required: true },
      { key: "consumerSecret", label: "Consumer secret", type: "password", required: true },
    ];
  }
  switch (authType) {
    case "api_key":
      return [{ key: "token", label: "API key", type: "password", required: true }];
    case "bearer_token":
      return [{ key: "token", label: "Token", type: "password", required: true }];
    case "basic_auth":
      return [
        { key: "username", label: "Username", type: "text", required: true },
        { key: "password", label: "Password", type: "password", required: true },
      ];
    default:
      return [];
  }
}

interface Props {
  mode: "create" | "edit";
  existing?: Connection;
  onClose: () => void;
}

export function ConnectionModal({ mode, existing, onClose }: Props) {
  const store = useStore();
  const [step, setStep] = useState<"pick" | "form">(mode === "edit" ? "form" : "pick");
  const [appKey, setAppKey] = useState(existing?.appKey ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [fields, setFields] = useState<AuthFieldDTO[]>([]);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauth, setOauth] = useState<{ loading: boolean; message?: string; authUrl?: string; configured?: boolean }>({ loading: false });
  const [test, setTest] = useState<{ loading: boolean; ok?: boolean; message?: string }>({ loading: false });

  const app = findApp(appKey);
  const authType = app?.auth;
  const isOAuth = authType === "oauth2";

  // Load the real auth-field schema (API) or a local fallback for the chosen app.
  useEffect(() => {
    if (!appKey) return;
    let cancelled = false;
    if (apiEnabled) {
      api
        .getAppAuth(appKey)
        .then((dto) => {
          if (!cancelled) setFields(dto.auth.fields ?? defaultAuthFields(dto.auth.type));
        })
        .catch(() => {
          if (!cancelled) setFields(defaultAuthFields(authType, appKey));
        });
    } else {
      setFields(defaultAuthFields(authType, appKey));
    }
    return () => {
      cancelled = true;
    };
  }, [appKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickApp = (key: string) => {
    setAppKey(key);
    const a = findApp(key);
    setName((n) => n || `${a?.name ?? key} connection`);
    setStep("form");
  };

  const connectOAuth = async () => {
    setOauth({ loading: true });
    if (!apiEnabled) {
      setOauth({ loading: false, configured: false, message: "OAuth needs a running API (set VITE_CYFLOW_API_URL) plus provider setup on the server." });
      return;
    }
    try {
      const res = GOOGLE_APPS.has(appKey) ? await api.googleOAuthStart(appKey) : await api.oauthStart(appKey);
      if (res.configured && res.authUrl) {
        // Send the user to the real Google consent screen; the callback returns
        // to the Connections page with a success/error banner.
        window.location.href = res.authUrl;
        return;
      }
      setOauth({ loading: false, configured: res.configured, message: res.message, authUrl: res.authUrl });
    } catch (e) {
      setOauth({ loading: false, configured: false, message: String((e as Error).message) });
    }
  };

  const testConn = async () => {
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

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give the connection a name.");
      return;
    }
    if (!isOAuth) {
      const missing = fields.find((f) => f.required !== false && !creds[f.key]?.trim());
      if (missing && mode === "create") {
        setError(`${missing.label} is required.`);
        return;
      }
    }
    setBusy(true);
    try {
      const credentials = isOAuth ? {} : creds;
      if (mode === "create") {
        await store.createConnection({ appKey, name: name.trim(), credentials });
      } else if (existing) {
        const hasNewCreds = Object.values(creds).some((v) => v.trim() !== "");
        await store.updateConnection(existing.id, { name: name.trim(), ...(hasNewCreds ? { credentials } : {}) });
      }
      onClose();
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };

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
      footer={step === "form" ? footer : undefined}
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
            <div className="field">
              <label>Authorization</label>
              <Button variant="ghost" onClick={connectOAuth} disabled={oauth.loading}>
                {oauth.loading ? "Starting…" : `Connect with ${app?.name ?? "provider"}`}
              </Button>
              {oauth.message ? (
                <div className={`oauth-note${oauth.configured ? " is-ok" : ""}`}>
                  {oauth.configured ? "✓ " : "⚠ "}
                  {oauth.message}
                  {oauth.authUrl ? (
                    <>
                      {" "}
                      <a href={oauth.authUrl} target="_blank" rel="noreferrer noopener">Open authorization page ↗</a>
                    </>
                  ) : null}
                </div>
              ) : (
                <span className="hint">You'll be redirected to the provider to authorize. No provider secrets are handled in the browser.</span>
              )}
            </div>
          ) : (
            fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`cred-${f.key}`}>{f.label}</label>
                <input
                  id={`cred-${f.key}`}
                  className="input mono"
                  type={f.type === "password" ? "password" : "text"}
                  autoComplete="off"
                  placeholder={mode === "edit" ? "•••••••• (leave blank to keep)" : undefined}
                  value={creds[f.key] ?? ""}
                  onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                />
              </div>
            ))
          )}

          {!isOAuth ? (
            <div className="field">
              <Button variant="ghost" onClick={testConn} disabled={test.loading}>
                {test.loading ? "Testing…" : "Test connection"}
              </Button>
              {test.message ? (
                <div className={`oauth-note${test.ok ? " is-ok" : ""}`}>{test.ok ? "✓ " : "⚠ "}{test.message}</div>
              ) : (
                <span className="hint">Encrypted with AES-256-GCM at rest. Never displayed again after saving.</span>
              )}
            </div>
          ) : null}
          {error ? <div className="oauth-note">⚠ {error}</div> : null}
        </>
      )}
    </Modal>
  );
}
