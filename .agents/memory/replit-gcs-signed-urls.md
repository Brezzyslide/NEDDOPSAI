---
name: Replit GCS signed URL limitation
description: Replit workload-identity credentials cannot sign GCS URLs; direct file.save() works fine.
---

## Rule
Never call `file.getSignedUrl()` (v4 write or read) in server code running on Replit.

**Why:** Replit's object storage uses external account / workload identity federation credentials served by the sidecar at `http://127.0.0.1:1106`. These credentials support direct GCS read/write operations (`file.save()`, `createReadStream()`) but **cannot sign URLs** — GCS signing requires a service account JSON key or the `roles/iam.serviceAccountTokenCreator` permission, neither of which Replit provides. Calling `getSignedUrl()` throws a credentials error at runtime, which Express catches and returns as "An unexpected error occurred."

**How to apply:**
- For file uploads: proxy through your own API route (`PUT .../file` with raw body). Receive the buffer server-side and call `file.save(buffer, { resumable: false })`.
- For file downloads: serve from your own API too, or use `createReadStream()` and pipe to the response.
- The `objectStorageClient` imported from `lib/objectStorage.ts` (configured with the sidecar credential) works fine for direct reads and writes — just never for signing.
- In the Knowledge Hub upload flow: `request-upload` returns `storageKey` (no uploadUrl); the client then calls `PUT .../file` with `X-Storage-Key` header carrying the storageKey.
