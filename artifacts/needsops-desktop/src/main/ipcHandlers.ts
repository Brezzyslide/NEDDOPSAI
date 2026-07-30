/**
 * ipcHandlers — IPC Bridge between Renderer and Main
 * Sprint 14
 *
 * All IPC channels are registered here. The renderer accesses them
 * exclusively through the contextBridge API in preload.ts — never
 * directly via ipcRenderer.
 *
 * Channels (invoke = request/response, on = event):
 *   Renderer→Main (invoke):
 *     credentials:load
 *     credentials:save
 *     credentials:clear
 *     credentials:isActivated
 *     broker:start
 *     broker:stop
 *     broker:restart
 *     broker:getStatus
 *     activation:redeem     — hit API, save returned credentials
 *     platform:info
 *     shell:openExternal
 *
 *   Main→Renderer (send):
 *     broker:status         — { status, error }
 *     broker:log            — string log line
 *     tunnel:status         — { status, url }
 */

import { ipcMain, shell, app } from "electron";
import {
  loadCredentials,
  saveCredentials,
  clearAllCredentials,
  isActivated,
} from "./credentialStore.js";
import {
  startBroker,
  stopBroker,
  restartBroker,
  getBrokerStatus,
} from "./brokerManager.js";

export function setupIpcHandlers(): void {

  // ── Credentials ─────────────────────────────────────────────────────────────

  ipcMain.handle("credentials:load", async () => {
    return loadCredentials();
  });

  ipcMain.handle("credentials:save", async (_event, creds: Parameters<typeof saveCredentials>[0]) => {
    await saveCredentials(creds);
    return { ok: true };
  });

  ipcMain.handle("credentials:clear", async () => {
    await clearAllCredentials();
    return { ok: true };
  });

  ipcMain.handle("credentials:isActivated", async () => {
    return isActivated();
  });

  // ── Broker lifecycle ─────────────────────────────────────────────────────────

  ipcMain.handle("broker:start", async (_event, params: Parameters<typeof startBroker>[0]) => {
    try {
      await startBroker(params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("broker:stop", async () => {
    await stopBroker();
    return { ok: true };
  });

  ipcMain.handle("broker:restart", async (_event, params: Parameters<typeof restartBroker>[0]) => {
    try {
      await restartBroker(params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("broker:getStatus", () => {
    return getBrokerStatus();
  });

  // ── Activation — redeem code via API, save creds ───────────────────────────

  ipcMain.handle("activation:redeem", async (_event, params: {
    activationCode: string;
    apiBaseUrl: string;
    platform: string;
    arch: string;
    displayName: string;
    appVersion: string;
  }) => {
    try {
      const resp = await fetch(`${params.apiBaseUrl}/v1/activation-codes/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: params.activationCode,
          platform: params.platform,
          arch: params.arch,
          displayName: params.displayName,
          appVersion: params.appVersion,
        }),
      });
      const data = await resp.json() as any;
      if (!resp.ok) {
        return { ok: false, error: data.error?.message ?? "Redemption failed" };
      }
      // Save credentials to OS keychain
      await saveCredentials({
        deviceToken: data.deviceToken,
        deviceId: data.deviceId,
        orgSlug: data.orgSlug,
        apiBaseUrl: params.apiBaseUrl,
      });
      return { ok: true, deviceId: data.deviceId, orgSlug: data.orgSlug };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Platform info ────────────────────────────────────────────────────────────

  ipcMain.handle("platform:info", () => {
    return {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      isDev: !app.isPackaged,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    };
  });

  // ── Shell ────────────────────────────────────────────────────────────────────

  ipcMain.handle("shell:openExternal", (_event, url: string) => {
    shell.openExternal(url);
  });
}
