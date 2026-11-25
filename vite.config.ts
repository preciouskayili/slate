import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const SERVER = `http://127.0.0.1:${process.env.SLATE_PORT ?? 4317}`;

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src"), "@shared": path.resolve(import.meta.dirname, "shared") } },
  server: {
    port: 5317,
    strictPort: true,
    proxy: { "/api": { target: SERVER, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
