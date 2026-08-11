/**
 * useOrgRole — Sprint 29N.10
 *
 * Shared hook for the current user's organisation role.
 * Uses the same query key as AppShell so the result is cached/shared.
 *
 * Canonical role strings: owner | administrator | manager | member | viewer | auditor
 * ("admin" short-form does NOT exist — always use "administrator")
 */

import { useQuery }    from "@tanstack/react-query";
import { useAuthFetch } from "@/lib/api";

export type OrgRole =
  | "owner"
  | "administrator"
  | "manager"
  | "member"
  | "viewer"
  | "auditor";

export interface OrgRoleState {
  role:              OrgRole;
  isLoading:         boolean;
  /** owner or administrator — can approve, publish, govern */
  isKnowledgeAdmin:  boolean;
  /** owner or administrator — can manage team, settings, plan */
  isOrgAdmin:        boolean;
  /** Can approve any pending decision (approvals, memory, blueprints) */
  canApprove:        boolean;
  /** owner, administrator, manager, auditor */
  canViewGovernance: boolean;
}

export function useOrgRole(orgSlug: string | undefined): OrgRoleState {
  const apiFetch = useAuthFetch();

  const { data, isLoading } = useQuery({
    queryKey:  ["me-orgs"],
    queryFn:   () =>
      apiFetch("/v1/me/organisations").then(r => {
        if (!r.ok) throw new Error(`me/organisations ${r.status}`);
        return r.json();
      }),
    staleTime: 5 * 60_000,
    retry: 3,
    enabled:   !!orgSlug,
  });

  const role: OrgRole = (
    (data?.organisations as Array<{ slug: string; role: string }> | undefined)
      ?.find(o => o.slug === orgSlug)?.role ?? "member"
  ) as OrgRole;

  const isKnowledgeAdmin  = role === "owner" || role === "administrator";
  const isOrgAdmin        = role === "owner" || role === "administrator";
  const canApprove        = role === "owner" || role === "administrator";
  const canViewGovernance = ["owner", "administrator", "manager", "auditor"].includes(role);

  return { role, isLoading, isKnowledgeAdmin, isOrgAdmin, canApprove, canViewGovernance };
}
