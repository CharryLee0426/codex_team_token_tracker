import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Snapshot, TrackerBridge } from "./core/snapshot";
import type { LanguageSetting } from "./i18n";

const bridge: TrackerBridge = {
  getSnapshot: () => ipcRenderer.invoke("snapshot:get"),
  onSnapshot: (cb) => {
    const listener = (_e: IpcRendererEvent, s: Snapshot) => cb(s);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  },
  setLanguage: (lang: LanguageSetting) => ipcRenderer.invoke("language:set", lang),
  openDashboard: () => ipcRenderer.invoke("dashboard:open"),
  openExternal: (url: string) => ipcRenderer.invoke("external:open", url),
  login: () => ipcRenderer.invoke("auth:login"),
  cancelLogin: () => ipcRenderer.invoke("auth:cancel"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  refresh: () => ipcRenderer.invoke("refresh"),
  syncNow: () => ipcRenderer.invoke("sync:now"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  quit: () => ipcRenderer.invoke("quit"),
};

contextBridge.exposeInMainWorld("codexTracker", bridge);
