import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#f7f8fb",
        surface: "#ffffff",
        border: "#e5e7eb",
        ink: {
          DEFAULT: "#0f172a",
          mid: "#334155",
          soft: "#64748b",
          ghost: "#9ca3af",
          disabled: "#cbd5e1",
        },
        accent: {
          DEFAULT: "#2563eb",
          soft: "#eff6ff",
        },
        paper: {
          DEFAULT: "#f8fafc",
          warm: "#f1f5f9",
          mid: "#e2e8f0",
        },
      },
      fontFamily: {
        brand: ['Sora', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: "14px",
        "2xl": "18px",
        "3xl": "28px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
        pop: "0 10px 24px rgba(15, 23, 42, 0.08)",
        hero: "0 28px 70px rgba(148, 163, 184, 0.18)",
        "button-dark": "0 18px 36px rgba(15, 23, 42, 0.22)",
        brand: "0 12px 32px rgba(99, 102, 241, 0.32)",
      },
    },
  },
  plugins: [],
};

export default config;
