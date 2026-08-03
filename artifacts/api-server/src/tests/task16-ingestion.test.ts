/**
 * Task #16 — Document Ingestion & Embedding Pipeline
 * Test suite: Ingestion Job Service (state machine, enqueue, fail, cancel)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock db ──────────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => {
  const chain = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    orderBy: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    execute: vi.fn(),
  };
  // Make all chainable methods return the chain itself
  for (const key of Object.keys(chain)) {
    (chain as any)[key].mockReturnValue(chain);
  }
  return chain;
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return {
    ...actual,
    db: {
      select: () => mockDb,
      insert: () => mockDb,
      update: () => mockDb,
      execute: mockDb.execute,
    },
  };
});

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  INGESTION_JOB_STATUSES,
  INGESTION_JOB_TRANSITIONS,
  INGESTION_TERMINAL_STATUSES,
  INGESTION_ACTIVE_STATUSES,
} from "@workspace/db";
import { IngestionJobError } from "../services/ingestionJobService.js";

// ─── State machine constants ──────────────────────────────────────────────────

describe("INGESTION_JOB_STATUSES", () => {
  it("contains all expected statuses", () => {
    const expected = [
      "queued", "fetching", "extracting", "normalising", "chunking",
      "embedding", "review_required", "approved", "failed", "cancelled", "revoked",
    ];
    for (const s of expected) {
      expect(INGESTION_JOB_STATUSES).toContain(s);
    }
  });

  it("has 11 statuses total", () => {
    expect(INGESTION_JOB_STATUSES.length).toBe(11);
  });
});

describe("INGESTION_JOB_TRANSITIONS", () => {
  it("allows queued → fetching", () => {
    expect(INGESTION_JOB_TRANSITIONS.queued).toContain("fetching");
  });

  it("allows queued → cancelled", () => {
    expect(INGESTION_JOB_TRANSITIONS.queued).toContain("cancelled");
  });

  it("allows failed → queued (retry)", () => {
    expect(INGESTION_JOB_TRANSITIONS.failed).toContain("queued");
  });

  it("allows review_required → approved", () => {
    expect(INGESTION_JOB_TRANSITIONS.review_required).toContain("approved");
  });

  it("does not allow approved → anything", () => {
    expect(INGESTION_JOB_TRANSITIONS.approved.length).toBe(0);
  });

  it("does not allow cancelled → anything", () => {
    expect(INGESTION_JOB_TRANSITIONS.cancelled.length).toBe(0);
  });

  it("does not allow revoked → anything", () => {
    expect(INGESTION_JOB_TRANSITIONS.revoked.length).toBe(0);
  });

  it("allows the full happy path", () => {
    const path = [
      "queued", "fetching", "extracting", "normalising",
      "chunking", "embedding", "review_required", "approved",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i] as keyof typeof INGESTION_JOB_TRANSITIONS;
      const to   = path[i + 1]!;
      expect(INGESTION_JOB_TRANSITIONS[from]).toContain(to);
    }
  });

  it("all active statuses can fail (except terminal)", () => {
    const failableStatuses = [
      "fetching", "extracting", "normalising", "chunking", "embedding", "review_required",
    ];
    for (const s of failableStatuses) {
      expect(INGESTION_JOB_TRANSITIONS[s as keyof typeof INGESTION_JOB_TRANSITIONS]).toContain("failed");
    }
  });
});

describe("INGESTION_TERMINAL_STATUSES", () => {
  it("contains approved, cancelled", () => {
    expect(INGESTION_TERMINAL_STATUSES).toContain("approved");
    expect(INGESTION_TERMINAL_STATUSES).toContain("cancelled");
  });
});

describe("INGESTION_ACTIVE_STATUSES", () => {
  it("does not include terminal statuses or failed", () => {
    for (const s of INGESTION_ACTIVE_STATUSES) {
      expect(INGESTION_TERMINAL_STATUSES).not.toContain(s);
      expect(s).not.toBe("failed");
    }
  });
});

// ─── IngestionJobError ────────────────────────────────────────────────────────

describe("IngestionJobError", () => {
  it("carries code and name", () => {
    const err = new IngestionJobError("something went wrong", "JOB_NOT_FOUND");
    expect(err.code).toBe("JOB_NOT_FOUND");
    expect(err.name).toBe("IngestionJobError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof IngestionJobError).toBe(true);
    expect(err.message).toBe("something went wrong");
  });
});

// ─── transitionIngestionJobStatus validation ──────────────────────────────────

describe("transitionIngestionJobStatus (unit — invalid transition)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws INVALID_TRANSITION for invalid transitions", async () => {
    // Mock getIngestionJob to return a job in "approved" state
    const { transitionIngestionJobStatus } = await import("../services/ingestionJobService.js");

    // Set up mock chain for get
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([{
      id: "job-1",
      organizationId: "org-1",
      status: "approved",
      sourceVersionId: "ver-1",
      knowledgeSourceId: "src-1",
      attemptCount: 1,
      maxAttempts: 3,
    }]);

    await expect(
      transitionIngestionJobStatus("job-1", "org-1", "fetching"),
    ).rejects.toThrow(IngestionJobError);

    await expect(
      transitionIngestionJobStatus("job-1", "org-1", "fetching"),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("throws NOT_FOUND when job does not exist", async () => {
    const { transitionIngestionJobStatus } = await import("../services/ingestionJobService.js");
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([]); // empty result

    await expect(
      transitionIngestionJobStatus("nonexistent", "org-1", "fetching"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
