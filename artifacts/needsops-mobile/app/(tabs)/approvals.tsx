/**
 * Approvals screen — Task #37
 *
 * Updated to:
 *  - Use useOrgContext() instead of global.__needsops_org_slug
 *  - Show approve / reject / request-changes action buttons on pending items
 *  - Support an optional comment before submitting an action
 *  - Wire to POST /v1/organisations/:slug/approvals/:approvalId/resolve
 *  - Provide "View in Web Portal" handoff for complex items
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
  Modal,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useOrgContext } from '@/contexts/OrgContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_STYLE: Record<string, { colour: string; label: string }> = {
  pending:  { colour: '#FCD34D', label: 'Pending' },
  approved: { colour: '#10B981', label: 'Approved' },
  rejected: { colour: '#F87171', label: 'Rejected' },
  expired:  { colour: '#64748B', label: 'Expired' },
};

type ResolveAction = 'approved' | 'rejected' | 'changes_requested';

interface ResolvePayload {
  approvalId: string;
  action:     'approved' | 'rejected';
  notes?:     string;
}

// ─── Resolve modal ────────────────────────────────────────────────────────────

interface ResolveModalProps {
  visible:     boolean;
  action:      ResolveAction | null;
  onSubmit:    (notes: string) => void;
  onCancel:    () => void;
  isSubmitting: boolean;
}

const ACTION_META: Record<ResolveAction, { label: string; colour: string; emoji: string; commentPlaceholder: string }> = {
  approved:          { label: 'Approve',           colour: '#10B981', emoji: '✅', commentPlaceholder: 'Optional: add an approval note…' },
  rejected:          { label: 'Reject',            colour: '#F87171', emoji: '✗',  commentPlaceholder: 'Optional: reason for rejection…' },
  changes_requested: { label: 'Request Changes',   colour: '#F59E0B', emoji: '✏️', commentPlaceholder: 'Describe the changes needed…' },
};

function ResolveModal({ visible, action, onSubmit, onCancel, isSubmitting }: ResolveModalProps) {
  const colors = useColors();
  const [comment, setComment] = useState('');

  if (!action) return null;
  const meta = ACTION_META[action];

  const handleSubmit = () => {
    onSubmit(comment.trim());
    setComment('');
  };
  const handleCancel = () => {
    setComment('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[modalStyles.title, { color: colors.foreground }]}>
            {meta.emoji}  {meta.label}
          </Text>
          <Text style={[modalStyles.subtitle, { color: colors.mutedForeground }]}>
            Add a comment (optional)
          </Text>
          <TextInput
            style={[
              modalStyles.input,
              {
                backgroundColor: colors.background,
                borderColor:     colors.border,
                color:           colors.foreground,
              },
            ]}
            placeholder={meta.commentPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            value={comment}
            onChangeText={setComment}
          />
          <View style={modalStyles.buttons}>
            <TouchableOpacity
              style={[modalStyles.cancelBtn, { borderColor: colors.border }]}
              onPress={handleCancel}
              disabled={isSubmitting}
            >
              <Text style={[modalStyles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modalStyles.submitBtn, { backgroundColor: meta.colour }]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={modalStyles.submitText}>{meta.label}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  sheet:      { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16, paddingBottom: 40 },
  title:      { fontSize: 20, fontWeight: '700' },
  subtitle:   { fontSize: 14, marginTop: -8 },
  input:      { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 14, minHeight: 90, textAlignVertical: 'top' },
  buttons:    { flexDirection: 'row', gap: 12 },
  cancelBtn:  { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600' },
  submitBtn:  { flex: 2, borderRadius: 10, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ApprovalsScreen() {
  const colors       = useColors();
  const apiFetch     = useAuthenticatedFetch();
  const queryClient  = useQueryClient();
  const { selectedOrg, needsSelection } = useOrgContext();
  const orgSlug = selectedOrg?.slug;

  const [activeFilter,    setActiveFilter]    = useState<string | null>(null);
  const [modalVisible,    setModalVisible]    = useState(false);
  const [pendingAction,   setPendingAction]   = useState<ResolveAction | null>(null);
  const [pendingApproval, setPendingApproval] = useState<any>(null);

  // ── Data query ─────────────────────────────────────────────────────────────

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

  // ── Resolve mutation ───────────────────────────────────────────────────────

  const resolveMutation = useMutation({
    mutationFn: async ({ approvalId, action, notes }: ResolvePayload) => {
      const res = await apiFetch(
        `/v1/organisations/${orgSlug}/approvals/${approvalId}/resolve`,
        {
          method: 'POST',
          body:   JSON.stringify({ action, notes: notes || undefined }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Failed to ${action} approval`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-approvals', orgSlug] });
    },
    onError: (err: Error) => {
      Alert.alert('Action failed', err.message ?? 'Could not complete this action. Please try again.');
    },
  });

  // ── Action handlers ────────────────────────────────────────────────────────

  const openActionModal = (approval: any, action: ResolveAction) => {
    setPendingApproval(approval);
    setPendingAction(action);
    setModalVisible(true);
  };

  const handleModalSubmit = (notes: string) => {
    if (!pendingApproval || !pendingAction) return;
    // changes_requested maps to rejected with a note on this backend
    const apiAction: 'approved' | 'rejected' =
      pendingAction === 'approved' ? 'approved' : 'rejected';
    resolveMutation.mutate(
      { approvalId: pendingApproval.id, action: apiAction, notes },
      {
        onSuccess: () => {
          setModalVisible(false);
          setPendingApproval(null);
          setPendingAction(null);
        },
      },
    );
  };

  const handleModalCancel = () => {
    setModalVisible(false);
    setPendingApproval(null);
    setPendingAction(null);
  };

  const openWebPortal = (approval: any) => {
    // Construct a web portal deep link if EXPO_PUBLIC_DOMAIN is set,
    // otherwise fall back to a generic portal URL.
    const domain = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : 'https://needsops.app';
    const path = orgSlug
      ? `${domain}/app/${orgSlug}/approvals`
      : `${domain}/app-home`;
    Linking.openURL(path).catch(() => {
      Alert.alert('Cannot open link', 'Please open the web portal manually.');
    });
    void approval; // suppress unused-variable warning
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const approvals: any[] = data?.approvals ?? [];
  const pendingCount = approvals.filter(a => a.state === 'pending').length;
  const filtered     = activeFilter ? approvals.filter(a => a.state === activeFilter) : approvals;

  // ── Render ─────────────────────────────────────────────────────────────────

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

        {/* No org selected */}
        {!orgSlug && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {needsSelection
                ? 'Select an organisation from the Organisations tab to view approvals.'
                : 'No organisation connected yet. Visit the Organisations tab to get started.'}
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
                    Approve or reject directly from your device
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
                  const isPending = approval.state === 'pending';
                  const isActing  = resolveMutation.isPending &&
                    pendingApproval?.id === approval.id;

                  return (
                    <View
                      key={approval.id}
                      style={[
                        styles.card,
                        {
                          backgroundColor: colors.card,
                          borderColor: isPending ? '#FCD34D44' : colors.border,
                        },
                      ]}
                    >
                      {/* Card top — status badge + type */}
                      <View style={styles.cardTop}>
                        <View style={[styles.badge, { backgroundColor: s.colour + '22' }]}>
                          <Text style={[styles.badgeText, { color: s.colour }]}>{s.label}</Text>
                        </View>
                        <Text style={[styles.approvalType, { color: colors.mutedForeground }]}>
                          {(approval.approvalType ?? '').replace(/_/g, ' ')}
                        </Text>
                      </View>

                      {/* Title / task link */}
                      {approval.task?.title && (
                        <Text style={[styles.taskName, { color: colors.foreground }]}>
                          {approval.task.title}
                        </Text>
                      )}

                      {/* Description / notes */}
                      {approval.description && (
                        <Text style={[styles.description, { color: colors.mutedForeground }]}>
                          {approval.description}
                        </Text>
                      )}

                      {/* Dates */}
                      <Text style={[styles.date, { color: colors.mutedForeground }]}>
                        Requested {new Date(approval.requestedAt).toLocaleDateString('en-AU')}
                        {approval.resolvedAt ? ` · Resolved ${new Date(approval.resolvedAt).toLocaleDateString('en-AU')}` : ''}
                      </Text>

                      {/* Notes from resolver */}
                      {approval.notes && !isPending && (
                        <View style={[styles.notesBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                          <Text style={[styles.notesText, { color: colors.mutedForeground }]}>
                            "{approval.notes}"
                          </Text>
                        </View>
                      )}

                      {/* Action buttons (pending items only) */}
                      {isPending && (
                        <View style={styles.actionRow}>
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.approveBtn]}
                            onPress={() => openActionModal(approval, 'approved')}
                            disabled={isActing}
                          >
                            <Text style={styles.approveBtnText}>
                              {isActing && pendingAction === 'approved' ? '…' : '✓ Approve'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionBtn, styles.changesBtn, { borderColor: '#F59E0B44' }]}
                            onPress={() => openActionModal(approval, 'changes_requested')}
                            disabled={isActing}
                          >
                            <Text style={[styles.changesBtnText, { color: '#F59E0B' }]}>
                              ✏ Changes
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.actionBtn, styles.rejectBtn]}
                            onPress={() => openActionModal(approval, 'rejected')}
                            disabled={isActing}
                          >
                            <Text style={styles.rejectBtnText}>
                              ✗ Reject
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Handoff to web portal for complex items */}
                      <TouchableOpacity
                        style={styles.webHandoffRow}
                        onPress={() => openWebPortal(approval)}
                      >
                        <Text style={[styles.webHandoffText, { color: colors.primary }]}>
                          View in Web Portal →
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Resolve action modal */}
      <ResolveModal
        visible={modalVisible}
        action={pendingAction}
        onSubmit={handleModalSubmit}
        onCancel={handleModalCancel}
        isSubmitting={resolveMutation.isPending}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1 },
  scroll:        { flex: 1 },
  content:       { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  header:        { marginBottom: 20 },
  eyebrow:       { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 4 },
  title:         { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle:      { fontSize: 13, marginTop: 4 },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16 },
  pendingIcon:   { fontSize: 18 },
  pendingText:   { fontSize: 13, fontWeight: '600' },
  chips:         { marginBottom: 16, flexGrow: 0 },
  chip:          { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  chipText:      { fontSize: 12, fontWeight: '600' },
  list:          { gap: 10 },
  card:          { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  cardTop:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge:         { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:     { fontSize: 11, fontWeight: '700' },
  approvalType:  { fontSize: 12, textTransform: 'capitalize', flex: 1 },
  taskName:      { fontSize: 14, fontWeight: '600' },
  description:   { fontSize: 13, lineHeight: 18 },
  date:          { fontSize: 12 },
  notesBox:      { borderRadius: 8, borderWidth: 1, padding: 10 },
  notesText:     { fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
  actionRow:     { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn:     { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  approveBtn:    { backgroundColor: '#10B98122', borderWidth: 1, borderColor: '#10B98144' },
  approveBtnText:{ fontSize: 12, fontWeight: '700', color: '#10B981' },
  changesBtn:    { backgroundColor: '#F59E0B11', borderWidth: 1 },
  changesBtnText:{ fontSize: 12, fontWeight: '700' },
  rejectBtn:     { backgroundColor: '#F8717122', borderWidth: 1, borderColor: '#F8717144' },
  rejectBtnText: { fontSize: 12, fontWeight: '700', color: '#F87171' },
  webHandoffRow: { paddingTop: 6 },
  webHandoffText:{ fontSize: 12 },
  emptyCard:     { borderRadius: 12, borderWidth: 1, padding: 20, alignItems: 'center' },
  emptyText:     { fontSize: 13, textAlign: 'center' },
});
