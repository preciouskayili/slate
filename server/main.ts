// CLI entry: `pnpm dev:server` (API only, Vite serves the UI) or `pnpm start` (API + built UI).
import path from "node:path";
import { startServer } from "./index.js";
import { store } from "./store.js";

const port = Number(process.env.SLATE_PORT ?? 4317);
const webRoot = process.env.NODE_ENV === "production" ? path.resolve(process.env.SLATE_WEB_ROOT ?? "dist") : undefined;

startServer({ port, webRoot }).then(({ port }) => {
  console.log(`[slate] ${webRoot ? "app" : "API"} on http://127.0.0.1:${port}  (data in ${store.home})`);
});
