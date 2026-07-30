/**
 * NeedsOps AI+ Desktop — Main Process Entry Point
 * Sprint 14
 *
 * Responsibilities:
 *  - Create BrowserWindow for the setup/settings UI
 *  - Manage system tray icon
 *  - Start/stop the embedded broker subprocess
 *  - Handle IPC from renderer
 *  - Register auto-launch on OS startup
 */

import { app, BrowserWindow, shell, nativeImage } from "electron";
import path from "path";
import { setupTray } from "./tray.js";
import { startBroker, stopBroker } from "./brokerManager.js";
import { setupIpcHandlers } from "./ipcHandlers.js";
import { configureStartup } from "./startupManager.js";
import { loadCredentials } from "./credentialStore.js";

const isDev = !app.isPackaged;
const RENDERER_URL = isDev ? "http://localhost:5174" : undefined;
const RENDERER_PATH = path.join(__dirname, "../../renderer/index.html");

let mainWindow: BrowserWindow | null = null;

// ── Window ────────────────────────────────────────────────────────────────────

export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 440,
    minHeight: 560,
    resizable: true,
    center: true,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../../main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: getAppIcon(),
  });

  if (RENDERER_URL) {
    mainWindow.loadURL(RENDERER_URL);
  } else {
    mainWindow.loadFile(RENDERER_PATH);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function getAppIcon() {
  if (process.platform === "darwin") return undefined;
  const iconPath = path.join(__dirname, "../../assets/icon.png");
  try { return nativeImage.createFromPath(iconPath); } catch { return undefined; }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Register IPC handlers before window creation
  setupIpcHandlers();

  // Create the window
  const win = createWindow();

  // Setup tray icon
  setupTray(win);

  // Configure auto-launch
  await configureStartup();

  // Load stored credentials to determine if we should auto-activate
  const creds = await loadCredentials();

  // Start the broker if we have credentials
  if (creds.deviceToken && creds.deviceId && creds.orgSlug) {
    try {
      await startBroker({
        orgSlug: creds.orgSlug,
        deviceId: creds.deviceId,
        deviceToken: creds.deviceToken,
        apiBaseUrl: creds.apiBaseUrl ?? "https://api.needsops.com",
      });
    } catch (err) {
      console.error("[main] Failed to start broker on launch:", err);
    }
  }
});

app.on("window-all-closed", () => {
  // On macOS, stay alive in tray unless explicitly quit
  if (process.platform !== "darwin") {
    stopBroker().finally(() => app.quit());
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", async () => {
  await stopBroker();
});

// Security: disable navigation to external URLs
app.on("web-contents-created", (_, contents) => {
  contents.on("will-navigate", (event, url) => {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (!isLocal && !isDev) {
      event.preventDefault();
    }
  });
});
