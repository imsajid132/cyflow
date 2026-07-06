/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Preflight is disabled so the ported design system in index.css renders
  // pixel-identically to the approved prototype. Tailwind utilities remain
  // available; the Cyflow tokens below are exposed to them.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        lime: {
          DEFAULT: "#9DDE1E",
          bright: "#B4F227",
          deep: "#6FA011",
        },
        ink: {
          DEFAULT: "#0A0A0A",
          soft: "#1A1A1A",
        },
        danger: "#FF4D4D",
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        data: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        panel: "20px",
        pill: "999px",
      },
    },
  },
  plugins: [],
};
