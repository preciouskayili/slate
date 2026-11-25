// Desktop shell: runs the Slate server in-process on a random loopback port,
// guarded by a per-launch token, and shows the UI in a native window.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from "electron";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { startServer } from "../server/index.js";

const token = randomBytes(24).toString("hex");

// ---- Crash log: ~/Library/Logs/Slate/main.log

let logFile = "";
function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  process.stderr.write(line);
  try {
    if (!logFile) {
      const dir = app.getPath("logs");
      mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "main.log");
    }
    appendFileSync(logFile, line);
  } catch {
    /* logging must never throw */
  }
}

// Keep the app alive on a stray error and record it, rather than vanishing.
process.on("uncaughtException", (error) => log("[uncaughtException]", error));
process.on("unhandledRejection", (reason) => log("[unhandledRejection]", reason instanceof Error ? reason : String(reason)));
let origin = "";
const STABLE_PORT = 47317;

ipcMain.on("slate:config", (event) => {
  event.returnValue = { electron: true, token };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: "Slate",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0c" : "#f7f8fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") log("[renderer]", event.message);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log("[render-process-gone]", details.reason, `exit ${details.exitCode}`);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) win.webContents.reload();
  });
  win.on("unresponsive", () => log("[unresponsive] window stopped responding"));
  // Keep navigation inside the app; open everything else in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  void win.loadURL(`${origin}/`);
  return win;
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
      },
      { role: "windowMenu" },
    ]),
  );
}

app.setName("Slate");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("child-process-gone", (_event, details) => {
  if (details.reason !== "clean-exit") log("[child-process-gone]", details.type, details.reason);
});

app.whenReady().then(async () => {
  // A fixed port keeps the page origin stable, so tabs, drafts and layout (localStorage) survive restarts.
  // Fall back to a random port only if it's taken.
  const webRoot = path.join(app.getAppPath(), "dist");
  const { port } = await startServer({ port: STABLE_PORT, token, webRoot }).catch((error) => {
    log(`[server] port ${STABLE_PORT} unavailable (${(error as Error).message}); using a random port, so saved tabs won't load this session`);
    return startServer({ port: 0, token, webRoot });
  });
  origin = `http://127.0.0.1:${port}`;
  // Packaged builds take the icon from build/icon.icns; unpackaged runs would show Electron's.
  if (process.platform === "darwin" && !app.isPackaged) app.dock?.setIcon(path.join(app.getAppPath(), "build/icon.png"));
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
