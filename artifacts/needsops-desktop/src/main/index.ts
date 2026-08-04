/**
 * NeedsOps AI+ Desktop — Main Process Entry Point
 * Sprint 14 (created) | Sprint 34 (cross-platform refactor)
 *
 * Platform-specific behaviour is now fully isolated behind IPlatformAdapter.
 * No direct process.platform checks exist in this file.
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
import { platformAdapter } from "./platform/PlatformAdapterFactory.js";

const isDev = !app.isPackaged;
const RENDERER_URL = isDev ? "http://localhost:5174" : undefined;
const RENDERER_PATH = path.join(__dirname, "../../renderer/index.html");

let mainWindow: BrowserWindow | null = null;

// ── Window ────────────────────────────────────────────────────────────────────

export function createWindow(): BrowserWindow {
  const chrome = platformAdapter.getWindowChromeOptions();

  mainWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 440,
    minHeight: 560,
    resizable: true,
    center: true,
    show: false,
    // titleBarStyle is now provided by the platform adapter:
    //   macOS   → "hiddenInset"  (integrates traffic-light buttons)
    //   Windows → "default"
    //   Linux   → "default"
    titleBarStyle: chrome.titleBarStyle,
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
  // Platform adapter determines whether an explicit icon is needed.
  // macOS: undefined — icon is embedded in the .app bundle.
  // Windows/Linux: load icon.png from assets.
  if (!platformAdapter.getWindowChromeOptions().showExplicitIcon) {
    return undefined;
  }
  const assetsDir = path.join(__dirname, "../../assets");
  const iconPath = platformAdapter.getAppIconPath(assetsDir);
  if (!iconPath) return undefined;
  try {
    return nativeImage.createFromPath(iconPath);
  } catch {
    return undefined;
  }
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
  // Platform adapter determines the correct close behaviour:
  //   macOS   → keep alive in tray (shouldKeepAliveOnWindowClose = true)
  //   Windows → quit when last window closes
  //   Linux   → quit when last window closes
  if (!platformAdapter.shouldKeepAliveOnWindowClose()) {
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
