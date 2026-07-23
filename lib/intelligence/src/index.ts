/**
 * @workspace/intelligence
 *
 * Business rule engines for the NeedsOps AI+ platform.
 *
 * Engines encode deterministic, auditable domain knowledge.
 * AI agents call into this package for facts — they do not embed rules themselves.
 *
 * Sprint 0: type definitions and interfaces only.
 * Sprint 2+: concrete engine implementations (SCHADS rates, NDIS price limits, etc.)
 */

export * from "./types.js";
