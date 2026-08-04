/**
 * IPlatformAdapter — Platform Abstraction Interface
 * Sprint 34: Cross-Platform Desktop Connector Architecture
 *
 * The connector core must not contain OS-specific logic.
 * All operating-system differences are isolated behind this interface.
 *
 * Implementations:
 *   MacPlatformAdapter     — macOS
 *   WindowsPlatformAdapter — Windows
 *   LinuxPlatformAdapter   — Linux
 *
 * The correct adapter is selected at runtime by PlatformAdapterFactory
 * based on process.platform.
 */

// ── Window chrome ─────────────────────────────────────────────────────────────

export type TitleBarStyle =
  | "default"
  | "hidden"
  | "hiddenInset"
  | "customButtonsOnHover";

export interface WindowChromeOptions {
  /** macOS: 'hiddenInset'; Windows/Linux: 'default' */
  titleBarStyle: TitleBarStyle;
  /**
   * Whether to show an explicit app icon in the window frame.
   * macOS does not require it (icon lives in .app bundle).
   * Windows and Linux show it in the taskbar and title bar.
   */
  showExplicitIcon: boolean;
}

// ── Tray icon ─────────────────────────────────────────────────────────────────

export interface TrayIconOptions {
  /**
   * Target size for the tray icon in pixels.
   * macOS: resize to 16×16 for template images.
   * Windows/Linux: undefined — let the OS handle sizing.
   */
  resizeTo?: { width: number; height: number };
}

// ── Child process ─────────────────────────────────────────────────────────────

export interface ChildProcessOptions {
  /**
   * Windows: true — prevents a console window flashing when spawning child
   * processes. Has no effect on macOS/Linux but is safe to pass.
   * Set false on non-Windows to avoid any unexpected behaviour.
   */
  windowsHide: boolean;
}

// ── Platform metadata ─────────────────────────────────────────────────────────

export type PlatformId = "macos" | "windows" | "linux";

export interface PlatformMetadata {
  /** Machine-readable platform identifier. Sent to the NeedsOps API. */
  id: PlatformId;
  /** Human-readable display name. Shown in UI. */
  displayName: "Mac" | "Windows" | "Linux";
  /** Node.js process.platform string for this platform. */
  nodePlatform: "darwin" | "win32" | "linux";
}

// ── Runtime discovery ─────────────────────────────────────────────────────────

export interface LocalRuntimeLocation {
  /** Common install directories to search for this runtime. Platform-specific. */
  searchPaths: string[];
  /** Executable name, without extension. Adapter appends .exe on Windows. */
  binaryName: string;
}

// ── IPlatformAdapter ──────────────────────────────────────────────────────────

export interface IPlatformAdapter {
  // ── Identity ──────────────────────────────────────────────────────────────

  /** Returns the platform metadata object. */
  getMetadata(): PlatformMetadata;

  // ── Window chrome ─────────────────────────────────────────────────────────

  /**
   * Returns window creation options that match OS conventions.
   * Used in BrowserWindow constructor.
   */
  getWindowChromeOptions(): WindowChromeOptions;

  // ── App icon ──────────────────────────────────────────────────────────────

  /**
   * Returns the absolute path to the app icon for window/taskbar use.
   * macOS: undefined (icon is embedded in the .app bundle).
   * Windows/Linux: path to icon.png in assets.
   */
  getAppIconPath(assetsDir: string): string | undefined;

  // ── Tray icon ─────────────────────────────────────────────────────────────

  /** Returns tray icon options for this platform. */
  getTrayIconOptions(): TrayIconOptions;

  // ── Window lifecycle ──────────────────────────────────────────────────────

  /**
   * Whether the app should remain alive in the system tray when all
   * BrowserWindows are closed.
   *
   * macOS: true — standard macOS behaviour; app lives in the menu bar.
   * Windows/Linux: false — closing the window quits the app (unless the user
   *   explicitly added it to system tray; handled by tray click handlers).
   */
  shouldKeepAliveOnWindowClose(): boolean;

  // ── Child process ─────────────────────────────────────────────────────────

  /**
   * Returns options to pass to child_process.spawn / spawnSync.
   * windowsHide: true on Windows to prevent console flashing.
   */
  getChildProcessOptions(): ChildProcessOptions;

  // ── Electron executable detection ─────────────────────────────────────────

  /**
   * Returns true if the given execPath is the Electron host binary
   * (not a Node.js binary). Used to decide whether to call system `node`.
   *
   * macOS: ends with "Electron" (app bundle binary)
   * Windows: ends with "electron.exe"
   * Linux: ends with "electron"
   */
  isElectronExecutable(execPath: string): boolean;

  // ── Runtime locations ─────────────────────────────────────────────────────

  /**
   * Returns platform-specific search paths and binary name for a named runtime.
   * Used by RuntimeDiscovery when auto-detecting installed runtimes.
   *
   * @param runtimeId — e.g. 'openclaw', 'ollama', 'lm-studio'
   */
  getRuntimeLocation(runtimeId: string): LocalRuntimeLocation;

  // ── Startup ───────────────────────────────────────────────────────────────

  /**
   * Whether this platform supports starting the app as hidden at login.
   * macOS: yes (openAsHidden: true in Login Items)
   * Windows: yes (registry RunKey, hidden start)
   * Linux: yes (XDG autostart .desktop with Hidden=false + StartupNotify=false)
   */
  supportsHiddenAutoStart(): boolean;

  // ── Notifications ─────────────────────────────────────────────────────────

  /**
   * Whether native OS notifications are expected to work reliably.
   * macOS: yes (NSUserNotification / UNUserNotification)
   * Windows: yes (Toast notifications via Electron)
   * Linux: yes, when libnotify is available; may be unavailable on some DEs.
   */
  notificationsAvailable(): boolean;

  // ── Temporary directories ─────────────────────────────────────────────────

  /**
   * Returns the OS temp directory for this platform.
   * Uses os.tmpdir() internally — exposed here so callers don't import os.
   */
  getTempDir(): string;
}
