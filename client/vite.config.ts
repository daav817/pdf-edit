import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The GitHub build passes APP_VERSION (package version + run number);
// local builds show the package version with "-dev".
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const appVersion =
  process.env.APP_VERSION && process.env.APP_VERSION !== "dev"
    ? process.env.APP_VERSION
    : `${pkg.version}-dev`;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    rollupOptions: {
      // The editor, plus the stand-alone preview page used by "View edited file".
      input: {
        main: "index.html",
        viewer: "viewer.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8750",
    },
  },
});
