import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

const PLACEHOLDER_APPROVALS = [
  {
    id: 'a1',
    approvalType: 'compliance_approval',
    state: 'pending',
    taskId: 'Review NDIS Policy',
    requestedAt: new Date().toISOString(),
  },
  {
    id: 'a2',
    approvalType: 'manager_approval',
    state: 'approved',
    taskId: 'Q2 Budget Summary',
    requestedAt: new Date(Date.now() - 3600000).toISOString(),
    resolvedAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'a3',
    approvalType: 'administrator_approval',
    state: 'rejected',
    taskId: 'Incident Report #112',
    requestedAt: new Date(Date.now() - 86400000).toISOString(),
    resolvedAt: new Date(Date.now() - 82000000).toISOString(),
  },
];

const STATE_STYLE: Record<string, { colour: string; label: string }> = {
  pending:  { colour: '#FCD34D', label: 'Pending' },
  approved: { colour: '#10B981', label: 'Approved' },
  rejected: { colour: '#F87171', label: 'Rejected' },
  expired:  { colour: '#64748B', label: 'Expired' },
};

export default function ApprovalsScreen() {
  const colors = useColors();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filtered = activeFilter
    ? PLACEHOLDER_APPROVALS.filter(a => a.state === activeFilter)
    : PLACEHOLDER_APPROVALS;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
          <Text style={[styles.title, { color: colors.foreground }]}>Approvals</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Review actions that require your authorisation
          </Text>
        </View>

        {/* Pending highlight */}
        {PLACEHOLDER_APPROVALS.filter(a => a.state === 'pending').length > 0 && (
          <View style={[styles.pendingBanner, { backgroundColor: '#FCD34D22', borderColor: '#FCD34D44' }]}>
            <Text style={styles.pendingIcon}>⏳</Text>
            <Text style={[styles.pendingText, { color: '#FCD34D' }]}>
              {PLACEHOLDER_APPROVALS.filter(a => a.state === 'pending').length} pending approval{PLACEHOLDER_APPROVALS.filter(a => a.state === 'pending').length > 1 ? 's' : ''} awaiting your review
            </Text>
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

        {/* Approval cards */}
        <View style={styles.list}>
          {filtered.map(approval => {
            const s = STATE_STYLE[approval.state] ?? STATE_STYLE.pending!;
            return (
              <View key={approval.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardTop}>
                  <View style={[styles.badge, { backgroundColor: s.colour + '22' }]}>
                    <Text style={[styles.badgeText, { color: s.colour }]}>{s.label}</Text>
                  </View>
                  <Text style={[styles.approvalType, { color: colors.mutedForeground }]}>
                    {approval.approvalType.replace(/_/g, ' ')}
                  </Text>
                </View>
                <Text style={[styles.taskName, { color: colors.foreground }]}>Task: {approval.taskId}</Text>
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
  pendingText: { fontSize: 13, fontWeight: '600', flex: 1 },
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
});
