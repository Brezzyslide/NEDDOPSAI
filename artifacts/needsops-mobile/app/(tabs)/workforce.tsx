/**
 * Workforce Screen — /tabs/workforce
 *
 * Shows individual specialists grouped by department with availability
 * status badges. Non-active specialists are visually dimmed and tapping
 * them is disabled. Mirrors the web WorkforcePage display-state logic.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from '@/components/StatusBadge';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import {
  getSpecialistDisplayState,
  DISPLAY_STATE_META,
  type SpecialistDisplayState,
} from '@/lib/specialistDisplayState';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Specialist {
  code: string;
  displayName: string;
  description: string;
  packCode: string;
  icon?: string;
  colour?: string;
  executionStatus?: string;
  comingSoon?: boolean;
  isArchived?: boolean;
  isAccessible?: boolean;
  dnaStatus?: string;
  capabilities?: string[];
  approvalRequirements?: string;
}

// ─── Department config ────────────────────────────────────────────────────────

const DEPARTMENT_NAMES: Record<string, string> = {
  core:        'Core',
  compliance:  'Compliance',
  operations:  'Operations',
  finance:     'Finance',
  hr:          'Human Resources',
  marketing:   'Marketing',
};

const DEPARTMENT_COLOURS: Record<string, string> = {
  core:        '#00D4FF',
  compliance:  '#FF8C00',
  operations:  '#1E90FF',
  finance:     '#32CD32',
  hr:          '#FF69B4',
  marketing:   '#FF1493',
};

const DEPARTMENT_ORDER = ['core', 'compliance', 'operations', 'finance', 'hr', 'marketing'];

// ─── State-specific notice text ───────────────────────────────────────────────

const STATE_NOTICE: Partial<Record<SpecialistDisplayState, string>> = {
  coming_soon:          '🕐 This specialist is not yet available. Check back soon.',
  dna_pending:          '🧬 This specialist\'s professional profile is still being designed.',
  unavailable_for_plan: '🔒 Your plan does not include this specialist.',
  archived:             '📦 This specialist has been retired and is no longer available.',
  deprecated:           '⚠️ This specialist has been replaced by a newer version.',
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function WorkforceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const apiFetch = useAuthenticatedFetch();

  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['mobile-specialists', selectedDept],
    queryFn: async () => {
      const url = selectedDept
        ? `/v1/workforce/specialists?pack=${selectedDept}`
        : '/v1/workforce/specialists';
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('Failed to load specialists');
      return res.json() as Promise<{ specialists: Specialist[]; total: number }>;
    },
  });

  const specialists = data?.specialists ?? [];

  // Group by department in fixed order
  const grouped = DEPARTMENT_ORDER
    .map(dept => ({
      dept,
      specialists: specialists.filter(s => s.packCode === dept),
    }))
    .filter(g => g.specialists.length > 0);

  // ─── Department filter tabs ─────────────────────────────────────────────────

  const deptButtons = [
    { code: null, label: 'All' },
    ...DEPARTMENT_ORDER.map(d => ({ code: d, label: DEPARTMENT_NAMES[d] ?? d })),
  ];

  const renderDeptButton = ({ code, label }: { code: string | null; label: string }) => {
    const isSelected = selectedDept === code;
    const colour = code ? (DEPARTMENT_COLOURS[code] ?? colors.primary) : colors.primary;
    return (
      <TouchableOpacity
        key={code ?? 'all'}
        onPress={() => setSelectedDept(code)}
        style={[
          styles.deptButton,
          {
            backgroundColor: isSelected ? colour + '22' : colors.card,
            borderColor: isSelected ? colour : colors.border,
          },
        ]}
        activeOpacity={0.75}
      >
        <Text style={[styles.deptLabel, { color: isSelected ? colour : colors.mutedForeground }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  // ─── Specialist card ────────────────────────────────────────────────────────

  const renderSpecialist = (s: Specialist) => {
    const displayState = getSpecialistDisplayState({
      executionStatus: s.executionStatus,
      comingSoon:      s.comingSoon,
      isArchived:      s.isArchived,
      isAccessible:    s.isAccessible,
      dnaStatus:       s.dnaStatus,
    });
    const meta      = DISPLAY_STATE_META[displayState];
    const isActive  = displayState === 'active';
    const deptColour = DEPARTMENT_COLOURS[s.packCode] ?? colors.primary;
    const notice    = STATE_NOTICE[displayState];

    return (
      <TouchableOpacity
        key={s.code}
        disabled={!meta.canExecute}
        activeOpacity={0.75}
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: isActive
              ? colors.border
              : displayState === 'dna_pending'
                ? '#1e3a5f'
                : displayState === 'coming_soon'
                  ? '#3d2e00'
                  : colors.border,
            opacity: isActive ? 1 : 0.7,
          },
        ]}
      >
        {/* Top row: icon + name + badge */}
        <View style={styles.cardTop}>
          <View
            style={[
              styles.iconBox,
              {
                backgroundColor: deptColour + '22',
                opacity: isActive ? 1 : 0.5,
              },
            ]}
          >
            <Text style={styles.iconText}>{s.icon ?? '🤖'}</Text>
          </View>

          <View style={styles.nameBlock}>
            <Text
              style={[
                styles.specialistName,
                { color: isActive ? colors.foreground : colors.mutedForeground },
              ]}
              numberOfLines={1}
            >
              {s.displayName}
            </Text>
            <Text style={[styles.deptName, { color: colors.mutedForeground }]}>
              {DEPARTMENT_NAMES[s.packCode] ?? s.packCode} department
            </Text>
          </View>

          <StatusBadge status={displayState} />
        </View>

        {/* Description */}
        <Text
          style={[
            styles.description,
            { color: isActive ? colors.mutedForeground : colors.mutedForeground + 'aa' },
          ]}
          numberOfLines={2}
        >
          {s.description}
        </Text>

        {/* State-specific notice */}
        {notice ? (
          <View
            style={[
              styles.notice,
              {
                backgroundColor:
                  displayState === 'dna_pending'     ? '#1e3569' + '44'
                  : displayState === 'coming_soon'   ? '#3d2e00' + '88'
                  : displayState === 'unavailable_for_plan' ? colors.secondary
                  : colors.secondary,
                borderColor:
                  displayState === 'dna_pending'     ? '#3b82f6' + '40'
                  : displayState === 'coming_soon'   ? '#f59e0b' + '40'
                  : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.noticeText,
                {
                  color:
                    displayState === 'dna_pending'     ? '#60a5fa'
                    : displayState === 'coming_soon'   ? '#fbbf24'
                    : colors.mutedForeground,
                },
              ]}
            >
              {notice}
            </Text>
          </View>
        ) : null}

        {/* Capabilities — only when active */}
        {isActive && (s.capabilities ?? []).length > 0 ? (
          <View style={styles.capabilities}>
            {(s.capabilities ?? []).slice(0, 4).map(cap => (
              <View key={cap} style={[styles.capChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.capLabel, { color: colors.mutedForeground }]}>
                  {cap.replace(/_/g, ' ')}
                </Text>
              </View>
            ))}
            {(s.capabilities ?? []).length > 4 ? (
              <View style={[styles.capChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.capLabel, { color: colors.mutedForeground }]}>
                  +{(s.capabilities ?? []).length - 4} more
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Approval hint — only when active */}
        {isActive && s.approvalRequirements && s.approvalRequirements !== 'no_approval' ? (
          <Text style={styles.approvalHint}>
            ⚠ Requires {s.approvalRequirements.replace(/_/g, ' ')}
          </Text>
        ) : null}

        {/* Disabled footer for non-active */}
        {!isActive ? (
          <View style={[styles.unavailableFooter, { borderTopColor: colors.border }]}>
            <Text style={[styles.unavailableText, { color: colors.mutedForeground }]}>
              {meta.label} — unavailable
            </Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ─── Department section ─────────────────────────────────────────────────────

  const renderSection = ({ dept, specialists: list }: { dept: string; specialists: Specialist[] }) => {
    const colour = DEPARTMENT_COLOURS[dept] ?? colors.primary;
    return (
      <View key={dept} style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: colour }]} />
          <Text style={[styles.sectionTitle, { color: colour }]}>
            {DEPARTMENT_NAMES[dept] ?? dept}
          </Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {list.length} {list.length === 1 ? 'specialist' : 'specialists'}
          </Text>
        </View>
        {list.map(renderSpecialist)}
      </View>
    );
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  const listHeader = (
    <View>
      {/* Page header */}
      <View style={styles.listHeader}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Specialists</Text>
        {data ? (
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {data.total} specialist{data.total !== 1 ? 's' : ''}
          </Text>
        ) : null}
      </View>

      {/* Department filter row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.deptRow}
        style={styles.deptScroll}
      >
        {deptButtons.map(renderDeptButton)}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={grouped}
        keyExtractor={g => g.dept}
        renderItem={({ item }) => renderSection(item)}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
                No specialists available
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:        { flex: 1 },
  list:             { paddingHorizontal: 20 },
  listHeader:       { marginBottom: 16 },
  eyebrow:          { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  title:            { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle:         { fontSize: 13, marginTop: 4 },

  // Department filter
  deptScroll:       { marginBottom: 20 },
  deptRow:          { gap: 8, paddingRight: 8 },
  deptButton:       {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  deptLabel:        { fontSize: 12, fontWeight: '600' },

  // Section
  section:          { marginBottom: 28 },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionDot:       { width: 6, height: 6, borderRadius: 3 },
  sectionTitle:     { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  sectionCount:     { fontSize: 11 },

  // Card
  card:             { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12, gap: 10 },
  cardTop:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconBox:          { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText:         { fontSize: 20 },
  nameBlock:        { flex: 1, minWidth: 0 },
  specialistName:   { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  deptName:         { fontSize: 11, marginTop: 2 },

  description:      { fontSize: 12, lineHeight: 18 },

  notice:           { borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  noticeText:       { fontSize: 11, lineHeight: 16 },

  capabilities:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  capChip:          { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  capLabel:         { fontSize: 10, fontWeight: '500' },

  approvalHint:     { fontSize: 11, color: '#fbbf24' },

  unavailableFooter: { borderTopWidth: 1, paddingTop: 8 },
  unavailableText:   { fontSize: 11, fontWeight: '500' },

  empty:            { alignItems: 'center', paddingVertical: 40 },
  emptyTitle:       { fontSize: 14, fontWeight: '500' },
});
