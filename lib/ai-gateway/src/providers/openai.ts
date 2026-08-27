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
import type { AIRequest, AIRuntimeProfile } from "../types.js";

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    apiKey:   process.env.OPENAI_API_KEY ?? "",
    model:    process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS ?? "30000", 10),
    maxRetries: parseInt(process.env.AI_MAX_RETRIES ?? "2", 10),
  };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  attempts: number;
  runtimeProfile: AIRuntimeProfile;
  configuredTimeoutMs: number;
  /** Sprint 28.7: the response_format value sent, or null when text mode */
  responseFormat: string | null;
  finishReason: string | null;
}

export interface OpenAIRuntimePolicy {
  runtimeProfile: AIRuntimeProfile;
  timeoutMs: number;
  maxRetries: number;
  retryOnTimeout: boolean;
  retryOnRateLimit: boolean;
  retryOnServerError: boolean;
}

export type OpenAIErrorKind =
  | "timeout"
  | "rate_limit"
  | "invalid_json"
  | "api_error"
  | "not_configured";

export class OpenAIProviderError extends Error {
  public readonly kind: OpenAIErrorKind;
  public readonly runtimeProfile?: AIRuntimeProfile;
  public readonly timeoutMs?: number;
  public readonly retries?: number;
  public readonly attempts?: number;
  public readonly elapsedMs?: number;
  constructor(
    message: string,
    kind: OpenAIErrorKind,
    details: {
      runtimeProfile?: AIRuntimeProfile;
      timeoutMs?: number;
      retries?: number;
      attempts?: number;
      elapsedMs?: number;
    } = {},
  ) {
    super(message);
    this.name = "OpenAIProviderError";
    this.kind = kind;
    this.runtimeProfile = details.runtimeProfile;
    this.timeoutMs = details.timeoutMs;
    this.retries = details.retries;
    this.attempts = details.attempts;
    this.elapsedMs = details.elapsedMs;
  }
}

