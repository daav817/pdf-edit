import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
