import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, formatDayLabel } from '@/features/calendar/dates';
import { colors, radii } from '@/features/theme/tokens';

export type DispatchDriver = { id: string; name: string };
export type DispatchStopItem = { dogId: string; clientName: string; dogName: string; reservationKind?: string };
export type DispatchRoute = { driverId: string; status: 'draft' | 'published' | 'completed' | 'cancelled'; stops: DispatchStopItem[] };

type Props = {
  date: string;
  drivers: DispatchDriver[];
  dayItems: DispatchStopItem[];
  routes: DispatchRoute[];
  onAssign: (dogId: string, driverId: string) => Promise<void>;
  onPublish: (driverId: string) => Promise<void>;
  onDateChange: (date: string) => void;
};

export function DispatchBoard({ date, drivers, dayItems, routes, onAssign, onPublish, onDateChange }: Props) {
  const [assigningDog, setAssigningDog] = useState<DispatchStopItem | null>(null);
  const [working, setWorking] = useState(false);

  const assignedDogIds = new Set(routes.flatMap((route) => route.stops.map((stop) => stop.dogId)));
  const unassigned = dayItems.filter((item) => !assignedDogIds.has(item.dogId));
  const routesByDriver = new Map(routes.map((route) => [route.driverId, route]));

  const confirmAssign = async (driverId: string) => {
    if (!assigningDog) return;
    setWorking(true);
    try {
      await onAssign(assigningDog.dogId, driverId);
      setAssigningDog(null);
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DISPATCH</Text>
        <View style={styles.dateRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => onDateChange(addDaysISO(date, -1))} style={styles.arrow}>
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>{formatDayLabel(date)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => onDateChange(addDaysISO(date, 1))} style={styles.arrow}>
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>
        <Text style={styles.summary}>{dayItems.length} transport dogs · {drivers.length} drivers</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {drivers.map((driver) => {
          const route = routesByDriver.get(driver.id);
          const stops = route?.stops ?? [];
          return (
            <View key={driver.id} style={styles.driverCard}>
              <View style={styles.driverHeader}>
                <View style={styles.driverIdentity}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{driver.name[0]}</Text></View>
                  <View>
                    <Text style={styles.driverName}>{driver.name}</Text>
                    <Text style={styles.muted}>{stops.length} stop{stops.length === 1 ? '' : 's'}{route?.status === 'published' ? ' · Published' : ''}</Text>
                  </View>
                </View>
                {stops.length > 0 ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Publish ${driver.name} route`} disabled={working} onPress={() => onPublish(driver.id)} style={styles.publishButton}>
                    <Text style={styles.publishText}>Publish</Text>
                  </Pressable>
                ) : null}
              </View>
              {stops.map((stop, index) => (
                <View key={`${driver.id}-${stop.dogId}`} style={styles.stop}>
                  <View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View>
                  <View style={styles.stopMain}>
                    <Text style={styles.stopName}>{stop.clientName} · {stop.dogName}</Text>
                    {stop.reservationKind ? <Text style={styles.muted}>{stop.reservationKind}</Text> : null}
                  </View>
                </View>
              ))}
              {stops.length === 0 ? <Text style={styles.noStops}>No stops assigned yet.</Text> : null}
            </View>
          );
        })}
        <View style={styles.unassigned}>
          <Text style={styles.unassignedTitle}>{unassigned.length} unassigned</Text>
          {unassigned.length === 0 ? <Text style={styles.muted}>Every transport dog is assigned. 🎉</Text> : null}
          {unassigned.map((item) => (
            <Pressable key={item.dogId} accessibilityRole="button" accessibilityLabel={`Assign ${item.clientName} · ${item.dogName}`} onPress={() => setAssigningDog(item)} style={styles.chip}>
              <Text style={styles.chipText}>{item.clientName} · {item.dogName}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={assigningDog !== null} transparent animationType="fade" onRequestClose={() => setAssigningDog(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAssigningDog(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Assign {assigningDog?.clientName} · {assigningDog?.dogName}</Text>
            {drivers.map((driver) => (
              <Pressable key={driver.id} accessibilityRole="button" accessibilityLabel={`Assign to ${driver.name}`} disabled={working} onPress={() => confirmAssign(driver.id)} style={styles.sheetOption}>
                <Text style={styles.sheetOptionText}>{driver.name}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setAssigningDog(null)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 24, fontWeight: '800', textTransform: 'capitalize' },
  arrow: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.gold, fontSize: 30, fontWeight: '700', lineHeight: 32 },
  summary: { color: '#D7E1D4', fontSize: 12, marginTop: 2 },
  content: { padding: 14, paddingBottom: 30 },
  driverCard: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12 },
  driverHeader: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FAFBF8', borderBottomWidth: 1, borderBottomColor: colors.line },
  driverIdentity: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.forest700, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '900' },
  driverName: { fontWeight: '900', color: colors.ink },
  muted: { color: colors.muted, fontSize: 11 },
  publishButton: { backgroundColor: colors.gold, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  publishText: { color: colors.forest900, fontWeight: '900', fontSize: 12 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderBottomWidth: 1, borderBottomColor: '#F0F1ED' },
  position: { width: 24, height: 24, borderRadius: 8, backgroundColor: '#EDF3EB', alignItems: 'center', justifyContent: 'center' },
  positionText: { color: colors.forest700, fontSize: 11, fontWeight: '900' },
  stopMain: { flex: 1 },
  stopName: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  noStops: { color: colors.muted, fontSize: 12, padding: 12 },
  unassigned: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B9C4B9', borderRadius: radii.medium, padding: 13, backgroundColor: '#FAFBF7', marginTop: 4 },
  unassignedTitle: { color: colors.muted, textTransform: 'uppercase', fontWeight: '900', fontSize: 11, marginBottom: 10 },
  chip: { backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 7, borderWidth: 1, borderColor: colors.line },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#0D1B12AA', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 34 },
  sheetTitle: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900, marginBottom: 14 },
  sheetOption: { backgroundColor: colors.sage, borderRadius: 12, padding: 14, marginBottom: 8 },
  sheetOptionText: { color: colors.forest900, fontWeight: '900', fontSize: 15, textAlign: 'center' },
  sheetCancel: { alignItems: 'center', padding: 10, marginTop: 4 },
  sheetCancelText: { color: colors.muted, fontWeight: '800' },
});
