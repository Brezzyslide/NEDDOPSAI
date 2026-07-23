/**
 * Transactional email service abstraction.
 * The invitation service depends on this interface, not any specific provider.
 */

export type EmailDeliveryState =
  | "not_attempted"
  | "development_preview"
  | "queued"
  | "sent"
  | "failed";

export type EmailProvider = "resend" | "development";

export interface EmailDeliveryResult {
  state: EmailDeliveryState;
  provider: EmailProvider;
  /** Provider-assigned message ID (e.g. Resend ID). Null in dev or on failure. */
  providerMessageId: string | null;
  sentAt: Date | null;
  failureCategory: string | null;
  failureSummary: string | null;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface InvitationEmailInput {
  toEmail: string;
  orgName: string;
  /** Display name of the person who sent the invitation, if available */
  inviterName: string | null;
  role: string;
  expiresAt: Date;
  acceptanceUrl: string;
}

export interface VerificationEmailInput {
  toEmail: string;
  verificationUrl: string;
}

export interface PasswordResetEmailInput {
  toEmail: string;
  resetUrl: string;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface TransactionalEmailService {
  sendInvitationEmail(input: InvitationEmailInput): Promise<EmailDeliveryResult>;
  sendVerificationSupportEmail?(input: VerificationEmailInput): Promise<EmailDeliveryResult>;
  sendPasswordResetSupportEmail?(input: PasswordResetEmailInput): Promise<EmailDeliveryResult>;
}
