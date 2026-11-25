import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        sidebar: v("sidebar"),
        panel: v("panel"),
        elevated: v("elevated"),
        surface: { DEFAULT: v("surface"), hover: v("surface-hover"), strong: v("surface-strong") },
        fg: v("fg"),
        accent: v("accent"),
        brand: v("brand"),
        ok: v("ok"),
        warn: v("warn"),
        danger: v("danger"),
      },
      fontFamily: {
        sans: ["Inter Variable", "-apple-system", "BlinkMacSystemFont", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "SF Mono", "ui-monospace", "Menlo", "monospace"],
      },
      fontSize: { "2xs": ["10.5px", "14px"], xs: ["11.5px", "16px"], sm: ["12.5px", "18px"], base: ["13px", "20px"] },
      boxShadow: {
        pop: "0 1px 2px rgb(0 0 0 / 0.08), 0 16px 48px -8px rgb(0 0 0 / 0.4)",
        dialog: "0 2px 6px rgb(0 0 0 / 0.08), 0 28px 90px rgb(0 0 0 / 0.45)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "scale(.97) translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        "fade-in": "fade-in .12s ease-out",
        "pop-in": "pop-in .14s cubic-bezier(.2,.9,.3,1)",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
