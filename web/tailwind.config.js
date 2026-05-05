/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Each token is a CSS var so light mode can override at the :root[data-theme="light"]
      // level without rewriting every className across 17 components in one go. Existing
      // bg-ink-900 / text-cream-100 etc. keep working — they just resolve to different
      // hex codes in light mode.
      colors: {
        ink: {
          950: "var(--c-ink-950)",
          900: "var(--c-ink-900)",
          850: "var(--c-ink-850)",
          800: "var(--c-ink-800)",
          700: "var(--c-ink-700)",
          600: "var(--c-ink-600)",
        },
        cream: {
          50:  "var(--c-cream-50)",
          100: "var(--c-cream-100)",
          200: "var(--c-cream-200)",
          300: "var(--c-cream-300)",
        },
        flame: { 400: "#f6a623", 500: "#e9911a", 600: "#c97712" },
        coral: { 400: "#ff7657", 500: "#ee5a3c", 600: "#c94327" },
        violet: { 400: "#9d6bff", 500: "#7e4eef", 600: "#6438c9" },
        leaf: { 400: "#8be0a8", 500: "#5fc783" },
      },
      fontFamily: {
        display: ["'Crimson Text'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
