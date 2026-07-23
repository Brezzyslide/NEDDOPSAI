/**
 * DevelopmentEmailService — used when EMAIL_DELIVERY_MODE=development (default).
 *
 * Does NOT claim delivery occurred.
 * Logs the invitation preview URL safely to stdout.
 * Returns state "development_preview".
 * Never logs the raw token separately from the complete URL.
 */

import type { TransactionalEmailService, InvitationEmailInput, EmailDeliveryResult } from "./types.js";

export class DevelopmentEmailService implements TransactionalEmailService {
  async sendInvitationEmail(input: InvitationEmailInput): Promise<EmailDeliveryResult> {
    const now = new Date();

    console.log("\n📧 [DEV EMAIL PREVIEW] Invitation email — not delivered in development mode");
    console.log(`   To:           ${input.toEmail}`);
    console.log(`   Organisation: ${input.orgName}`);
    console.log(`   Role:         ${input.role}`);
    console.log(`   Expires:      ${input.expiresAt.toISOString()}`);
    console.log(`   Preview URL:  ${input.acceptanceUrl}`);
    console.log("   (Set EMAIL_DELIVERY_MODE=resend and configure RESEND_API_KEY to send real emails)\n");

    return {
      state: "development_preview",
      provider: "development",
      providerMessageId: null,
      sentAt: null,
      failureCategory: null,
      failureSummary: null,
    };
  }
}
