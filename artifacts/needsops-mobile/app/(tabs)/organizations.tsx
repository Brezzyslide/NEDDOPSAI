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
import { useListOrganizations } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from '@/components/StatusBadge';

type OrgStatus = 'active' | 'suspended' | 'trial' | 'inactive';
type SubTier = 'starter' | 'professional' | 'enterprise';

const TIER_COLORS: Record<SubTier, string> = {
  starter: '#6b7896',
  professional: '#3b82f6',
  enterprise: '#8b5cf6',
};

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  industry?: string;
  status: OrgStatus;
  subscriptionTier: SubTier;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function OrganizationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, isRefetching } = useListOrganizations();

  const organizations = (data?.items ?? []) as OrgItem[];

  const renderItem = ({ item }: { item: OrgItem }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.orgName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          <StatusBadge status={item.status} />
        </View>
        <Text style={[styles.orgSlug, { color: colors.mutedForeground }]}>/{item.slug}</Text>
      </View>
      <View style={styles.cardMeta}>
        {item.industry ? (
          <View style={[styles.chip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.mutedForeground }]}>
              {item.industry.toUpperCase()}
            </Text>
          </View>
        ) : null}
        <View
          style={[
            styles.chip,
            {
              backgroundColor: (TIER_COLORS[item.subscriptionTier] ?? colors.mutedForeground) + '20',
              borderColor: (TIER_COLORS[item.subscriptionTier] ?? colors.mutedForeground) + '40',
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { color: TIER_COLORS[item.subscriptionTier] ?? colors.mutedForeground },
            ]}
          >
            {item.subscriptionTier.toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.userCount, { color: colors.mutedForeground }]}>
          {item.userCount} {item.userCount === 1 ? 'user' : 'users'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={organizations}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
        ]}
        scrollEnabled={!!organizations.length}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>TENANT REGISTRY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Organizations</Text>
            {data ? (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {data.total} organization{data.total !== 1 ? 's' : ''}
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
                No organizations yet
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
                Organizations will appear here once created
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
  list: { paddingHorizontal: 20, gap: 0 },
  listHeader: { marginBottom: 20 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: { fontSize: 13, marginTop: 4 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  cardHeader: { gap: 3 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orgName: { fontSize: 16, fontWeight: '700', flex: 1 },
  orgSlug: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  userCount: { fontSize: 12, marginLeft: 'auto' },
  empty: { marginTop: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptySubtitle: { fontSize: 13, textAlign: 'center' },
});
