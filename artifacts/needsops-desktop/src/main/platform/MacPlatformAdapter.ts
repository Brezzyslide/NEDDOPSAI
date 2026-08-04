/**
 * MacPlatformAdapter — macOS implementation of IPlatformAdapter
 * Sprint 34
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

export class MacPlatformAdapter implements IPlatformAdapter {
  getMetadata(): PlatformMetadata {
    return {
      id: "macos",
      displayName: "Mac",
      nodePlatform: "darwin",
    };
  }

  getWindowChromeOptions(): WindowChromeOptions {
    return {
      // Hides the standard title bar and integrates traffic lights into the
      // window content — standard macOS app convention.
      titleBarStyle: "hiddenInset",
      // macOS: icon is in the .app bundle; no explicit icon needed on the window.
      showExplicitIcon: false,
    };
  }

  getAppIconPath(_assetsDir: string): string | undefined {
    // macOS apps use the .icns file embedded in the bundle.
    // Electron sets this automatically from the build config.
    return undefined;
  }

  getTrayIconOptions(): TrayIconOptions {
    return {
      // macOS menu bar icons should be 16×16 template images.
      // Electron renders them in dark/light mode automatically.
      resizeTo: { width: 16, height: 16 },
    };
  }

  shouldKeepAliveOnWindowClose(): boolean {
    // Standard macOS behaviour: the app lives in the menu bar after the
    // last window is closed. User must choose Quit explicitly.
    return true;
  }

  getChildProcessOptions(): ChildProcessOptions {
    return {
      // windowsHide: false on macOS — the option is Windows-only and
      // should not be set here to keep behaviour predictable.
      windowsHide: false,
    };
  }

  isElectronExecutable(execPath: string): boolean {
    const base = path.basename(execPath);
    // Development: Electron's own binary is named "Electron" (capital E) on macOS.
    // The .app bundle contents/MacOS/ path is also valid.
    return base === "Electron" || base === "electron";
  }

  getRuntimeLocation(runtimeId: string): LocalRuntimeLocation {
    switch (runtimeId) {
      case "openclaw":
        return {
          searchPaths: [
            "/usr/local/bin",
            "/opt/homebrew/bin",       // Apple Silicon Homebrew
            "/usr/bin",
            path.join(os.homedir(), ".local/bin"),
            path.join(os.homedir(), ".openclaw/bin"),
          ],
          binaryName: "openclaw",
        };
      case "ollama":
        return {
          searchPaths: [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/Applications/Ollama.app/Contents/MacOS",
          ],
          binaryName: "ollama",
        };
      case "lm-studio":
        return {
          searchPaths: [
            "/Applications/LM Studio.app/Contents/MacOS",
            path.join(os.homedir(), "Applications/LM Studio.app/Contents/MacOS"),
          ],
          binaryName: "LM Studio",
        };
      case "vllm":
        return {
          searchPaths: [
            "/usr/local/bin",
            path.join(os.homedir(), ".local/bin"),
            path.join(os.homedir(), "miniforge3/bin"),
            path.join(os.homedir(), "opt/anaconda3/bin"),
          ],
          binaryName: "vllm",
        };
      default:
        return {
          searchPaths: ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"],
          binaryName: runtimeId,
        };
    }
  }

  supportsHiddenAutoStart(): boolean {
    return true;
  }

  notificationsAvailable(): boolean {
    return true;
  }

  getTempDir(): string {
    return os.tmpdir();
  }
}
