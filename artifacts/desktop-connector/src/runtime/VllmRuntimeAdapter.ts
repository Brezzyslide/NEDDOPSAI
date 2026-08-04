/**
 * VllmRuntimeAdapter — Runtime discovery adapter for vLLM
 * Sprint 34
 *
 * vLLM is an OpenAI-compatible inference server.
 * Default endpoint: http://localhost:8000
 *
 * Discovery strategy:
 *   Probe GET /health on the default (or configured) endpoint.
 *   vLLM exposes /health for a simple up/down check and
 *   /v1/models for the model list.
 *
 * Platform notes:
 *   vLLM has limited native Windows support. On Windows, it typically runs
 *   inside WSL2. The adapter will detect it if the API endpoint is accessible.
 *   On macOS and Linux, the binary may also be installed via pip.
 */

import type { IRuntimeAdapter, RuntimeInfo } from "./IRuntimeAdapter.js";

export class VllmRuntimeAdapter implements IRuntimeAdapter {
  readonly id = "vllm";
  readonly name = "vLLM";

  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(opts: {
    /** vLLM API base URL. Default: http://localhost:8000 */
    endpoint?: string;
    /** Probe timeout in ms. Default: 5000. */
    timeoutMs?: number;
  } = {}) {
    this.endpoint  = (opts.endpoint ?? process.env["VLLM_HOST"] ?? "http://localhost:8000").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  async isAvailable(): Promise<boolean> {
    const info = await this.getInfo();
    return info.available;
  }

  async getInfo(): Promise<RuntimeInfo> {
    const discoveredAt = new Date().toISOString();

    // 1. Probe /health
    const healthResult = await this._probeHealth();
    if (healthResult.ok) {
      // 2. Fetch model list for version info
      const modelsResult = await this._probeModels();
      return {
        id: this.id,
        name: this.name,
        available: true,
        version: modelsResult.version,
        endpoint: this.endpoint,
        capabilities: ["llm", "gpu_acceleration"],
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
        `vLLM server not reachable at ${this.endpoint}. ` +
        "Start vLLM with: python -m vllm.entrypoints.openai.api_server --model <model>. " +
        "On Windows, run inside WSL2.",
      discoveredAt,
    };
  }

  private async _probeHealth(): Promise<{ ok: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { ok: res.ok };
    } catch {
      clearTimeout(timer);
      return { ok: false };
    }
  }

  private async _probeModels(): Promise<{ version: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${this.endpoint}/v1/models`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) return { version: null };
      // vLLM doesn't expose version in the API yet.
      return { version: res.headers.get("x-vllm-version") ?? null };
    } catch {
      clearTimeout(timer);
      return { version: null };
    }
  }
}
