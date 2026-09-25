import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, formatDayLabel } from '@/features/calendar/dates';
import { DogPicker } from '@/features/calendar/DogPicker';
import type { DogRef } from '@/features/calendar/dayMath';
import { frescorDaPosicao, isPastDeadline, nextStopEta } from '@/features/driver/eta';
import { TimeWheel } from '@/features/dispatch/TimeWheel';
import { colors, radii } from '@/features/theme/tokens';
import { StopProofChips } from '@/features/dispatch/ProofViewer';
import { showAlert } from '@/features/ui/alert';
import { plural } from '@/lib/plural';

export type DispatchConstraint = {
  windowStart: string | null;
  windowEnd: string | null;
  exactTime: string | null;
  priority: 'normal' | 'priority';
};

export const EMPTY_CONSTRAINT: DispatchConstraint = { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' };

export type DispatchDriver = { id: string; name: string };
export type DispatchStopItem = {
  dogId: string;
  clientName: string;
  dogName: string;
  reservationKind?: string;
  /**
   * Cão em boarding que também faz daycare no dia: já começa o dia DENTRO da van, então não pede
   * pickup. Aparece numa seção separada para o gestor incluir à mão quando ele tiver de voltar para
   * casa (áudio do cliente, 23/09/2026).
   */
  inVan?: boolean;
  /**
   * Cão que o gestor adicionou À MÃO, fora do calendário do dia ("Add any dog"). O app não inventa
   * reserva — a parada existe só na rota. Pedido do dono (23/09/2026): o admin tem de conseguir
   * puxar qualquer cão do cadastro para o Total Pack, mesmo sem reserva no dia.
   */
  extra?: boolean;
};
export type DispatchRouteStop = DispatchStopItem & {
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  latitude: number | null;
  longitude: number | null;
  /** Caminhos das fotos de comprovante no bucket privado (migration 020). */
  pickupProofPath?: string | null;
  dropoffProofPath?: string | null;
} & DispatchConstraint;
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
  driverLocations?: Record<string, { latitude: number; longitude: number; updatedAt: string }>;
  onAssign: (dogId: string, driverId: string, constraint: DispatchConstraint) => Promise<void>;
  onSaveStop: (routeId: string, dogId: string, constraint: DispatchConstraint) => Promise<void>;
  onRemoveStop: (routeId: string, dogId: string) => Promise<void>;
  onMoveStop: (routeId: string, dogId: string, direction: -1 | 1) => Promise<void>;
  onOptimize: (routeId: string) => Promise<void>;
  onPublish: (routeId: string) => Promise<void>;
  onUnpublish: (routeId: string) => Promise<void>;
  onCancelRoute: (routeId: string) => Promise<void>;
  onCompleteRoute: (routeId: string) => Promise<void>;
  onDateChange: (date: string) => void;
  /** Cães do cadastro, para o gestor adicionar um que não está no calendário do dia. */
  dogs?: DogRef[];
  onAddExtraDog?: (dog: DogRef) => void;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function DispatchBoard({ date, drivers, dayItems, routes, driverLocations = {}, onAssign, onSaveStop, onRemoveStop, onMoveStop, onOptimize, onPublish, onUnpublish, onCancelRoute, onCompleteRoute, onDateChange, dogs = [], onAddExtraDog }: Props) {
  const [sheet, setSheet] = useState<SheetState>(null);
  const [buscaCao, setBuscaCao] = useState(false);
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
  /** Fila principal: precisa de transporte e não está já na van. */
  const paraTransporte = dayItems.filter((item) => !item.inVan);
  const unassigned = paraTransporte.filter((item) => !assignedDogIds.has(item.dogId));
  /** Seção separada: já estão na van (sem pickup), mas o gestor pode incluir na rota à mão. */
  const naVan = dayItems.filter((item) => item.inVan && !assignedDogIds.has(item.dogId));
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
    showAlert('Remove stop', `Remove ${label} from the route?`, [
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
        <Text style={styles.summary}>
          {plural(dayItems.length, 'transport dog', 'transport dogs')} · {plural(drivers.length, 'driver', 'drivers')}
        </Text>
      </View>
      <ScrollView automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {drivers.map((driver) => {
          const route = routesByDriver.get(driver.id);
          const stops = route ? [...route.stops].sort((a, b) => a.sequence - b.sequence) : [];
          const location = driverLocations[driver.id];
          // Idade da última posição: a tela avisa quando fica velha e ESCONDE o ETA quando é antiga
          // demais (melhoria 3 da revisão das contas) — número calculado de posição velha engana.
          const frescor = location ? frescorDaPosicao(location.updatedAt) : null;
          const eta = route && stops.length > 0
            ? nextStopEta(
                stops.map((stop) => ({
                  id: stop.dogId,
                  sequence: stop.sequence,
                  clientName: stop.clientName,
                  dogName: stop.dogName,
                  latitude: stop.latitude,
                  longitude: stop.longitude,
                  windowEnd: stop.windowEnd,
                  exactTime: stop.exactTime,
                  status: stop.status,
                })),
                location ? { latitude: location.latitude, longitude: location.longitude } : null,
              )
            : null;
          return (
            <View key={driver.id} style={styles.driverCard}>
              <View style={styles.driverHeader}>
                <View style={styles.driverIdentity}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{driver.name[0]}</Text></View>
                  {/* Precisa de flex:1 (e minWidth:0): sem isso, numa tela estreita os QUATRO botoes
                      de acao consomem a linha e sobram ~48pt para o texto - o nome do motorista
                      quebra LETRA POR LETRA (relato do dono no iPhone, 12/09/2026). */}
                  <View style={styles.driverText} testID="driver-info">
                    <Text style={styles.driverName}>{driver.name}</Text>
                    <Text style={styles.muted}>{stops.length} stop{stops.length === 1 ? '' : 's'}{route?.status === 'published' ? ' · Published' : route ? ' · Draft' : ''}</Text>
                    {route && stops.length > 0 ? (
                      <Text style={[styles.muted, eta?.lateMinutes || frescor?.velha ? styles.lateText : null]}>
                        {location && frescor
                          ? `📍 ${frescor.texto}${frescor.muitoVelha ? ' · ⚠️ position stale' : frescor.velha ? ' · ⚠️ going stale' : ''}`
                          : '📍 not sharing'}
                        {eta && !frescor?.muitoVelha ? ` · ~${eta.minutes} min to ${eta.dogName}` : ''}
                        {eta && frescor?.muitoVelha ? ' · ETA hidden (position too old)' : ''}
                        {eta && eta.lateMinutes > 0 ? ` · ⚠️ ${eta.lateMinutes} min late` : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {route && stops.length > 0 ? (
                  <View style={styles.driverActions} testID="driver-actions">
                    {stops.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped').length >= 2 ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={`Optimize ${driver.name} route`} disabled={working} onPress={() => void onOptimize(route.routeId)} style={styles.optimizeButton}>
                        <Text style={styles.optimizeText}>Optimize</Text>
                      </Pressable>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={`Publish ${driver.name} route`} disabled={working} onPress={() => void onPublish(route.routeId)} style={styles.publishButton}>
                      <Text style={styles.publishText}>{route.status === 'published' ? 'Republish' : 'Publish'}</Text>
                    </Pressable>
                    {route.status === 'published' ? (
                      <>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Unpublish ${driver.name} route`} disabled={working} onPress={() => void onUnpublish(route.routeId)} style={styles.unpublishButton}>
                          <Text style={styles.unpublishText}>Unpublish</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Complete ${driver.name} route`} disabled={working} onPress={() => void onCompleteRoute(route.routeId)} style={styles.completeButton}>
                          <Text style={styles.completeText}>✓ Done</Text>
                        </Pressable>
                      </>
                    ) : null}
                    <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${driver.name} route`} disabled={working} onPress={() => void onCancelRoute(route.routeId)} style={styles.cancelRouteButton}>
                      <Text style={styles.cancelRouteText}>✕</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              {stops.map((stop, index) => (
                <View key={`${driver.id}-${stop.dogId}`} style={styles.stop}>
                  <View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View>
                  <View style={styles.stopMain}>
                    <Text style={styles.stopName}>{stop.clientName} · {stop.dogName}</Text>
                    <View style={styles.badgeRow}>
                      {stop.status === 'skipped' ? <Badge text="⚠ Problem" color={colors.urgency} /> : null}
                      {stop.status === 'pending' && isPastDeadline(stop.windowEnd, stop.exactTime) ? <Badge text="Late" color={colors.urgency} /> : null}
                      {stop.priority === 'priority' ? <Badge text="⚡ High" color={colors.urgency} /> : null}
                      {stop.windowStart && stop.windowEnd ? <Badge text={`⏰ ${stop.windowStart}–${stop.windowEnd}`} color={colors.forest500} /> : null}
                      {stop.exactTime ? <Badge text={`@ ${stop.exactTime}`} color={colors.gold} /> : null}
                    </View>
                    <StopProofChips pickupPath={stop.pickupProofPath} dropoffPath={stop.dropoffProofPath} />
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
          {paraTransporte.length === 0 ? (
            <Text style={styles.muted}>No transport dogs need a ride today.</Text>
          ) : unassigned.length === 0 ? (
            <Text style={styles.muted}>Every transport dog is assigned. 🎉</Text>
          ) : null}
          {unassigned.map((item) => (
            <Pressable key={item.dogId} accessibilityRole="button" accessibilityLabel={`Assign ${item.clientName} · ${item.dogName}`} onPress={() => setSheet({ mode: 'assign', item })} style={styles.chip}>
              <Text style={styles.chipText}>{item.clientName} · {item.dogName}{item.extra ? ' · manual' : ''}</Text>
            </Pressable>
          ))}
          {onAddExtraDog ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add any dog" onPress={() => setBuscaCao(true)} style={styles.chipAdd}>
              <Text style={styles.chipAddText}>＋ Add any dog (not in the calendar)</Text>
            </Pressable>
          ) : null}
        </View>

        {/*
          Cão em boarding que também faz daycare no dia: já acorda dentro da van, então não pede
          pickup (pedido do cliente, 23/09/2026). Fica AQUI, e não na fila de cima, porque o gestor
          ainda pode precisar incluí-lo na rota — quando ele tiver de voltar para casa.
        */}
        {naVan.length > 0 ? (
          <View style={styles.unassigned} testID="dispatch-ja-na-van">
            <Text style={styles.unassignedTitle}>Boarding — already in the van</Text>
            <Text style={styles.muted}>
              They start the day in the van, so they don&apos;t need a pickup. Add one only if it has to go back
              home today.
            </Text>
            {naVan.map((item) => (
              <Pressable
                key={item.dogId}
                accessibilityRole="button"
                accessibilityLabel={`Add boarding ${item.clientName} · ${item.dogName}`}
                onPress={() => setSheet({ mode: 'assign', item })}
                style={[styles.chip, styles.chipVan]}
              >
                <Text style={styles.chipText}>{item.clientName} · {item.dogName}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/*
        "Add any dog": o gestor puxa um cão do cadastro que NÃO está no calendário do dia (chegou de
        última hora, ou o transporte não foi marcado na reserva). Não inventa reserva: a parada vive
        só na rota. Pedido do dono (23/09/2026) — controle do Total Pack sem depender do calendário.
      */}
      <Modal visible={buscaCao} transparent animationType="fade" onRequestClose={() => setBuscaCao(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add any dog</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setBuscaCao(false)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              Straight from the registry — no reservation needed today. The stop is created only on the route.
            </Text>
            <DogPicker
              dogs={dogs}
              selected={null}
              hint="Search by dog or client"
              onSelect={(dog) => { onAddExtraDog?.(dog); setBuscaCao(false); }}
            />
          </View>
        </View>
      </Modal>

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
                  <TimeTargetButton label="From" accessibilityLabel="Window start" value={windowStart} active={timeTarget === 'from'} half onPress={() => setTimeTarget((current) => (current === 'from' ? null : 'from'))} />
                  <TimeTargetButton label="Until" accessibilityLabel="Window end" value={windowEnd} active={timeTarget === 'until'} half onPress={() => setTimeTarget((current) => (current === 'until' ? null : 'until'))} />
                </View>
                {timeTarget === 'from' ? (
                  <TimeWheel testID="time-picker-from" value={windowStart || null} onChange={setWindowStart} onDone={() => setTimeTarget(null)} />
                ) : null}
                {timeTarget === 'until' ? (
                  <TimeWheel testID="time-picker-until" value={windowEnd || null} onChange={setWindowEnd} onDone={() => setTimeTarget(null)} />
                ) : null}
              </>
            ) : null}
            {kind === 'exact' ? (
              <>
                <TimeTargetButton label="Exact time" accessibilityLabel="Exact time input" value={exactTime} active={timeTarget === 'exact'} onPress={() => setTimeTarget((current) => (current === 'exact' ? null : 'exact'))} />
                {timeTarget === 'exact' ? (
                  <TimeWheel testID="time-picker-exact" value={exactTime || null} onChange={setExactTime} onDone={() => setTimeTarget(null)} />
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

function TimeTargetButton({ label, accessibilityLabel, value, active, onPress, half }: { label: string; accessibilityLabel: string; value: string; active: boolean; onPress: () => void; half?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={[styles.timeTarget, half && styles.timeTargetHalf, active && styles.timeTargetActive]}>
      <Text style={styles.timeTargetLabel}>{label}</Text>
      <Text style={[styles.timeTargetValue, !value && styles.timeTargetPlaceholder]}>{value || 'Select…'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  scroll: { flex: 1, backgroundColor: colors.cream },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 24, fontWeight: '800', textTransform: 'capitalize' },
  arrow: { width: 42, height: 38, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.gold, fontSize: 30, fontWeight: '700', lineHeight: 32 },
  summary: { color: '#D7E1D4', fontSize: 12, marginTop: 2 },
  content: { padding: 14, paddingBottom: 30 },
  driverCard: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12 },
  driverHeader: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FAFBF8', borderBottomWidth: 1, borderBottomColor: colors.line },
  driverIdentity: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1, minWidth: 200 },
  driverText: { flex: 1, minWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.forest700, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '900' },
  driverName: { fontWeight: '900', color: colors.ink },
  muted: { color: colors.muted, fontSize: 11 },
  lateText: { color: colors.urgency, fontWeight: '800' },
  publishButton: { backgroundColor: colors.gold, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  publishText: { color: colors.forest900, fontWeight: '900', fontSize: 12 },
  unpublishButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  unpublishText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  completeButton: { backgroundColor: '#4E8D5C', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  completeText: { color: 'white', fontWeight: '900', fontSize: 12 },
  cancelRouteButton: { borderWidth: 1, borderColor: '#E8BFBF', backgroundColor: '#FBEDED', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  cancelRouteText: { color: colors.urgency, fontWeight: '900', fontSize: 12 },
  // flexWrap: numa tela estreita os botoes descem para a propria linha em vez de espremer o nome.
  driverActions: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' },
  optimizeButton: { backgroundColor: colors.forest500, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  optimizeText: { color: 'white', fontWeight: '900', fontSize: 12 },
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
  /** Botão "Add any dog": pontilhado como a moldura da fila, para não parecer um cão já listado. */
  chipAdd: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B9C4B9', borderRadius: radii.medium, paddingVertical: 9, paddingHorizontal: 12, marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#FFFFFF' },
  chipAddText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  /** Chip dos cães que já estão na van: fundo mais claro para não confundir com a fila principal. */
  chipVan: { backgroundColor: colors.sage, borderColor: colors.sage },
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
  timeTarget: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'stretch' },
  timeTargetHalf: { flex: 1, alignSelf: 'auto' },
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
