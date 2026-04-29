/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#15140f", 900: "#1d1c16", 850: "#23211b", 800: "#2b2922", 700: "#3a3830", 600: "#524f44" },
        cream: { 50: "#f7f3e8", 100: "#ece6d4", 200: "#d8d1bb", 300: "#b8b09a" },
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
