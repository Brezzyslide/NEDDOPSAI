/**
 * startupManager — OS Auto-Launch Configuration
 * Sprint 14
 *
 * Configures NeedsOps AI+ to launch automatically when the user logs into
 * their computer. Uses Electron's built-in LoginItemSettings API.
 *
 * macOS: Adds to Login Items (System Preferences → General → Login Items)
 * Windows: Adds registry key at HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
 */

import { app } from "electron";

export async function configureStartup(enable = true): Promise<void> {
  if (!app.isPackaged) {
    // Never configure startup in development
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enable,
    openAsHidden: true,    // Start minimised to tray
    name: "NeedsOps AI+",
  });
}

export function getStartupEnabled(): boolean {
  const settings = app.getLoginItemSettings({ name: "NeedsOps AI+" });
  return settings.openAtLogin;
}

export function setStartupEnabled(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    name: "NeedsOps AI+",
  });
}
