/**
 * AI Gateway — OpenAI Provider — Sprint 9.1
 *
 * Implements the actual OpenAI API calls used by the AI Privacy Gateway.
 * This is the ONLY file in the codebase that imports the OpenAI SDK.
 *
 * Never import this file directly from routes, services, React components,
 * or mobile code. All calls must go through createAIGateway() → process().
 */

import OpenAI from "openai";
import type { AIRequest } from "../types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    apiKey:   process.env.OPENAI_API_KEY ?? "",
    model:    process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? "30000", 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES ?? "2", 10),
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenAICompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
  retries: number;
}

export type OpenAIErrorKind =
  | "timeout"
  | "rate_limit"
  | "invalid_json"
  | "api_error"
  | "not_configured";

export class OpenAIProviderError extends Error {
  public readonly kind: OpenAIErrorKind;
  constructor(message: string, kind: OpenAIErrorKind) {
    super(message);
    this.name = "OpenAIProviderError";
    this.kind = kind;
  }
}

// ─── Client factory ───────────────────────────────────────────────────────────

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new OpenAIProviderError(
      "OPENAI_API_KEY is not configured. Set the environment variable to enable the OpenAI provider.",
      "not_configured",
    );
  }
  // Reuse client across requests (connection pool)
  if (!_client) {
    _client = new OpenAI({
      apiKey: cfg.apiKey,
      timeout: cfg.timeoutMs,
      maxRetries: 0, // We handle retries ourselves for better observability
    });
  }
  return _client;
}

// ─── Main call ────────────────────────────────────────────────────────────────

/**
 * Call OpenAI chat completions with retry logic and timeout handling.
 * Returns the raw content string and token usage.
 *
 * @throws OpenAIProviderError on unrecoverable failure
 */
export async function callOpenAI(request: AIRequest): Promise<OpenAICompletionResult> {
  const cfg = getConfig();
  const client = getClient();
  const startMs = Date.now();

  let lastError: unknown = null;
  let retries = 0;

  while (retries <= cfg.maxRetries) {
    try {
      const completion = await client.chat.completions.create({
        model: cfg.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        response_format: { type: "json_object" },
        max_tokens: request.maxTokens ?? 2048,
        temperature: 0.3, // Low temp for deterministic structured output
      });

      const choice = completion.choices[0];
      const content = choice?.message?.content ?? "";
      const usage = completion.usage;

      return {
        content,
        inputTokens:  usage?.prompt_tokens     ?? 0,
        outputTokens: usage?.completion_tokens  ?? 0,
        totalTokens:  usage?.total_tokens       ?? 0,
        model: completion.model ?? cfg.model,
        latencyMs: Date.now() - startMs,
        retries,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof OpenAI.APIError) {
        // 429 rate limit — retry with exponential backoff
        if (err.status === 429) {
          if (retries < cfg.maxRetries) {
            await sleep(1000 * Math.pow(2, retries));
            retries++;
            continue;
          }
          throw new OpenAIProviderError(`Rate limited by OpenAI after ${retries} retries`, "rate_limit");
        }
        // 5xx server errors — retry
        if (err.status !== undefined && err.status >= 500 && retries < cfg.maxRetries) {
          await sleep(500 * Math.pow(2, retries));
          retries++;
          continue;
        }
        throw new OpenAIProviderError(`OpenAI API error (${err.status}): ${err.message}`, "api_error");
      }

      // Network timeout
      if (isTimeoutError(err)) {
        if (retries < cfg.maxRetries) {
          retries++;
          continue;
        }
        throw new OpenAIProviderError(
          `OpenAI request timed out after ${cfg.timeoutMs}ms (${retries} retries)`,
          "timeout",
        );
      }

      // Unknown error — don't retry
      throw new OpenAIProviderError(
        `Unexpected OpenAI provider error: ${String(err)}`,
        "api_error",
      );
    }
  }

  throw new OpenAIProviderError(
    `OpenAI request failed after ${retries} retries: ${String(lastError)}`,
    "api_error",
  );
}

// ─── Health check ─────────────────────────────────────────────────────────────

/** Returns true if the OpenAI provider is configured (key present) */
export function isOpenAIConfigured(): boolean {
  const cfg = getConfig();
  return !!cfg.apiKey;
}

/** Returns the configured model name */
export function getOpenAIModel(): string {
  return getConfig().model;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout") || msg.includes("econnreset");
}
