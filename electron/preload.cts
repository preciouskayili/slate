// Exposes the per-launch API token to the page. Runs sandboxed.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("slate", ipcRenderer.sendSync("slate:config"));
