import type { Config } from "tailwindcss";

// Design tokens. Cool, ink-based palette chosen for a data product:
// numbers must read cleanly, and color is reserved for meaning (up / down / attention).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#16202E", soft: "#3A4656", muted: "#6B7685" },
        paper: { DEFAULT: "#F5F7F9", raised: "#FFFFFF", sunk: "#E9EDF1" },
        line: "#D7DDE4",
        signal: { DEFAULT: "#1D5FBF", hover: "#174E9E", tint: "#E6EEF9" },
        up: "#1E7A4F",
        down: "#B42318",
        caution: "#A86400",
      },
      fontFamily: {
        sans: ['"Public Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        // Modular scale (1.2) for UI.
        xs: ["0.75rem", "1.1rem"],
        sm: ["0.875rem", "1.3rem"],
        base: ["1rem", "1.5rem"],
        lg: ["1.2rem", "1.65rem"],
        xl: ["1.44rem", "1.9rem"],
        "2xl": ["1.728rem", "2.1rem"],
        "3xl": ["2.488rem", "2.75rem"],
        "4xl": ["3.583rem", "3.75rem"],
      },
      borderRadius: { sm: "3px", DEFAULT: "6px", lg: "10px" },
    },
  },
  plugins: [],
};
export default config;
