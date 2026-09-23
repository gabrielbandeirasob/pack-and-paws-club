import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View, type AlertButton } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { DriverRouteView, type DriverAction, type DriverStop } from '@/features/driver/DriverRouteView';
import { nextStopEta, type EtaResult } from '@/features/driver/eta';
import { startLocationSharing, type LocationHandle, type LocationUpdate } from '@/features/driver/locationService';
import {
  captureProofPhoto,
  proofColumn,
  proofErrorMessage,
  proofKindForAction,
  proofPath,
  proofRequired,
  uploadProof,
  type ProofChoice,
  type ProofKind,
  type ProofSettings,
} from '@/features/driver/proofCapture';
import {
  applyPendingEvents,
  clearRouteSnapshot,
  enqueueEvent,
  isNetworkError,
  loadOutbox,
  loadRouteSnapshot,
  saveOutbox,
  saveRouteSnapshot,
  type DriverEventStatus,
} from '@/features/driver/offlineStore';
import { colors, radii } from '@/features/theme/tokens';
import { NavigationSheet } from '@/features/maps/NavigationSheet';
import type { NavTarget } from '@/features/maps/links';
import { navigationUrlFor, type NavApp } from '@/features/maps/navigation';
import { loadPreferredNavApp, savePreferredNavApp } from '@/features/maps/preferences';
import { rowToStop, type DriverRouteRow, type DriverStopRow } from '@/features/driver/rows';
import { supabase } from '@/lib/supabase';

type StopRow = DriverStopRow;
type RouteResult = DriverRouteRow;

/**
 * Pergunta ao motorista de onde vem a foto. Obrigatório não oferece pular; opcional oferece;
 * desistir (fora do alerta) devolve 'cancel' e o passo não é marcado.
 */
function askProofChoice(required: boolean): Promise<ProofChoice | 'skip' | 'cancel'> {
  return new Promise((resolve) => {
    const buttons: AlertButton[] = [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from library', onPress: () => resolve('library') },
    ];
    if (!required) buttons.push({ text: 'No photo', onPress: () => resolve('skip') });
    Alert.alert(
      required ? 'Proof photo required' : 'Attach a proof photo?',
      required
        ? 'This stop only moves forward with a photo.'
        : 'You can attach a photo now, or skip and add it later.',
      buttons,
      { cancelable: true, onDismiss: () => resolve('cancel') },
    );
  });
}

