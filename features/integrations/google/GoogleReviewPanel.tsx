import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/features/theme/tokens';
import { ReviewItems, type GoogleReviewState } from './CalendarConnectionCard';

/** Fica fora da rolagem do dia. A barra de abas já reserva o inset inferior do iPhone. */
export function GoogleReviewPanel({ review, selectedDay }: { review: GoogleReviewState | null; selectedDay: string }) {
  const [expanded, setExpanded] = useState(false);
  const items = review?.items.filter((item) => item.date === selectedDay) ?? [];
  if (!items.length || !review) return null;
  const counts = {
    dogs: items.filter((item) => !['unrecognized color', 'purple without schedule', 'duplicate'].includes(item.reason)).length,
    colors: items.filter((item) => item.reason === 'unrecognized color').length,
    duplicates: items.filter((item) => item.reason === 'duplicate').length,
    schedules: items.filter((item) => item.reason === 'purple without schedule').length,
  };
  const summary = `Google: ${[
    counts.dogs ? `${counts.dogs} not registered` : null,
    counts.colors ? `${counts.colors} ${counts.colors === 1 ? 'unrecognized color' : 'unrecognized colors'}` : null,
    counts.duplicates ? `${counts.duplicates} ${counts.duplicates === 1 ? 'duplicate' : 'duplicates'}` : null,
    counts.schedules ? `${counts.schedules} ${counts.schedules === 1 ? 'changed day without schedule' : 'changed days without schedule'}` : null,
  ].filter(Boolean).join(' · ')}`;
  return (
    <View testID="google-review-panel" style={styles.reviewPanel}>
      <Pressable
        testID="google-review-toggle"
        accessibilityRole="button"
        accessibilityLabel={`${summary}, ${expanded ? 'expanded' : 'collapsed'}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.reviewToggle}
      >
        <Text numberOfLines={1} style={styles.reviewSummary}>{summary}</Text>
        <Text style={styles.secondaryText}>{expanded ? '▾' : '▴'}</Text>
      </Pressable>
      {expanded ? (
        <ScrollView testID="google-review-list" style={styles.reviewScroll} contentContainerStyle={styles.reviewContent}>
          <ReviewItems items={items} onChoose={review.onChoose} />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  reviewPanel: { maxHeight: '45%', flexShrink: 1, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  reviewToggle: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewSummary: { flex: 1, color: colors.forest900, fontSize: 12, fontWeight: '700' },
  reviewScroll: { flexShrink: 1 },
  reviewContent: { paddingHorizontal: 16, paddingBottom: 16 },
  secondaryText: { color: colors.forest700, fontWeight: '800' },
});