export function resolveOpenAIRuntimePolicy(request: Pick<AIRequest, "runtimeProfile">): OpenAIRuntimePolicy {
  const cfg = getConfig();
  const runtimeProfile = request.runtimeProfile ?? "default";
  switch (runtimeProfile) {
    case "conversation_intelligence":
      return {
        runtimeProfile,
        timeoutMs: envInt("AI_CONVERSATION_TIMEOUT_MS", cfg.timeoutMs),
        maxRetries: envInt("AI_CONVERSATION_MAX_RETRIES", 0),
        retryOnTimeout: false,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
    case "professional_execution":
      return {
        runtimeProfile,
        timeoutMs: envInt("AI_PROFESSIONAL_TIMEOUT_MS", 120_000),
        maxRetries: envInt("AI_PROFESSIONAL_MAX_RETRIES", 1),
        retryOnTimeout: true,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
    case "final_synthesis":
      return {
        runtimeProfile,
        timeoutMs: envInt("AI_FINAL_SYNTHESIS_TIMEOUT_MS", envInt("AI_PROFESSIONAL_TIMEOUT_MS", 120_000)),
        maxRetries: envInt("AI_FINAL_SYNTHESIS_MAX_RETRIES", envInt("AI_PROFESSIONAL_MAX_RETRIES", 1)),
        retryOnTimeout: true,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
    case "targeted_repair":
      return {
        runtimeProfile,
        timeoutMs: envInt("AI_TARGETED_REPAIR_TIMEOUT_MS", 90_000),
        maxRetries: envInt("AI_TARGETED_REPAIR_MAX_RETRIES", 1),
        retryOnTimeout: true,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
    case "self_review":
      return {
        runtimeProfile,
        timeoutMs: envInt("AI_SELF_REVIEW_TIMEOUT_MS", 75_000),
        maxRetries: envInt("AI_SELF_REVIEW_MAX_RETRIES", 1),
        retryOnTimeout: true,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
    case "default":
    default:
      return {
        runtimeProfile: "default",
        timeoutMs: cfg.timeoutMs,
        maxRetries: cfg.maxRetries,
        retryOnTimeout: true,
        retryOnRateLimit: true,
        retryOnServerError: true,
      };
  }
}

// ─── Client factory ───────────────────────────────────────────────────────────

const clientsByTimeout = new Map<number, OpenAI>();

function getClient(timeoutMs: number): OpenAI {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    throw new OpenAIProviderError(
      "OPENAI_API_KEY is not configured. Set the environment variable to enable the OpenAI provider.",
      "not_configured",
    );
  }
  // Reuse clients by timeout so long-running professional calls do not inherit
  // the shorter interactive client timeout from an earlier conversation request.
  const existing = clientsByTimeout.get(timeoutMs);
  if (existing) return existing;
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    timeout: timeoutMs,
    maxRetries: 0, // We handle retries ourselves for better observability
  });
  clientsByTimeout.set(timeoutMs, client);
  return client;
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
  const policy = resolveOpenAIRuntimePolicy(request);
  const client = getClient(policy.timeoutMs);
  const startMs = Date.now();

  // Sprint 28.7 — Output mode determines whether response_format is sent.
  //
  // OpenAI enforces: when response_format: json_object is set, the word "json"
  // MUST appear in the prompt, or OpenAI returns HTTP 400. Text-mode callers
  // (specialist work execution, self-review revision, executive briefings) produce
  // prose/markdown and must never receive the json_object constraint.
  //
  // Mapping:
  //   "text"       → no response_format sent
  //   "json"       → response_format: { type: "json_object" }
  //   "structured" → response_format: { type: "json_object" }  (future: JSON Schema)
  //   undefined    → response_format: { type: "json_object" }  (legacy default, warn)
  const outputMode = request.outputMode ?? "json";
  const useJsonMode = outputMode !== "text";
  const responseFormat = useJsonMode ? "json_object" : null;

  let lastError: unknown = null;
  let retries = 0;
  let attempts = 0;

  while (attempts <= policy.maxRetries) {
    attempts++;
    try {
      const completion = await client.chat.completions.create({
        model: request.model ?? cfg.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        ...(useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
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
        model: completion.model ?? (request.model ?? cfg.model),
        latencyMs: Date.now() - startMs,
        retries,
        attempts,
        runtimeProfile: policy.runtimeProfile,
        configuredTimeoutMs: policy.timeoutMs,
        responseFormat,
        finishReason: choice?.finish_reason ?? null,
      };
    } catch (err) {
      lastError = err;

      if (err instanceof OpenAI.APIError) {
        // 429 rate limit — retry with exponential backoff
        if (err.status === 429) {
          if (policy.retryOnRateLimit && retries < policy.maxRetries) {
            await sleep(1000 * Math.pow(2, retries));
            retries++;
            continue;
          }
          throw new OpenAIProviderError(`Rate limited by OpenAI after ${retries} retries`, "rate_limit", {
            runtimeProfile: policy.runtimeProfile,
            timeoutMs: policy.timeoutMs,
            retries,
            attempts,
            elapsedMs: Date.now() - startMs,
          });
        }
        // 5xx server errors — retry
        if (err.status !== undefined && err.status >= 500 && policy.retryOnServerError && retries < policy.maxRetries) {
          await sleep(500 * Math.pow(2, retries));
          retries++;
          continue;
        }
        throw new OpenAIProviderError(`OpenAI API error (${err.status}): ${err.message}`, "api_error", {
          runtimeProfile: policy.runtimeProfile,
          timeoutMs: policy.timeoutMs,
          retries,
          attempts,
          elapsedMs: Date.now() - startMs,
        });
      }

      // Network timeout
      if (isTimeoutError(err)) {
        if (policy.retryOnTimeout && retries < policy.maxRetries) {
          retries++;
          continue;
        }
        throw new OpenAIProviderError(
          `OpenAI request timed out after ${policy.timeoutMs}ms (${retries} retries)`,
          "timeout",
          {
            runtimeProfile: policy.runtimeProfile,
            timeoutMs: policy.timeoutMs,
            retries,
            attempts,
            elapsedMs: Date.now() - startMs,
          },
        );
      }

      // Unknown error — don't retry
      throw new OpenAIProviderError(
        `Unexpected OpenAI provider error: ${String(err)}`,
        "api_error",
        {
          runtimeProfile: policy.runtimeProfile,
          timeoutMs: policy.timeoutMs,
          retries,
          attempts,
          elapsedMs: Date.now() - startMs,
        },
      );
    }
  }

  throw new OpenAIProviderError(
    `OpenAI request failed after ${retries} retries: ${String(lastError)}`,
    "api_error",
    {
      runtimeProfile: policy.runtimeProfile,
      timeoutMs: policy.timeoutMs,
      retries,
      attempts,
      elapsedMs: Date.now() - startMs,
    },
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

// ─── Embeddings ───────────────────────────────────────────────────────────────
// Knowledge Hub — embedding support.
// All OpenAI SDK calls are confined to THIS file per platform convention.

export interface OpenAIEmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  totalInputTokens: number;
}

const EMBEDDING_MODEL   = "text-embedding-3-small";
const EMBEDDING_DIMS    = 1536;
const EMBEDDING_BATCH   = 96;  // OpenAI limit is 2048 inputs, but keep batches small
const EMBEDDING_TIMEOUT = 30_000;
// text-embedding-3-small supports up to 8191 tokens.
// Safety net: even after stripping base64 blobs, very long chunks (e.g. tables,
// dense lists) can exceed the 8 191-token limit. We cap at 24 000 chars
// (≈ 6 000 tokens at a conservative 4 chars/token for clean prose, or ~8 000
// tokens worst-case at 3 chars/token for dense medical/legal text).
// Truncating preserves the start of each chunk (most semantically dense).
const EMBEDDING_MAX_CHARS = 24_000;

/**
 * Generate embeddings for a batch of texts using OpenAI.
 * Splits into batches of EMBEDDING_BATCH automatically.
 * Texts longer than ~8000 tokens (≈32 000 chars) are silently truncated
 * to avoid the model's 8192-token per-input limit (HTTP 400).
 * Never logs raw text content.
 *
 * @throws OpenAIProviderError on unrecoverable failure
 */
export async function callOpenAIEmbeddings(
  texts: string[],
  model = EMBEDDING_MODEL,
): Promise<OpenAIEmbeddingResult> {
  const client = getClient(EMBEDDING_TIMEOUT); // reuses the shared client
  const allEmbeddings: number[][] = [];
  let totalTokens = 0;

  // Process in batches
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH) {
    // Truncate each text to stay within the model's 8192-token limit.
    const batch = texts.slice(i, i + EMBEDDING_BATCH)
      .map((t) => t.length > EMBEDDING_MAX_CHARS ? t.slice(0, EMBEDDING_MAX_CHARS) : t);
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const timer = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("embedding timeout")), EMBEDDING_TIMEOUT),
        );

        const call = client.embeddings.create({
          model,
          input: batch,
          encoding_format: "float",
        });

        const res = await Promise.race([call, timer]) as Awaited<typeof call>;

        for (const item of res.data) {
          allEmbeddings.push(item.embedding);
        }
        totalTokens += res.usage?.prompt_tokens ?? 0;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (err instanceof OpenAI.APIError && err.status === 429 && attempt < 2) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        if (isTimeoutError(err) && attempt < 2) {
          await sleep(500);
          continue;
        }
        break;
      }
    }

    if (lastErr) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new OpenAIProviderError(
        `Embedding request failed: ${msg.slice(0, 200)}`,
        isTimeoutError(lastErr) ? "timeout" : "api_error",
      );
    }
  }

  return {
    embeddings: allEmbeddings,
    model,
    dimensions: EMBEDDING_DIMS,
    totalInputTokens: totalTokens,
  };
}

/** Returns configured embedding dimensions for the default model */
export function getEmbeddingDimensions(): number { return EMBEDDING_DIMS; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout") || msg.includes("econnreset");
}
