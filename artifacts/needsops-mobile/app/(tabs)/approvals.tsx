/**
 * Approvals screen — Sprint 9
 * Replaced placeholder data with real API calls.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';

const STATE_STYLE: Record<string, { colour: string; label: string }> = {
  pending:  { colour: '#FCD34D', label: 'Pending' },
  approved: { colour: '#10B981', label: 'Approved' },
  rejected: { colour: '#F87171', label: 'Rejected' },
  expired:  { colour: '#64748B', label: 'Expired' },
};

export default function ApprovalsScreen() {
  const colors = useColors();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const apiFetch = useAuthenticatedFetch();

  const orgSlug = (global as any).__needsops_org_slug as string | undefined;

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['mobile-approvals', orgSlug, activeFilter],
    queryFn: async () => {
      if (!orgSlug) return { approvals: [] };
      const stateParam = activeFilter ? `?state=${activeFilter}` : '';
      const res = await apiFetch(`/v1/organisations/${orgSlug}/approvals${stateParam}`);
      if (!res.ok) return { approvals: [] };
      return res.json();
    },
    enabled: !!orgSlug,
    refetchInterval: 20_000,
  });

  const approvals: any[] = data?.approvals ?? [];
  const pendingCount = approvals.filter(a => a.state === 'pending').length;
  const filtered = activeFilter ? approvals.filter(a => a.state === activeFilter) : approvals;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Approvals</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Review actions that require your authorisation
          </Text>
        </View>

        {!orgSlug && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Select an organisation from the Organisations tab to view approvals.
            </Text>
          </View>
        )}

        {orgSlug && (
          <>
            {/* Pending banner */}
            {pendingCount > 0 && (
              <View style={[styles.pendingBanner, { backgroundColor: '#FCD34D22', borderColor: '#FCD34D44' }]}>
                <Text style={styles.pendingIcon}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pendingText, { color: '#FCD34D' }]}>
                    {pendingCount} pending approval{pendingCount > 1 ? 's' : ''} awaiting your review
                  </Text>
                  <Text style={{ color: '#FCD34D88', fontSize: 11, marginTop: 2 }}>
                    Open the web portal to approve or reject
                  </Text>
                </View>
              </View>
            )}

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {['All', 'Pending', 'Approved', 'Rejected'].map(f => {
                const isActive = f === 'All' ? activeFilter === null : activeFilter === f.toLowerCase();
                const col = f === 'All' ? colors.primary : (STATE_STYLE[f.toLowerCase()]?.colour ?? colors.primary);
                return (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setActiveFilter(f === 'All' ? null : f.toLowerCase())}
                    style={[styles.chip, { borderColor: isActive ? col : colors.border, backgroundColor: isActive ? col + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: isActive ? col : colors.mutedForeground }]}>{f}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
            ) : isError ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: '#F87171' }]}>Failed to load approvals.</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  {activeFilter ? `No ${activeFilter} approvals.` : 'No approvals found.'}
                </Text>
              </View>
            ) : (
              <View style={styles.list}>
                {filtered.map((approval: any) => {
                  const s = STATE_STYLE[approval.state] ?? STATE_STYLE.pending!;
                  return (
                    <View key={approval.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.cardTop}>
                        <View style={[styles.badge, { backgroundColor: s.colour + '22' }]}>
                          <Text style={[styles.badgeText, { color: s.colour }]}>{s.label}</Text>
                        </View>
                        <Text style={[styles.approvalType, { color: colors.mutedForeground }]}>
                          {(approval.approvalType ?? '').replace(/_/g, ' ')}
                        </Text>
                      </View>
                      {approval.task?.title && (
                        <Text style={[styles.taskName, { color: colors.foreground }]}>
                          Task: {approval.task.title}
                        </Text>
                      )}
                      <Text style={[styles.date, { color: colors.mutedForeground }]}>
                        Requested {new Date(approval.requestedAt).toLocaleDateString('en-AU')}
                        {approval.resolvedAt ? ` · Resolved ${new Date(approval.resolvedAt).toLocaleDateString('en-AU')}` : ''}
                      </Text>
                      {approval.state === 'pending' && (
                        <Text style={[styles.reviewNote, { color: colors.primary }]}>
                          Open web portal to review and approve →
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 4 },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16 },
  pendingIcon: { fontSize: 18 },
  pendingText: { fontSize: 13, fontWeight: '600' },
  chips: { marginBottom: 16, flexGrow: 0 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  chipText: { fontSize: 12, fontWeight: '600' },
  list: { gap: 10 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  approvalType: { fontSize: 12, textTransform: 'capitalize', flex: 1 },
  taskName: { fontSize: 14, fontWeight: '600' },
  date: { fontSize: 12 },
  reviewNote: { fontSize: 12, marginTop: 2 },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center' },
});
