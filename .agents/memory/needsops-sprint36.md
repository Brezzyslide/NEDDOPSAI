---
name: NeedsOps Task #36 — Server-side notification state
description: notification_reads table, service, routes, AppShell badge, legacy messageIds dual-write, mobile notifications tab
---

# NeedsOps Task #36 — Server-side Notification State

## What was built
- `notification_reads` table: per-user, per-tenant read/archive/snooze state keyed by synthetic notification ID (e.g. `work-<uuid>`, `approval-<uuid>`). Unique index on `(organization_id, user_id, notification_id)`.
- `notificationReadsService`: getAllNotificationStates, markNotificationsRead, markNotificationsUnread, archiveNotifications, restoreNotifications, snoozeNotification. All use upsert-on-conflict pattern.
- Notifications routes rewritten: GET /unread-count LEFT JOINs message_reads (fixes overcounting), GET /state, POST mark-read/mark-unread/archive/restore/snooze.
- AppShell: live nav badge from /unread-count, 60s refetchInterval.
- NotificationCentrePage + ExecutiveInbox: server-backed state replaces localStorage; optimistic Sets for instant UI.
- Mobile: new notifications tab + Alerts tab in both layout variants.

## Critical: legacy messageIds dual-write
**Rule:** `POST /mark-read` accepts both `notificationIds` (new) and `messageIds` (legacy). When `messageIds` are provided, the route MUST write to BOTH tables:
1. `notification_reads` (for cross-device server state)
2. `message_reads` (so /unread-count, which JOINs message_reads, decrements correctly)

**Why:** /unread-count is computed from `message_reads`; skipping the second write was a functional regression — legacy callers could call mark-read successfully but conversation unread counts remained unchanged.

**How to apply:** In the route, branch on `legacyMsgIds.length > 0` and call `markMessagesRead(orgId, legacyMsgIds, userId)` after the notification_reads upsert.

## REQUIRED_RLS_TABLES: 67 → 68
`notification_reads` added. All prior count assertions updated to 68.

## Pre-existing failing tests
`sprint4-platform-console.test.ts` and `sprint5-isolation.test.ts` use raw `fetch("http://localhost:8080/...")` — they fail with ECONNREFUSED when no server is running. This predates task #36 and is unrelated to any changes here. 29 tests total. All other 2331 pass.
