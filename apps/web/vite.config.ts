import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development Vite serves the UI on 5173 and proxies the API and the
// terminal socket to the server on 8788, so the browser sees one origin and
// the server's Origin check stays strict.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:8788", ws: true, changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
