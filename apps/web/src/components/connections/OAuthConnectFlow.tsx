import { useState } from "react";
import { Button } from "../ui";
import { useStore } from "../../store/appStore";
import { api, apiEnabled, GOOGLE_APPS, MICROSOFT_APPS } from "../../store/api";
import { openOAuthPopup } from "./oauthPopup";
import type { Connection } from "../../store/types";

/**
 * Reusable OAuth connect flow. Opens the provider consent in a popup so the user
 * never leaves the current screen (the builder or Connections page); on success
 * it reloads connections and hands the new one back via `onConnected`.
 */
export function OAuthConnectFlow({
  appKey,
  appName,
  onConnected,
}: {
  appKey: string;
  appName: string;
  onConnected?: (conn: Connection) => void;
}) {
  const store = useStore();
  const [state, setState] = useState<{ loading: boolean; ok?: boolean; message?: string; authUrl?: string }>({ loading: false });

  const connect = async () => {
    setState({ loading: true });
    if (!apiEnabled) {
      setState({ loading: false, ok: false, message: "OAuth needs a running API (set VITE_CYFLOW_API_URL) plus provider setup on the server." });
      return;
    }
    try {
      const start = GOOGLE_APPS.has(appKey)
        ? await api.googleOAuthStart(appKey)
        : MICROSOFT_APPS.has(appKey)
          ? await api.microsoftOAuthStart(appKey)
          : await api.oauthStart(appKey);
      if (!start.configured || !start.authUrl) {
        setState({ loading: false, ok: false, message: start.message ?? "This provider is not configured on the server.", authUrl: start.authUrl });
        return;
      }
      const before = new Set(store.connections.filter((c) => c.appKey === appKey).map((c) => c.id));
      const outcome = await openOAuthPopup(start.authUrl);
      if (outcome.kind === "blocked") {
        setState({ loading: false, ok: false, message: "Popup blocked — allow popups for this site, then retry, or open the authorization page.", authUrl: start.authUrl });
        return;
      }
      if (outcome.kind === "result" && outcome.result.error) {
        setState({ loading: false, ok: false, message: `Authorization failed: ${outcome.result.error}` });
        return;
      }
      // Either the popup reported success or closed — reload and look for the new connection.
      const conns = await store.reloadConnections();
      const fresh = conns.find((c) => c.appKey === appKey && !before.has(c.id));
      if (fresh) {
        setState({ loading: false, ok: true, message: `Connected: ${fresh.name}` });
        onConnected?.(fresh);
        return;
      }
      setState({ loading: false, ok: false, message: "Authorization was cancelled or didn't complete." });
    } catch (e) {
      setState({ loading: false, ok: false, message: String((e as Error).message) });
    }
  };

  return (
    <div className="field">
      <label>Authorization</label>
      <Button variant="ghost" onClick={connect} disabled={state.loading}>
        {state.loading ? "Waiting for authorization…" : `Connect with ${appName}`}
      </Button>
      {state.message ? (
        <div className={`oauth-note${state.ok ? " is-ok" : ""}`}>
          {state.ok ? "✓ " : "⚠ "}
          {state.message}
          {state.authUrl ? (
            <>
              {" "}
              <a href={state.authUrl} target="_blank" rel="noreferrer noopener">Open authorization page ↗</a>
            </>
          ) : null}
        </div>
      ) : (
        <span className="hint">A secure popup opens for {appName}. No provider secrets are handled in the browser.</span>
      )}
    </div>
  );
}
