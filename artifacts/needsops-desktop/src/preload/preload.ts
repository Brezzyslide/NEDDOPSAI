/**
 * preload.ts — Context Bridge (Renderer ↔ Main)
 * Sprint 14
 *
 * Exposes a narrow, typed API to the renderer process.
 * The renderer accesses everything through window.needsops — it cannot
 * call ipcRenderer directly.
 */

import { contextBridge, ipcRenderer } from "electron";

export interface PlatformInfo {
  platform: string;
  arch: string;
  appVersion: string;
  isDev: boolean;
  electronVersion: string;
  nodeVersion: string;
}

export interface StoredCredentials {
  deviceToken: string | null;
  deviceId: string | null;
  orgSlug: string | null;
  apiBaseUrl: string | null;
}

export type BrokerStatus = "stopped" | "starting" | "running" | "error";

export interface BrokerStartParams {
  orgSlug: string;
  deviceId: string;
  deviceToken: string;
  apiBaseUrl: string;
}

export interface RedeemParams {
  activationCode: string;
  apiBaseUrl: string;
  platform: string;
  arch: string;
  displayName: string;
  appVersion: string;
}

const needsops = {
  // ── Credentials ─────────────────────────────────────────────────────────────
  credentials: {
    load: (): Promise<StoredCredentials> => ipcRenderer.invoke("credentials:load"),
    save: (creds: Partial<StoredCredentials>): Promise<{ ok: boolean }> => ipcRenderer.invoke("credentials:save", creds),
    clear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("credentials:clear"),
    isActivated: (): Promise<boolean> => ipcRenderer.invoke("credentials:isActivated"),
  },

  // ── Broker ──────────────────────────────────────────────────────────────────
  broker: {
    start: (params: BrokerStartParams): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("broker:start", params),
    stop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("broker:stop"),
    restart: (params: BrokerStartParams): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("broker:restart", params),
    getStatus: (): Promise<{ status: BrokerStatus; error: string | null }> => ipcRenderer.invoke("broker:getStatus"),
    onStatus: (cb: (data: { status: BrokerStatus; error: string | null }) => void) => {
      ipcRenderer.on("broker:status", (_event, data) => cb(data));
    },
    onLog: (cb: (line: string) => void) => {
      ipcRenderer.on("broker:log", (_event, line) => cb(line));
    },
    offAll: () => {
      ipcRenderer.removeAllListeners("broker:status");
      ipcRenderer.removeAllListeners("broker:log");
    },
  },

  // ── Activation ──────────────────────────────────────────────────────────────
  activation: {
    redeem: (params: RedeemParams): Promise<{ ok: boolean; deviceId?: string; orgSlug?: string; error?: string }> =>
      ipcRenderer.invoke("activation:redeem", params),
  },

  // ── Platform info ────────────────────────────────────────────────────────────
  platform: {
    info: (): Promise<PlatformInfo> => ipcRenderer.invoke("platform:info"),
  },

  // ── Shell ────────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
};

contextBridge.exposeInMainWorld("needsops", needsops);

// Type declaration for the renderer TypeScript
declare global {
  interface Window {
    needsops: typeof needsops;
  }
}
