/**
 * SpecialistMessageBubble — Sprint 10 (Task C4)
 *
 * Renders a specialist update message in the mobile conversation view.
 * Detects messages with structuredContent.data.isSpecialistUpdate=true and
 * renders them with a distinct specialist badge and styled content.
 *
 * Usage:
 *   Import and call renderMessage(msg) — it returns the correct component
 *   for specialist messages or null for regular messages (caller handles normal rendering).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  senderType: string;
  workforceRoleCode?: string;
  messageType: string;
  content: string;
  structuredContent?: Record<string, unknown> | null;
  createdAt: string;
}

interface SpecialistUpdateData {
  specialistRole: string;
  confidence: number;
  isSpecialistUpdate: boolean;
  findingCount?: number;
  hasUnresolvedQuestions?: boolean;
}

// ─── Badge colour map ─────────────────────────────────────────────────────────

const BADGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  compliance_officer:  { bg: '#3B0A0A', border: '#7F1D1D', text: '#FCA5A5' },
  operations_manager:  { bg: '#0A1929', border: '#1E3A5F', text: '#93C5FD' },
  document_specialist: { bg: '#1A0A3B', border: '#4C1D95', text: '#C4B5FD' },
  chief_of_staff:      { bg: '#022C22', border: '#065F46', text: '#6EE7B7' },
  research_specialist: { bg: '#0A2233', border: '#155E75', text: '#67E8F9' },
  executive_assistant: { bg: '#0F172A', border: '#3730A3', text: '#A5B4FC' },
  quality_officer:     { bg: '#2D0A1E', border: '#831843', text: '#F9A8D4' },
  hr_officer:          { bg: '#292400', border: '#78350F', text: '#FCD34D' },
  finance_officer:     { bg: '#042829', border: '#134E4A', text: '#5EEAD4' },
  operations_officer:  { bg: '#082239', border: '#075985', text: '#7DD3FC' },
  marketing_officer:   { bg: '#2D0614', border: '#9F1239', text: '#FDA4AF' },
};

const DEFAULT_BADGE = { bg: '#112033', border: '#1E3A5F', text: '#94A3B8' };

const ROLE_LABELS: Record<string, string> = {
  compliance_officer:  'Compliance Officer',
  operations_manager:  'Operations Manager',
  document_specialist: 'Document Specialist',
  chief_of_staff:      'Chief of Staff',
  research_specialist: 'Research Specialist',
  executive_assistant: 'Executive Assistant',
  quality_officer:     'Quality Officer',
  hr_officer:          'HR Officer',
  finance_officer:     'Finance Officer',
  operations_officer:  'Operations Officer',
  marketing_officer:   'Marketing Officer',
};

// ─── Helper: detect specialist update ─────────────────────────────────────────

export function isSpecialistUpdateMessage(msg: ConversationMessage): boolean {
  const sc = msg.structuredContent;
  if (!sc || typeof sc !== 'object') return false;
  const scType = sc.type as string | undefined;
  const scData = sc.data as Record<string, unknown> | undefined;
  return scType === 'specialist_update' && scData?.isSpecialistUpdate === true;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SpecialistMessageBubbleProps {
  msg: ConversationMessage;
}

export function SpecialistMessageBubble({ msg }: SpecialistMessageBubbleProps) {
  const sc = msg.structuredContent as Record<string, unknown> | null | undefined;
  const scData = (sc?.data ?? {}) as Record<string, unknown>;
  const updateData = scData as unknown as SpecialistUpdateData;

  const roleCode = updateData.specialistRole ?? msg.workforceRoleCode ?? 'chief_of_staff';
  const confidence = typeof updateData.confidence === 'number' ? updateData.confidence : 0;
  const roleLabel = ROLE_LABELS[roleCode] ?? roleCode.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const badgeColor = BADGE_COLORS[roleCode] ?? DEFAULT_BADGE;
  const confidencePct = Math.round(confidence * 100);

  // Parse content: first line is header, rest is body
  const contentLines = msg.content.split('\n');
  const rawHeader = contentLines[0] ?? '';
  // Strip markdown bold markers from header
  const header = rawHeader.replace(/\*\*/g, '');
  const body = contentLines.slice(1).join('\n').trim();

  const time = new Date(msg.createdAt).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={styles.container}>
      {/* Specialist badge */}
      <View
        style={[
          styles.badge,
          { backgroundColor: badgeColor.bg, borderColor: badgeColor.border },
        ]}
      >
        <View style={[styles.badgeDot, { backgroundColor: badgeColor.text }]} />
        <Text style={[styles.badgeText, { color: badgeColor.text }]}>
          {roleLabel}
        </Text>
        <Text style={[styles.badgeSeparator, { color: badgeColor.text }]}>·</Text>
        <Text style={[styles.badgeText, { color: badgeColor.text }]}>
          {confidencePct}% confidence
        </Text>
      </View>

      {/* Message bubble */}
      <View style={styles.bubble}>
        {/* Header line */}
        <Text style={styles.headerText}>{header}</Text>

        {/* Body */}
        {!!body && (
          <Text style={styles.bodyText}>{body}</Text>
        )}
      </View>

      {/* Timestamp */}
      <Text style={styles.timestamp}>{time}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    marginBottom: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 6,
    gap: 4,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    opacity: 0.8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  badgeSeparator: {
    fontSize: 10,
    opacity: 0.5,
  },
  bubble: {
    backgroundColor: '#0D1829',
    borderColor: '#1E3A5F',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  headerText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  bodyText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
  },
  timestamp: {
    color: '#475569',
    fontSize: 10,
    marginTop: 4,
    paddingHorizontal: 2,
  },
});
