import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, type AlertButton } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { DriverRouteView, type DriverAction, type DriverStop } from '@/features/driver/DriverRouteView';
import { DriverRouteOptimizerCard } from '@/features/driver/DriverRouteOptimizerCard';
import { resolveDriverOptimizationOrigin } from '@/features/driver/driverRouteLocation';
import { optimizeDriverRoute, type DriverRouteStop } from '@/features/driver/driverRouteOptimizer';
import { lateMinutesForStop, minutesToStop, nextStopEta, type EtaResult } from '@/features/driver/eta';
import { etaMessageText, etaNoticeError, messengerLink, phaseForStop, type Messenger } from '@/features/driver/etaMessage';
import { NotifyOwnerSheet } from '@/features/driver/NotifyOwnerSheet';
import { savePendingWrites, enqueuePending, flushPendingWrites, loadPendingWrites, type PendingShift, type PendingWrite } from '@/features/driver/pendingWrites';
import { ShiftCard } from '@/features/driver/ShiftCard';
import { shiftErrorMessage, shiftState, type ManualShift } from '@/features/driver/shift';
import {
  createClosedShift,
  endManualShift,
  loadDriverShifts,
  markEtaNotice,
  startManualShift,
} from '@/features/driver/shiftService';
import { getCurrentDriverLocation, startLocationSharing, type LocationHandle, type LocationUpdate } from '@/features/driver/locationService';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
import {
  captureProofPhoto,
  proofColumn,
  proofErrorMessage,
  proofFailureHandling,
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
import { showAlert } from '@/features/ui/alert';
import { escolherMotivoDoProblema } from '@/features/driver/problemReason';
import { NavigationSheet } from '@/features/maps/NavigationSheet';
import type { NavTarget } from '@/features/maps/links';
import { navigationUrlFor, type NavApp } from '@/features/maps/navigation';
import { loadPreferredNavApp, savePreferredNavApp } from '@/features/maps/preferences';
import { rowToStop, type DriverRouteRow, type DriverStopRow } from '@/features/driver/rows';
import { supabase } from '@/lib/supabase';

type StopRow = DriverStopRow;
type RouteResult = DriverRouteRow;

/** Momento do dia em ISO, usado para recortar as jornadas de hoje. */
function startOfToday(): string {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).toISOString();
}

/** Começo do dia seguinte (recorte exclusivo). */
function startOfTomorrow(): string {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1).toISOString();
}

/**
 * Pergunta ao motorista de onde vem a foto. Obrigatório não oferece pular; opcional oferece;
 * desistir (fechar o alerta) devolve 'cancel' e o passo não é marcado.
 *
 * No navegador não existe câmera: a origem é a biblioteca de fotos e o botão de recusar vai
 * marcado como `style: 'cancel'`, que é o que o shim (features/ui/alert) traduz para o diálogo
 * do browser. Antes disso o passo ficava travado para sempre no web, porque o `Alert.alert` do
 * react-native-web é uma função VAZIA e a Promise que espera a escolha nunca resolvia.
 */
