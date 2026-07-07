import { useState } from "react";
import { applyTheme, getStoredTheme, type Theme } from "../theme";
import { SunIcon, MoonIcon } from "./icons";

/** Sidebar theme switch — flips between the signature lime (dark) + light themes. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  const toggle = () => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      className="navitem themetoggle"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}
