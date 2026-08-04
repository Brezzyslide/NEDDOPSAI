/**
 * RuntimeDiscovery — Cross-Platform Runtime Detection
 * Sprint 34
 *
 * Scans all known AI execution runtimes and returns their availability,
 * version, and capabilities. Results are used for:
 *   - Health endpoint reporting to the NeedsOps platform
 *   - Capability advertising (cloud knows what can run locally)
 *   - User-facing connector status UI
 *
 * Design:
 *   - Probes all adapters in parallel (Promise.allSettled — never throws)
 *   - Results are cached for cacheTtlMs to avoid hammering binaries
 *   - Never assumes a runtime exists — discovery is always explicit
 *
 * Future runtimes (Docker, remote GPU, Kubernetes) implement IRuntimeAdapter
 * and are registered here without any other code change.
 */

import type { IRuntimeAdapter, RuntimeInfo } from "./IRuntimeAdapter.js";
import { OpenClawRuntimeAdapter } from "./OpenClawRuntimeAdapter.js";
import { OllamaRuntimeAdapter } from "./OllamaRuntimeAdapter.js";
import { LMStudioRuntimeAdapter } from "./LMStudioRuntimeAdapter.js";
import { VllmRuntimeAdapter } from "./VllmRuntimeAdapter.js";

export interface DiscoveryResult {
  runtimes: RuntimeInfo[];
  discoveredAt: string;
  durationMs: number;
}

export interface RuntimeDiscoveryOptions {
  /** Cache TTL in ms. Re-runs discovery after this period. Default: 60 000. */
  cacheTtlMs?: number;
  /** Per-adapter probe timeout in ms. Default: 8 000. */
  probeTimeoutMs?: number;
  /** Custom adapter list. Default: all built-in adapters. */
  adapters?: IRuntimeAdapter[];
}

export class RuntimeDiscovery {
  private readonly adapters: IRuntimeAdapter[];
  private readonly cacheTtlMs: number;

  private cache: DiscoveryResult | null = null;
  private lastDiscoveryAt = 0;

  constructor(opts: RuntimeDiscoveryOptions = {}) {
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    const timeoutMs = opts.probeTimeoutMs ?? 8_000;

    this.adapters = opts.adapters ?? [
      new OpenClawRuntimeAdapter({ timeoutMs }),
      new OllamaRuntimeAdapter({ timeoutMs }),
      new LMStudioRuntimeAdapter({ timeoutMs }),
      new VllmRuntimeAdapter({ timeoutMs }),
    ];
  }

  /**
   * Run discovery against all registered runtime adapters.
   * Results are cached for cacheTtlMs. Pass force=true to bypass cache.
   */
  async discover(force = false): Promise<DiscoveryResult> {
    const now = Date.now();

    if (!force && this.cache && now - this.lastDiscoveryAt < this.cacheTtlMs) {
      return this.cache;
    }

    const start = Date.now();

    // Probe all adapters in parallel. Never allow one to block others.
    // Wrap each call in Promise.resolve() to catch synchronous throws
    // before Promise.allSettled sees them.
    const results = await Promise.allSettled(
      this.adapters.map((adapter) => {
        try {
          return Promise.resolve(adapter.getInfo());
        } catch (err) {
          return Promise.reject(err as Error);
        }
      }),
    );

    const runtimes: RuntimeInfo[] = results.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      // Adapter threw unexpectedly — wrap as unavailable
      const adapter = this.adapters[i]!;
      return {
        id: adapter.id,
        name: adapter.name,
        available: false,
        version: null,
        capabilities: [],
        unavailableReason: `Discovery probe failed: ${(result.reason as Error)?.message ?? "unknown error"}`,
        discoveredAt: new Date().toISOString(),
      };
    });

    const durationMs = Date.now() - start;

    this.cache = {
      runtimes,
      discoveredAt: new Date().toISOString(),
      durationMs,
    };
    this.lastDiscoveryAt = now;

    return this.cache;
  }

  /**
   * Check a single runtime by id without affecting the cache.
   * Returns null if no adapter with that id is registered.
   */
  async checkRuntime(id: string): Promise<RuntimeInfo | null> {
    const adapter = this.adapters.find((a) => a.id === id);
    if (!adapter) return null;
    try {
      return await adapter.getInfo();
    } catch (err) {
      return {
        id: adapter.id,
        name: adapter.name,
        available: false,
        version: null,
        capabilities: [],
        unavailableReason: `Probe failed: ${(err as Error).message}`,
        discoveredAt: new Date().toISOString(),
      };
    }
  }

  /** Returns the last cached result without re-probing. null if never run. */
  getCachedResult(): DiscoveryResult | null {
    return this.cache;
  }

  /** Returns the ids of all registered adapters. */
  getRegisteredRuntimeIds(): string[] {
    return this.adapters.map((a) => a.id);
  }

  /** Invalidate the cache, forcing the next discover() call to re-probe. */
  invalidateCache(): void {
    this.cache = null;
    this.lastDiscoveryAt = 0;
  }
}

// ── Singleton for use by the broker ──────────────────────────────────────────
// Created once at startup with default options.
// Access via getRuntimeDiscovery() to allow test injection.

let _instance: RuntimeDiscovery | null = null;

export function getRuntimeDiscovery(opts?: RuntimeDiscoveryOptions): RuntimeDiscovery {
  if (!_instance) {
    _instance = new RuntimeDiscovery(opts);
  }
  return _instance;
}

/** Replace the singleton — for testing only. */
export function _setRuntimeDiscovery(instance: RuntimeDiscovery | null): void {
  _instance = instance;
}
