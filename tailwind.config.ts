import type { Config } from "tailwindcss";

// Tailwind v4 reads CSS-first config from globals.css (@import "tailwindcss").
// This file remains only to register plugins and content globs.
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {},
  plugins: [],
};
export default config;
