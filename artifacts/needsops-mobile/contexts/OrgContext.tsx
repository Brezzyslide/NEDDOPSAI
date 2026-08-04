/**
 * OrgContext — Task #37
 *
 * React context + SecureStore-backed selected-org store.
 *
 * Replaces the mutable `(global as any).__needsops_org_slug` pattern.
 *
 * Features:
 *  - Persists the selected org across app restarts via expo-secure-store
 *  - Auto-selects on first launch when the user belongs to exactly one org
 *  - Prompts selection when the user has multiple orgs and none is stored
 *  - Falls back gracefully when stored org is no longer in the user's org list
 *  - Clears selection on sign-out
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/expo';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgSummary {
  id:                string;
  name:              string;
  slug:              string;
  status:            string;
  subscriptionTier:  string;
  userCount:         number;
  createdAt:         string;
  updatedAt:         string;
  industry?:         string;
}

interface OrgContextValue {
  /** The currently selected organisation (null = none chosen yet). */
  selectedOrg:    OrgSummary | null;
  /** All orgs the signed-in user belongs to. */
  orgs:           OrgSummary[];
  /** True while orgs are loading or the persisted selection is being restored. */
  isLoading:      boolean;
  /** Whether the user needs to manually pick an org (multiple orgs, none stored). */
  needsSelection: boolean;
  /** Select an org — persists to SecureStore. */
  setSelectedOrg: (org: OrgSummary) => Promise<void>;
  /** Clear the selection (e.g. on sign-out). */
  clearSelectedOrg: () => Promise<void>;
  /** Re-fetch the org list. */
  refreshOrgs:    () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const OrgContext = createContext<OrgContextValue>({
  selectedOrg:      null,
  orgs:             [],
  isLoading:        true,
  needsSelection:   false,
  setSelectedOrg:   async () => {},
  clearSelectedOrg: async () => {},
  refreshOrgs:      async () => {},
});

const STORAGE_KEY = 'needsops_selected_org_v1';

// ─── Provider ─────────────────────────────────────────────────────────────────

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth();
  const apiFetch = useAuthenticatedFetch();

  const [orgs, setOrgs]               = useState<OrgSummary[]>([]);
  const [selectedOrg, setSelectedOrgState] = useState<OrgSummary | null>(null);
  const [isLoading, setIsLoading]     = useState(true);
  const [needsSelection, setNeedsSelection] = useState(false);

  // ── Fetch orgs from API ──────────────────────────────────────────────────

  const fetchOrgs = useCallback(async (): Promise<OrgSummary[]> => {
    try {
      const res = await apiFetch('/v1/organisations?limit=100');
      if (!res.ok) return [];
      const json = await res.json();
      return (json.items ?? json.organisations ?? []) as OrgSummary[];
    } catch {
      return [];
    }
  }, [apiFetch]);

  // ── Initialise: load orgs + restore persisted selection ──────────────────

  const initialise = useCallback(async () => {
    if (!isSignedIn) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [fetched, storedJson] = await Promise.all([
        fetchOrgs(),
        SecureStore.getItemAsync(STORAGE_KEY).catch(() => null),
      ]);

      setOrgs(fetched);

      // Try to restore previously selected org — validate it's still accessible
      if (storedJson) {
        try {
          const stored: OrgSummary = JSON.parse(storedJson);
          const stillValid = fetched.some(o => o.id === stored.id);
          if (stillValid) {
            // Refresh the stored data with the latest from the API
            const fresh = fetched.find(o => o.id === stored.id) ?? stored;
            setSelectedOrgState(fresh);
            setNeedsSelection(false);
            return;
          } else {
            // Stored org is no longer accessible — clear and fall through
            await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
          }
        } catch {
          // Corrupt stored data — ignore
        }
      }

      // Auto-select when there is exactly one org
      if (fetched.length === 1) {
        const only = fetched[0]!;
        setSelectedOrgState(only);
        setNeedsSelection(false);
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(only)).catch(() => {});
      } else if (fetched.length === 0) {
        setSelectedOrgState(null);
        setNeedsSelection(false);
      } else {
        // Multiple orgs — user must choose
        setSelectedOrgState(null);
        setNeedsSelection(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, fetchOrgs]);

  useEffect(() => {
    initialise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // ── Public actions ────────────────────────────────────────────────────────

  const setSelectedOrg = useCallback(async (org: OrgSummary) => {
    setSelectedOrgState(org);
    setNeedsSelection(false);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(org)).catch(() => {});
  }, []);

  const clearSelectedOrg = useCallback(async () => {
    setSelectedOrgState(null);
    setNeedsSelection(false);
    await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
  }, []);

  const refreshOrgs = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetched = await fetchOrgs();
      setOrgs(fetched);

      // If current selection is no longer valid, clear it
      if (selectedOrg && !fetched.some(o => o.id === selectedOrg.id)) {
        setSelectedOrgState(null);
        setNeedsSelection(fetched.length > 1);
        await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {});
      }
    } finally {
      setIsLoading(false);
    }
  }, [fetchOrgs, selectedOrg]);

  return (
    <OrgContext.Provider value={{
      selectedOrg,
      orgs,
      isLoading,
      needsSelection,
      setSelectedOrg,
      clearSelectedOrg,
      refreshOrgs,
    }}>
      {children}
    </OrgContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOrgContext(): OrgContextValue {
  return useContext(OrgContext);
}
