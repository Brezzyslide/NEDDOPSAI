/**
 * LMStudioRuntimeAdapter — Runtime discovery adapter for LM Studio
 * Sprint 34
 *
 * LM Studio exposes an OpenAI-compatible local API.
 * Default endpoint: http://localhost:1234
 *
 * Discovery strategy:
 *   Probe GET /v1/models on the default (or configured) endpoint.
 *   LM Studio does not expose a /version route; use /v1/models as the
 *   health signal. A 200 response means the server is running.
 */

import type { IRuntimeAdapter, RuntimeInfo } from "./IRuntimeAdapter.js";

export class LMStudioRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "lm-studio";
  readonly name = "LM Studio";

  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    /** LM Studio API base URL. Default: http://localhost:1234 */
    endpoint?: string;
    /** Probe timeout in ms. Default: 5000. */
    timeoutMs?: number;
  } = {}) {
    this.endpoint  = (opts.endpoint ?? process.env["LM_STUDIO_HOST"] ?? "http://localhost:1234").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async isAvailable(): Promise<boolean> {
    const info = await this.getInfo();
    return info.available;
  }

  async getInfo(): Promise<RuntimeInfo> {
    const discoveredAt = new Date().toISOString();
    const result = await this._probeHttp();

    if (result.ok) {
      return {
        id: this.id,
        name: this.name,
        available: true,
        version: result.version,
        endpoint: this.endpoint,
        capabilities: ["llm", "vision"],
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
        `LM Studio server not reachable at ${this.endpoint}. ` +
        "Open LM Studio and start the local server from the Developer tab.",
      discoveredAt,
    };
  }

  private async _probeHttp(): Promise<{ ok: boolean; version: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/v1/models`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return { ok: false, version: null };
      // LM Studio doesn't expose version in the API; extract from headers if present.
      const serverHeader = res.headers.get("x-lm-studio-version") ?? null;
      return { ok: true, version: serverHeader };
    } catch {
      clearTimeout(timer);
      return { ok: false, version: null };
    }
  }
}
