import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

export type DriverStop = {
  id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  clientName: string;
  dogName: string;
  address: string | null;
  city: string | null;
  instructions: string | null;
};

export type DriverAction = 'navigate' | 'arrived' | 'picked_up' | 'completed' | 'problem';

type Props = {
  stops: DriverStop[];
  onAction: (stopId: string, action: DriverAction) => Promise<void>;
};

function addressLine(stop: DriverStop): string | null {
  const parts = [stop.address, stop.city].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function DriverRouteView({ stops, onAction }: Props) {
  const fire = (stop: DriverStop, action: DriverAction) => onAction(stop.id, action);
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);

  return (
    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {ordered.map((stop) => {
        const done = stop.status === 'completed' || stop.status === 'skipped';
        const address = addressLine(stop);
        return (
          <View key={stop.id} style={[styles.card, done && styles.cardDone]}>
            <View style={styles.rowTop}>
              <Text style={styles.title}>{stop.sequence}. {stop.clientName} · {stop.dogName}</Text>
              <StatusBadge status={stop.status} />
            </View>
            {address ? <Text style={styles.address}>{address}</Text> : null}
            {stop.instructions ? <View style={styles.instructions}><Text style={styles.instructionsLabel}>ACCESS INSTRUCTIONS</Text><Text style={styles.instructionsText}>{stop.instructions}</Text></View> : null}
            {!done ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`Navigate to ${stop.dogName}`} onPress={() => fire(stop, 'navigate')} style={[styles.action, styles.actionDark]}>
                  <Text style={styles.actionDarkText}>Navigate</Text>
                </Pressable>
                {stop.status === 'pending' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Mark arrived ${stop.id}`} onPress={() => fire(stop, 'arrived')} style={[styles.action, styles.actionGold]}>
                    <Text style={styles.actionGoldText}>Arrived</Text>
                  </Pressable>
                ) : null}
                {stop.status === 'arrived' ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Picked up ${stop.dogName}`} onPress={() => fire(stop, 'picked_up')} style={[styles.action, styles.actionGold]}>
                      <Text style={styles.actionGoldText}>Dog picked up</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Problem ${stop.id}`} onPress={() => fire(stop, 'problem')} style={[styles.action, styles.actionProblem]}>
                      <Text style={styles.actionProblemText}>Problem</Text>
                    </Pressable>
                  </>
                ) : null}
                {stop.status === 'picked_up' ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Complete ${stop.id}`} onPress={() => fire(stop, 'completed')} style={[styles.action, styles.actionGold]}>
                    <Text style={styles.actionGoldText}>Completed</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function StatusBadge({ status }: { status: DriverStop['status'] }) {
  const labels: Record<DriverStop['status'], string> = {
    pending: 'Pending', arrived: 'Arrived', picked_up: 'Dog picked up', completed: 'Completed', skipped: 'Skipped',
  };
  const colorsByStatus: Record<DriverStop['status'], string> = {
    pending: '#8A6D1F', arrived: colors.forest700, picked_up: '#4E8D5C', completed: '#4E8D5C', skipped: colors.muted,
  };
  return <Text style={[styles.badge, { color: colorsByStatus[status], backgroundColor: `${colorsByStatus[status]}18` }]}>{labels[status]}</Text>;
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 12 },
  cardDone: { opacity: 0.55 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, flex: 1 },
  badge: { fontSize: 11, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  address: { color: colors.ink, fontSize: 13, marginTop: 6 },
  instructions: { backgroundColor: '#FBF6E8', borderWidth: 1, borderColor: '#EADFB8', borderRadius: 12, padding: 11, marginTop: 10 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  action: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 120 },
  actionDark: { backgroundColor: colors.forest700 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  actionProblem: { backgroundColor: '#FBEAE6' },
  actionProblemText: { color: colors.urgency, fontWeight: '900', fontSize: 13 },
});
