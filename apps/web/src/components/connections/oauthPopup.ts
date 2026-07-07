/**
 * Popup-based OAuth so the user never leaves the scenario builder. We open the
 * provider consent in a popup; the callback lands back on our app (in the popup)
 * which postMessages the result to the opener and closes itself.
 */

const MESSAGE_TYPE = "cyflow-oauth";

export interface OAuthResult {
  ok: boolean;
  app: string | null;
  error: string | null;
}

/** Read an OAuth result from the callback query params (?google / ?ms / *_error). */
function readCallbackParams(): OAuthResult | null {
  const p = new URLSearchParams(window.location.search);
  const okApp = p.get("google") ?? p.get("ms");
  const error = p.get("google_error") ?? p.get("ms_error");
  if (!okApp && !error) return null;
  return { ok: !!okApp, app: okApp, error };
}

/** True when this page load is the OAuth callback running inside our popup. */
export function isOAuthPopupCallback(): boolean {
  return !!window.opener && window.opener !== window && readCallbackParams() !== null;
}

/** From inside the popup: notify the opener of the result and close. */
export function reportOAuthPopupResult(): void {
  const result = readCallbackParams();
  try {
    window.opener?.postMessage({ type: MESSAGE_TYPE, ...result }, window.location.origin);
  } catch {
    /* opener gone — nothing to do */
  }
  window.close();
}

export type PopupOutcome =
  | { kind: "result"; result: OAuthResult }
  | { kind: "closed" } // popup closed without posting a result (cancelled, or postMessage missed)
  | { kind: "blocked" }; // the browser blocked the popup

/** Open the consent popup and resolve once it reports a result or closes. */
export function openOAuthPopup(authUrl: string): Promise<PopupOutcome> {
  const popup = window.open(authUrl, "cyflow-oauth", "width=520,height=680,menubar=no,toolbar=no");
  if (!popup) return Promise.resolve({ kind: "blocked" });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: PopupOutcome) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      resolve(outcome);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; ok?: boolean; app?: string | null; error?: string | null };
      if (data?.type === MESSAGE_TYPE) finish({ kind: "result", result: { ok: !!data.ok, app: data.app ?? null, error: data.error ?? null } });
    };
    window.addEventListener("message", onMessage);
    const timer = window.setInterval(() => {
      if (popup.closed) finish({ kind: "closed" });
    }, 500);
  });
}
