// Renders build/icon.svg into the app icon set: build/icon.png (1024), build/icon.icns (macOS),
// and public/favicon.svg (tile cropped to the edges for tabs). Run: pnpm icons
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(path.join(root, "build/icon.svg"), "utf8");
const png = (size) => new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();

await writeFile(path.join(root, "build/icon.png"), png(1024));
// Favicon: same artwork, cropped to the tile so it fills a browser tab.
await writeFile(path.join(root, "public/favicon.svg"), source.replace('viewBox="0 0 1024 1024"', 'viewBox="96 96 832 840"'));

if (process.platform === "darwin") {
  const temporary = await mkdtemp(path.join(tmpdir(), "slate-icons-"));
  try {
    const iconset = path.join(temporary, "Slate.iconset");
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      await writeFile(path.join(iconset, `icon_${size}x${size}.png`), png(size));
      await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2));
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build/icon.icns")]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
console.log("Generated build/icon.png, build/icon.icns and public/favicon.svg from build/icon.svg");
