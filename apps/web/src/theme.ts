/**
 * Theme system. Two themes share the Cyflow identity (lime accents, frosted
 * glass, ink text): "dark" is the signature vivid-lime world (default); "light"
 * is a clean professional light surface. The choice is stored in localStorage
 * and applied as a `data-theme` attribute on <html> so CSS variables switch.
 */
export type Theme = "dark" | "light";

const KEY = "cyflow_theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable — the attribute still applies for this session */
  }
}

/** Set the initial theme before React renders (avoids a flash of the wrong theme). */
export function initTheme(): void {
  document.documentElement.setAttribute("data-theme", getStoredTheme());
}
