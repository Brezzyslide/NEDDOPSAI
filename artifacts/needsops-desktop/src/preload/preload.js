"use strict";
/**
 * preload.ts — Context Bridge (Renderer ↔ Main)
 * Sprint 14
 *
 * Exposes a narrow, typed API to the renderer process.
 * The renderer accesses everything through window.needsops — it cannot
 * call ipcRenderer directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const needsops = {
    // ── Credentials ─────────────────────────────────────────────────────────────
    credentials: {
        load: () => electron_1.ipcRenderer.invoke("credentials:load"),
        save: (creds) => electron_1.ipcRenderer.invoke("credentials:save", creds),
        clear: () => electron_1.ipcRenderer.invoke("credentials:clear"),
        isActivated: () => electron_1.ipcRenderer.invoke("credentials:isActivated"),
    },
    // ── Broker ──────────────────────────────────────────────────────────────────
    broker: {
        start: (params) => electron_1.ipcRenderer.invoke("broker:start", params),
        stop: () => electron_1.ipcRenderer.invoke("broker:stop"),
        restart: (params) => electron_1.ipcRenderer.invoke("broker:restart", params),
        getStatus: () => electron_1.ipcRenderer.invoke("broker:getStatus"),
        onStatus: (cb) => {
            electron_1.ipcRenderer.on("broker:status", (_event, data) => cb(data));
        },
        onLog: (cb) => {
            electron_1.ipcRenderer.on("broker:log", (_event, line) => cb(line));
        },
        offAll: () => {
            electron_1.ipcRenderer.removeAllListeners("broker:status");
            electron_1.ipcRenderer.removeAllListeners("broker:log");
        },
    },
    // ── Activation ──────────────────────────────────────────────────────────────
    activation: {
        redeem: (params) => electron_1.ipcRenderer.invoke("activation:redeem", params),
    },
    // ── Platform info ────────────────────────────────────────────────────────────
    platform: {
        info: () => electron_1.ipcRenderer.invoke("platform:info"),
    },
    // ── Shell ────────────────────────────────────────────────────────────────────
    shell: {
        openExternal: (url) => electron_1.ipcRenderer.invoke("shell:openExternal", url),
    },
};
electron_1.contextBridge.exposeInMainWorld("needsops", needsops);
