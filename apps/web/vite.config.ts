import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development Vite serves the UI on 5173 and proxies the API and the
// terminal socket to the server on 8788, so the browser sees one origin and
// the server's Origin check stays strict.
// CV_API points a worktree's UI at a scratch server, so it can be checked in a
// browser without touching the viewer on :8788.
const api = process.env.CV_API ?? "127.0.0.1:8788";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CV_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": { target: `http://${api}`, changeOrigin: true },
      "/ws": { target: `ws://${api}`, ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
