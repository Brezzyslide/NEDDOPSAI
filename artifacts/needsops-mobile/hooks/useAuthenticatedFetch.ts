/**
 * useAuthenticatedFetch — Sprint 9
 * Clerk-authenticated fetch hook for React Native / Expo.
 * Mirrors the web `useAuthFetch` pattern but uses `@clerk/expo` token retrieval.
 */
import { useCallback } from 'react';
import { useAuth } from '@clerk/expo';

const API_BASE =
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';

export function useAuthenticatedFetch() {
  const { getToken } = useAuth();

  return useCallback(
    async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
      const token = await getToken();
      const headers = new Headers(init.headers as HeadersInit | undefined);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (init.body !== undefined && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      return fetch(`${API_BASE}${path}`, { ...init, headers });
    },
    [getToken],
  );
}
