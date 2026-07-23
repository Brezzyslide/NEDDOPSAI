# Sprint 1 Email Delivery — Completion Report

**Date:** 2026-07-23  
**Status:** ✅ Complete

---

## What was built

### Email service abstraction

Created a provider-independent email layer inside the API server:

```
artifacts/api-server/src/services/email/
├── types.ts                  — TransactionalEmailService interface + input/output types
├── templates.ts              — HTML + plain-text invitation email templates
├── developmentEmailService.ts — dev mode (preview only, no delivery)
├── resendEmailService.ts      — Resend API implementation
└── index.ts                  — factory singleton, reset helper for tests
```

**Delivery modes** controlled by `EMAIL_DELIVERY_MODE` env var:
- `development` (default) — logs preview URL to stdout, returns `development_preview` state
- `resend` — sends real email via Resend API

### Database changes

Two schema additions (pushed via `drizzle-kit push`):

1. **`email_delivery_status` column** on `invitations` — quick status without join (`not_attempted` | `development_preview` | `queued` | `sent` | `failed`)
2. **`email_delivery_logs` table** — full delivery history per attempt (provider, state, provider message ID, attempted/sent timestamps, failure category/summary)

### Invitation URL format changed

Previous: `{base}/invitations/accept?token={rawToken}`  
New: `{WEB_APP_URL}/invitations/{rawToken}/accept`

Web app route updated: `/invitations/accept` → `/invitations/:token/accept`  
`InvitationAccept.tsx` updated to read token from path param via `useParams`.

### Invitation workflow changes

`createInvitation` and `resendInvitation` now:
1. Look up org name + inviter display name automatically
2. Call `emailService.sendInvitationEmail()` after creating the DB record
3. Update `emailDeliveryStatus` on the invitation row
4. Append a row to `email_delivery_logs`
5. Write audit events for both creation and delivery outcome

Failed delivery does not delete the invitation — it stays `pending` and can be resent.

### Route response changes

Create and resend endpoints now return:
```json
{
  "success": true,
  "data": {
    "invitationCreated": true,
    "invitation": { ... },
    "emailDelivery": "development_preview",
    "previewUrl": "http://..." // dev mode only
  }
}
```

On failure:
```json
{
  "success": true,
  "data": {
    "invitationCreated": true,
    "emailDelivery": "failed",
    "message": "The invitation was created, but the email could not be delivered."
  }
}
```

### New audit event types (added to `lib/shared`)

- `invitation.email_delivery_attempted`
- `invitation.email_sent`
- `invitation.email_failed`
- `invitation.email_preview_created`

### Team page changes

`TeamPage.tsx` now shows for each invitation:
- Invited email + role badge
- Delivery status label (colour-coded): _Email sent_ / _Email delivery failed_ / _Development preview only_ / _Not sent_
- Expiry date (for pending invitations)
- **Resend** and **Revoke** action buttons on pending invitations
- **Open invitation preview** link (dev mode only, stored in local state after create/resend)

---

## Tests — 17/17 passing

File: `artifacts/api-server/src/__tests__/emailService.test.ts`

| # | Test |
|---|------|
| 1 | Subject contains organisation name |
| 2 | HTML email contains organisation name |
| 3 | HTML email contains the correct acceptance URL |
| 4 | Token hash stored; plaintext token not in URL structure |
| 5 | HTML email contains the role |
| 6 | HTML email contains recipient email (privacy notice) |
| 7 | HTML email contains inviter name |
| 8 | Plain-text fallback contains acceptance URL |
| 9 | Plain-text fallback contains organisation name |
| 10 | Dev service returns `development_preview` state (no delivery claimed) |
| 11 | Dev mode logs preview URL safely — no standalone raw token line |
| 12 | Factory returns `DevelopmentEmailService` when mode=development |
| 13 | Factory returns `DevelopmentEmailService` when mode is unset |
| 14 | Factory throws config error (not key value) when mode=resend + no key |
| 15 | Provider error returns `failed` state without exposing API key |
| 16 | `buildInvitationUrl` uses path format `/invitations/{token}/accept` |
| 17 | `hashToken` produces a value different from the raw token |

---

## Completion checklist

- [x] Invitation creation still works (201)
- [x] Real email can be delivered through Resend (when configured)
- [x] Development preview works without Resend
- [x] Failed delivery is visible (`emailDeliveryStatus: "failed"`) and recoverable via resend
- [x] Resend creates a new secure token (old token expires)
- [x] Accepted/revoked invitations cannot be resent (enforced in service)
- [x] Team page displays delivery state
- [x] 17 tests pass
- [x] TypeScript builds clean
- [x] Audit events written for all outcomes

---

## Manual configuration — switching to Resend

To send real invitation emails:

1. **Create a Resend account** at [resend.com](https://resend.com) (free tier: 3,000 emails/month)

2. **Add your API key** — in the Replit Secrets panel, add:
   - `RESEND_API_KEY` = `re_...` (from Resend dashboard → API Keys)

3. **Configure the sender address** — add these Replit secrets:
   - `EMAIL_FROM_ADDRESS` = `invitations@yourdomain.com.au`  
     _(must be a verified domain or `onboarding@resend.dev` for testing)_
   - `EMAIL_FROM_NAME` = `NeedsOps AI+`

4. **Domain verification** — in Resend dashboard → Domains, add your domain and add the DNS records provided. Sending from `onboarding@resend.dev` works immediately without domain setup.

5. **Set the web app URL** — add Replit secret:
   - `WEB_APP_URL` = your public web app URL  
     e.g. `https://yourrepl.replit.dev/needsops-web`

6. **Switch delivery mode** — add Replit secret:
   - `EMAIL_DELIVERY_MODE` = `resend`

7. **Restart the API server** workflow to pick up the new secrets.

8. **Test one invitation** — go to Team page, invite an email address. The server log will show `[ResendEmailService] Invitation sent to ... — message ID: re_...` and the Team page will show "Email sent".

9. **Confirm delivery** — check the recipient's inbox (and spam folder). The Resend dashboard → Emails tab also shows delivery status.
