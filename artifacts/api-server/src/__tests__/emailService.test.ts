/**
 * Email service + invitation workflow tests — Sprint 1
 *
 * Uses vitest. DB calls are mocked; no real DB or email provider required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const mockInvitation = {
    id: "inv-001",
    organizationId: "org-aaa",
    email: "alice@example.com",
    role: "member",
    status: "pending",
    tokenHash: "hash-abc",
    invitedBy: "user-xyz",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    emailDeliveryStatus: "not_attempted",
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([mockInvitation]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([mockInvitation]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    db: chain,
    invitationsTable: {},
    membershipsTable: {},
    usersTable: {},
    organizationsTable: {},
    emailDeliveryLogsTable: {},
  };
});

// ─── Mock invitation token lib ────────────────────────────────────────────────
vi.mock("../lib/invitationToken.js", () => ({
  generateInvitationToken: vi.fn().mockReturnValue({
    rawToken: "raw-token-abc123",
    tokenHash: "hash-abc",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }),
  hashToken: vi.fn((t: string) => `hash-of-${t}`),
  buildInvitationUrl: vi.fn(
    (rawToken: string) => `https://app.example.com/invitations/${rawToken}/accept`,
  ),
}));

// ─── Email service tests ──────────────────────────────────────────────────────

import { DevelopmentEmailService } from "../services/email/developmentEmailService.js";
import { _resetEmailServiceForTest, getEmailService } from "../services/email/index.js";
import { invitationEmailSubject, invitationEmailHtml, invitationEmailText } from "../services/email/templates.js";
import type { InvitationEmailInput } from "../services/email/types.js";

const sampleInput: InvitationEmailInput = {
  toEmail: "alice@example.com",
  orgName: "Horizon Support Services",
  inviterName: "Bob Smith",
  role: "member",
  expiresAt: new Date("2026-07-30T00:00:00Z"),
  acceptanceUrl: "https://app.example.com/invitations/raw-token-abc123/accept",
};

describe("Email templates", () => {
  it("subject contains organisation name", () => {
    const subject = invitationEmailSubject("Horizon Support Services");
    expect(subject).toContain("Horizon Support Services");
    expect(subject).toContain("NeedsOps AI+");
  });

  it("HTML email contains organisation name", () => {
    const html = invitationEmailHtml(sampleInput);
    expect(html).toContain("Horizon Support Services");
  });

  it("HTML email contains the correct acceptance URL", () => {
    const html = invitationEmailHtml(sampleInput);
    expect(html).toContain(sampleInput.acceptanceUrl);
  });

  it("HTML email contains the role", () => {
    const html = invitationEmailHtml(sampleInput);
    expect(html.toLowerCase()).toContain("member");
  });

  it("HTML email contains the recipient email address (privacy notice)", () => {
    const html = invitationEmailHtml(sampleInput);
    expect(html).toContain("alice@example.com");
  });

  it("HTML email contains the inviter name", () => {
    const html = invitationEmailHtml(sampleInput);
    expect(html).toContain("Bob Smith");
  });

  it("plain-text fallback contains the acceptance URL", () => {
    const text = invitationEmailText(sampleInput);
    expect(text).toContain(sampleInput.acceptanceUrl);
  });

  it("plain-text fallback contains the organisation name", () => {
    const text = invitationEmailText(sampleInput);
    expect(text).toContain("Horizon Support Services");
  });
});

describe("DevelopmentEmailService", () => {
  it("returns development_preview state without claiming delivery", async () => {
    const svc = new DevelopmentEmailService();
    const result = await svc.sendInvitationEmail(sampleInput);
    expect(result.state).toBe("development_preview");
    expect(result.provider).toBe("development");
    expect(result.sentAt).toBeNull();
    expect(result.providerMessageId).toBeNull();
  });

  it("11. logs the preview URL safely (no separate raw token log)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const svc = new DevelopmentEmailService();
    await svc.sendInvitationEmail(sampleInput);

    // All console.log calls should include the full URL (token embedded in URL)
    // and should NOT have a separate line that prints just the raw token
    const calls = consoleSpy.mock.calls.map(c => c.join(" "));
    const rawTokenOnlyLines = calls.filter(
      line => line.includes("raw-token-abc123") && !line.includes("/invitations/"),
    );
    expect(rawTokenOnlyLines).toHaveLength(0);
    consoleSpy.mockRestore();
  });
});

describe("Email service factory", () => {
  beforeEach(() => {
    _resetEmailServiceForTest();
  });
  afterEach(() => {
    _resetEmailServiceForTest();
    delete process.env.EMAIL_DELIVERY_MODE;
  });

  it("returns DevelopmentEmailService when mode=development", () => {
    process.env.EMAIL_DELIVERY_MODE = "development";
    const svc = getEmailService();
    expect(svc).toBeInstanceOf(DevelopmentEmailService);
  });

  it("returns DevelopmentEmailService when EMAIL_DELIVERY_MODE is not set", () => {
    delete process.env.EMAIL_DELIVERY_MODE;
    const svc = getEmailService();
    expect(svc).toBeInstanceOf(DevelopmentEmailService);
  });

  it("14. throws config error when mode=resend but RESEND_API_KEY is missing (no key exposure)", () => {
    process.env.EMAIL_DELIVERY_MODE = "resend";
    delete process.env.RESEND_API_KEY;
    expect(() => getEmailService()).toThrow("RESEND_API_KEY");
    // Ensure the thrown message does not include any actual key value
    try {
      getEmailService();
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/^[A-Za-z0-9_\-]{20,}$/); // no bare key-like strings
    }
  });
});

describe("ResendEmailService — provider error handling", () => {
  beforeEach(() => {
    _resetEmailServiceForTest();
    process.env.EMAIL_DELIVERY_MODE = "resend";
    process.env.RESEND_API_KEY = "re_test_key_000000000000000";
    process.env.EMAIL_FROM_ADDRESS = "test@example.com";
  });
  afterEach(() => {
    _resetEmailServiceForTest();
    delete process.env.EMAIL_DELIVERY_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
  });

  it("14. returns failed state and does not expose API key in failure summary", async () => {
    // Mock Resend to return an error
    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: {
          send: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Invalid API key" },
          }),
        },
      })),
    }));

    _resetEmailServiceForTest();
    const svc = getEmailService();
    const result = await svc.sendInvitationEmail(sampleInput);

    expect(result.state).toBe("failed");
    expect(result.failureCategory).toBe("provider_error");
    // The failure summary should not contain the actual API key
    expect(result.failureSummary).not.toContain(process.env.RESEND_API_KEY);
  });
});

describe("Invitation token security", () => {
  it("4. buildInvitationUrl embeds the token in the path (not in storage)", async () => {
    const { buildInvitationUrl } = await vi.importActual<
      typeof import("../lib/invitationToken.js")
    >("../lib/invitationToken.js");
    const url = buildInvitationUrl("my-raw-token");
    expect(url).toContain("my-raw-token");
    // Must use path format, not query-string
    expect(url).toMatch(/\/invitations\/[^?]+\/accept/);
  });

  it("hashToken produces a different value from the raw token", async () => {
    const { hashToken } = await vi.importActual<
      typeof import("../lib/invitationToken.js")
    >("../lib/invitationToken.js");
    const raw = "test-raw-token";
    const hash = hashToken(raw);
    expect(hash).not.toBe(raw);
    expect(hash.length).toBeGreaterThan(0);
  });

  it("generateInvitationToken returns rawToken, tokenHash, and expiresAt", async () => {
    const { generateInvitationToken } = await vi.importActual<
      typeof import("../lib/invitationToken.js")
    >("../lib/invitationToken.js");
    const result = generateInvitationToken();
    expect(result).toHaveProperty("rawToken");
    expect(result).toHaveProperty("tokenHash");
    expect(result).toHaveProperty("expiresAt");
    expect(result.rawToken).not.toBe(result.tokenHash);
  });
});
