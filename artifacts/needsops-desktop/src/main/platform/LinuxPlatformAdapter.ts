/**
 * LinuxPlatformAdapter — Linux implementation of IPlatformAdapter
 * Sprint 34
 *
 * Linux-specific notes:
 *   - Credential storage: Electron safeStorage uses libsecret (if available)
 *     or falls back to Chromium's obfuscated local storage. On headless servers
 *     or systems without a keyring daemon, the base64 fallback in credentialStore
 *     applies. This is documented as a known limitation.
 *   - Startup (auto-launch): Electron's app.setLoginItemSettings() uses XDG
 *     autostart on Linux (writes ~/.config/autostart/<appname>.desktop).
 *     This is cross-desktop (GNOME, KDE, XFCE) but requires the session to
 *     support XDG autostart. systemd user services are an alternative; not
 *     implemented here but documented.
 *   - Tray: Electron Tray works on GNOME/KDE/XFCE. Some GNOME configurations
 *     require the AppIndicator extension to show tray icons.
 *   - Notifications: libnotify via Electron's Notification API. Works on most
 *     desktop environments. Not available on headless or Wayland-only without
 *     a notification daemon.
 *   - Packaging: AppImage (electron-builder). Self-contained, no install step.
 *     .deb and .rpm are alternatives; not built by default.
 *
 * Known limitations documented in platform-compatibility-report.md.
 */

import os from "os";
import path from "path";
import type {
  IPlatformAdapter,
  PlatformMetadata,
  WindowChromeOptions,
  TrayIconOptions,
  ChildProcessOptions,
  LocalRuntimeLocation,
} from "./IPlatformAdapter.js";

export class LinuxPlatformAdapter implements IPlatformAdapter {
  getMetadata(): PlatformMetadata {
    return {
      id: "linux",
      displayName: "Linux",
      nodePlatform: "linux",
    };
  }

  getWindowChromeOptions(): WindowChromeOptions {
    return {
      // Standard window decoration on Linux.
      titleBarStyle: "default",
      showExplicitIcon: true,
    };
  }

  getAppIconPath(assetsDir: string): string | undefined {
    return path.join(assetsDir, "icon.png");
  }

  getTrayIconOptions(): TrayIconOptions {
    return {
      // Linux desktop environments handle icon sizing.
      // Typical system tray size is 22×22 or 24×24 depending on DE theme.
      // Let the OS decide — do not resize.
      resizeTo: undefined,
    };
  }

  shouldKeepAliveOnWindowClose(): boolean {
    // Linux convention: closing the window quits unless the user explicitly
    // minimises to tray. The tray icon click handler allows re-opening.
    // Setting this to false means window-all-closed triggers quit, which
    // is the standard desktop application behaviour on Linux.
    return false;
  }

  getChildProcessOptions(): ChildProcessOptions {
    return {
      // windowsHide is a Windows-only option and has no effect on Linux.
      // Set to false to avoid any unexpected behaviour.
      windowsHide: false,
    };
  }

  isElectronExecutable(execPath: string): boolean {
    const base = path.basename(execPath);
    // Linux Electron binary is simply named "electron" (lowercase).
    return base === "electron";
  }

  getRuntimeLocation(runtimeId: string): LocalRuntimeLocation {
    const home = os.homedir();

    switch (runtimeId) {
      case "openclaw":
        return {
          searchPaths: [
            "/usr/local/bin",
            "/usr/bin",
            path.join(home, ".local/bin"),
            path.join(home, ".openclaw/bin"),
          ],
          binaryName: "openclaw",
        };
      case "ollama":
        return {
          searchPaths: [
            "/usr/local/bin",
            "/usr/bin",
            path.join(home, ".local/bin"),
          ],
          binaryName: "ollama",
        };
      case "lm-studio":
        return {
          // LM Studio on Linux is distributed as AppImage; location varies.
          searchPaths: [
            path.join(home, "Applications"),
            path.join(home, ".local/bin"),
            "/usr/local/bin",
          ],
          binaryName: "lmstudio",
        };
      case "vllm":
        return {
          searchPaths: [
            "/usr/local/bin",
            path.join(home, ".local/bin"),
            path.join(home, "miniforge3/bin"),
            path.join(home, "anaconda3/bin"),
            path.join(home, "miniconda3/bin"),
          ],
          binaryName: "vllm",
        };
      default:
        return {
          searchPaths: ["/usr/local/bin", "/usr/bin", path.join(home, ".local/bin")],
          binaryName: runtimeId,
        };
    }
  }

  supportsHiddenAutoStart(): boolean {
    // XDG autostart supports hidden start via StartupNotify=false.
    return true;
  }

  notificationsAvailable(): boolean {
    // Notifications require a notification daemon (e.g. dunst, notify-osd).
    // Most desktop environments provide one. Headless environments do not.
    // Return true as the default assumption for a desktop install.
    return true;
  }

  getTempDir(): string {
    return os.tmpdir();
  }
}
