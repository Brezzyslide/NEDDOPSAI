/**
 * Notifications — Mobile (Task #36)
 *
 * Displays pending items requiring attention:
 *   - Approvals awaiting decision
 *   - Work items submitted for review
 *   - Knowledge proposals
 *
 * Archive state is server-backed via notification_reads.
 * Unread count badge updates after mark-read/archive actions.
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotifItem {
  id:          string;
  title:       string;
  description: string;
  timestamp:   string;
  priority:    'high' | 'normal';
  type:        'work' | 'approval' | 'knowledge';
}

interface ServerNotifState {
  notificationId: string;
  isRead:         boolean;
  isArchived:     boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const colors      = useColors();
  const fetchAuth   = useAuthenticatedFetch();
  const queryClient = useQueryClient();
  const slug        = (global as any).__needsops_org_slug as string | undefined ?? '';

  const [optimisticArchived, setOptimisticArchived] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: approvalsData, isLoading: loadingApprovals } = useQuery({
    queryKey: ['approvals-mobile', slug],
    queryFn:  () => fetchAuth(`/v1/organisations/${slug}/approvals?state=pending`).then(r => r.json()),
    enabled:  !!slug, staleTime: 30_000,
  });

  const { data: workData, isLoading: loadingWork } = useQuery({
    queryKey: ['completed-work-mobile', slug],
    queryFn:  () => fetchAuth(`/v1/organisations/${slug}/completed-work?limit=30`).then(r => r.json()),
    enabled:  !!slug, staleTime: 30_000,
  });

  const { data: proposalsData, isLoading: loadingProposals } = useQuery({
    queryKey: ['proposals-mobile', slug],
    queryFn:  () =>
      fetchAuth(`/v1/organisations/${slug}/knowledge/curation/proposals?status=proposed&limit=10`)
        .then(r => r.json()),
    enabled:  !!slug, staleTime: 60_000,
  });

  const { data: stateData } = useQuery({
    queryKey: ['notif-state-mobile', slug],
    queryFn:  () => fetchAuth(`/v1/organisations/${slug}/notifications/state`).then(r => r.json()),
    enabled:  !!slug, staleTime: 30_000,
  });

  const isArchived = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of (stateData?.states ?? []) as ServerNotifState[]) {
      if (s.isArchived) m.set(s.notificationId, true);
    }
    return (id: string) => optimisticArchived.has(id) || (m.get(id) ?? false);
  }, [stateData, optimisticArchived]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const markReadMutation = useMutation({
    mutationFn: (ids: string[]) =>
      fetchAuth(`/v1/organisations/${slug}/notifications/mark-read`, {
        method: 'POST',
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif-state-mobile', slug] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (ids: string[]) =>
      fetchAuth(`/v1/organisations/${slug}/notifications/archive`, {
        method: 'POST',
        body:   JSON.stringify({ notificationIds: ids }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notif-state-mobile', slug] });
    },
  });

  const handleArchive = (id: string) => {
    setOptimisticArchived(prev => new Set([...prev, id]));
    archiveMutation.mutate([id]);
  };

  const handleMarkRead = (id: string) => {
    markReadMutation.mutate([id]);
  };

  // ── Build items ────────────────────────────────────────────────────────────

  const items = useMemo<NotifItem[]>(() => {
    const result: NotifItem[] = [];

    for (const a of (approvalsData?.approvals ?? []).slice(0, 10)) {
      const id = `approval-${a.id}`;
      if (!isArchived(id)) {
        result.push({
          id, type: 'approval',
          title:       a.approvalType?.replace(/_/g, ' ') ?? 'Approval required',
          description: a.description ?? 'Requires your decision.',
          timestamp:   a.createdAt ?? new Date().toISOString(),
          priority:    'high',
        });
      }
    }

    for (const w of (workData?.completedWork ?? []).filter((w: any) => w.status === 'awaiting_approval')) {
      const id = `work-${w.id}`;
      if (!isArchived(id)) {
        result.push({
          id, type: 'work',
          title:       `"${w.title ?? 'Work item'}" needs your approval`,
          description: `Submitted by ${w.primarySpecialist?.replace(/_/g, ' ') ?? 'AI Workforce'}.`,
          timestamp:   w.updatedAt ?? w.createdAt,
          priority:    'high',
        });
      }
    }

    for (const p of (proposalsData?.proposals ?? []).slice(0, 5)) {
      const id = `proposal-${p.id}`;
      if (!isArchived(id)) {
        result.push({
          id, type: 'knowledge',
          title:       p.title ?? 'Knowledge update proposed',
          description: p.rationale ?? 'Review recommended by your AI Workforce.',
          timestamp:   p.createdAt ?? new Date().toISOString(),
          priority:    'normal',
        });
      }
    }

    return result.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [approvalsData, workData, proposalsData, isArchived]);

  const isLoading = loadingApprovals || loadingWork || loadingProposals;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['approvals-mobile', slug] }),
      queryClient.invalidateQueries({ queryKey: ['completed-work-mobile', slug] }),
      queryClient.invalidateQueries({ queryKey: ['proposals-mobile', slug] }),
      queryClient.invalidateQueries({ queryKey: ['notif-state-mobile', slug] }),
    ]);
    setRefreshing(false);
  };

  const TYPE_ICON: Record<NotifItem['type'], string> = {
    work:       '📋',
    approval:   '✅',
    knowledge:  '🧠',
  };

  const styles = makeStyles(colors);

  if (!slug) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Select an organisation to view notifications.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {items.length > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{items.length}</Text>
          </View>
        )}
      </View>

      {isLoading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {items.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>All clear</Text>
              <Text style={styles.emptyText}>No items require your attention right now.</Text>
            </View>
          ) : (
            items.map(item => (
              <View key={item.id} style={[styles.card, item.priority === 'high' && styles.cardHigh]}>
                <View style={styles.cardRow}>
                  <Text style={styles.cardIcon}>{TYPE_ICON[item.type]}</Text>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                    <Text style={styles.cardTime}>{relativeTime(item.timestamp)}</Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleMarkRead(item.id)}
                  >
                    <Text style={styles.actionBtnText}>Mark read</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.archiveBtn}
                    onPress={() => handleArchive(item.id)}
                  >
                    <Text style={styles.archiveBtnText}>Archive</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container:    { flex: 1, backgroundColor: colors.background },
    header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, gap: 10 },
    title:        { fontSize: 28, fontWeight: '700', color: colors.foreground },
    badge:        { backgroundColor: colors.primary, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
    badgeText:    { color: '#0B1829', fontSize: 11, fontWeight: '700' },
    centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
    list:         { padding: 16, paddingBottom: 100 },
    emptyState:   { alignItems: 'center', paddingVertical: 60 },
    emptyIcon:    { fontSize: 48, marginBottom: 12, opacity: 0.3 },
    emptyTitle:   { fontSize: 18, fontWeight: '600', color: colors.foreground, marginBottom: 6 },
    emptyText:    { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },
    card:         { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
    cardHigh:     { borderColor: '#92400e' },
    cardRow:      { flexDirection: 'row', gap: 12, marginBottom: 10 },
    cardIcon:     { fontSize: 24, lineHeight: 30 },
    cardContent:  { flex: 1 },
    cardTitle:    { fontSize: 14, fontWeight: '600', color: colors.foreground, marginBottom: 3 },
    cardDesc:     { fontSize: 12, color: colors.mutedForeground, lineHeight: 18, marginBottom: 4 },
    cardTime:     { fontSize: 11, color: colors.mutedForeground + '99' },
    cardActions:  { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
    actionBtn:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.primary + '1A', borderWidth: 1, borderColor: colors.primary + '4D' },
    actionBtnText:{ fontSize: 12, fontWeight: '600', color: colors.primary },
    archiveBtn:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    archiveBtnText:{ fontSize: 12, color: colors.mutedForeground },
  });
}
