/**
 * tray — System Tray Icon
 * Sprint 14 (created) | Sprint 34 (cross-platform refactor)
 *
 * Shows the NeedsOps AI+ icon in the system tray with a context menu.
 * Platform-specific icon behaviour is handled by IPlatformAdapter.
 *
 *   macOS   — icon resized to 16×16 (template image, adapts dark/light mode)
 *   Windows — icon passed as-is (Windows notification area handles sizing)
 *   Linux   — icon passed as-is (desktop environment handles sizing)
 */

import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import path from "path";
import { getBrokerStatus } from "./brokerManager.js";
import { platformAdapter } from "./platform/PlatformAdapterFactory.js";

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

  // Platform adapter determines whether and how to resize the tray icon.
  // macOS: resize to 16×16 for menu bar template images.
  // Windows/Linux: let the OS handle sizing.
  const trayOpts = platformAdapter.getTrayIconOptions();
  if (trayOpts.resizeTo) {
    icon = icon.resize(trayOpts.resizeTo);
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
