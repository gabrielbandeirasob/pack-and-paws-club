import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildDay, transportPool, vanPool, type DogRef, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchConstraint, type DispatchDriver, type DispatchRoute, type DispatchStopItem } from '@/features/dispatch/DispatchBoard';
import { juntarIrmaosDeCasa, vaoJunto } from '@/features/dispatch/houseMates';
import { criarFilaDeEscrita, trocarNaOrdem } from '@/features/dispatch/reorderQueue';
import { ordemDaBusca, ordemDaEntrega, ordenarComTravas, pinDaParada, type Travas, type Perna } from '@/features/dispatch/orderPins';
import { avisoDeFechamento, paradasPendentes, type FechamentoDeRota } from '@/features/dispatch/routeClosing';
import { optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { GRACE_MINUTES } from '@/features/driver/eta';
import { STALE_ROUTE_TITLE, expectedVersion, isStaleRouteError, routeErrorMessage } from '@/features/dispatch/staleRoute';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
import { showAlert } from '@/features/ui/alert';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { loadOrganizationLocations, vanLocationForRoute } from '@/features/organization/locations';
import { sugerirRotas, type BlocoSugerido, type SugestaoDeRotas } from '@/features/dispatch/routeSuggestion';

type DriverRow = { user_id: string; role: 'manager' | 'driver'; profiles: { full_name: string | null } | null };
type ReservationRow = { id: string; service_type: 'daycare' | 'boarding'; start_date: string; end_date: string; transport_required: boolean; goes_to_daycare: boolean | null; dog: { id: string; name: string; client: { id: string; name: string; latitude: number | null; longitude: number | null } } };
type RecurringRow = { id: string; weekdays: number[]; start_date: string; end_date: string | null; active: boolean; transport_required: boolean; dog: { id: string; name: string; client: { id: string; name: string; latitude: number | null; longitude: number | null } } };
type ExceptionRow = { id: string; recurring_schedule_id: string; action: 'skip' | 'transport_on' | 'transport_off'; start_date: string; end_date: string };
type StopRow = {
  pickup_pin?: Travas['pickupPin'];
  pickup_pin_position?: number | null;
  dropoff_pin?: Travas['dropoffPin'];
  dropoff_pin_position?: number | null;
  dropoff_sequence?: number | null;
  dog_id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  window_start: string | null;
  window_end: string | null;
  exact_time: string | null;
  priority: 'normal' | 'priority';
  pickup_proof_path: string | null;
  dropoff_proof_path: string | null;
  dog: { id: string; name: string; client: { id?: string; name: string; latitude: number | null; longitude: number | null } };
};
type RouteRow = { id: string; driver_id: string; status: DispatchRoute['status']; lock_version: number | null; route_stops: StopRow[] | null };
type DogRow = { id: string; name: string; client: { id: string; name: string; latitude: number | null; longitude: number | null } };

/** Coordenada do endereço do cliente por cão — é o que a sugestão de rota usa (geografia). */
type Coordenada = { latitude: number | null; longitude: number | null };

function toDogRef(dog: { id: string; name: string; client: { id: string; name: string; latitude?: number | null; longitude?: number | null } }) {
  return {
    id: dog.id,
    dogName: dog.name,
    clientName: dog.client.name,
    clientId: dog.client.id,
    latitude: dog.client.latitude ?? null,
    longitude: dog.client.longitude ?? null,
  };
}

export default function DispatchScreen() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  /**
   * A mesma fila do dia num ref: a atribuição precisa saber quem mora junto (mesmo cliente) no momento
   * do toque, sem depender do estado capturado no `useCallback`. Áudio do dono, 29/09/2026.
   */
  const itensDoDia = useRef<DispatchStopItem[]>([]);
  /** Cães do cadastro (para o gestor adicionar um que não está no calendário do dia). */
  const [caesCadastro, setCaesCadastro] = useState<DogRef[]>([]);
  /**
   * ENDEREÇO DE CADA CÃO (por `dogId`) — a sugestão de rota é geográfica, e a fila do dia montada pelo
   * calendário não carrega coordenada. O mapa sai da MESMA consulta do dia, sem ida extra ao banco.
   */
  const coordenadasPorCao = useRef<Map<string, Coordenada>>(new Map());
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
  const propostaRef = useRef<{ dia: string; org: string; assinatura: string; blocos: BlocoSugerido[] } | null>(null);
  const aplicandoSugestao = useRef(false);
  const membrosDoDia = useRef<DriverRow[]>([]);
  const revisoes = useRef<Record<string, number>>({});
  const contexto = useRef({ orgId: '', date });
  const diaDasRotas = useRef(date);
  const leituraRotas = useRef(0);
  const gravandoOrdens = useRef(new Set<string>());
  contexto.current.date = date;
  const atualizarRotas = useCallback((novas: DispatchRoute[]) => {
    routesRef.current = novas;
    setRoutes(novas);
  }, []);
  const fila = useMemo(() => criarFilaDeEscrita<{ pickup: string[]; dropoff: string[] | null; pernas: Set<Perna> }>({
    escrever: async (rotaId, ordem) => {
      for (const perna of ordem.pernas) {
        const { error } = perna === 'pickup'
          ? await supabase.rpc('reorder_route_stops', {
            p_route_id: rotaId, p_dog_ids: ordem.pickup, p_esperado: expectedVersion(versoes.current, rotaId),
          })
          : await supabase.rpc('apply_route_order', {
            p_route_id: rotaId, p_pickup_ids: null, p_dropoff_ids: ordem.dropoff, p_esperado: expectedVersion(versoes.current, rotaId),
          });
        if (error) throw error;
        versoes.current[rotaId] = (versoes.current[rotaId] ?? 1) + 1;
      }
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
    setDayItems((prev) => {
      if (prev.some((item) => item.dogId === dog.id)) return prev;
      const novo = { dogId: dog.id, clientName: dog.clientName, dogName: dog.dogName, inVan: false, extra: true, clientId: dog.clientId ?? null };
      const novos = juntarIrmaosDeCasa([...prev, novo]);
      itensDoDia.current = novos;
      return novos;
    });
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
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, goes_to_daycare, dog:dogs(id, name, client:clients(id, name, latitude, longitude))').eq('organization_id', orgId).eq('status', 'confirmed'),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(id, name, latitude, longitude))').eq('organization_id', orgId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', orgId),
      // Cadastro completo (cão ativo): alimenta o "Add any dog" do Dispatch.
      supabase.from('dogs').select('id, name, client:clients(id, name, latitude, longitude)').eq('organization_id', orgId).eq('active', true),
    ]);
    if (dia !== contexto.current.date) return;
    const firstError = driverResult.error ?? reservationResult.error ?? recurringResult.error ?? exceptionResult.error ?? dogResult.error;
    if (firstError) { falhou('dia', firstError.message); return; }
    falhou('dia', null);

    const driverRows = (driverResult.data as unknown as DriverRow[]) ?? [];
    membrosDoDia.current = driverRows;
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

    /**
     * ENDEREÇO POR CÃO (para a sugestão de rota): sai das mesmas linhas que acabaram de chegar — sem
     * consulta nova. Cão sem coordenada simplesmente não entra no mapa (a sugestão avisa e o deixa fora).
     */
    const coordenadas = new Map<string, Coordenada>();
    const guardarCoordenada = (dog: { id: string; client?: { latitude?: number | null; longitude?: number | null } | null } | null | undefined) => {
      if (!dog?.id) return;
      coordenadas.set(dog.id, { latitude: dog.client?.latitude ?? null, longitude: dog.client?.longitude ?? null });
    };
    for (const row of ((reservationResult.data as unknown as ReservationRow[]) ?? [])) guardarCoordenada(row.dog);
    for (const row of ((recurringResult.data as unknown as RecurringRow[]) ?? [])) guardarCoordenada(row.dog);
    for (const row of ((dogResult.data as unknown as DogRow[]) ?? [])) guardarCoordenada(row);
    coordenadasPorCao.current = coordenadas;

    const day = buildDay(dia, reservations, recurring, exceptions);
    const fila = transportPool(day);
    const naVan = vanPool(day);
    const jaNoDia = new Set([...fila, ...naVan].map((item) => item.dogId));
    // Fila principal: quem precisa de transporte e NÃO está já na van (deduplicado por cão).
    // Seção separada: cão em boarding que também faz daycare no dia — ele acorda dentro da van (sem
    // pickup), mas o gestor pode incluir à mão quando precisar dele de volta em casa. Pedido do
    // cliente em áudio (23/09/2026).
    const itens = juntarIrmaosDeCasa([
      ...fila.map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind, inVan: false, clientId: item.clientId ?? null })),
      ...naVan.map((item) => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, reservationKind: item.kind, inVan: true, clientId: item.clientId ?? null })),
      // Cães que o gestor adicionou à mão (fora do calendário do dia) — pedido do dono, 23/09/2026.
      ...extrasRef.current.filter((extra) => !jaNoDia.has(extra.id)).map((extra) => ({ dogId: extra.id, clientName: extra.clientName, dogName: extra.dogName, inVan: false, extra: true, clientId: extra.clientId ?? null })),
    ]);
    itensDoDia.current = itens;
    setDayItems(itens);
    return true;

  }, []);

  const carregarRotas = useCallback(async () => {
    const { orgId, date } = contexto.current;
    const consulta = ++leituraRotas.current;
    const leitura = { ...revisoes.current };
    const pendentes = new Set(routesRef.current.filter((rota) => (fila.pendente(rota.routeId) || gravandoOrdens.current.has(rota.routeId))).map((rota) => rota.routeId));
    const routeResult = await supabase.from('routes').select('id, driver_id, status, lock_version, route_stops(dog_id, pickup_pin, pickup_pin_position, dropoff_pin, dropoff_pin_position, dropoff_sequence, sequence, status, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, dog:dogs(id, name, client:clients(id, name, latitude, longitude)))').eq('organization_id', orgId).eq('route_date', date);
    if (date !== contexto.current.date || consulta !== leituraRotas.current) return;
    if (routeResult.error) { falhou('rotas', routeResult.error.message); return; }
    falhou('rotas', null);
    const routeRows = (routeResult.data as unknown as RouteRow[]) ?? [];
    const protegida = (id: string) => gravandoOrdens.current.has(id) || fila.pendente(id) || pendentes.has(id) || leitura[id] !== revisoes.current[id];
    routeRows.forEach((row) => {
      if (!protegida(row.id)) versoes.current[row.id] = row.lock_version ?? 1;
    });
    const novas: DispatchRoute[] = routeRows.map((row) => ({
      routeId: row.id,
      driverId: row.driver_id,
      status: row.status,
      stops: (row.route_stops ?? []).map((stop) => ({
        dogId: stop.dog_id,
        pickupPin: stop.pickup_pin,
        pickupPinPosition: stop.pickup_pin_position,
        dropoffPin: stop.dropoff_pin,
        dropoffPinPosition: stop.dropoff_pin_position,
        dropoffSequence: stop.dropoff_sequence,
        sequence: stop.sequence,
        status: stop.status,
        clientName: stop.dog.client.name,
        clientId: stop.dog.client.id,
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
    return true;
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

  /**
   * Atribui o cão ao motorista — e leva JUNTO os irmãos de casa (mesmo cliente) que ainda estão sem
   * motorista. Áudio do dono (29/09/2026): *"se eu mandar o Sam para um driver, o Oli vai para o mesmo
   * driver… não faz sentido eu ter que clicar duas vezes para a mesma casa"*.
   *
   * Cada cão continua sendo um cão: a contagem do dia, o Total Pack e o calendário não mudam — o que
   * não se repete é o trabalho do gestor. Para o motorista já é uma parada só, porque o banco agrupa
   * as paradas do mesmo cliente por `stop_group_id` (migração 029).
   *
   * Quem já está em outro carro NÃO é roubado (decisão do gestor vale); a folha de atribuição mostra
   * quem vai junto antes de salvar.
   */
  const assign = useCallback(async (dogId: string, driverId: string, constraint: DispatchConstraint) => {
    const routeId = await routeIdForDriver(driverId);
    const naRota = new Set(routesRef.current.flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
    const junto = [dogId, ...vaoJunto(itensDoDia.current, dogId, naRota).map((item) => item.dogId)];
    for (const alvo of junto) {
      const { error } = await supabase.rpc('assign_stop_to_route', {
        p_route_id: routeId,
        p_dog_id: alvo,
        p_window_start: constraint.windowStart,
        p_window_end: constraint.windowEnd,
        p_exact_time: constraint.exactTime,
        p_priority: constraint.priority,
        p_esperado: versaoDe(routeId),
      });
      if (error) {
        falhaDeEscrita(error);
        break;
      }
      // Cada escrita bem-sucedida incrementa `lock_version` no banco: a próxima precisa da versão nova,
      // senão o Banco recusa como 'stale_route' (a trava é justamente para escrita velha).
      versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
    }
    await carregarRotas();
  }, [routeIdForDriver, versaoDe, falhaDeEscrita, carregarRotas]);

  /**
   * SUGESTÃO DE ROTA (cliente, áudio de 01/10/2026): *"sugestão de rota automática… leva um tempinho aí
   * de clicar e mandar pro driver certo"*. A conta é PURA (`features/dispatch/routeSuggestion.ts`):
   * junta os cães por endereço e corta a trilha em blocos contíguos, minimizando a distância.
   *
   * Entram: os cães do dia que ainda estão SEM motorista e a van da organização (sede padrão) como
   * ponto de partida. NADA é gravado aqui — a folha mostra e o gestor confirma.
   */
  const assinaturaDaSugestao = useCallback(() => JSON.stringify({
    itens: itensDoDia.current,
    coordenadas: [...coordenadasPorCao.current.entries()],
    membros: membrosDoDia.current,
    rotas: routesRef.current.map(r => ({ ...r, versao: versoes.current[r.routeId] })),
  }), []);

  const sugerirRotasDoDia = useCallback(async (driverIds?: string[]): Promise<SugestaoDeRotas | null> => {
    if (!organizationId || aplicandoSugestao.current) return null;
    const dia = contexto.current.date;
    propostaRef.current = null;
    if (!(await carregarDia()) || !(await carregarRotas())) throw new Error('Could not refresh the day. Try again.');
    const assinatura = assinaturaDaSugestao();
    const atribuidos = new Set(routesRef.current.flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
    const caes = itensDoDia.current
      .filter((item) => !item.inVan && !atribuidos.has(item.dogId))
      .map((item) => {
        const ponto = coordenadasPorCao.current.get(item.dogId);
        return {
          dogId: item.dogId,
          clientId: item.clientId,
          clientName: item.clientName,
          dogName: item.dogName,
          latitude: ponto?.latitude ?? null,
          longitude: ponto?.longitude ?? null,
        };
      });
    // Só rascunhos sem travas: anexar após um "last" invalidaria a condição do gestor.
    // Não se muda o status de rota publicada/fechada para acomodar uma sugestão.
    const disponiveis = membrosDoDia.current.filter(driver => {
      if (driverIds && !driverIds.includes(driver.user_id)) return false;
      const rota = routesRef.current.find(r => r.driverId === driver.user_id);
      return !rota || (rota.status === 'draft' && rota.stops.every(s =>
        s.status === 'pending' && !s.pickupPin && !s.dropoffPin));
    });
    const vans = await loadOrganizationLocations(supabase, organizationId);
    if (dia !== contexto.current.date || assinatura !== assinaturaDaSugestao()) return null;
    const van = vanLocationForRoute(vans, null);
    const inicio = van ? { latitude: van.latitude, longitude: van.longitude } : null;
    const motoristas = disponiveis.map(driver => ({ driverId: driver.user_id, driverName: driver.profiles?.full_name?.trim() || 'Driver' }));
    const motoristaDaCasa = new Map<string, Set<string>>();
    for (const rota of routesRef.current) for (const stop of rota.stops) {
      if (!stop.clientId) continue;
      const ids = motoristaDaCasa.get(stop.clientId) ?? new Set<string>();
      ids.add(rota.driverId);
      motoristaDaCasa.set(stop.clientId, ids);
    }
    const livres = caes.filter(c => !c.clientId || !motoristaDaCasa.has(c.clientId));
    const proposta = sugerirRotas(
      livres, motoristas, inicio,
    );
    // Casa parcialmente atribuída não é repartida para preencher outro carro. Respeitamos também
    // separações manuais já existentes: se há dois motoristas na casa, o restante fica para revisão.
    const fixos = caes.filter(c => c.clientId && motoristaDaCasa.has(c.clientId));
    for (const cao of fixos) {
      const ids = motoristaDaCasa.get(cao.clientId!)!;
      const motorista = motoristas.find(m => ids.size === 1 && ids.has(m.driverId));
      if (!motorista) { proposta.semLugar.push(cao); continue; }
      let bloco = proposta.blocos.find(b => b.driverId === motorista.driverId);
      if (!bloco) { bloco = { ...motorista, caes: [], km: 0 }; proposta.blocos.push(bloco); }
      bloco.caes.push(cao);
    }
    if (fixos.length) {
      proposta.blocos = proposta.blocos.flatMap(bloco => {
        const ordenada = sugerirRotas(bloco.caes, [bloco], inicio);
        proposta.semLugar.push(...ordenada.semLugar);
        return ordenada.blocos;
      });
      proposta.kmTotal = proposta.blocos.reduce((soma, bloco) => soma + bloco.km, 0);
    }
    propostaRef.current = { dia, org: organizationId, assinatura, blocos: proposta.blocos };
    return proposta;
  }, [organizationId, carregarDia, carregarRotas, assinaturaDaSugestao]);

  /**
   * A proposta já contém os irmãos: uma RPC por cão, sem chamar assign (que os expandiria de novo).
   * INSERT de rota nova, nunca UPSERT status=draft sobre rota existente. Falha parcial não é rollback:
   * recarregamos o que foi salvo e exigimos nova proposta, evitando replay de um plano velho.
   */
  const aplicarSugestao = useCallback(async (blocos: BlocoSugerido[]) => {
    if (aplicandoSugestao.current) return;
    const proposta = propostaRef.current;
    propostaRef.current = null;
    const conferirDia = () => {
      if (!proposta || proposta.dia !== contexto.current.date || proposta.org !== contexto.current.orgId)
        throw new Error('The day changed. Create a new suggestion.');
    };
    aplicandoSugestao.current = true;
    let salvos = 0;
    try {
      conferirDia();
      if (proposta!.blocos !== blocos) throw new Error('Create a new suggestion.');
      if (!(await carregarDia()) || !(await carregarRotas())) throw new Error('Could not refresh the day.');
      conferirDia();
      if (assinaturaDaSugestao() !== proposta!.assinatura || routesRef.current.some(r => fila.pendente(r.routeId)))
        throw new Error('The routes or dogs changed.');
      const atribuidos = new Set(routesRef.current.flatMap(r => r.stops.map(s => s.dogId)));
      for (const bloco of blocos) {
        conferirDia();
        let routeId = routesRef.current.find(r => r.driverId === bloco.driverId)?.routeId;
        if (!routeId) {
          const { data, error } = await supabase.from('routes').insert({
            organization_id: proposta!.org, route_date: proposta!.dia, driver_id: bloco.driverId, status: 'draft',
          }).select('id, lock_version').single();
          if (error) throw new Error(error.message);
          routeId = (data as { id: string }).id;
          versoes.current[routeId] = (data as { lock_version: number | null }).lock_version ?? 1;
        }
        for (const cao of bloco.caes) {
          conferirDia();
          if (atribuidos.has(cao.dogId)) throw new Error('A dog is already assigned.');
          const { error } = await supabase.rpc('assign_stop_to_route', {
            p_route_id: routeId, p_dog_id: cao.dogId, p_window_start: null, p_window_end: null,
            p_exact_time: null, p_priority: 'normal', p_esperado: versaoDe(routeId),
          });
          falhaDeEscrita(error);
          versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
          atribuidos.add(cao.dogId);
          salvos++;
        }
      }
    } catch (erro) {
      throw new Error(`${salvos} dogs saved. ${erro instanceof Error ? erro.message : 'Could not apply.'} Create a new suggestion to continue.`);
    } finally {
      try { await carregarRotas(); } finally { aplicandoSugestao.current = false; }
    }
  }, [carregarDia, carregarRotas, assinaturaDaSugestao, fila, versaoDe, falhaDeEscrita]);

  const saveStopConstraint = useCallback(async (routeId: string, dogId: string, constraint: DispatchConstraint) => {
    const parada = routesRef.current.find((rota) => rota.routeId === routeId)?.stops.find((stop) => stop.dogId === dogId);
    if (parada && parada.windowStart === constraint.windowStart && parada.windowEnd === constraint.windowEnd
      && parada.exactTime === constraint.exactTime && parada.priority === constraint.priority) return;
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

  const savePins = useCallback(async (routeId: string, dogId: string, travas: Travas) => {
    await fila.aguardar(routeId);
    const parada = routesRef.current.find((rota) => rota.routeId === routeId)?.stops.find((stop) => stop.dogId === dogId);
    if (!parada) return;
    gravandoOrdens.current.add(routeId);
    try {
      for (const perna of ['pickup', 'dropoff'] as const) {
        const antes = pinDaParada(parada, perna);
        const depois = pinDaParada(travas, perna);
        if (antes?.tipo === depois?.tipo && (antes?.tipo !== 'fixed' || antes.posicao === depois?.posicao)) continue;
        const { error } = await supabase.rpc('set_stop_order_pin', {
          p_route_id: routeId, p_dog_id: dogId, p_leg: perna, p_pin: depois?.tipo ?? null,
          p_pin_position: depois?.tipo === 'fixed' ? depois.posicao : null, p_esperado: versaoDe(routeId),
        });
        falhaDeEscrita(error);
        versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
        revisoes.current[routeId] = (revisoes.current[routeId] ?? 0) + 1;
      }
    } finally {
      gravandoOrdens.current.delete(routeId);
      await carregarRotas();
    }
  }, [fila, versaoDe, falhaDeEscrita, carregarRotas]);

  const removeStop = useCallback(async (routeId: string, dogId: string) => {
    const { error } = await supabase.from('route_stops').delete().eq('route_id', routeId).eq('dog_id', dogId);
    falhaDeEscrita(error);
    await marcarRotaAlterada(routeId);
    await carregarRotas();
  }, [falhaDeEscrita, marcarRotaAlterada, carregarRotas]);

  const pernasPendentes = useRef<Record<string, Set<Perna>>>({});
  const moverNaPerna = useCallback(async (routeId: string, dogId: string, direction: -1 | 1, perna: Perna) => {
    const rota = routesRef.current.find((item) => item.routeId === routeId);
    if (!rota) return;
    const base = perna === 'pickup' ? rota.stops : ordemDaEntrega(rota.stops).map((stop, i) => ({ ...stop, sequence: i + 1 }));
    const troca = trocarNaOrdem(base, dogId, direction);
    const ordem = perna === 'pickup' ? troca : troca?.map((stop, i) => ({
      ...stop, sequence: rota.stops.find((original) => original.dogId === stop.dogId)!.sequence, dropoffSequence: i + 1,
    }));
    if (!ordem) return;
    revisoes.current[routeId] = (revisoes.current[routeId] ?? 0) + 1;
    atualizarRotas(routesRef.current.map((item) => item.routeId === routeId ? { ...item, stops: ordem } : item));
    const jaPendente = fila.pendente(routeId);
    const pernas = pernasPendentes.current[routeId] ?? new Set<Perna>();
    pernas.add(perna);
    pernasPendentes.current[routeId] = pernas;
    const escrita = fila.enfileirar(routeId, {
      pickup: ordemDaBusca(ordem).map((item) => item.dogId),
      dropoff: ordemDaEntrega(ordem).map((item) => item.dogId), pernas: new Set(pernas),
    });
    // Uma única observação de erro por lote, mesmo com vários toques.
    if (jaPendente) return;
    try {
      await escrita;
    } catch (erro) {
      showAlert(isStaleRouteError(erro as { message: string }) ? STALE_ROUTE_TITLE : 'Unable to reorder stops', routeErrorMessage(erro as { message: string }));
      await carregarRotas();
    } finally {
      delete pernasPendentes.current[routeId];
    }
  }, [fila, atualizarRotas, carregarRotas]);
  const moveStop = useCallback((routeId: string, dogId: string, direction: -1 | 1) => moverNaPerna(routeId, dogId, direction, 'pickup'), [moverNaPerna]);
  const moveDropoff = useCallback((routeId: string, dogId: string, direction: -1 | 1) => moverNaPerna(routeId, dogId, direction, 'dropoff'), [moverNaPerna]);

  const publish = useCallback(async (routeId: string) => {
    const { error } = await supabase.rpc('publish_route', { p_route_id: routeId, p_esperado: versaoDe(routeId) });
    falhaDeEscrita(error);
    await carregarRotas();
  }, [versaoDe, falhaDeEscrita, carregarRotas]);

  /**
   * Fechar, despublicar ou cancelar TIRA a rota da tela do motorista (ele só lê `status = 'published'`).
   * Com parada ainda pendente, o gestor tem de ver quantas são e QUAIS cães ficam sem a rota, e dar
   * o ok — cancelar não muda nada. Sem pendência, a ação acontece direto como sempre. O texto sai do
   * módulo puro `routeClosing`; aqui só entra a decisão de quando perguntar.
   * Incidente de 30/09/2026: rota fechada com as 3 paradas pendentes 1 s depois de publicada.
   * O ✕ (cancelar) entrou na mesma proteção em 01/10/2026 — era o único que saía sem perguntar.
   */
  const fecharComAviso = useCallback(
    async (routeId: string, acao: FechamentoDeRota, aplicar: () => Promise<void>) => {
      const rota = routesRef.current.find((item) => item.routeId === routeId);
      const pendentes = paradasPendentes(rota?.stops ?? []);
      if (pendentes.length === 0) {
        await aplicar();
        return;
      }
      const aviso = avisoDeFechamento(acao, pendentes);
      showAlert(aviso.title, aviso.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: aviso.confirmLabel, onPress: () => { void aplicar(); } },
      ]);
    },
    [],
  );

  // Volta a rota para rascunho: o motorista deixa de ver a rota, mas nada e apagado.
  const unpublish = useCallback(async (routeId: string) => {
    await fecharComAviso(routeId, 'unpublish', () => trocarStatus(routeId, { status: 'draft', published_at: null }));
  }, [fecharComAviso, trocarStatus]);

  // Cancela a rota (status cancelado): sai da operacao e sai da tela do motorista — mesma protecao
  // dos outros dois botoes (com parada pendente, o gestor le quais caes ficam sem a rota e confirma).
  const cancelRoute = useCallback(async (routeId: string) => {
    await fecharComAviso(routeId, 'cancel', () => trocarStatus(routeId, { status: 'cancelled' }));
  }, [fecharComAviso, trocarStatus]);

  // Fecha a rota: ela sai da operacao (motorista deixa de ver) e entra no historico.
  const completeRoute = useCallback(async (routeId: string) => {
    await fecharComAviso(routeId, 'complete', () => trocarStatus(routeId, { status: 'completed' }));
  }, [fecharComAviso, trocarStatus]);

  const optimize = useCallback(async (routeId: string) => {
    const route = routesRef.current.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const versao = versaoDe(routeId);
    const sorted = ordemDaBusca(route.stops);
    const finished = sorted.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
    const remaining = sorted.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
    if (sorted.length < 2) return;

    // Tempos reais de transito (servidor). Sem funcao/chave/internet, cai na estimativa de
    // linha reta e o gestor nem percebe atraso: a espera e limitada por timeout curto.
    const traffic = await fetchTravelTimes(sorted.map((stop) => ({
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
      // 3 min de serviço por pick-up (pedido do cliente, 30/09/2026 "três minutinhos por pick-up"):
      // até aqui a tela NÃO passava nada e o otimizador usava o padrão de 8 min. O número é o MESMO
      // da tolerância de atraso do motorista (GRACE_MINUTES) — decisão do dono, um valor só.
      { travel: traffic.travel, serviceMinutes: GRACE_MINUTES },
    );
    if (!result.feasible) {
      showAlert('Cannot optimize this route', result.reason ?? 'The schedule is infeasible.');
      return;
    }
    // As janelas existentes são de busca; a entrega usa a mesma matriz, sem janelas da manhã.
    const entrega = optimizeRoute(ordemDaEntrega(sorted).map((stop) => ({
      ...stop, windowStart: null, windowEnd: null, exactTime: null,
    })), { travel: traffic.travel, serviceMinutes: GRACE_MINUTES });
    if (!entrega.feasible) {
      showAlert('Cannot optimize this route', entrega.reason ?? 'The schedule is infeasible.'); return;
    }
    const travasBusca = sorted.map((stop) => ({ dogId: stop.dogId, pin: pinDaParada(stop, 'pickup') }));
    // Concluídas ocupam o início; qualquer trava incompatível aparece como conflito.
    const busca = ordenarComTravas([...finished, ...result.stops], [
      ...finished.map((stop, i) => ({ dogId: stop.dogId, pin: { tipo: 'fixed' as const, posicao: i + 1 } })),
      ...travasBusca,
    ], sorted.length);
    const volta = ordenarComTravas(entrega.stops, sorted.map((stop) => ({ dogId: stop.dogId, pin: pinDaParada(stop, 'dropoff') })), sorted.length);
    const linhas = (ordem: { dogName: string }[]) => ordem.map((stop, i) => `• ${i + 1}. ${stop.dogName}`).join('\n');
    const conflitos = (resultado: typeof busca, perna: string) => resultado.conflitos.map((conflito) =>
      `${perna}: ${conflito.motivo === 'collision' ? 'Conflicting locks' : 'Position outside route'} #${conflito.posicao}: ${conflito.dogIds.map((id) => sorted.find((stop) => stop.dogId === id)?.dogName ?? id).join(', ')}`);
    const mensagem = `Pick-up:\n${linhas(busca.ordem)}\n\nDrop-off:\n${linhas(volta.ordem)}\n\n${[...conflitos(busca, 'Pick-up'), ...conflitos(volta, 'Drop-off')].join('\n')}`;
    const origem = traffic.source === 'live' ? 'live traffic' : 'estimated times';
    showAlert(`Optimized route (${origem})`, mensagem, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Apply',
        onPress: () => {
          gravandoOrdens.current.add(routeId);
          void Promise.resolve(supabase.rpc('apply_route_order', {
            p_route_id: routeId, p_pickup_ids: busca.ordem.map((stop) => stop.dogId),
            p_dropoff_ids: ordemDaEntrega(volta.ordem.map((stop, i) => ({ ...stop, dropoffSequence: i + 1 }))).map((stop) => stop.dogId),
            p_esperado: versao,
          })).then(({ error }) => {
            if (!error) {
              versoes.current[routeId] = (versao ?? 1) + 1;
              revisoes.current[routeId] = (revisoes.current[routeId] ?? 0) + 1;
            }
            if (error) showAlert(isStaleRouteError(error) ? STALE_ROUTE_TITLE : 'Unable to apply the route', routeErrorMessage(error));
          }).catch((erro: { message: string }) => {
            showAlert('Unable to apply the route', routeErrorMessage(erro));
          }).finally(() => {
            gravandoOrdens.current.delete(routeId);
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
          onSuggestRoutes={sugerirRotasDoDia}
          onApplySuggestion={aplicarSugestao}
          onSaveStop={saveStopConstraint}
          onRemoveStop={removeStop}
          onMoveStop={moveStop}
          onMoveDropoff={moveDropoff}
          onSavePins={savePins}
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
