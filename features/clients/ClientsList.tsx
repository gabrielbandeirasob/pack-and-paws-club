import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import type { ClientWithDogs } from '@/features/clients/types';

type Props = {
  clients: ClientWithDogs[];
  loading: boolean;
  onAddClient: () => void;
};

export function ClientsList({ clients, loading, onAddClient }: Props) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Clients</Text>
        <Text style={styles.subtitle}>Families and dogs under Pack & Paws care.</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Add from Contacts" onPress={onAddClient} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <Text style={styles.addButtonText}>＋ Add from Contacts</Text>
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : clients.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🐶</Text>
            <Text style={styles.emptyTitle}>No clients yet</Text>
            <Text style={styles.emptyText}>Add your first client from the iPhone contacts.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {clients.map((client) => (
              <View key={client.id} style={styles.card}>
                <Text style={styles.clientName}>{client.name}</Text>
                <Text style={styles.muted}>{client.phone || 'No phone number'}</Text>
                <Text style={styles.muted}>{client.address_line_1 ?? ''}{client.address_line_1 && client.city ? ' · ' : ''}{client.city ?? ''}</Text>
                <View style={styles.dogRow}>
                  {client.dogs.map((dog) => (
                    <View key={dog} style={styles.dogChip}><Text style={styles.dogChipText}>{dog}</Text></View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 30, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#D7E1D4', fontSize: 13, marginTop: 6 },
  body: { flex: 1, marginTop: -16 },
  actions: { paddingHorizontal: 18, marginBottom: 6 },
  addButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center' },
  pressed: { opacity: 0.85 },
  addButtonText: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
  center: { marginTop: 60 },
  empty: { alignItems: 'center', paddingHorizontal: 30, marginTop: 70 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 10 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 6 },
  list: { padding: 18, paddingTop: 8, paddingBottom: 90 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 10 },
  clientName: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900 },
  muted: { color: colors.muted, fontSize: 12, marginTop: 3 },
  dogRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  dogChip: { backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  dogChipText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
});
