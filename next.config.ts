import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so Tauri can load the built HTML directly without a Node server.
  output: "export",
  images: {
    // No Next image optimizer in a static export.
    unoptimized: true,
  },
  // Tauri webview loads files from disk, so trailing slashes keep asset paths stable.
  trailingSlash: true,
  // The app is fully client-rendered (Zustand + localStorage); the App Router
  // data layer is not used, so skip prerender type errors on internal pages.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Work around https://github.com/vercel/next.js/issues/85668 — React 19
  // + Next 16 fails prerender with "useContext of null" when static-exporting
  // internal pages (_global-error, _not-found). Forcing single-threaded
  // prerender sidesteps the worker-communication bug.
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
};

export default nextConfig;

