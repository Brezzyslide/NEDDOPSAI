/**
 * OpenClawRuntimeAdapter — Runtime discovery adapter for OpenClaw
 * Sprint 34
 *
 * Detects whether the OpenClaw binary is installed and reachable.
 * Does NOT handle execution submission — that remains in LiveGatewayAdapter.
 * This adapter is for discovery and health reporting only.
 */

import { execFile } from "node:child_process";
import type { IRuntimeAdapter, RuntimeInfo } from "./IRuntimeAdapter.js";

export class OpenClawRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "openclaw";
  readonly name = "OpenClaw";

  private readonly binPath: string;
  private readonly bridgeUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    /** Path to openclaw binary. Default: "openclaw" (relies on PATH). */
    binPath?: string;
    /** URL of the OpenClaw browser bridge, for bridge-http health checks. */
    bridgeUrl?: string;
    /** Probe timeout in ms. Default: 8000. */
    timeoutMs?: number;
  } = {}) {
    this.binPath    = opts.binPath    ?? process.env["OPENCLAW_BIN_PATH"] ?? "openclaw";
    this.bridgeUrl  = opts.bridgeUrl  ?? process.env["OPENCLAW_GATEWAY_URL"] ?? "http://127.0.0.1:19001";
    this.timeoutMs  = opts.timeoutMs  ?? 8_000;
  }

  async isAvailable(): Promise<boolean> {
    const info = await this.getInfo();
    return info.available;
  }

  async getInfo(): Promise<RuntimeInfo> {
    const discoveredAt = new Date().toISOString();

    // 1. Try --version on the binary
    const versionResult = await this._checkBinaryVersion();
    if (versionResult.ok) {
      return {
        id: this.id,
        name: this.name,
        available: true,
        version: versionResult.version,
        capabilities: ["browser", "local_files", "vision"],
        discoveredAt,
      };
    }

    // 2. Try the bridge HTTP server
    const bridgeResult = await this._checkBridgeHealth();
    if (bridgeResult.ok) {
      return {
        id: this.id,
        name: this.name,
        available: true,
        version: bridgeResult.version,
        endpoint: this.bridgeUrl,
        capabilities: ["browser", "local_files", "vision"],
        discoveredAt,
      };
    }

    return {
      id: this.id,
      name: this.name,
      available: false,
      version: null,
      capabilities: [],
      unavailableReason:
        `Binary not found at "${this.binPath}" and bridge not reachable at ${this.bridgeUrl}. ` +
        "Install OpenClaw from https://openclaw.io.",
      discoveredAt,
    };
  }

  private _checkBinaryVersion(): Promise<{ ok: boolean; version: string | null }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, version: null });
      }, this.timeoutMs);

      try {
        execFile(
          this.binPath,
          ["--version"],
          { timeout: this.timeoutMs - 500 },
          (err, stdout) => {
            clearTimeout(timeout);
            if (err) {
              resolve({ ok: false, version: null });
            } else {
              const version = stdout.trim().split(/\s+/).pop() ?? null;
              resolve({ ok: true, version });
            }
          },
        );
      } catch {
        // execFile itself threw synchronously (e.g. mocked to throw in tests)
        clearTimeout(timeout);
        resolve({ ok: false, version: null });
      }
    });
  }

  private async _checkBridgeHealth(): Promise<{ ok: boolean; version: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5_000));
    try {
      const res = await fetch(`${this.bridgeUrl}/basic`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, version: null };
      const body = await res.json().catch(() => ({})) as { version?: string };
      return { ok: true, version: body.version ?? null };
    } catch {
      clearTimeout(timer);
      return { ok: false, version: null };
    }
  }
}
