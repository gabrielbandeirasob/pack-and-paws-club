import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, transportPool, vanPool, type DogRef, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchConstraint, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { criarFilaDeEscrita, trocarNaOrdem } from '@/features/dispatch/reorderQueue';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { STALE_ROUTE_TITLE, expectedVersion, isStaleRouteError, routeErrorMessage } from '@/features/dispatch/staleRoute';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
import { showAlert } from '@/features/ui/alert';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type DriverRow = { user_id: string; role: 'manager' | 'driver'; profiles: { full_name: string | null } | null };
type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; transport_required: boolean; goes_to_daycare: boolean | null; dog: { id: string; name: string; client: { name: string } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; transport_required: boolean; dog: { id: string; name: string; client: { name: string } } };
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string };
type StopRow = {
  dog_id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  window_start: string | null;
  window_end: string | null;
  exact_time: string | null;
  priority: 'normal' | 'priority';
  pickup_proof_path: string | null;
  dropoff_proof_path: string | null;
  dog: { id: string; name: string; client: { name: string; latitude: number | null; longitude: number | null } };
};
type RouteRow = { id: string; driver_id: string; status: DispatchRoute['status']; lock_version: number | null; route_stops: StopRow[] | null };
type DogRow = { id: string; name: string; client: { name: string } };

function toDogRef(dog: { id: string; name: string; client: { name: string } }) {
  return { id: dog.id, dogName: dog.name, clientName: dog.client.name };
}

