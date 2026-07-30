/**
 * tray — System Tray Icon
 * Sprint 14
 *
 * Shows the NeedsOps AI+ icon in the system tray with a context menu.
 * The tray icon gives quick access to:
 *  - Open main window
 *  - Broker status
 *  - Quit
 */

import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import path from "path";
import { getBrokerStatus } from "./brokerManager.js";

let tray: Tray | null = null;

export function setupTray(win: BrowserWindow): void {
  const iconPath = path.join(__dirname, "../../assets/tray-icon.png");
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  // macOS: use template image (auto adapts to dark/light mode)
  if (process.platform === "darwin") {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip("NeedsOps AI+");

  const rebuildMenu = () => {
    const { status, error } = getBrokerStatus();
    const statusLabel = {
      stopped: "● Disconnected",
      starting: "◌ Connecting…",
      running: "● Connected",
      error: `✕ Error: ${error?.slice(0, 40) ?? "unknown"}`,
    }[status] ?? "–";

    const contextMenu = Menu.buildFromTemplate([
      { label: "NeedsOps AI+", enabled: false, type: "normal" as const },
      { type: "separator" as const },
      { label: statusLabel, enabled: false },
      { type: "separator" as const },
      {
        label: "Open NeedsOps AI+",
        click: () => {
          if (win.isDestroyed()) return;
          win.show();
          win.focus();
        },
      },
      { type: "separator" as const },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

    tray?.setContextMenu(contextMenu);
  };

  rebuildMenu();

  tray.on("click", () => {
    if (!win.isDestroyed()) {
      win.isVisible() ? win.hide() : win.show();
    }
  });

  // Rebuild menu every 30s to reflect broker status
  setInterval(rebuildMenu, 30_000);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
