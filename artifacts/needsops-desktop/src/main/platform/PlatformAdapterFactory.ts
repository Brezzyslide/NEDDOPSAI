/**
 * PlatformAdapterFactory — selects the correct IPlatformAdapter at runtime
 * Sprint 34
 *
 * Called once at application startup. The returned adapter is injected
 * into every module that previously contained inline process.platform checks.
 *
 * Usage:
 *   import { createPlatformAdapter } from "./platform/PlatformAdapterFactory.js";
 *   const platform = createPlatformAdapter();
 */

import type { IPlatformAdapter } from "./IPlatformAdapter.js";
import { MacPlatformAdapter } from "./MacPlatformAdapter.js";
import { WindowsPlatformAdapter } from "./WindowsPlatformAdapter.js";
import { LinuxPlatformAdapter } from "./LinuxPlatformAdapter.js";

export function createPlatformAdapter(): IPlatformAdapter {
  switch (process.platform) {
    case "darwin":
      return new MacPlatformAdapter();
    case "win32":
      return new WindowsPlatformAdapter();
    case "linux":
      return new LinuxPlatformAdapter();
    default:
      // Unsupported platform: fall back to Linux adapter as the safest
      // default. Log a warning so operators know.
      console.warn(
        `[platform] Unsupported platform "${process.platform}" — ` +
          "using Linux adapter as fallback. Some features may not work correctly.",
      );
      return new LinuxPlatformAdapter();
  }
}

/**
 * Singleton — created once and reused throughout the application lifecycle.
 * Import this instead of calling createPlatformAdapter() multiple times.
 */
export const platformAdapter: IPlatformAdapter = createPlatformAdapter();
