import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, formatDayLabel } from '@/features/calendar/dates';
import { TimeGridPicker } from '@/features/dispatch/TimeGridPicker';
import { colors, radii } from '@/features/theme/tokens';

export type DispatchConstraint = {
  windowStart: string | null;
  windowEnd: string | null;
  exactTime: string | null;
  priority: 'normal' | 'priority';
};

export const EMPTY_CONSTRAINT: DispatchConstraint = { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' };

export type DispatchDriver = { id: string; name: string };
export type DispatchStopItem = { dogId: string; clientName: string; dogName: string; reservationKind?: string };
export type DispatchRouteStop = DispatchStopItem & { sequence: number } & DispatchConstraint;
export type DispatchRoute = { routeId: string; driverId: string; status: 'draft' | 'published' | 'completed' | 'cancelled'; stops: DispatchRouteStop[] };

type ConstraintKind = 'none' | 'window' | 'exact';

type SheetState =
  | { mode: 'assign'; item: DispatchStopItem }
  | { mode: 'edit'; route: DispatchRoute; stop: DispatchRouteStop }
  | null;

type Props = {
  date: string;
  drivers: DispatchDriver[];
  dayItems: DispatchStopItem[];
  routes: DispatchRoute[];
  onAssign: (dogId: string, driverId: string, constraint: DispatchConstraint) => Promise<void>;
  onSaveStop: (routeId: string, dogId: string, constraint: DispatchConstraint) => Promise<void>;
  onRemoveStop: (routeId: string, dogId: string) => Promise<void>;
  onMoveStop: (routeId: string, dogId: string, direction: -1 | 1) => Promise<void>;
  onPublish: (routeId: string) => Promise<void>;
  onDateChange: (date: string) => void;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function DispatchBoard({ date, drivers, dayItems, routes, onAssign, onSaveStop, onRemoveStop, onMoveStop, onPublish, onDateChange }: Props) {
  const [sheet, setSheet] = useState<SheetState>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [kind, setKind] = useState<ConstraintKind>('none');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [exactTime, setExactTime] = useState('');
  const [priority, setPriority] = useState<'normal' | 'priority'>('normal');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [timeTarget, setTimeTarget] = useState<'from' | 'until' | 'exact' | null>(null);

  useEffect(() => {
    if (!sheet) return;
    setError(null);
    setTimeTarget(null);
    setKind('none');
    setWindowStart('');
    setWindowEnd('');
    setExactTime('');
    setPriority('normal');
    if (sheet.mode === 'edit') {
      setDriverId(sheet.route.driverId);
      if (sheet.stop.windowStart && sheet.stop.windowEnd) {
        setKind('window');
        setWindowStart(sheet.stop.windowStart);
        setWindowEnd(sheet.stop.windowEnd);
      } else if (sheet.stop.exactTime) {
        setKind('exact');
        setExactTime(sheet.stop.exactTime);
      }
      setPriority(sheet.stop.priority);
    } else {
      setDriverId(null);
    }
  }, [sheet]);

  const assignedDogIds = new Set(routes.flatMap((route) => route.stops.map((stop) => stop.dogId)));
  const unassigned = dayItems.filter((item) => !assignedDogIds.has(item.dogId));
  const routesByDriver = new Map(routes.map((route) => [route.driverId, route]));

  const constraintFromFields = (): DispatchConstraint => {
    if (kind === 'window') return { windowStart, windowEnd, exactTime: null, priority };
    if (kind === 'exact') return { windowStart: null, windowEnd: null, exactTime, priority };
    return { windowStart: null, windowEnd: null, exactTime: null, priority };
  };

  const submit = async () => {
    setError(null);
    if (!sheet) return;
    if (sheet.mode === 'assign' && !driverId) {
      setError('Choose a driver first.');
      return;
    }
    if (kind === 'window') {
      if (!validTime(windowStart) || !validTime(windowEnd)) { setError('Use HH:MM for both window times.'); return; }
      if (windowEnd <= windowStart) { setError('The window end must be after its start.'); return; }
    }
    if (kind === 'exact' && !validTime(exactTime)) { setError('Use HH:MM for the exact time.'); return; }
    setWorking(true);
    try {
      const constraint = constraintFromFields();
      if (sheet.mode === 'assign') {
        await onAssign(sheet.item.dogId, driverId as string, constraint);
      } else if (driverId !== sheet.route.driverId) {
        await onAssign(sheet.stop.dogId, driverId as string, constraint);
      } else {
        await onSaveStop(sheet.route.routeId, sheet.stop.dogId, constraint);
      }
      setSheet(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save.');
    } finally {
      setWorking(false);
    }
  };

  const confirmRemove = (route: DispatchRoute, stop: DispatchRouteStop) => {
    const label = `${stop.clientName} · ${stop.dogName}`;
    Alert.alert('Remove stop', `Remove ${label} from the route?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { setSheet(null); void onRemoveStop(route.routeId, stop.dogId); } },
    ]);
  };

  const sheetTitle = sheet ? (sheet.mode === 'assign' ? `Assign ${sheet.item.clientName} · ${sheet.item.dogName}` : `Edit ${sheet.stop.clientName} · ${sheet.stop.dogName}`) : '';

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
          const stops = route ? [...route.stops].sort((a, b) => a.sequence - b.sequence) : [];
          return (
            <View key={driver.id} style={styles.driverCard}>
              <View style={styles.driverHeader}>
                <View style={styles.driverIdentity}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{driver.name[0]}</Text></View>
                  <View>
                    <Text style={styles.driverName}>{driver.name}</Text>
                    <Text style={styles.muted}>{stops.length} stop{stops.length === 1 ? '' : 's'}{route?.status === 'published' ? ' · Published' : route ? ' · Draft' : ''}</Text>
                  </View>
                </View>
                {route && stops.length > 0 ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Publish ${driver.name} route`} disabled={working} onPress={() => void onPublish(route.routeId)} style={styles.publishButton}>
                    <Text style={styles.publishText}>{route.status === 'published' ? 'Republish' : 'Publish'}</Text>
                  </Pressable>
                ) : null}
              </View>
              {stops.map((stop, index) => (
                <View key={`${driver.id}-${stop.dogId}`} style={styles.stop}>
                  <View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View>
                  <View style={styles.stopMain}>
                    <Text style={styles.stopName}>{stop.clientName} · {stop.dogName}</Text>
                    <View style={styles.badgeRow}>
                      {stop.priority === 'priority' ? <Badge text="⚡ High" color={colors.urgency} /> : null}
                      {stop.windowStart && stop.windowEnd ? <Badge text={`⏰ ${stop.windowStart}–${stop.windowEnd}`} color={colors.forest500} /> : null}
                      {stop.exactTime ? <Badge text={`@ ${stop.exactTime}`} color={colors.gold} /> : null}
                    </View>
                  </View>
                  <View style={styles.stopActions}>
                    {route && route.status === 'draft' && stops.length > 1 ? (
                      <>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${stop.dogName} up`} disabled={working || index === 0} onPress={() => void onMoveStop(route.routeId, stop.dogId, -1)} hitSlop={6}>
                          <Text style={[styles.moveText, index === 0 && styles.moveDisabled]}>▲</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${stop.dogName} down`} disabled={working || index === stops.length - 1} onPress={() => void onMoveStop(route.routeId, stop.dogId, 1)} hitSlop={6}>
                          <Text style={[styles.moveText, index === stops.length - 1 && styles.moveDisabled]}>▼</Text>
                        </Pressable>
                      </>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${stop.dogName}`} onPress={() => route && setSheet({ mode: 'edit', route, stop })} hitSlop={8}>
                      <Text style={styles.optionsText}>⋯</Text>
                    </Pressable>
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
            <Pressable key={item.dogId} accessibilityRole="button" accessibilityLabel={`Assign ${item.clientName} · ${item.dogName}`} onPress={() => setSheet({ mode: 'assign', item })} style={styles.chip}>
              <Text style={styles.chipText}>{item.clientName} · {item.dogName}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={sheet !== null} transparent animationType="fade" onRequestClose={() => setSheet(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setSheet(null)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Driver</Text>
            <View style={styles.driverOptions}>
              {drivers.map((driver) => {
                const active = driver.id === driverId;
                return (
                  <Pressable key={driver.id} accessibilityRole="button" accessibilityLabel={`Driver ${driver.name}`} onPress={() => setDriverId(driver.id)} style={[styles.driverOption, active && styles.driverOptionActive]}>
                    <Text style={[styles.driverOptionText, active && styles.driverOptionTextActive]}>{driver.name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Pickup time</Text>
            <Text style={styles.fieldHint}>No window means the driver can stop at any time.</Text>
            <View style={styles.segmented}>
              {(['none', 'window', 'exact'] as ConstraintKind[]).map((option) => (
                <Pressable key={option} accessibilityRole="button" accessibilityLabel={option === 'none' ? 'Any time' : option === 'window' ? 'Time window' : 'Exact time'} onPress={() => { setKind(option); setTimeTarget(null); }} style={[styles.segment, kind === option && styles.segmentActive]}>
                  <Text style={[styles.segmentText, kind === option && styles.segmentTextActive]}>
                    {option === 'none' ? 'Any time' : option === 'window' ? 'Time window' : 'Exact time'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {kind === 'window' ? (
              <>
                <View style={styles.timeRow}>
                  <TimeTargetButton label="From" accessibilityLabel="Window start" value={windowStart} active={timeTarget === 'from'} onPress={() => setTimeTarget((current) => (current === 'from' ? null : 'from'))} />
                  <TimeTargetButton label="Until" accessibilityLabel="Window end" value={windowEnd} active={timeTarget === 'until'} onPress={() => setTimeTarget((current) => (current === 'until' ? null : 'until'))} />
                </View>
                {timeTarget === 'from' ? (
                  <TimeGridPicker testID="time-picker-from" value={windowStart || null} onChange={setWindowStart} onDone={() => setTimeTarget(null)} />
                ) : null}
                {timeTarget === 'until' ? (
                  <TimeGridPicker testID="time-picker-until" value={windowEnd || null} onChange={setWindowEnd} onDone={() => setTimeTarget(null)} />
                ) : null}
              </>
            ) : null}
            {kind === 'exact' ? (
              <>
                <TimeTargetButton label="Exact time" accessibilityLabel="Exact time input" value={exactTime} active={timeTarget === 'exact'} onPress={() => setTimeTarget((current) => (current === 'exact' ? null : 'exact'))} />
                {timeTarget === 'exact' ? (
                  <TimeGridPicker testID="time-picker-exact" value={exactTime || null} onChange={setExactTime} onDone={() => setTimeTarget(null)} />
                ) : null}
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.driverOptions}>
              {(['normal', 'priority'] as const).map((option) => (
                <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Priority ${option}`} onPress={() => setPriority(option)} style={[styles.driverOption, priority === option && styles.driverOptionActive]}>
                  <Text style={[styles.driverOptionText, priority === option && styles.driverOptionTextActive]}>{option === 'priority' ? '⚡ High' : 'Normal'}</Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Save stop" disabled={working} onPress={() => void submit()} style={styles.saveButton}>
              {working ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.saveText}>{sheet?.mode === 'edit' ? 'Save' : 'Assign'}</Text>}
            </Pressable>
            {sheet?.mode === 'edit' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Remove from route" disabled={working} onPress={() => confirmRemove(sheet.route, sheet.stop)} style={styles.removeButton}>
                <Text style={styles.removeText}>Remove from route</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setSheet(null)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}18` }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

function TimeTargetButton({ label, accessibilityLabel, value, active, onPress }: { label: string; accessibilityLabel: string; value: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={[styles.timeTarget, active && styles.timeTargetActive]}>
      <Text style={styles.timeTargetLabel}>{label}</Text>
      <Text style={[styles.timeTargetValue, !value && styles.timeTargetPlaceholder]}>{value || 'Select…'}</Text>
    </Pressable>
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
  driverIdentity: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
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
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: '900' },
  stopActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moveText: { color: colors.forest700, fontSize: 11, fontWeight: '900' },
  moveDisabled: { color: '#C8CFC9' },
  optionsText: { color: colors.forest700, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  noStops: { color: colors.muted, fontSize: 12, padding: 12 },
  unassigned: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B9C4B9', borderRadius: radii.medium, padding: 13, backgroundColor: '#FAFBF7', marginTop: 4 },
  unassignedTitle: { color: colors.muted, textTransform: 'uppercase', fontWeight: '900', fontSize: 11, marginBottom: 10 },
  chip: { backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 7, borderWidth: 1, borderColor: colors.line },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#0D1B12AA', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 34 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900, flex: 1 },
  sheetClose: { color: colors.muted, fontSize: 17, fontWeight: '800', paddingHorizontal: 6 },
  fieldLabel: { color: colors.ink, fontWeight: '800', fontSize: 11, marginTop: 12, marginBottom: 6 },
  fieldHint: { color: colors.muted, fontSize: 11, marginBottom: 6 },
  driverOptions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  driverOption: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  driverOptionActive: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  driverOptionText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  driverOptionTextActive: { color: 'white' },
  segmented: { flexDirection: 'row', backgroundColor: '#EDE9DC', borderRadius: 12, padding: 4, gap: 0 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segmentActive: { backgroundColor: colors.forest700 },
  segmentText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  segmentTextActive: { color: 'white' },
  timeRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  timeTarget: { flex: 1, backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  timeTargetActive: { borderColor: colors.gold, backgroundColor: '#F8F1E1' },
  timeTargetLabel: { color: colors.muted, fontWeight: '800', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  timeTargetValue: { color: colors.ink, fontWeight: '800', fontSize: 16, marginTop: 3 },
  timeTargetPlaceholder: { color: colors.muted, fontWeight: '500' },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 10 },
  saveButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 16 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  removeButton: { alignItems: 'center', padding: 8, marginTop: 4 },
  removeText: { color: colors.urgency, fontWeight: '800', fontSize: 13 },
  sheetCancel: { alignItems: 'center', padding: 8, marginTop: 2 },
  sheetCancelText: { color: colors.muted, fontWeight: '800' },
});
