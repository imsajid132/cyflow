import { useState } from "react";
import { useStore } from "../store/appStore";
import { apiBaseUrl, getAdminToken } from "../store/api";
import { Button } from "./Button";
import { ConnectionsIcon } from "./icons";

/**
 * Blocking screen shown (in API mode) until the frontend can talk to the API.
 * Handles a missing/invalid admin token and an unreachable API.
 */
export function AdminGate() {
  const store = useStore();
  const status = store.apiStatus;
  const [token, setToken] = useState(getAdminToken());
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      await store.connectApi(token.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate__card glass">
        <div className="gate__logo">
          <ConnectionsIcon sw={1.9} />
        </div>
        <h1 className="gate__title">Connect to Cyflow</h1>

        {status === "connecting" ? (
          <p className="muted">
            Connecting to <span className="mono">{apiBaseUrl}</span>…
          </p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {status === "offline"
                ? "Can't reach the Cyflow API. It powers every connector, OAuth sign-in, webhook, and scheduled run — real workflows need it deployed."
                : "This Cyflow API is protected. Enter your admin token to continue."}
            </p>
            {status === "offline" ? (
              <p className="muted" style={{ marginTop: 0, fontSize: ".78rem", textAlign: "left" }}>
                Deploy the API + worker (README → <b>Personal Production Deployment</b>), then set
                <span className="mono"> VITE_CYFLOW_API_URL</span> on Vercel to your API URL. To try Cyflow with no
                backend, leave that variable unset — the app runs in local demo mode.
              </p>
            ) : null}
            <div className="field" style={{ textAlign: "left" }}>
              <label htmlFor="gate-token">Admin token</label>
              <input
                id="gate-token"
                className="input mono"
                type="password"
                autoFocus
                value={token}
                placeholder="CYFLOW_ADMIN_TOKEN"
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => (e.key === "Enter" ? connect() : undefined)}
              />
              {status === "auth-required" && token ? (
                <span className="hint" style={{ color: "var(--danger)" }}>That token was rejected — check it and try again.</span>
              ) : null}
            </div>
            <Button variant="primary" onClick={connect} disabled={busy}>
              {busy ? "Connecting…" : status === "offline" ? "Retry" : "Connect"}
            </Button>
            <p className="muted" style={{ fontSize: ".72rem", marginBottom: 0 }}>
              API: <span className="mono">{apiBaseUrl}</span> · stored locally in this browser only.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
