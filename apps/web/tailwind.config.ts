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
        ink: "#0f172a",
        accent: "#2563eb",
      },
    },
  },
  plugins: [],
};

export default config;
