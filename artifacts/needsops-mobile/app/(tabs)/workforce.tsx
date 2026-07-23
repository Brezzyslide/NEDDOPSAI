import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListWorkforcePacks } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from '@/components/StatusBadge';

type PackTier = 'starter' | 'professional' | 'enterprise';
type PackStatus = 'available' | 'coming_soon';

interface WorkerItem {
  id: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
}

interface PackItem {
  id: string;
  name: string;
  description: string;
  industry: string;
  workers: WorkerItem[];
  tier: PackTier;
  status: PackStatus;
}

const TIER_CONFIG: Record<PackTier, { label: string; color: string }> = {
  starter: { label: 'Starter', color: '#6b7896' },
  professional: { label: 'Professional', color: '#3b82f6' },
  enterprise: { label: 'Enterprise', color: '#8b5cf6' },
};

export default function WorkforceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, isRefetching } = useListWorkforcePacks();

  const packs = (data?.items ?? []) as PackItem[];

  const renderItem = ({ item }: { item: PackItem }) => {
    const tier = TIER_CONFIG[item.tier];
    const isAvailable = item.status === 'available';

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: isAvailable ? colors.border : colors.border,
            opacity: isAvailable ? 1 : 0.6,
          },
        ]}
        activeOpacity={0.75}
        disabled={!isAvailable}
      >
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.packName, { color: colors.foreground }]} numberOfLines={2}>
              {item.name}
            </Text>
            <StatusBadge status={item.status} />
          </View>
          <View style={styles.metaRow}>
            <View
              style={[
                styles.tierChip,
                { backgroundColor: tier.color + '20', borderColor: tier.color + '40' },
              ]}
            >
              <Text style={[styles.tierLabel, { color: tier.color }]}>{tier.label.toUpperCase()}</Text>
            </View>
            <View style={[styles.industryChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[styles.industryLabel, { color: colors.mutedForeground }]}>
                {item.industry.toUpperCase()}
              </Text>
            </View>
          </View>
        </View>

        {/* Description */}
        <Text style={[styles.description, { color: colors.mutedForeground }]} numberOfLines={3}>
          {item.description}
        </Text>

        {/* Workers */}
        {item.workers.length > 0 ? (
          <View style={[styles.workersSection, { borderTopColor: colors.border }]}>
            <Text style={[styles.workersSectionLabel, { color: colors.mutedForeground }]}>
              {item.workers.length} AI {item.workers.length === 1 ? 'worker' : 'workers'}
            </Text>
            <View style={styles.workersList}>
              {item.workers.map((worker) => (
                <View
                  key={worker.id}
                  style={[styles.workerChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                >
                  <Text style={[styles.workerName, { color: colors.foreground }]}>{worker.name}</Text>
                  <Text style={[styles.workerRole, { color: colors.primary }]}>{worker.role}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={packs}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
        ]}
        scrollEnabled={!!packs.length}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>AI WORKFORCE</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Workforce Packs</Text>
            {data ? (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {data.total} pack{data.total !== 1 ? 's' : ''} available
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>
                No workforce packs available
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20 },
  listHeader: { marginBottom: 20 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, marginTop: 4 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    gap: 10,
  },
  cardHeader: { gap: 8 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  packName: { fontSize: 17, fontWeight: '700', flex: 1, lineHeight: 22 },
  metaRow: { flexDirection: 'row', gap: 8 },
  tierChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  tierLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  industryChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  industryLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  description: { fontSize: 13, lineHeight: 19 },
  workersSection: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
  workersSectionLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  workersList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  workerChip: { borderRadius: 8, borderWidth: 1, padding: 10, minWidth: '45%', flex: 1 },
  workerName: { fontSize: 13, fontWeight: '600' },
  workerRole: { fontSize: 11, marginTop: 2 },
});
