import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RouteMap } from '@/features/maps/RouteMap';
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
  /** Notas do cão que o motorista PRECISA ver (segurança): comportamento e saúde. */
  behaviorNotes?: string | null;
  medicalNotes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  windowEnd?: string | null;
  exactTime?: string | null;
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
    <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      {ordered.length > 0 ? (
        <RouteMap
          stops={ordered.map((stop, index) => ({
            id: stop.id,
            sequence: index + 1,
            dogName: stop.dogName,
            address: addressLine(stop),
            status: stop.status,
            latitude: stop.latitude,
            longitude: stop.longitude,
          }))}
        />
      ) : null}
      {ordered.map((stop, index) => {
        const done = stop.status === 'completed' || stop.status === 'skipped';
        const address = addressLine(stop);
        // O cartao inteiro abre a navegacao. Relato do dono (12/09/2026): "ao clicar nao direciona a
        // aplicativo algum" - antes so o botao Navigate fazia isso, e ele SUMIA quando a parada
        // estava concluida (o bloco de acoes ficava atras de `!done`). Perder a navegacao numa parada
        // concluida e pior: e justamente quando o motorista precisa reconferir o local.
        return (
          <Pressable
            key={stop.id}
            accessibilityRole="button"
            accessibilityLabel={`Open navigation for ${stop.dogName}`}
            onPress={() => fire(stop, 'navigate')}
            style={({ pressed }) => [styles.card, done && styles.cardDone, pressed && styles.cardPressed]}
          >
            <View style={styles.rowTop}>
              {/* Numera pela posicao na rota (1, 2, 3...). O painel do Dispatch ja fazia assim;
                  aqui saia o campo cru do banco, que pode vir 0 ("0. Maria Silva"). */}
              <Text style={styles.title}>{index + 1}. {stop.clientName} · {stop.dogName}</Text>
              <StatusBadge status={stop.status} />
            </View>
            {address ? <Text style={styles.address}>{address}</Text> : null}
            {stop.exactTime ? <Text style={styles.deadline}>⏱ Must arrive by {stop.exactTime}</Text> : stop.windowEnd ? <Text style={styles.deadline}>⏱ Window until {stop.windowEnd}</Text> : null}
            {stop.instructions ? <View style={styles.instructions}><Text style={styles.instructionsLabel}>ACCESS INSTRUCTIONS</Text><Text style={styles.instructionsText}>{stop.instructions}</Text></View> : null}
            {stop.medicalNotes ? <View style={[styles.care, styles.careMedical]}><Text style={[styles.careLabel, styles.careLabelMedical]}>⚠ MEDICAL</Text><Text style={styles.careText}>{stop.medicalNotes}</Text></View> : null}
            {stop.behaviorNotes ? <View style={[styles.care, styles.careBehavior]}><Text style={styles.careLabel}>BEHAVIOR</Text><Text style={styles.careText}>{stop.behaviorNotes}</Text></View> : null}
            <View style={styles.actions}>
              {/* sempre visivel, inclusive para parada concluida */}
              <Pressable accessibilityRole="button" accessibilityLabel={`Navigate to ${stop.dogName}`} onPress={() => fire(stop, 'navigate')} style={[styles.action, styles.actionDark]}>
                <Text style={styles.actionDarkText}>Navigate</Text>
              </Pressable>
              {!done && stop.status === 'pending' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Mark arrived ${stop.id}`} onPress={() => fire(stop, 'arrived')} style={[styles.action, styles.actionGold]}>
                  <Text style={styles.actionGoldText}>Arrived</Text>
                </Pressable>
              ) : null}
              {!done && stop.status === 'arrived' ? (
                <>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Picked up ${stop.dogName}`} onPress={() => fire(stop, 'picked_up')} style={[styles.action, styles.actionGold]}>
                    <Text style={styles.actionGoldText}>Dog picked up</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Problem ${stop.id}`} onPress={() => fire(stop, 'problem')} style={[styles.action, styles.actionProblem]}>
                    <Text style={styles.actionProblemText}>Problem</Text>
                  </Pressable>
                </>
              ) : null}
              {!done && stop.status === 'picked_up' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Complete ${stop.id}`} onPress={() => fire(stop, 'completed')} style={[styles.action, styles.actionGold]}>
                  <Text style={styles.actionGoldText}>Completed</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function StatusBadge({ status }: { status: DriverStop['status'] }) {
  const labels: Record<DriverStop['status'], string> = {
    pending: 'Pending', arrived: 'Arrived', picked_up: 'Dog picked up', completed: 'Completed', skipped: 'Problem',
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
  cardPressed: { opacity: 0.9 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, flex: 1 },
  badge: { fontSize: 11, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  address: { color: colors.ink, fontSize: 13, marginTop: 6 },
  deadline: { color: '#8A6D1F', fontSize: 12, fontWeight: '800', marginTop: 5 },
  instructions: { backgroundColor: '#FBF6E8', borderWidth: 1, borderColor: '#EADFB8', borderRadius: 12, padding: 11, marginTop: 10 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  care: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 8 },
  careMedical: { backgroundColor: '#FDEEEE', borderColor: '#E8BFBF' },
  careBehavior: { backgroundColor: '#F1F4EE', borderColor: '#CFD8C6' },
  careLabel: { color: colors.forest700, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  careLabelMedical: { color: colors.urgency },
  careText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  action: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 120 },
  actionDark: { backgroundColor: colors.forest700 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  actionProblem: { backgroundColor: '#FBEAE6' },
  actionProblemText: { color: colors.urgency, fontWeight: '900', fontSize: 13 },
});
