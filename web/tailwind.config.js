/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b0c10", 900: "#11131a", 800: "#181b25", 700: "#222636" },
        neuro: { 400: "#7c8cff", 500: "#5d6cff", 600: "#4a55e6" },
        pulse: { 400: "#21d4a8", 500: "#13b890" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