export default function DriverTodayScreen() {
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [navTarget, setNavTarget] = useState<{ stopId: string; target: NavTarget } | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  const [eta, setEta] = useState<EtaResult | null>(null);
  /** Configuração da creche (migration 020): o comprovante é obrigatório em cada etapa? */
  const [proofSettings, setProofSettings] = useState<ProofSettings | null>(null);
  const locationHandle = useRef<LocationHandle | null>(null);
  const realtimeRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncOutbox = useCallback(async (): Promise<boolean> => {
    const events = await loadOutbox();
    if (events.length === 0) {
      setPendingSync(0);
      return true;
    }
    const remaining: typeof events = [];
    for (const event of events) {
      // Comprovante pendente: sobe a foto ANTES de aplicar o status.
      let prova: Record<string, unknown> = {};
      if (event.proof) {
        try {
          const caminho = await uploadProof(supabase, event.proof.localUri, event.proof.path);
          prova = {
            [proofColumn(event.proof.kind, 'path')]: caminho,
            [proofColumn(event.proof.kind, 'at')]: event.proof.capturedAt,
          };
        } catch (reason) {
          const texto = reason instanceof Error ? reason.message : String(reason ?? '');
          if (isNetworkError(texto)) {
            // Sem rede: guarda o evento COM a foto para tentar de novo depois.
            remaining.push(event, ...events.slice(events.indexOf(event) + 1));
            break;
          }
          // Erro que não é de rede (permissão/arquivo): não deixa o passo preso para sempre -
          // aplica o status sem a foto.
        }
      }
      const { error } = await supabase
        .from('route_stops')
        .update({ status: event.status, ...prova })
        .eq('id', event.stopId);
      if (error) {
        if (isNetworkError(error.message)) {
          remaining.push(event, ...events.slice(events.indexOf(event) + 1));
          break;
        }
        continue;
      }
    }
    await saveOutbox(remaining);
    setPendingSync(remaining.length);
    return remaining.length === 0;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const events = await loadOutbox();
    setPendingSync(events.length);

    let snapshot = await loadRouteSnapshot();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: routes, error } = await supabase
        .from('routes')
        .select('id, organization_id, published_at, organization:organizations(proof_pickup_required, proof_dropoff_required), route_stops(id, sequence, status, window_end, exact_time, pickup_proof_path, dropoff_proof_path, dog:dogs(id, name, behavior_notes, medical_notes, photo_url, client:clients(name, address_line_1, city, latitude, longitude, client_instructions(pickup_access_instructions))))')
        .eq('driver_id', user?.id ?? '')
        .eq('route_date', todayLocalISO())
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const route = (routes as unknown as RouteResult[] | null)?.[0];
      if (route) {
        const mapped = ((route.route_stops ?? []) as StopRow[]).map(rowToStop);
        snapshot = { savedAt: new Date().toISOString(), publishedAt: route.published_at, stops: mapped };
        await saveRouteSnapshot(snapshot);
        setRouteId(route.id);
        setOrganizationId(route.organization_id);
      setProofSettings(route.organization ?? null);
        setOffline(false);
      } else {
        // Route finished/not published: drop the cached copy (sensitive instructions must not linger).
        await clearRouteSnapshot();
        setRouteId(null);
        setOrganizationId(null);
      }
      // Retention: prune stale positions opportunistically.
      void supabase.rpc('cleanup_driver_locations');
    } catch (reason) {
      if (!isNetworkError(reason)) {
        setMessage(reason instanceof Error ? reason.message : 'Unable to load your route.');
        setLoading(false);
        return;
      }
      setOffline(true);
      snapshot = await loadRouteSnapshot();
    }

    const synced = await syncOutbox();
    if (!synced) setOffline(true);

    if (!snapshot) {
      setStops([]);
      setPublishedAt(null);
      setOffline(false);
      setLoading(false);
      return;
    }
    setPublishedAt(snapshot.publishedAt);
    setStops(applyPendingEvents(snapshot.stops, events));
    setLoading(false);
  }, [syncOutbox]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Realtime: route/stops changes from the manager push into the driver screen immediately.
  useEffect(() => {
    let channel = supabase.channel(`driver-route-${routeId ?? 'today'}`);
    const scheduleReload = () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      realtimeRefresh.current = setTimeout(() => void load(), 800);
    };
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'routes' }, scheduleReload);
    if (routeId) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops', filter: `route_id=eq.${routeId}` }, scheduleReload);
    }
    channel.subscribe();
    return () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      void supabase.removeChannel(channel);
    };
  }, [routeId, load]);

  // Location sharing only while a published route is active.
  useEffect(() => {
    if (!routeId || !organizationId) {
      locationHandle.current?.stop();
      locationHandle.current = null;
      setPosition(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const handle = await startLocationSharing((update) => {
        if (cancelled) return;
        setPosition(update);
        void supabase.auth.getUser().then(({ data: { user } }) => {
          if (!user) return;
          void supabase.from('driver_locations').upsert(
            {
              route_id: routeId,
              organization_id: organizationId,
              driver_id: user.id,
              latitude: update.latitude,
              longitude: update.longitude,
              recorded_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'route_id' },
          );
        });
      });
      if (cancelled) {
        handle?.stop();
        return;
      }
      locationHandle.current = handle;
    })();
    return () => {
      cancelled = true;
      locationHandle.current?.stop();
      locationHandle.current = null;
    };
  }, [routeId, organizationId]);

  // ETA for the next pending stop, recalculated as position/time change.
  useEffect(() => {
    const compute = () => setEta(nextStopEta(stops, position));
    compute();
    const timer = setInterval(compute, 60_000);
    return () => clearInterval(timer);
  }, [stops, position]);

  const act = async (stopId: string, action: DriverAction) => {
    setMessage(null);
    if (action === 'navigate') {
      const stop = stops.find((candidate) => candidate.id === stopId);
      const query = [stop?.address, stop?.city].filter(Boolean).join(', ');
      const target: NavTarget = {
        address: query || null,
        latitude: typeof stop?.latitude === 'number' ? stop.latitude : null,
        longitude: typeof stop?.longitude === 'number' ? stop.longitude : null,
      };
      if (!target.address && (target.latitude === null || target.longitude === null)) {
        setMessage('This stop has no address to navigate to.');
        return;
      }
      // O app não navega: redireciona para o mapa escolhido pelo motorista (Google ou Apple).
      const preferred = await loadPreferredNavApp();
      if (preferred) {
        await Linking.openURL(navigationUrlFor(preferred, target));
        return;
      }
      setNavTarget({ stopId, target });
      return;
    }
    const statusMap: Partial<Record<DriverAction, DriverEventStatus>> = {
      arrived: 'arrived', picked_up: 'picked_up', completed: 'completed', problem: 'skipped',
    };
    const status = statusMap[action];
    if (!status) return;

    // Comprovante de entrega (migration 020): a foto é tirada ANTES de marcar o passo.
    // Obrigatório bloqueia, opcional só oferece, e sem configuração carregada o motorista
    // nunca fica preso num passo.
    const proofKind = proofKindForAction(action);
    let proof: { kind: ProofKind; localUri: string; path: string; capturedAt: string } | null = null;
    if (proofKind && organizationId) {
      const required = proofRequired(proofKind, proofSettings);
      const choice = await askProofChoice(required);
      if (choice === 'cancel') return;
      if (choice !== 'skip') {
        try {
          const localUri = await captureProofPhoto(choice);
          if (localUri) {
            proof = {
              kind: proofKind,
              localUri,
              path: proofPath(organizationId, stopId, proofKind, localUri),
              capturedAt: new Date().toISOString(),
            };
          } else if (required) {
            setMessage('The proof photo is required to finish this stop.');
            return;
          }
        } catch (reason) {
          setMessage(proofErrorMessage(reason));
          if (required) return;
        }
      }
    }

    setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, status } : stop)));

    try {
      const atualizacao: Record<string, unknown> = { status };
      if (proof) {
        // Sobe a foto e grava o caminho junto do status: uma única escrita no banco.
        const caminho = await uploadProof(supabase, proof.localUri, proof.path);
        atualizacao[proofColumn(proof.kind, 'path')] = caminho;
        atualizacao[proofColumn(proof.kind, 'at')] = proof.capturedAt;
      }
      const { error } = await supabase.from('route_stops').update(atualizacao).eq('id', stopId);
      if (error) {
        if (!isNetworkError(error.message)) {
          setMessage(error.message);
          return;
        }
        throw new Error(error.message);
      }
      const events = (await loadOutbox()).filter((event) => event.stopId !== stopId);
      await saveOutbox(events);
      setPendingSync(events.length);
      if (events.length === 0) setOffline(false);
      await load();
    } catch (reason) {
      const events = enqueueEvent(await loadOutbox(), {
        stopId,
        status,
        createdAt: new Date().toISOString(),
        ...(proof ? { proof } : {}),
      });
      await saveOutbox(events);
      setPendingSync(events.length);
      setOffline(true);
      setMessage(
        proof
          ? 'No connection: the photo and this step are saved on your device and will sync automatically.'
          : 'You are offline. This change is saved on your device and will sync automatically.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Today&apos;s Route</Text>
        {publishedAt || stops.length > 0 ? <Text style={styles.date}>{todayLocalISO()}</Text> : null}
      </View>
      {offline || pendingSync > 0 ? (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Text style={styles.offlineText}>
            {offline ? '📡 Offline — showing the saved route. ' : ''}
            {pendingSync > 0 ? `${pendingSync} change${pendingSync === 1 ? '' : 's'} waiting to sync.` : 'Changes will sync when you are back online.'}
          </Text>
        </View>
      ) : null}
      {eta ? (
        <View style={[styles.etaBanner, eta.lateMinutes > 0 && styles.etaBannerLate]} accessibilityRole="alert">
          <Text style={[styles.etaText, eta.lateMinutes > 0 && styles.etaTextLate]}>
            {eta.lateMinutes > 0
              ? `⚠️ Running ${eta.lateMinutes} min late for ${eta.clientName} · ${eta.dogName}`
              : `Next: ${eta.clientName} · ${eta.dogName} — ~${eta.minutes} min away${position ? '' : ' (sharing location…)'}`}
          </Text>
        </View>
      ) : null}
      <View style={styles.body}>
        {loading ? <ActivityIndicator style={styles.center} color={colors.gold} size="large" /> : stops.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🚚</Text>
            <Text style={styles.emptyTitle}>No published route today</Text>
            <Text style={styles.emptyText}>When the manager publishes your route, it will appear here with every stop and instruction.</Text>
          </View>
        ) : (
          <DriverRouteView stops={stops} onAction={act} />
        )}
        {message ? (
          <Pressable accessibilityRole="button" onPress={() => setMessage(null)} style={styles.message}>
            <Text style={styles.messageText}>{message}</Text>
          </Pressable>
        ) : null}
      </View>
      <NavigationSheet
        visible={navTarget !== null}
        target={navTarget?.target ?? null}
        onClose={() => setNavTarget(null)}
        onChoose={async (app: NavApp, remember: boolean) => {
          const target = navTarget?.target ?? null;
          setNavTarget(null);
          if (!target) return;
          if (remember) await savePreferredNavApp(app);
          await Linking.openURL(navigationUrlFor(app, target));
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  date: { color: '#D7E1D4', fontSize: 12, marginTop: 4 },
  offlineBanner: { backgroundColor: '#FBF0D9', borderBottomWidth: 1, borderBottomColor: '#EADFB8', paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { color: '#7A5E12', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  etaBanner: { backgroundColor: colors.sage, paddingHorizontal: 16, paddingVertical: 9 },
  etaBannerLate: { backgroundColor: '#FBEAE6' },
  etaText: { color: colors.forest900, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  etaTextLate: { color: colors.urgency },
  body: { flex: 1, backgroundColor: colors.cream },
  center: { marginTop: 80 },
  empty: { alignItems: 'center', paddingHorizontal: 34, marginTop: 90 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 12 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, marginTop: 8 },
  message: { position: 'absolute', left: 18, right: 18, bottom: 24, backgroundColor: colors.urgency, borderRadius: 12, padding: 12 },
  messageText: { color: 'white', fontWeight: '800', textAlign: 'center', fontSize: 13 },
});
