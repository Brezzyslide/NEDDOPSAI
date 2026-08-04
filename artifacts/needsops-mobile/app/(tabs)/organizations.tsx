/**
 * Organizations screen — Task #37
 *
 * Updated to:
 *  - Call setSelectedOrg when an org card is tapped
 *  - Show a checkmark indicator on the currently selected org
 *  - Show a "needs selection" banner when the user has multiple orgs and none is chosen
 */
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
import { useColors } from '@/hooks/useColors';
import { StatusBadge } from '@/components/StatusBadge';
import { useOrgContext, OrgSummary } from '@/contexts/OrgContext';

type OrgStatus = 'active' | 'suspended' | 'trial' | 'inactive';
type SubTier = 'starter' | 'professional' | 'enterprise';

const TIER_COLORS: Record<SubTier, string> = {
  starter:      '#6b7896',
  professional: '#3b82f6',
  enterprise:   '#8b5cf6',
};

export default function OrganizationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const {
    orgs,
    selectedOrg,
    isLoading,
    needsSelection,
    setSelectedOrg,
    refreshOrgs,
  } = useOrgContext();

  const renderItem = ({ item }: { item: OrgSummary }) => {
    const isSelected = selectedOrg?.id === item.id;
    const tier = (item.subscriptionTier ?? 'starter') as SubTier;
    const tierColor = TIER_COLORS[tier] ?? colors.mutedForeground;

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: isSelected ? colors.primary : colors.border,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
        activeOpacity={0.7}
        onPress={() => setSelectedOrg(item)}
        accessibilityRole="button"
        accessibilityLabel={`Select ${item.name}`}
        accessibilityState={{ selected: isSelected }}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.orgName, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.rightBadges}>
              {isSelected && (
                <View style={[styles.selectedBadge, { backgroundColor: colors.primary + '20', borderColor: colors.primary + '60' }]}>
                  <Text style={[styles.selectedBadgeText, { color: colors.primary }]}>✓ Active</Text>
                </View>
              )}
              <StatusBadge status={item.status as OrgStatus} />
            </View>
          </View>
          <Text style={[styles.orgSlug, { color: colors.mutedForeground }]}>/{item.slug}</Text>
        </View>
        <View style={styles.cardMeta}>
          {item.industry ? (
            <View style={[styles.chip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[styles.chipText, { color: colors.mutedForeground }]}>
                {(item.industry as string).toUpperCase()}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.chip,
              {
                backgroundColor: tierColor + '20',
                borderColor:     tierColor + '40',
              },
            ]}
          >
            <Text style={[styles.chipText, { color: tierColor }]}>
              {tier.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.userCount, { color: colors.mutedForeground }]}>
            {item.userCount} {item.userCount === 1 ? 'user' : 'users'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={orgs as OrgSummary[]}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.list,
          { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 },
        ]}
        scrollEnabled={orgs.length > 0}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshOrgs}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>TENANT REGISTRY</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>Organizations</Text>
            {orgs.length > 0 && (
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                {orgs.length} organization{orgs.length !== 1 ? 's' : ''}{selectedOrg ? ` · ${selectedOrg.name} selected` : ''}
              </Text>
            )}
            {needsSelection && (
              <View style={[styles.selectionBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
                <Text style={[styles.selectionBannerText, { color: colors.primary }]}>
                  Tap an organisation to make it active across all tabs.
                </Text>
              </View>
            )}
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
  container:            { flex: 1 },
  list:                 { paddingHorizontal: 20, gap: 0 },
  listHeader:           { marginBottom: 20 },
  eyebrow:              { fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  title:                { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  subtitle:             { fontSize: 13, marginTop: 4 },
  selectionBanner:      { marginTop: 12, borderRadius: 8, borderWidth: 1, padding: 10 },
  selectionBannerText:  { fontSize: 13, fontWeight: '500' },
  card:                 { borderRadius: 12, padding: 16, marginBottom: 12, gap: 10 },
  cardHeader:           { gap: 3 },
  cardTitleRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orgName:              { fontSize: 16, fontWeight: '700', flex: 1 },
  orgSlug:              { fontSize: 12, fontFamily: 'Inter_400Regular' },
  rightBadges:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  selectedBadge:        { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
  selectedBadgeText:    { fontSize: 10, fontWeight: '700' },
  cardMeta:             { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip:                 { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  chipText:             { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  userCount:            { fontSize: 12, marginLeft: 'auto' },
  empty:                { marginTop: 60, alignItems: 'center', gap: 8 },
  emptyTitle:           { fontSize: 16, fontWeight: '600' },
  emptySubtitle:        { fontSize: 13, textAlign: 'center' },
});