function askProofChoice(required: boolean): Promise<ProofChoice | 'skip' | 'cancel'> {
  return new Promise((resolve) => {
    const buttons: AlertButton[] = [];
    if (Platform.OS !== 'web') buttons.push({ text: 'Take photo', onPress: () => resolve('camera') });
    buttons.push({
      text: Platform.OS === 'web' ? 'Choose a photo' : 'Choose from library',
      onPress: () => resolve('library'),
    });
    if (!required) {
      buttons.push({
        text: 'No photo',
        // No navegador o botao de recusa e o "Cancel" do dialogo (o shim precisa dessa marca).
        ...(Platform.OS === 'web' ? { style: 'cancel' as const } : {}),
        onPress: () => resolve('skip'),
      });
    }
    showAlert(
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
  const [routeVersion, setRouteVersion] = useState<number | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  const [eta, setEta] = useState<EtaResult | null>(null);
  /** Configuração da creche (migration 020): o comprovante é obrigatório em cada etapa? */
  const [proofSettings, setProofSettings] = useState<ProofSettings | null>(null);
  /** Jornadas manuais de hoje (a deduzida sai dos eventos da rota). */
  const [shifts, setShifts] = useState<ManualShift[]>([]);
  /** Escritas que ficaram na fila local (jornada manual / registro de aviso de ETA). */
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  /** Parada escolhida para avisar o tutor (abre a folha do mensageiro). */
  const [notifyStop, setNotifyStop] = useState<DriverStop | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const locationHandle = useRef<LocationHandle | null>(null);
  const realtimeRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Organização/motorista/rota em ref: a fila local (jornada/aviso) precisa deles no momento do
   * envio, sem recriar o syncOutbox a cada mudança de estado.
   */
  const envioRef = useRef<{ organizationId: string | null; driverId: string | null; routeId: string | null }>({
    organizationId: null,
    driverId: null,
    routeId: null,
  });

  useEffect(() => {
    envioRef.current = { organizationId, driverId, routeId };
  }, [organizationId, driverId, routeId]);

  const syncOutbox = useCallback(async (): Promise<boolean> => {
    // Escritas da jornada/aviso que ficaram na fila local (sem sinal) sobem antes do resto: são
    // registros do dia de trabalho e não podem ficar esquecidos no aparelho.
    const filaLocal = await loadPendingWrites();
    if (filaLocal.length > 0) {
      const alvo = envioRef.current;
      const resultado = await flushPendingWrites(filaLocal, async (entrada) => {
        if (entrada.kind === 'eta_notice') {
          await markEtaNotice(supabase, entrada.stopId, entrada.phase);
          return;
        }
        if (!alvo.organizationId || !alvo.driverId) throw new Error('Organization not found for this account.');
        if (entrada.endedAt) {
          await createClosedShift(supabase, {
            organizationId: alvo.organizationId,
            driverId: alvo.driverId,
            routeId: alvo.routeId,
            startedAt: entrada.startedAt,
            endedAt: entrada.endedAt,
            startReason: entrada.startReason,
            endReason: entrada.endReason,
          });
          return;
        }
        const aberta = await startManualShift(supabase, {
          organizationId: alvo.organizationId,
          driverId: alvo.driverId,
          routeId: alvo.routeId,
          reason: entrada.startReason,
          startedAt: entrada.startedAt,
        });
        // Já existe jornada aberta no servidor = o registro da fila é o mesmo: nada a fazer.
        if (aberta.mode === 'already-open') throw new Error('driver_shifts_uma_aberta');
      });
      await savePendingWrites(resultado.remaining);
      setPendingWrites(resultado.remaining);
    }

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
          const caminho = await uploadProof(supabase, event.proof.localUri, event.proof.path, event.proof.mimeType ?? null);
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
        .select('id, organization_id, lock_version, published_at, organization:organizations(proof_pickup_required, proof_dropoff_required), route_stops(id, sequence, status, stop_group_id, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, arrived_at, picked_up_at, completed_at, skipped_at, status_updated_at, eta_notice_at, eta_notice_kind, dog:dogs(id, name, behavior_notes, medical_notes, photo_url, client:clients(name, phone, address_line_1, city, latitude, longitude, client_instructions(pickup_access_instructions))))')
        .eq('driver_id', user?.id ?? '')
        .eq('route_date', todayLocalISO())
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      setDriverId(user?.id ?? null);
      const route = (routes as unknown as RouteResult[] | null)?.[0];
      if (route) {
        const mapped = ((route.route_stops ?? []) as StopRow[]).map(rowToStop);
        snapshot = { savedAt: new Date().toISOString(), publishedAt: route.published_at, stops: mapped };
        await saveRouteSnapshot(snapshot);
        setRouteId(route.id);
        setRouteVersion(route.lock_version);
        setOrganizationId(route.organization_id);
      setProofSettings(route.organization ?? null);
        setOffline(false);
      } else {
        // Route finished/not published: drop the cached copy (sensitive instructions must not linger).
        await clearRouteSnapshot();
        setRouteId(null);
        setRouteVersion(null);
        setOrganizationId(null);
      }
      // Retention: prune stale positions opportunistically.
      void supabase.rpc('cleanup_driver_locations');

      // Jornada: registros manuais de hoje + o que está na fila local (sem sinal).
      if (user?.id) {
        try {
          setShifts(await loadDriverShifts(supabase, { driverId: user.id, dayStart: startOfToday(), dayEnd: startOfTomorrow() }));
        } catch {
          // Sem jornada carregada a tela ainda mostra a dedução dos eventos da rota.
        }
      }
      setPendingWrites(await loadPendingWrites());
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

  /** Grava a ordem sugerida pelo GPS sem permitir que um motorista altere a rota de outro. */
  const applyOptimizedOrder = async (dogIds: string[]) => {
    if (!routeId || routeVersion === null) {
      showAlert('Unable to save this route', 'Reload the route and optimize it again.');
      return;
    }

    setOptimizeBusy(true);
    try {
      const { error } = await supabase.rpc('driver_reorder_route_stops', {
        p_route_id: routeId,
        p_dog_ids: dogIds,
        p_esperado: routeVersion,
      });
      if (error) {
        const stale = error.message.toLowerCase().includes('stale_route');
        showAlert(
          stale ? 'Route changed' : 'Unable to save this route',
          stale
            ? 'The manager changed this route. Reload it and optimize again.'
            : 'The optimized route could not be saved. Please try again.',
        );
        await load();
        return;
      }

      const order = new Map(dogIds.map((dogId, index) => [dogId, index + 1]));
      setStops((current) =>
        [...current]
          .map((stop) => ({ ...stop, sequence: stop.dogId ? (order.get(stop.dogId) ?? stop.sequence) : stop.sequence }))
          .sort((a, b) => a.sequence - b.sequence),
      );
      await load();
      setMessage('Route optimized from your current location.');
    } catch {
      showAlert('Unable to save this route', 'The optimized route could not be saved. Check your connection and try again.');
    } finally {
      setOptimizeBusy(false);
    }
  };

  /**
   * Botão do motorista: usa a posição viva do aparelho como ponto zero, considera trânsito real
   * quando o servidor responde e preserva qualquer etapa já iniciada/concluída.
   */
  const optimizeFromCurrentLocation = async () => {
    if (!routeId) return;
    setOptimizeBusy(true);
    try {
      const origin = await resolveDriverOptimizationOrigin(getCurrentDriverLocation, position);
      if (origin) setPosition(origin);
      if (!origin) {
        showAlert('Unable to optimize this route', 'Your current location is not available. Allow location access and try again.');
        return;
      }

      const missingDog = stops.find((stop) => !stop.dogId);
      if (missingDog) {
        showAlert('Unable to optimize this route', 'One of the assigned dogs is unavailable. Ask the manager to reload and publish the route again.');
        return;
      }

      const routeStops: DriverRouteStop[] = stops.map((stop) => ({
        stopId: stop.id,
        dogId: stop.dogId!,
        sequence: stop.sequence,
        status: stop.status,
        clientName: stop.clientName,
        dogName: stop.dogName,
        latitude: stop.latitude ?? null,
        longitude: stop.longitude ?? null,
        windowStart: stop.windowStart ?? null,
        windowEnd: stop.windowEnd ?? null,
        exactTime: stop.exactTime ?? null,
        priority: stop.priority ?? 'normal',
      }));
      const pending = routeStops.filter((stop) => stop.status === 'pending');
      const traffic = await fetchTravelTimes(pending, origin);
      const now = new Date();
      const result = optimizeDriverRoute(routeStops, origin, {
        startAtMinutes: now.getHours() * 60 + now.getMinutes(),
        travel: traffic.travel,
      });
      if (!result.feasible) {
        showAlert('Unable to optimize this route', result.reason ?? 'The route cannot be calculated.');
        return;
      }

      const lines = result.optimized.map((stop, index) => `• ${index + 1}. ${stop.clientName} · ${stop.dogName} — ${stop.plannedArrival ?? 'next'}`);
      const source = traffic.source === 'live' ? 'live traffic' : 'distance estimate';
      showAlert(
        `Route ready (${source})`,
        `Starting at your current location:\n${lines.join('\n')}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Apply route', onPress: () => void applyOptimizedOrder(result.orderedDogIds) },
        ],
      );
    } catch (reason) {
      showAlert('Unable to optimize this route', reason instanceof Error ? reason.message : 'Location or route service is unavailable.');
    } finally {
      setOptimizeBusy(false);
    }
  };

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

    // PROBLEMA pergunta o motivo ANTES de gravar, para o aviso ao gestor já sair com a explicação
    // (defeito corrigido em 25/09/2026: antes o escritório só sabia que "houve um problema").
    let notaDoProblema: string | null = null;
    if (action === 'problem') {
      notaDoProblema = await escolherMotivoDoProblema();
      if (notaDoProblema === null) return; // desistiu: a parada NÃO é marcada como problema
    }

    // Comprovante de entrega (migration 020): a foto é tirada ANTES de marcar o passo.
    // Obrigatório bloqueia, opcional só oferece, e sem configuração carregada o motorista
    // nunca fica preso num passo.
    const proofKind = proofKindForAction(action);
    let proof: { kind: ProofKind; localUri: string; path: string; capturedAt: string; mimeType: string | null } | null = null;
    // A exigencia da foto vale la embaixo tambem, na hora de decidir o que fazer se a gravacao falhar.
    let provaObrigatoria = false;
    if (proofKind && organizationId) {
      const required = proofRequired(proofKind, proofSettings);
      provaObrigatoria = required;
      const choice = await askProofChoice(required);
      if (choice === 'cancel') return;
      if (choice !== 'skip') {
        try {
          const escolhida = await captureProofPhoto(choice);
          if (escolhida) {
            proof = {
              kind: proofKind,
              localUri: escolhida.uri,
              path: proofPath(organizationId, stopId, proofKind, escolhida.uri, new Date(), escolhida.mimeType),
              capturedAt: new Date().toISOString(),
              mimeType: escolhida.mimeType,
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

    const statusAnterior = stops.find((stop) => stop.id === stopId)?.status ?? status;
    setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, status } : stop)));

    /** Grava o passo no banco (com a foto, quando houver). Lança em QUALQUER falha. */
    const gravarPasso = async (comProva: boolean) => {
      const atualizacao: Record<string, unknown> = { status };
      // O motivo do problema entra na MESMA escrita: o push do gestor (trigger 033) sai com ele.
      if (notaDoProblema) atualizacao.proof_note = notaDoProblema;
      if (proof && comProva) {
        // Sobe a foto e grava o caminho junto do status: uma única escrita no banco.
        const caminho = await uploadProof(supabase, proof.localUri, proof.path, proof.mimeType);
        atualizacao[proofColumn(proof.kind, 'path')] = caminho;
        atualizacao[proofColumn(proof.kind, 'at')] = proof.capturedAt;
      }
      const { error } = await supabase.from('route_stops').update(atualizacao).eq('id', stopId);
      if (error) throw new Error(error.message);
    };

    /** O cartao volta para o estado do BANCO (a escrita nao aconteceu). */
    const desfazerStatus = () =>
      setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, status: statusAnterior } : stop)));

    try {
      await gravarPasso(true);
      const events = (await loadOutbox()).filter((event) => event.stopId !== stopId);
      await saveOutbox(events);
      setPendingSync(events.length);
      if (events.length === 0) setOffline(false);
      await load();
    } catch (reason) {
      // O destino do passo que nao gravou e uma regra pura (proofCapture.proofFailureHandling):
      // fila local quando e rede; sem a foto quando ela era opcional; volta ao estado do banco
      // no resto (inclusive foto OBRIGATORIA). Antes disso QUALQUER falha virava "sem conexao" e
      // ia para a fila: a tela marcava "Completed" e o banco ficava sem o carimbo da foto.
      const destino = proofFailureHandling({
        networkError: isNetworkError(reason),
        hasProof: proof !== null,
        proofRequired: provaObrigatoria,
      });

      if (destino === 'queue') {
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
        return;
      }

      if (destino === 'without-photo') {
        try {
          await gravarPasso(false);
          setMessage(`Step saved without the photo. ${proofErrorMessage(reason)}`);
          await load();
          return;
        } catch {
          // nem sem a foto deu: cai no aviso abaixo
        }
      }

      desfazerStatus();
      setMessage(proofErrorMessage(reason));
    }
  };

  /* ------------------------------------------------------------------ *
   * JORNADA (clock in / clock out) — pedido do cliente em áudio (16/09/2026)
   * ------------------------------------------------------------------ */

  /** Jornadas que estão só no aparelho (fila local) entram no mesmo estado da tela. */
  const jornadasLocais = useMemo<ManualShift[]>(
    () =>
      pendingWrites
        .filter((entrada): entrada is PendingShift => entrada.kind === 'shift')
        .map((entrada) => ({
          id: `local-${entrada.queuedAt}`,
          startedAt: entrada.startedAt,
          endedAt: entrada.endedAt,
          startReason: entrada.startReason,
          endReason: entrada.endReason,
        })),
    [pendingWrites],
  );

  /** Jornada mostrada na tela: manual (exceção) quando existe, senão deduzida dos eventos. */
  const journey = useMemo(() => shiftState(stops, [...shifts, ...jornadasLocais]), [stops, shifts, jornadasLocais]);

  const recarregarJornadas = async (motorista: string) => {
    setShifts(await loadDriverShifts(supabase, { driverId: motorista, dayStart: startOfToday(), dayEnd: startOfTomorrow() }));
  };

  const guardarNaFila = async (entrada: PendingWrite) => {
    const fila = enqueuePending(pendingWrites, entrada);
    setPendingWrites(fila);
    await savePendingWrites(fila);
    return fila;
  };

  /** Clock in MANUAL: exceção (esqueceu), por isso o motivo é obrigatório no banco. */
  const clockIn = async (motivo: string) => {
    setShiftBusy(true);
    setShiftError(null);
    const startedAt = new Date().toISOString();
    try {
      if (!organizationId || !driverId) throw new Error('Organization not found for this account.');
      const resultado = await startManualShift(supabase, { organizationId, driverId, routeId, reason: motivo, startedAt });
      if (resultado.mode === 'already-open') {
        setShiftError('You already have a journey open.');
        return;
      }
      await recarregarJornadas(driverId);
      setMessage('Journey started — manual record.');
    } catch (causa) {
      if (isNetworkError(causa)) {
        await guardarNaFila({ kind: 'shift', startedAt, endedAt: null, startReason: motivo, endReason: null, routeId, queuedAt: startedAt });
        setMessage('No connection: the journey is saved on your phone and will sync automatically.');
      } else {
        setShiftError(shiftErrorMessage(causa));
      }
    } finally {
      setShiftBusy(false);
    }
  };

  /**
   * Clock out. Três casos: fecha a jornada manual aberta; fecha uma jornada que estava só na fila
   * local; ou fecha (à mão) a jornada que vinha sendo deduzida dos eventos da rota — o intervalo
   * gravado vai da primeira chegada até agora, e o resumo do gestor não conta duas vezes.
   */
  const clockOut = async (motivo: string) => {
    setShiftBusy(true);
    setShiftError(null);
    const agora = new Date().toISOString();
    const aberta = shifts.find((registro) => registro.endedAt === null) ?? null;
    const inicio = aberta?.startedAt ?? journey.startedAt ?? agora;
    const motivoEntrada = aberta?.startReason ?? 'Journey closed manually';
    try {
      if (!organizationId || !driverId) throw new Error('Organization not found for this account.');
      if (aberta) {
        await endManualShift(supabase, { shiftId: aberta.id, reason: motivo, endedAt: agora });
      } else {
        await createClosedShift(supabase, {
          organizationId,
          driverId,
          routeId,
          startedAt: inicio,
          endedAt: agora,
          startReason: motivoEntrada,
          endReason: motivo,
        });
      }
      await recarregarJornadas(driverId);
      setMessage('Journey closed.');
    } catch (causa) {
      if (isNetworkError(causa)) {
        // Uma linha só com entrada e saída: nada de meio registro no aparelho.
        await guardarNaFila({ kind: 'shift', startedAt: inicio, endedAt: agora, startReason: motivoEntrada, endReason: motivo, routeId, queuedAt: agora });
        setMessage('No connection: the journey is saved on your phone and will sync automatically.');
      } else {
        setShiftError(shiftErrorMessage(causa));
      }
    } finally {
      setShiftBusy(false);
    }
  };

  /* ------------------------------------------------------------------ *
   * AVISO DE ETA AO TUTOR — mensagem pronta no mensageiro do motorista
   * ------------------------------------------------------------------ */

  const avisoDe = (stop: DriverStop) => {
    const phase = phaseForStop(stop.status);
    return etaMessageText({
      clientName: stop.clientName,
      dogName: stop.dogName,
      phase,
      minutes: stop.etaMinutes ?? 0,
      lateMinutes: stop.lateMinutes ?? 0,
    });
  };

  /** Abre o mensageiro do motorista com o texto pronto e registra o aviso no histórico da parada. */
  const enviarAviso = async (messenger: Messenger) => {
    const stop = notifyStop;
    setNotifyStop(null);
    if (!stop) return;
    const texto = avisoDe(stop);
    const link = messengerLink(messenger, stop.clientPhone ?? null, texto);
    if (!link) {
      setMessage('This client has no usable phone number to send the ETA.');
      return;
    }
    try {
      await Linking.openURL(link);
    } catch {
      // Se o mensageiro não abrir, o registro do aviso ainda vale (o motorista avisa por telefone).
    }
    const phase = phaseForStop(stop.status);
    try {
      await markEtaNotice(supabase, stop.id, phase);
      await load();
      setMessage('Notice recorded — the office can see you warned the owner.');
    } catch (causa) {
      if (isNetworkError(causa)) {
        await guardarNaFila({ kind: 'eta_notice', stopId: stop.id, phase, queuedAt: new Date().toISOString() });
        setMessage('Message opened. No connection: the notice is recorded when you are back online.');
      } else {
        setMessage(etaNoticeError(causa));
      }
    }
  };

  /** Paradas com o ETA de cada uma (o botão de avisar mostra "~12 min" e fica âmbar se atrasar). */
  const stopsComEta = useMemo(
    () =>
      stops.map((stop) => {
        const minutos = minutesToStop(position, stop);
        return { ...stop, etaMinutes: minutos, lateMinutes: minutos == null ? 0 : lateMinutesForStop(stop, minutos) };
      }),
    [stops, position],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB · DRIVER</Text>
        <Text style={styles.title}>Today&apos;s Route</Text>
        {publishedAt || stops.length > 0 ? <Text style={styles.date}>{todayLocalISO()}</Text> : null}
      </View>
      {offline || pendingSync + pendingWrites.length > 0 ? (
        <View style={styles.offlineBanner} accessibilityRole="alert">
          <Text style={styles.offlineText}>
            {offline ? '📡 Offline — showing the saved route. ' : ''}
            {pendingSync + pendingWrites.length > 0
              ? `${pendingSync + pendingWrites.length} change${pendingSync + pendingWrites.length === 1 ? '' : 's'} waiting to sync.`
              : 'Changes will sync when you are back online.'}
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
          <>
            {/* A rota nasce onde o motorista está; o gestor continua decidindo QUAIS cães entram. */}
            <View style={styles.routeTools}>
              <DriverRouteOptimizerCard
                pendingStops={stops.filter((stop) => stop.status === 'pending').length}
                busy={optimizeBusy}
                hasLocation={position !== null}
                onOptimize={optimizeFromCurrentLocation}
              />
            </View>
            {/* Jornada do dia (deduzida da rota; manual só na exceção) */}
            <View style={styles.jornada}>
              <ShiftCard
                state={journey}
                pendingCount={pendingWrites.length}
                busy={shiftBusy}
                error={shiftError}
                onClockIn={(motivo) => void clockIn(motivo)}
                onClockOut={(motivo) => void clockOut(motivo)}
              />
            </View>
            <DriverRouteView stops={stopsComEta} onAction={act} onNotifyOwner={(stop) => setNotifyStop(stop)} />
          </>
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
      {/* Aviso de ETA ao tutor: o texto vai pronto, quem envia é o motorista (pedido do cliente) */}
      <NotifyOwnerSheet
        visible={notifyStop !== null}
        phone={notifyStop?.clientPhone ?? null}
        message={notifyStop ? avisoDe(notifyStop) : ''}
        onChoose={(messenger) => void enviarAviso(messenger)}
        onClose={() => setNotifyStop(null)}
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
  routeTools: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 2 },
  jornada: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 },
  center: { marginTop: 80 },
  empty: { alignItems: 'center', paddingHorizontal: 34, marginTop: 90 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 12 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, marginTop: 8 },
  message: { position: 'absolute', left: 18, right: 18, bottom: 24, backgroundColor: colors.urgency, borderRadius: 12, padding: 12 },
  messageText: { color: 'white', fontWeight: '800', textAlign: 'center', fontSize: 13 },
});
