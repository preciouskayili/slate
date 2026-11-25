// Bundles the Electron main + preload (including the server) into dist-electron/.
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron", "pg-native"], logLevel: "info" };
await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" });
await build({ ...common, entryPoints: ["electron/preload.cts"], outfile: "dist-electron/preload.cjs" });
