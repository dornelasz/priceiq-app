import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Premium dark palette
        bg: {
          DEFAULT: "#0a0b0f",
          soft: "#101218",
          card: "#14161d",
          hover: "#1a1d26",
        },
        border: {
          DEFAULT: "#23262f",
          soft: "#1b1e26",
        },
        brand: {
          DEFAULT: "#6366f1",
          soft: "#818cf8",
          dim: "#4f46e5",
        },
        relevance: {
          low: "#64748b",
          medium: "#3b82f6",
          high: "#f59e0b",
          critical: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
