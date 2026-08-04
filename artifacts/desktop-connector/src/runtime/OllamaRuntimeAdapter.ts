/**
 * OllamaRuntimeAdapter — Runtime discovery adapter for Ollama
 * Sprint 34
 *
 * Ollama is a local LLM server. It exposes an OpenAI-compatible HTTP API.
 * Default endpoint: http://localhost:11434
 *
 * Discovery strategy:
 *   1. Probe GET /api/version on the default (or configured) endpoint.
 *   2. If unreachable, check for the ollama binary in PATH.
 */

import { execFile } from "node:child_process";
import type { IRuntimeAdapter, RuntimeInfo } from "./IRuntimeAdapter.js";

export class OllamaRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "ollama";
  readonly name = "Ollama";

  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    /** Ollama API base URL. Default: http://localhost:11434 */
    endpoint?: string;
    /** Probe timeout in ms. Default: 5000. */
    timeoutMs?: number;
  } = {}) {
    this.endpoint  = (opts.endpoint ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async isAvailable(): Promise<boolean> {
    const info = await this.getInfo();
    return info.available;
  }

  async getInfo(): Promise<RuntimeInfo> {
    const discoveredAt = new Date().toISOString();

    // 1. Probe the HTTP API
    const httpResult = await this._probeHttp();
    if (httpResult.ok) {
      return {
        id: this.id,
        name: this.name,
        available: true,
        version: httpResult.version,
        endpoint: this.endpoint,
        capabilities: ["llm", "vision"],
        discoveredAt,
      };
    }

    // 2. Check binary existence
    const binaryResult = await this._checkBinary();
    if (binaryResult.ok) {
      return {
        id: this.id,
        name: this.name,
        // Binary found but server not running — available but not serving.
        available: false,
        version: binaryResult.version,
        capabilities: ["llm"],
        unavailableReason: `Ollama binary found (${binaryResult.version ?? "version unknown"}) but server is not running at ${this.endpoint}. Start it with: ollama serve`,
        discoveredAt,
      };
    }

    return {
      id: this.id,
      name: this.name,
      available: false,
      version: null,
      capabilities: [],
      unavailableReason: `Ollama not found. Install from https://ollama.ai`,
      discoveredAt,
    };
  }

  private async _probeHttp(): Promise<{ ok: boolean; version: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/api/version`, {
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

  private _checkBinary(): Promise<{ ok: boolean; version: string | null }> {
    return new Promise((resolve) => {
      execFile("ollama", ["--version"], { timeout: 4_000 }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, version: null });
        } else {
          const version = stdout.trim().split(/\s+/).pop() ?? null;
          resolve({ ok: true, version });
        }
      });
    });
  }
}
