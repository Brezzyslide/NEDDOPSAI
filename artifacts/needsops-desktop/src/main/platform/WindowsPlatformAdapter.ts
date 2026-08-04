/**
 * WindowsPlatformAdapter — Windows implementation of IPlatformAdapter
 * Sprint 34
 *
 * Windows-specific notes:
 *   - Credential storage: Electron safeStorage uses Windows DPAPI.
 *     No additional native module required.
 *   - Startup: Electron app.setLoginItemSettings() writes to
 *     HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
 *   - Tray: Windows system tray (notification area) is supported by Electron Tray.
 *   - windowsHide: must be set on all child_process.spawn() calls to prevent
 *     a console window flashing briefly on screen.
 *   - HOME env variable: Not reliably set on Windows. Use USERPROFILE or
 *     os.homedir() instead. The broker types.ts fix uses os.homedir().
 *   - Installer: NSIS x64 (electron-builder). Per-machine install optional.
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

export class WindowsPlatformAdapter implements IPlatformAdapter {
  getMetadata(): PlatformMetadata {
    return {
      id: "windows",
      displayName: "Windows",
      nodePlatform: "win32",
    };
  }

  getWindowChromeOptions(): WindowChromeOptions {
    return {
      // Standard Windows title bar.
      titleBarStyle: "default",
      // Windows requires an explicit icon for the taskbar and title bar.
      showExplicitIcon: true,
    };
  }

  getAppIconPath(assetsDir: string): string | undefined {
    return path.join(assetsDir, "icon.png");
  }

  getTrayIconOptions(): TrayIconOptions {
    return {
      // Windows notification area handles icon sizing automatically.
      // Do not resize — let Electron pass the original image.
      resizeTo: undefined,
    };
  }

  shouldKeepAliveOnWindowClose(): boolean {
    // Windows convention: closing the window quits the app.
    // The tray icon click handler re-opens the window if the user clicked
    // the tray icon after closing, but the window-all-closed event triggers
    // a quit on Windows.
    return false;
  }

  getChildProcessOptions(): ChildProcessOptions {
    return {
      // REQUIRED on Windows: prevents a console (cmd) window from flashing
      // briefly when spawning child processes (broker, node, etc.).
      windowsHide: true,
    };
  }

  isElectronExecutable(execPath: string): boolean {
    const base = path.basename(execPath).toLowerCase();
    return base === "electron.exe";
  }

  getRuntimeLocation(runtimeId: string): LocalRuntimeLocation {
    const programFiles = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
    const userBin = path.join(os.homedir(), ".local", "bin");

    switch (runtimeId) {
      case "openclaw":
        return {
          searchPaths: [
            path.join(programFiles, "OpenClaw", "bin"),
            path.join(localAppData, "OpenClaw", "bin"),
            userBin,
          ],
          binaryName: "openclaw",
        };
      case "ollama":
        return {
          searchPaths: [
            path.join(programFiles, "Ollama"),
            path.join(localAppData, "Programs", "Ollama"),
          ],
          binaryName: "ollama",
        };
      case "lm-studio":
        return {
          searchPaths: [
            path.join(programFiles, "LM Studio"),
            path.join(localAppData, "Programs", "LM Studio"),
            path.join(programFilesX86, "LM Studio"),
          ],
          binaryName: "LM Studio",
        };
      case "vllm":
        return {
          // vLLM has limited native Windows support; typically run in WSL2.
          // Include common WSL2-exposed paths.
          searchPaths: [
            path.join(localAppData, "vllm", "bin"),
            userBin,
          ],
          binaryName: "vllm",
        };
      default:
        return {
          searchPaths: [
            path.join(programFiles, runtimeId),
            path.join(localAppData, "Programs", runtimeId),
            userBin,
          ],
          binaryName: runtimeId,
        };
    }
  }

  supportsHiddenAutoStart(): boolean {
    return true;
  }

  notificationsAvailable(): boolean {
    // Windows Toast notifications work via Electron on Windows 10/11.
    // Requires the app to be packaged (uses App User Model ID).
    return true;
  }

  getTempDir(): string {
    return os.tmpdir();
  }
}
