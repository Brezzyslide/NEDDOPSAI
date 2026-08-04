---
name: Clerk Show-without-when crash
description: Root cause and fix for the TypeError crash in Clerk v6's <Show> component when rendered without a `when` prop while the user is signed in.
---

## Rule

Never use Clerk's `<Show>` component without a `when` prop when the user might be signed in.

**Why:** Clerk v6's `<Show>` implementation is:
```js
var Show = ({ children, fallback, when }) => {
  const { has, isLoaded, userId } = useAuth();
  if (resolvedWhen === "signed-out") return ...;
  if (!userId) return unauthorized;
  if (resolvedWhen === "signed-in") return authorized;
  if (checkAuthorization(resolvedWhen, has)) return authorized;  // ← called with undefined!
  return unauthorized;
};
```
When `when` is `undefined` and `userId` is present, `checkAuthorization(undefined, has)` → `has(undefined)` → `checkOrgAuthorization(undefined, options)` → `undefined.role` → TypeError crash.

The crash manifests as:
- "Invalid hook call" (React logs first)
- "Cannot read properties of undefined (reading 'role')"
- "An error occurred in the `<Show>` component"

## How to apply

All `<Show>` without a `when` prop (e.g. `<Show fallback={<Redirect to="/sign-in" />}>`) must have `when="signed-in"` added:
```tsx
// WRONG — crashes for signed-in users without Clerk org membership
<Show fallback={<Redirect to="/sign-in" />}>...</Show>

// CORRECT
<Show when="signed-in" fallback={<Redirect to="/sign-in" />}>...</Show>
```

Files fixed: `CompletedWorkPortal.tsx` (1 instance) and `CompletedWorkViewer.tsx` (3 instances).

## Safety net

`ClerkErrorBoundary` (class component) in `App.tsx` catches "Cannot read properties of undefined" errors from Clerk internals and calls `window.location.reload()` to recover cleanly. This is a last-resort guard — fix the root cause (`when` prop) instead of relying on the boundary.
