/**
 * brokerManager — Embedded Broker Process Manager
 * Sprint 14 (created) | Sprint 34 (cross-platform refactor)
 *
 * Spawns the NeedsOps broker as a Node.js child process.
 * Platform-specific spawn options are now provided by IPlatformAdapter.
 *
 * The broker binary path:
 *   - Dev: artifacts/desktop-connector/dist/index.js (run via node)
 *   - Packaged: resources/broker/index.js (bundled by electron-builder extraResources)
 */

import { ChildProcess, spawn } from "child_process";
import path from "path";
import { app } from "electron";
import { getMainWindow } from "./index.js";
import { platformAdapter } from "./platform/PlatformAdapterFactory.js";

let brokerProcess: ChildProcess | null = null;
let brokerStarting = false;

export type BrokerStatus = "stopped" | "starting" | "running" | "error";
let currentStatus: BrokerStatus = "stopped";
let lastError: string | null = null;

export interface BrokerStartParams {
  orgSlug: string;
  deviceId: string;
  deviceToken: string;
  apiBaseUrl: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function getBrokerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "broker", "index.js");
  }
  // Development: resolve relative to monorepo root
  const repoRoot = path.resolve(__dirname, "../../../../");
  return path.join(repoRoot, "artifacts/desktop-connector/dist/index.js");
}

function getNodePath(): string {
  // In dev, use the system node. In packaged builds, node is bundled.
  if (app.isPackaged) {
    // Packaged node binary — platform adapter provides the correct executable name.
    // On Windows this would be node.exe; on macOS/Linux, node.
    return path.join(process.resourcesPath, "node", "node");
  }
  // Platform adapter determines whether the current execPath is the Electron
  // host binary (in which case we fall back to system node).
  return platformAdapter.isElectronExecutable(process.execPath)
    ? "node" // use system node in development
    : process.execPath;
}

// ── Status broadcasting ───────────────────────────────────────────────────────

function broadcastStatus(status: BrokerStatus, error?: string) {
  currentStatus = status;
  lastError = error ?? null;
  const win = getMainWindow();
  win?.webContents.send("broker:status", { status, error: lastError });
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

export async function startBroker(params: BrokerStartParams): Promise<void> {
  if (brokerProcess || brokerStarting) {
    console.log("[broker] Already running or starting");
    return;
  }

  brokerStarting = true;
  broadcastStatus("starting");

  const brokerPath = getBrokerPath();
  const nodePath = getNodePath();

  const env = {
    ...process.env,
    NEEDSOPS_ORG_SLUG: params.orgSlug,
    NEEDSOPS_DEVICE_ID: params.deviceId,
    NEEDSOPS_DEVICE_TOKEN: params.deviceToken,
    NEEDSOPS_API_BASE_URL: params.apiBaseUrl,
    NEEDSOPS_MODE: "desktop",
    NODE_ENV: app.isPackaged ? "production" : "development",
  };

  console.log(`[broker] Spawning: ${nodePath} ${brokerPath}`);

  // Platform adapter provides the correct spawn options for this OS.
  // windowsHide: true on Windows prevents a console window flashing.
  // windowsHide: false on macOS/Linux — not applicable, avoid side effects.
  const spawnOpts = platformAdapter.getChildProcessOptions();

  brokerProcess = spawn(nodePath, [brokerPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: spawnOpts.windowsHide,
  });

  brokerProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    console.log("[broker]", line);
    if (line.includes("connected") || line.includes("ready")) {
      brokerStarting = false;
      broadcastStatus("running");
    }
    // Forward log lines to renderer for status panel
    getMainWindow()?.webContents.send("broker:log", line);
  });

  brokerProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    console.error("[broker:err]", line);
    getMainWindow()?.webContents.send("broker:log", `[ERR] ${line}`);
  });

  brokerProcess.on("exit", (code, signal) => {
    console.log(`[broker] Exited — code=${code} signal=${signal}`);
    brokerProcess = null;
    brokerStarting = false;
    if (code !== 0 && signal !== "SIGTERM") {
      broadcastStatus("error", `Broker exited with code ${code}`);
    } else {
      broadcastStatus("stopped");
    }
  });

  brokerProcess.on("error", (err) => {
    console.error("[broker] Spawn error:", err.message);
    brokerProcess = null;
    brokerStarting = false;
    broadcastStatus("error", err.message);
  });

  // Give it 5s to start — if no "connected" log, mark running anyway
  setTimeout(() => {
    if (brokerStarting) {
      brokerStarting = false;
      if (brokerProcess) broadcastStatus("running");
    }
  }, 5000);
}

export async function stopBroker(): Promise<void> {
  if (!brokerProcess) return;
  return new Promise((resolve) => {
    brokerProcess!.once("exit", () => resolve());
    brokerProcess!.kill("SIGTERM");
    // Force-kill after 5s
    setTimeout(() => {
      brokerProcess?.kill("SIGKILL");
      resolve();
    }, 5000);
  });
}

export async function restartBroker(params: BrokerStartParams): Promise<void> {
  await stopBroker();
  await startBroker(params);
}

export function getBrokerStatus(): { status: BrokerStatus; error: string | null } {
  return { status: currentStatus, error: lastError };
}
