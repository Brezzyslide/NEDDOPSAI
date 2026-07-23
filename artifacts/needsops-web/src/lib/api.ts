/**
 * useAuthFetch — authenticated fetch hook.
 *
 * Returns a stable `apiFetch(path, init?)` function that automatically
 * attaches the Clerk Bearer token to every request.  Drop-in replacement
 * for `fetch` inside React components; call the hook at the top of the
 * component and pass `apiFetch` into React Query `queryFn` / `mutationFn`.
 *
 * The proxy in vite.config.ts routes /v1/* and /api/* to the API server,
 * so root-relative paths work correctly in development.
 */

import { useCallback } from "react";
import { useAuth } from "@clerk/react";

export function useAuthFetch() {
  const { getToken } = useAuth();

  return useCallback(
    async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      // Only set Content-Type when there is a body and the caller hasn't set it already
      if (init.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      return fetch(path, { ...init, headers });
    },
    [getToken],
  );
}