export default function DispatchScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  /** Cães do cadastro (para o gestor adicionar um que não está no calendário do dia). */
  const [caesCadastro, setCaesCadastro] = useState<DogRef[]>([]);
  /**
   * Cães adicionados À MÃO pelo gestor. Guardados num ref (e não no estado) para sobreviverem ao
   * recarregamento: o carregamento reconstrói a fila a partir do calendário, e sem isso o cão manual
   * sumiria da tela a cada atualização. Pedido do dono (23/09/2026).
   */
  const extrasRef = useRef<DogRef[]>([]);
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  // Versao de cada rota (lock otimista): o aparelho guarda o que leu; se outro gestor
  // escrever antes, o banco recusa a escrita velha com 'stale_route' em vez de sobrescrever.
  const versoes = useRef<Record<string, number>>({});
  const routesRef = useRef<DispatchRoute[]>([]);
  const revisoes = useRef<Record<string, number>>({});
  const contexto = useRef({ orgId: '', date });
  const diaDasRotas = useRef(date);
  const leituraRotas = useRef(0);
  contexto.current.date = date;
  const atualizarRotas = useCallback((novas: DispatchRoute[]) => {
    routesRef.current = novas;
    setRoutes(novas);
  }, []);
  const fila = useMemo(() => criarFilaDeEscrita<string[]>({
    escrever: async (rotaId, ordem) => {
      const { error } = await supabase.rpc('reorder_route_stops', {
        p_route_id: rotaId, p_dog_ids: ordem, p_esperado: expectedVersion(versoes.current, rotaId),
      });
      if (error) throw error;
      versoes.current[rotaId] = (versoes.current[rotaId] ?? 1) + 1;
      revisoes.current[rotaId] = (revisoes.current[rotaId] ?? 0) + 1;
    },
  }), []);
  const [driverLocations, setDriverLocations] = useState<Record<string, { latitude: number; longitude: number; updatedAt: string }>>({});
  const [loading, setLoading] = useState(true);
  /**
   * Falha de leitura guardada POR ORIGEM: agora que cada pedaço da tela recarrega sozinho, um erro do
   * dia não pode ser apagado pela recarga das rotas (nem o contrário) — e a mensagem some por conta
   * própria quando aquela origem volta a ler com sucesso, em vez de ficar presa na tela até o gestor
   * trocar de dia.
   */
  const [falhas, setFalhas] = useState<{ dia: string | null; rotas: string | null }>({ dia: null, rotas: null });
  const error = falhas.dia ?? falhas.rotas;
  const falhou = useCallback((origem: 'dia' | 'rotas', mensagem: string | null) => {
    setFalhas((atual) => (atual[origem] === mensagem ? atual : { ...atual, [origem]: mensagem }));
  }, []);
  const realtimeRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A fila de cães do dia (reservas) é escrita pelo relógio do servidor, não pelos eventos de rota —
   * mas era a recarga do dia inteiro a cada evento que a mantinha fresca antes. Renovamos o dia junto
   * com os eventos de rota, porém no máximo a cada 2 minutos: a fila de "unassigned" continua pegando
   * cão novo do Sync em poucos minutos, sem voltar a refazer 7 consultas a cada toque.
   */
  const ultimaCargaDoDia = useRef(0);
  const JANELA_DO_DIA = 120_000;

  /**
   * "Add any dog": o gestor puxa um cão do cadastro para a fila do dia mesmo sem reserva no dia
   * (chegou de última hora, ou o transporte não foi marcado). Pedido do dono, 23/09/2026.
   */
  const adicionarCaoForaDoCalendario = useCallback((dog: DogRef) => {
    if (!extrasRef.current.some((item) => item.id === dog.id)) extrasRef.current = [...extrasRef.current, dog];
    setDayItems((prev) => (
      prev.some((item) => item.dogId === dog.id)
        ? prev
        : [...prev, { dogId: dog.id, clientName: dog.clientName, dogName: dog.dogName, inVan: false, extra: true }]
    ));
  }, []);

  const carregarDia = useCallback(async () => {
    const { orgId, date: dia } = contexto.current;
    const [driverResult, reservationResult, recurringResult, exceptionResult, dogResult] = await Promise.all([
      /**
       * Quem pode receber rota: motoristas E gestores. O gestor também faz pick-up/drop-off (áudio do
       * dono, 27/09/2026) e precisa aparecer aqui para pegar uma rota — sem conta nova e sem
       * segundo vínculo. Na tela ele aparece marcado como "· manager".
       */
      supabase.from('organization_members').select('user_id, role, profiles(full_name)').eq('organization_id', orgId).in('role', ['driver', 'manager']).eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, goes_to_daycare, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(name))').eq('organization_id', orgId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', orgId),
      // Cadastro completo (cão ativo): alimenta o "Add any dog" do Dispatch.
      supabase.from('dogs').select('id, name, client:clients(name)').eq('organization_id', orgId).eq('active', true),
    ]);
    if (dia !== contexto.current.date) return;
    const firstError = driverResult.error ?? reservationResult.error ?? recurringResult.error ?? exceptionResult.error ?? dogResult.error;
    if (firstError) { falhou('dia', firstError.message); return; }
    falhou('dia', null);

    const driverRows = (driverResult.data as unknown as DriverRow[]) ?? [];
    setDrivers(
      driverRows.map((row) => ({
        id: row.user_id,
        name: row.profiles?.full_name?.trim() || 'Driver',
        alsoManager: row.role === 'manager',
      })),
    );

    const reservations: ReservationRecord[] = ((reservationResult.data as unknown as ReservationRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), serviceType: row.service_type, startDate: row.start_date, endDate: row.end_date, transportRequired: row.transport_required, goesToDaycare: row.goes_to_daycare ?? true,
    }));
    const recurring: RecurringScheduleRecord[] = ((recurringResult.data as unknown as RecurringRow[]) ?? []).map((row) => ({
      id: row.id, dog: toDogRef(row.dog), weekdays: row.weekdays, startDate: row.start_date, endDate: row.end_date, active: row.active, transportRequired: row.transport_required,
    }));
    const exceptions: RecurringExceptionRecord[] = ((exceptionResult.data as unknown as ExceptionRow[]) ?? []).map((row) => ({
      id: row.id, scheduleId: row.recurring_schedule_id, action: row.action, startDate: row.start_date, endDate: row.end_date,
    }));

    setCaesCadastro(((dogResult.data as unknown as DogRow[]) ?? []).map((row) => toDogRef(row)));

    const day = buildDay(dia, reservations, recurring, exceptions);
    const fila = transportPool(day);
    const naVan = vanPool(day);
    const jaNoDia = new Set([...fila, ...naVan].map((item) => item.dogId));
    // Fila principal: quem precisa de transporte e NÃO está já na van (deduplicado por cão).
    // Seção separada: cão em boarding que também faz daycare no dia — ele acorda dentro da van (sem
    // pickup), mas o gestor pode incluir à mão quando precisar dele de volta em casa. Pedido do
    // cliente em áudio (23/09/2026).
    setDayItems([
      ...fila.map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind, inVan: false })),
      ...naVan.map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind, inVan: true })),
      // Cães que o gestor adicionou à mão (fora do calendário do dia) — pedido do dono, 23/09/2026.
      ...extrasRef.current.filter((extra) => !jaNoDia.has(extra.id)).map((extra) => ({ dogId: extra.id, clientName: extra.clientName, dogName: extra.dogName, inVan: false, extra: true })),
    ]);

  }, []);

  const carregarRotas = useCallback(async () => {
    const { orgId, date } = contexto.current;
    const consulta = ++leituraRotas.current;
    const leitura = { ...revisoes.current };
    const pendentes = new Set(routesRef.current.filter((rota) => fila.pendente(rota.routeId)).map((rota) => rota.routeId));
    const routeResult = await supabase.from('routes').select('id, driver_id, status, lock_version, route_stops(dog_id, sequence, status, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, dog:dogs(id, name, client:clients(name, latitude, longitude)))').eq('organization_id', orgId).eq('route_date', date);
    if (date !== contexto.current.date || consulta !== leituraRotas.current) return;
    if (routeResult.error) { falhou('rotas', routeResult.error.message); return; }
    falhou('rotas', null);
    const routeRows = (routeResult.data as unknown as RouteRow[]) ?? [];
    const protegida = (id: string) => fila.pendente(id) || pendentes.has(id) || leitura[id] !== revisoes.current[id];
    routeRows.forEach((row) => {
      if (!protegida(row.id)) versoes.current[row.id] = row.lock_version ?? 1;
    });
    const novas: DispatchRoute[] = routeRows.map((row) => ({
      routeId: row.id,
      driverId: row.driver_id,
      status: row.status,
      stops: (row.route_stops ?? []).map((stop) => ({
        dogId: stop.dog_id,
        sequence: stop.sequence,
        status: stop.status,
        clientName: stop.dog.client.name,
        dogName: stop.dog.name,
        reservationKind: undefined,
        latitude: stop.dog.client.latitude,
        longitude: stop.dog.client.longitude,
        windowStart: stop.window_start ? stop.window_start.slice(0, 5) : null,
        windowEnd: stop.window_end ? stop.window_end.slice(0, 5) : null,
        exactTime: stop.exact_time ? stop.exact_time.slice(0, 5) : null,
        priority: stop.priority,
        pickupProofPath: stop.pickup_proof_path,
        dropoffProofPath: stop.dropoff_proof_path,
      })),
    }));
    const atuais = diaDasRotas.current === date ? routesRef.current : [];
    diaDasRotas.current = date;
    atualizarRotas(novas.map((rota) => {
      const anterior = atuais.find((atual) => atual.routeId === rota.routeId);
      return anterior && (protegida(rota.routeId) || JSON.stringify(anterior) === JSON.stringify(rota)) ? anterior : rota;
    })
      .concat(atuais.filter((rota) => protegida(rota.routeId) && !novas.some((nova) => nova.routeId === rota.routeId))));
  }, [fila, atualizarRotas]);

  const carregarPosicoes = useCallback(async () => {
    const { orgId } = contexto.current;
    const { data: locationRows } = await supabase
      .from('driver_locations')
      .select('driver_id, latitude, longitude, updated_at')
      .eq('organization_id', orgId);
    setDriverLocations((anteriores) => {
      const novas = Object.fromEntries(
        ((locationRows as unknown as { driver_id: string; latitude: number; longitude: number; updated_at: string }[]) ?? []).map((row) => [
          row.driver_id,
          { latitude: row.latitude, longitude: row.longitude, updatedAt: row.updated_at },
        ]),
      );
      for (const id of Object.keys(novas)) {
        if (JSON.stringify(novas[id]) === JSON.stringify(anteriores[id])) novas[id] = anteriores[id];
      }
      return novas;
    });
  }, []);

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    setFalhas({ dia: null, rotas: null });
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !ativo) return;
        const { data } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).eq('status', 'active').limit(1);
        if (!ativo) return;
        const orgId = (data as { organization_id: string }[] | null)?.[0]?.organization_id;
        if (!orgId) return;
        contexto.current.orgId = orgId;
        setOrganizationId(orgId);
        ultimaCargaDoDia.current = Date.now();
        await Promise.all([carregarDia(), carregarRotas(), carregarPosicoes()]);
      } catch (erro) {
        if (ativo) falhou('dia', erro instanceof Error ? erro.message : 'Unable to load dispatch.');
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [date, carregarDia, carregarRotas, carregarPosicoes]);

  // Cada tipo de evento atualiza somente os dados correspondentes.
  useEffect(() => {
    if (!organizationId) return;
    let posicoes: ReturnType<typeof setTimeout> | null = null;
    const atualizarPosicoes = () => {
      if (posicoes) clearTimeout(posicoes);
      posicoes = setTimeout(() => void carregarPosicoes(), 700);
    };
    const atualizarDia = () => {
      const agora = Date.now();
      if (agora - ultimaCargaDoDia.current < JANELA_DO_DIA) return;
      ultimaCargaDoDia.current = agora;
      void carregarDia();
    };
    const refresh = () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      realtimeRefresh.current = setTimeout(() => {
        atualizarDia();
        void carregarRotas();
      }, 700);
    };
    const channel = supabase
      .channel(`dispatch-${organizationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'routes', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `organization_id=eq.${organizationId}` }, atualizarPosicoes)
      .subscribe();
    return () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      if (posicoes) clearTimeout(posicoes);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, carregarDia, carregarRotas, carregarPosicoes]);

  const versaoDe = useCallback((routeId: string) => expectedVersion(versoes.current, routeId), []);

  // Dois gestores na mesma rota: avisa e recarrega, em vez de deixar a escrita velha passar.
  const avisarRotaMudou = useCallback(() => {
    showAlert(STALE_ROUTE_TITLE, routeErrorMessage('stale_route'), [{ text: 'Reload', onPress: () => void carregarRotas() }]);
  }, [carregarRotas]);

  /** Trata erro de escrita: avisa quando for concorrencia e sempre devolve mensagem legivel. */
  const falhaDeEscrita = useCallback(
    (erro: { message: string } | null) => {
      if (!erro) return;
      if (isStaleRouteError(erro)) avisarRotaMudou();
      throw new Error(routeErrorMessage(erro));
    },
    [avisarRotaMudou],
  );

  /**
   * Mexeu nas paradas por fora das RPCs (editar janela, remover)? Marca a rota como alterada
   * para que a proxima acao de outro aparelho, que leu a versao antiga, tambem seja recusada.
   */
  const marcarRotaAlterada = useCallback(
    async (routeId: string) => {
      const versao = versaoDe(routeId);
      if (versao === null) return;
      await supabase.from('routes').update({ lock_version: versao + 1 }).eq('id', routeId).eq('lock_version', versao);
    },
    [versaoDe],
  );

  /** Troca o status da rota com trava de versao: 0 linhas = outro aparelho mudou antes. */
  const trocarStatus = useCallback(
    async (routeId: string, mudanca: { status: DispatchRoute['status']; published_at?: string | null }) => {
      const versao = versaoDe(routeId);
      const atualizacao: Record<string, unknown> = { ...mudanca, lock_version: (versao ?? 1) + 1 };
      let consulta = supabase.from('routes').update(atualizacao).eq('id', routeId);
      if (versao !== null) consulta = consulta.eq('lock_version', versao);
      const { data, error } = await consulta.select('id');
      falhaDeEscrita(error);
      if (versao !== null && (data ?? []).length === 0) {
        avisarRotaMudou();
        throw new Error(routeErrorMessage('stale_route'));
      }
      await carregarRotas();
    },
    [versaoDe, falhaDeEscrita, avisarRotaMudou, carregarRotas],
  );

  const routeIdForDriver = useCallback(async (driverId: string) => {
    if (!organizationId) throw new Error('Organization not found.');
    const { data: route, error: routeError } = await supabase.from('routes').upsert(
      { organization_id: organizationId, route_date: date, driver_id: driverId, status: 'draft' },
      { onConflict: 'organization_id,route_date,driver_id' },
    ).select('id').single();
    if (routeError) throw new Error(routeError.message);
    return (route as { id: string }).id;
  }, [organizationId, date]);

  const assign = useCallback(async (dogId: string, driverId: string, constraint: DispatchConstraint) => {
    const routeId = await routeIdForDriver(driverId);
    const { error } = await supabase.rpc('assign_stop_to_route', {
      p_route_id: routeId,
      p_dog_id: dogId,
      p_window_start: constraint.windowStart,
      p_window_end: constraint.windowEnd,
      p_exact_time: constraint.exactTime,
      p_priority: constraint.priority,
      p_esperado: versaoDe(routeId),
    });
    falhaDeEscrita(error);
    await carregarRotas();
  }, [routeIdForDriver, versaoDe, falhaDeEscrita, carregarRotas]);

  const saveStopConstraint = useCallback(async (routeId: string, dogId: string, constraint: DispatchConstraint) => {
    const { error } = await supabase.from('route_stops').update({
      window_start: constraint.windowStart,
      window_end: constraint.windowEnd,
      exact_time: constraint.exactTime,
      priority: constraint.priority,
    }).eq('route_id', routeId).eq('dog_id', dogId);
    falhaDeEscrita(error);
    await marcarRotaAlterada(routeId);
    await carregarRotas();
  }, [falhaDeEscrita, marcarRotaAlterada, carregarRotas]);

  const removeStop = useCallback(async (routeId: string, dogId: string) => {
    const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId).eq('dog_id', dogId);
    falhaDeEscrita(error);
    await marcarRotaAlterada(routeId);
    await carregarRotas();
  }, [falhaDeEscrita, marcarRotaAlterada, carregarRotas]);

  const moveStop = useCallback(async (routeId: string, dogId: string, direction: -1 | 1) => {
    const rota = routesRef.current.find((item) => item.routeId === routeId);
    if (!rota) return;
    const ordem = trocarNaOrdem(rota.stops, dogId, direction);
    if (!ordem) return;
    revisoes.current[routeId] = (revisoes.current[routeId] ?? 0) + 1;
    atualizarRotas(routesRef.current.map((item) => item.routeId === routeId ? { ...item, stops: ordem } : item));
    const jaPendente = fila.pendente(routeId);
    const escrita = fila.enfileirar(routeId, ordem.map((item) => item.dogId));
    // Uma única observação de erro por lote, mesmo com vários toques.
    if (jaPendente) return;
    try {
      await escrita;
    } catch (erro) {
      showAlert(isStaleRouteError(erro as { message: string }) ? STALE_ROUTE_TITLE : 'Unable to reorder stops', routeErrorMessage(erro as { message: string }));
      await carregarRotas();
    }
  }, [fila, atualizarRotas, carregarRotas]);

  const publish = useCallback(async (routeId: string) => {
    const { error } = await supabase.rpc('publish_route', { p_route_id: routeId, p_esperado: versaoDe(routeId) });
    falhaDeEscrita(error);
    await carregarRotas();
  }, [versaoDe, falhaDeEscrita, carregarRotas]);

  // Volta a rota para rascunho: o motorista deixa de ver a rota, mas nada e apagado.
  const unpublish = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'draft', published_at: null });
  }, [trocarStatus]);

  // Cancela a rota (status cancelado): sai da operacao e sai da tela do motorista.
  const cancelRoute = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'cancelled' });
  }, [trocarStatus]);

  // Fecha a rota: ela sai da operacao (motorista deixa de ver) e entra no historico.
  const completeRoute = useCallback(async (routeId: string) => {
    await trocarStatus(routeId, { status: 'completed' });
  }, [trocarStatus]);

  const optimize = useCallback(async (routeId: string) => {
    const route = routesRef.current.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const sorted = [...route.stops].sort((a, b) => a.sequence - b.sequence);
    const finished = sorted.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
    const remaining = sorted.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
    if (remaining.length < 2) return;

    // Tempos reais de transito (servidor). Sem funcao/chave/internet, cai na estimativa de
    // linha reta e o gestor nem percebe atraso: a espera e limitada por timeout curto.
    const traffic = await fetchTravelTimes(remaining.map((stop) => ({
      dogId: stop.dogId,
      clientName: stop.clientName,
      dogName: stop.dogName,
      latitude: stop.latitude,
      longitude: stop.longitude,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      exactTime: stop.exactTime,
      priority: stop.priority,
    })));

    const result = optimizeRoute(
      remaining.map((stop) => ({
        dogId: stop.dogId,
        clientName: stop.clientName,
        dogName: stop.dogName,
        latitude: stop.latitude,
        longitude: stop.longitude,
        windowStart: stop.windowStart,
        windowEnd: stop.windowEnd,
        exactTime: stop.exactTime,
        priority: stop.priority,
      })),
      { travel: traffic.travel },
    );
    if (!result.feasible) {
      showAlert('Cannot optimize this route', result.reason ?? 'The schedule is infeasible.');
      return;
    }
    const lines = result.stops.map((stop) => `• ${stop.sequence}. ${stop.clientName} · ${stop.dogName} — arrive ${stop.plannedArrival}`);
    const origem = traffic.source === 'live' ? 'live traffic' : 'estimated times';
    showAlert(`Optimized route (${origem})`, `Suggested order:\n${lines.join('\n')}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Apply',
        onPress: () => {
          const order = [...finished.map((stop) => stop.dogId), ...result.stops.map((stop) => stop.dogId)];
          void supabase.rpc('reorder_route_stops', { p_route_id: routeId, p_dog_ids: order, p_esperado: versaoDe(routeId) }).then(({ error }) => {
            if (error) showAlert(isStaleRouteError(error) ? STALE_ROUTE_TITLE : 'Unable to apply the route', routeErrorMessage(error));
            void carregarRotas();
          });
        },
      },
    ]);
  }, [versaoDe, carregarRotas]);

  const summary = useMemo(() => ({ date, drivers, dayItems, routes, dogs: caesCadastro, onAddExtraDog: adicionarCaoForaDoCalendario }), [date, drivers, dayItems, routes, caesCadastro, adicionarCaoForaDoCalendario]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {loading ? <ActivityIndicator testID="dispatch-loading" style={styles.center} color={colors.gold} size="large" /> : (
        <DispatchBoard
          date={summary.date}
          drivers={summary.drivers}
          dayItems={summary.dayItems}
          routes={summary.routes}
          driverLocations={driverLocations}
          onAssign={assign}
          onSaveStop={saveStopConstraint}
          onRemoveStop={removeStop}
          onMoveStop={moveStop}
          onOptimize={optimize}
          onPublish={publish}
          onUnpublish={unpublish}
          onCancelRoute={cancelRoute}
          onCompleteRoute={completeRoute}
          onDateChange={setDate}
          dogs={summary.dogs}
          onAddExtraDog={summary.onAddExtraDog}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  center: { marginTop: 80 },
  errorText: { color: colors.urgency, textAlign: 'center', marginTop: 60, paddingHorizontal: 24 },
});
