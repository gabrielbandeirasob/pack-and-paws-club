import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { buildDay, transportPool, transportPoolForPhase, vanPool, type DogRef, type RecurringExceptionRecord, type RecurringScheduleRecord, type ReservationRecord } from '@/features/calendar/dayMath';
import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { DispatchBoard, type DispatchSuggestion, type DispatchSuggestionBlock, type DispatchConstraint, type DispatchDriver, type DispatchRoute, type DispatchStopItem, type DispatchVan } from '@/features/dispatch/DispatchBoard';
import { juntarIrmaosDeCasa, vaoJunto } from '@/features/dispatch/houseMates';
import { avisoDeFalhaParcial, type FalhaParcial } from '@/features/dispatch/partialWrite';
import { criarFilaDeEscrita, trocarNaOrdem } from '@/features/dispatch/reorderQueue';
import { ordemDaBusca, ordemDaEntrega, ordenarComTravas, pinDaParada, type Travas, type Perna } from '@/features/dispatch/orderPins';
import { avisoDeFechamento, paradasPendentes, type FechamentoDeRota } from '@/features/dispatch/routeClosing';
import { minutosDaOrdem, optimizeRoute } from '@/features/dispatch/routeOptimizer';
import { GRACE_MINUTES } from '@/features/driver/eta';
import { STALE_ROUTE_TITLE, expectedVersion, isStaleRouteError, routeErrorMessage } from '@/features/dispatch/staleRoute';
import { fetchTravelTimes } from '@/features/dispatch/trafficProvider';
import type { TravelTimes } from '@/features/dispatch/travelMatrix';
import { showAlert } from '@/features/ui/alert';
import { colors } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { loadOrganizationLocations, origemDaEntregaDaRota, vanDaRota, vanLocationForRoute, yardDaOrganizacao } from '@/features/organization/locations';
import { motoristaDoPickupPorCao, sugerirRotas, type CaoParaSugerir } from '@/features/dispatch/routeSuggestion';

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
  travel_seconds?: number | null;
  dropoff_travel_seconds?: number | null;
  dog: { id: string; name: string; client: { id?: string; name: string; latitude: number | null; longitude: number | null } };
};
type RouteRow = { phase?: Perna; id: string; driver_id: string; status: DispatchRoute['status']; lock_version: number | null; start_location_id?: string | null; end_location_id?: string | null; route_stops: StopRow[] | null };
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

/**
 * Erro JÁ relatado por extenso: a frase de falha parcial já diz quantos cães entraram e quais ficaram
 * de fora, então o `catch` do `aplicarSugestao` não pode prefixar "N dogs saved" outra vez.
 */
function erroParcial(mensagem: string): Error {
  return Object.assign(new Error(mensagem), { parcial: true });
}

export default function DispatchScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalISO());
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [dayItems, setDayItems] = useState<DispatchStopItem[]>([]);
  /**
   * A mesma fila do dia num ref: a atribuição precisa saber quem mora junto (mesmo cliente) no momento
   * do toque, sem depender do estado capturado no `useCallback`. Áudio do dono, 29/09/2026.
   */
  const itensDoDia = useRef<DispatchStopItem[]>([]);
  // The migration is deployed separately. Missing phase keeps the legacy pickup path usable.
  const fasesDisponiveis = useRef(false);
  const itensDropoff = useRef<DispatchStopItem[]>([]);
  const [dropoffItems, setDropoffItems] = useState<DispatchStopItem[]>([]);
  /** Cães do cadastro (para o gestor adicionar um que não está no calendário do dia). */
  const [caesCadastro, setCaesCadastro] = useState<DogRef[]>([]);
  /**
   * ENDEREÇO DE CADA CÃO (por `dogId`) — a sugestão de rota é geográfica, e a fila do dia montada pelo
   * calendário não carrega coordenada. O mapa sai da MESMA consulta do dia, sem ida extra ao banco.
   */
  const coordenadasPorCao = useRef<Map<string, Coordenada>>(new Map());
  /**
   * Sede PADRÃO da organização, para gravar na rota quando ela nasce (item 1/3 da conferência do dono,
   * 01/10/2026). As rotas nasciam com `start_location_id` NULL e, sem ele, a trava do clock-in e a
   * sugestão caíam na van padrão — que estava apontando para um cadastro de TESTE em outra cidade.
   */
  const sedePadraoId = useRef<string | null>(null);
  /**
   * O YARD da organização (pedido do cliente, 02/10/2026: *"as rota de pick up não tão acabando no
   * yard"*). A rota nasce com esse ponto como FIM, para o dia fechar onde os cães ficam.
   */
  const yardId = useRef<string | null>(null);
  /** Coordenadas do yard: onde a BUSCA termina e de onde a ENTREGA começa (cliente, 02/10/2026). */
  const yardCoords = useRef<{ latitude: number; longitude: number } | null>(null);
  /**
   * VANS DA ORGANIZAÇÃO + a van ESCOLHIDA por motorista (pergunta do dono, 01/10/2026: *"vamos supor que
   * tenhas várias vans, o erro não vai se repetir?"*). A escolha vale para a rota que já existe (update
   * imediato) e para a rota que ainda vai nascer (o mapa é lido na criação).
   */
  const [vans, setVans] = useState<DispatchVan[]>([]);
  const vanPorMotorista = useRef<Map<string, string>>(new Map());
  /**
   * Cães adicionados À MÃO pelo gestor. Guardados num ref (e não no estado) para sobreviverem ao
   * recarregamento: o carregamento reconstrói a fila a partir do calendário, e sem isso o cão manual
   * sumiria da tela a cada atualização. Pedido do dono (23/09/2026).
   */
  const [planningPhase, setPlanningPhase] = useState<Perna>('pickup');
  const extrasRef = useRef<Record<Perna, DogRef[]>>({ pickup: [], dropoff: [] });
  const [routes, setRoutes] = useState<DispatchRoute[]>([]);
  // Versao de cada rota (lock otimista): o aparelho guarda o que leu; se outro gestor
  // escrever antes, o banco recusa a escrita velha com 'stale_route' em vez de sobrescrever.
  const versoes = useRef<Record<string, number>>({});
  const routesRef = useRef<DispatchRoute[]>([]);
  const propostaRef = useRef<{ dia: string; org: string; assinatura: string; blocos: DispatchSuggestionBlock[] } | null>(null);
  const aplicandoSugestao = useRef(false);
  const membrosDoDia = useRef<DriverRow[]>([]);
  const revisoes = useRef<Record<string, number>>({});
  const contexto = useRef({ orgId: '', date });
  const diaDasRotas = useRef(date);
  const leituraRotas = useRef(0);
  /**
   * A última carga de rotas do dia DEU CERTO? (dono, 04/10/2026)
   *
   * A conferência da atribuição usava `routesRef.current.length === 0` como se fosse "sem dados" — mas
   * ZERO ROTAS é um resultado VÁLIDO (dia sem rota viva: nenhuma publicada, ou todas canceladas). Com o
   * quadro vazio a conferência era PULADA e a folha fechava como se tivesse atribuído, com o cão indo
   * parar numa rota cancelada. Este sinal diz o que interessa: "a leitura online do dia funcionou".
   */
  const rotasCarregadasOk = useRef(false);
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
    if (planningPhase === 'dropoff' && itensDoDia.current.some(item => item.dogId === dog.id && (item.inVan || item.reservationKind === 'boarding'))) {
      showAlert('No drop-off for boarding', 'Boarding dogs finish the day in the van.');
      return;
    }
    if (!extrasRef.current[planningPhase].some((item) => item.id === dog.id)) extrasRef.current[planningPhase] = [...extrasRef.current[planningPhase], dog];
    const setItems = planningPhase === 'pickup' ? setDayItems : setDropoffItems;
    setItems((prev) => {
      if (prev.some((item) => item.dogId === dog.id)) return prev;
      const novo = { dogId: dog.id, clientName: dog.clientName, dogName: dog.dogName, inVan: false, extra: true, clientId: dog.clientId ?? null };
      const novos = juntarIrmaosDeCasa([...prev, novo]);
      if (planningPhase === 'pickup') itensDoDia.current = novos;
      else itensDropoff.current = novos;
      return novos;
    });
  }, [planningPhase]);

  /**
   * AS VANS DA ORGANIZAÇÃO (id, rótulo e qual é a padrão).
   *
   * ⚠️ Nasceu separada do `carregarDia` por um defeito real (01/10/2026): o dono cadastrou a **Van 2** e
   * ela não apareceu no cartão do motorista. A lista de vans era lida DENTRO do "dia", que tem trava de
   * 2 minutos e não escuta `organization_locations` — então quem cadastrava uma van voltava para o
   * Dispatch e continuava vendo a lista velha (com uma van só, o seletor nem existe). Agora tem carga
   * própria: no foco da tela e por tempo real da tabela de vans.
   */
  const carregarVans = useCallback(async (orgId: string) => {
    try {
      const carregadas = await loadOrganizationLocations(supabase, orgId);
      /**
       * A VAN do dia (sede padrão) NUNCA pode ser o yard: `vanLocationForRoute` já filtra o yard (ele
       * não é van). O dono relatou (02/10/2026) que o yard aparecia "na lista de vans" — se ele fosse
       * marcado como padrão por engano, o dia começaria (e o clock in travaria) no yard.
       */
      sedePadraoId.current = vanLocationForRoute(carregadas, null)?.id ?? null;
      const yard = yardDaOrganizacao(carregadas);
      yardId.current = yard?.id ?? null;
      // A 1ª perna da ENTREGA parte do YARD (dono, 02/10/2026). Sem yard, null — nunca a van.
      yardCoords.current = origemDaEntregaDaRota(yard);
      /**
       * O cartão do motorista recebe TODAS as sedes COM o `kind`, para separar "van (onde o dia começa)"
       * de "yard (onde o pick-up termina)" — o dono via "van 1, van 2, yard" e perguntava "não é uma van
       * o yard" (02/10/2026). O endereço entra junto: "ele tem que ter o endereço que vai finalizar".
       */
      setVans(carregadas.map((local) => ({
        id: local.id,
        name: local.name,
        isDefault: local.isDefault,
        kind: local.kind,
        address: [local.addressLine1, local.city].filter((parte) => (parte ?? '').length > 0).join(' · ') || null,
      })));
    } catch {
      // Best-effort: sem a lista o cartão fica como era (sem o seletor) — não derruba o dia por isso.
      sedePadraoId.current = null;
      yardId.current = null;
      yardCoords.current = null;
    }
  }, []);

  const carregarDia = useCallback(async () => {
    const { orgId, date: dia } = contexto.current;
    /**
     * 🪤 ACHADO DA AUDITORIA (02/10/2026): o Dispatch lia o histórico INTEIRO de reservas e exceções a
     * cada carga (sem data nem limite) — a tela ia ficando lenta a cada mês de uso e o índice de data
     * nem era usado. A MESMA janela da Home (−30 dias atrás, +180 à frente) acompanha o dia.
     */
    const janelaDe = addDaysISO(dia, -30);
    const janelaAte = addDaysISO(dia, 180);
    const [driverResult, reservationResult, recurringResult, exceptionResult, dogResult] = await Promise.all([
      /**
       * Quem pode receber rota: motoristas E gestores. O gestor também faz pick-up/drop-off (áudio do
       * dono, 27/09/2026) e precisa aparecer aqui para pegar uma rota — sem conta nova e sem
       * segundo vínculo. Na tela ele aparece marcado como "· manager".
       */
      supabase.from('organization_members').select('user_id, role, profiles(full_name)').eq('organization_id', orgId).in('role', ['driver', 'manager']).eq('status', 'active'),
      supabase.from('reservations').select('id, service_type, start_date, end_date, transport_required, goes_to_daycare, dog:dogs(id, name, client:clients(id, name, latitude, longitude))').eq('organization_id', orgId).eq('status', 'confirmed').gte('end_date', janelaDe).lte('start_date', janelaAte),
      supabase.from('recurring_schedules').select('id, weekdays, start_date, end_date, active, transport_required, dog:dogs(id, name, client:clients(id, name, latitude, longitude))').eq('organization_id', orgId).eq('active', true),
      supabase.from('recurring_exceptions').select('id, recurring_schedule_id, action, start_date, end_date').eq('organization_id', orgId).gte('end_date', janelaDe).lte('start_date', janelaAte),
      // Cadastro completo (cão ativo): alimenta o "Add any dog" do Dispatch.
      supabase.from('dogs').select('id, name, client:clients(id, name, latitude, longitude)').eq('organization_id', orgId).eq('active', true),
    ]);
    if (dia !== contexto.current.date) return;
    /*
     * A sede PADRÃO da organização é lida junto do dia — em PARALELO e sem bloquear a carga (best-effort):
     * é ela que vai gravada na rota que nasce. Esperar por esta consulta aqui travava a tela do Dispatch
     * quando a consulta demorava (o dia não aparecia), e sem ela a rota nascia com `start_location_id`
     * NULL — que era o defeito original (item 1/3 da conferência, 01/10/2026).
     */
    void carregarVans(orgId);
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
    const poolEntrega = transportPoolForPhase(day, 'dropoff');
    const boardingIds = new Set(day.boarding.map(item => item.dogId));
    const entregas = juntarIrmaosDeCasa([
      ...poolEntrega.map(item => ({ dogId: item.dogId, clientName: item.clientName, dogName: item.dogName, clientId: item.clientId, reservationKind: item.kind })),
      ...extrasRef.current.dropoff.filter(dog => !boardingIds.has(dog.id) && !poolEntrega.some(item => item.dogId === dog.id))
        .map(dog => ({ dogId: dog.id, dogName: dog.dogName, clientName: dog.clientName, clientId: dog.clientId, extra: true })),
    ]);
    itensDropoff.current = entregas;
    setDropoffItems(entregas);
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
      ...extrasRef.current.pickup.filter((extra) => !jaNoDia.has(extra.id)).map((extra) => ({ dogId: extra.id, clientName: extra.clientName, dogName: extra.dogName, inVan: false, extra: true, clientId: extra.clientId ?? null })),
    ]);
    itensDoDia.current = itens;
    setDayItems(itens);
    return true;

  }, [carregarVans]);

  const carregarRotas = useCallback(async () => {
    const { orgId, date } = contexto.current;
    const consulta = ++leituraRotas.current;
    const leitura = { ...revisoes.current };
    const pendentes = new Set(routesRef.current.filter((rota) => (fila.pendente(rota.routeId) || gravandoOrdens.current.has(rota.routeId))).map((rota) => rota.routeId));
    const campos = 'id, driver_id, status, lock_version, start_location_id, end_location_id, route_stops(dog_id, pickup_pin, pickup_pin_position, dropoff_pin, dropoff_pin_position, dropoff_sequence, sequence, status, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, travel_seconds, dropoff_travel_seconds, dog:dogs(id, name, client:clients(id, name, latitude, longitude)))';
    let routeResult: { data: unknown; error: { code: string; message: string } | null } = await supabase.from('routes').select(`phase, ${campos}`).eq('organization_id', orgId).eq('route_date', date);
    const semFase = routeResult.error && ['42703', 'PGRST204'].includes(routeResult.error.code) && /phase/.test(routeResult.error.message);
    if (semFase) routeResult = await supabase.from('routes').select(campos).eq('organization_id', orgId).eq('route_date', date);
    if (date !== contexto.current.date || consulta !== leituraRotas.current) return;
    fasesDisponiveis.current = !semFase && !routeResult.error;
    if (routeResult.error) { rotasCarregadasOk.current = false; falhou('rotas', routeResult.error.message); return; }
    falhou('rotas', null);
    // Rota CANCELADA não ocupa mais a tela do dia (dono, 04/10/2026: os cães voltam para não-atribuídos e a
    // rota sai do quadro). O histórico do dia continua válido para as rotas fechadas (completed).
    const routeRows = ((routeResult.data as unknown as RouteRow[]) ?? []).filter((row) => row.status !== 'cancelled');
    const protegida = (id: string) => gravandoOrdens.current.has(id) || fila.pendente(id) || pendentes.has(id) || leitura[id] !== revisoes.current[id];
    routeRows.forEach((row) => {
      if (!protegida(row.id)) versoes.current[row.id] = row.lock_version ?? 1;
    });
    const novas: DispatchRoute[] = routeRows.map((row) => ({
      routeId: row.id,
      phase: row.phase,
      driverId: row.driver_id,
      status: row.status,
      // A van escolhida para ESTA rota (é o que o cartão mostra marcado).
      startLocationId: row.start_location_id ?? null,
      // O yard escolhido para ESTA rota (`routes.end_location_id`) — lido pelo fim do dia do motorista.
      endLocationId: row.end_location_id ?? null,
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
        travelSeconds: stop.travel_seconds ?? null,
        dropoffTravelSeconds: stop.dropoff_travel_seconds ?? null,
      })),
    }));
    const atuais = diaDasRotas.current === date ? routesRef.current : [];
    diaDasRotas.current = date;
    atualizarRotas(novas.map((rota) => {
      const anterior = atuais.find((atual) => atual.routeId === rota.routeId);
      return anterior && (protegida(rota.routeId) || JSON.stringify(anterior) === JSON.stringify(rota)) ? anterior : rota;
    })
      .concat(atuais.filter((rota) => protegida(rota.routeId) && !novas.some((nova) => nova.routeId === rota.routeId))));
    rotasCarregadasOk.current = true;
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
    // Van cadastrada/editada em outro aparelho (ou na tela Van & yard) vale na hora: consulta leve,
    // sem passar pela trava do dia.
    const atualizarVans = () => void carregarVans(organizationId);
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
      // Filtro por organização (auditoria 02/10/2026): sem ele, o tempo real recebia as paradas de QUALQUER org.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `organization_id=eq.${organizationId}` }, atualizarPosicoes)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organization_locations', filter: `organization_id=eq.${organizationId}` }, atualizarVans)
      .subscribe();
    return () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      if (posicoes) clearTimeout(posicoes);
      void supabase.removeChannel(channel);
    };
  }, [organizationId, carregarDia, carregarRotas, carregarPosicoes, carregarVans]);

  /**
   * AO VOLTAR PARA ESTA TELA as vans são relidas (defeito de 01/10/2026: o dono cadastrou a Van 2, voltou
   * para o Dispatch e o seletor não aparecia — a lista só era lida dentro do "dia", com trava de 2 min).
   * É o caminho humano normal: Van & yard → cadastrar → voltar para o Dispatch.
   */
  useFocusEffect(
    useCallback(() => {
      if (organizationId) void carregarVans(organizationId);
    }, [organizationId, carregarVans]),
  );

  /**
   * LISTA DE PARADAS com a hora de cada uma — a MESMA tela que a Home abre pelo cartão do motorista
   * (`/route-stops`). Aqui dentro do Dispatch porque foi onde o dono procurou (01/10/2026: *"cliquei no
   * cartao do driver e nao vi nada disso"*).
   */
  const abrirListaDeParadas = useCallback(
    (routeId: string, driverName: string) => {
      router.push({ pathname: '/route-stops', params: { route: routeId, driver: driverName, day: date } });
    },
    [router, date],
  );

  const versaoDe = useCallback((routeId: string) => expectedVersion(versoes.current, routeId), []);

  // Dois gestores na mesma rota: avisa e recarrega, em vez de deixar a escrita velha passar.
  // POLIMENTO (05/10/2026): o aviso era `Alert` nativo (botão azul/cinza, "parecia desabilitado").
  // Agora é um modal do PRÓPRIO quadro, com a ação primária no verde do app.
  const [rotaMudou, setRotaMudou] = useState(false);
  const avisarRotaMudou = useCallback(() => {
    setRotaMudou(true);
  }, []);
  const recarregarRotas = useCallback(() => {
    setRotaMudou(false);
    void carregarRotas();
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
      // 0 linha = a versão já andou (outro aparelho mexeu): avisa em vez de seguir calado.
      const { data } = await supabase
        .from('routes')
        .update({ lock_version: versao + 1 })
        .eq('id', routeId)
        .eq('lock_version', versao)
        .select('id');
      if ((data ?? []).length === 0) avisarRotaMudou();
    },
    [versaoDe, avisarRotaMudou],
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
      // A versão no banco virou `versao + 1` (é o valor que mandamos): guardar AGORA evita que a
      // próxima ação mande a versão velha e seja recusada como `stale_route` — o alarme falso de
      // "outro aparelho" quando, na verdade, foi a nossa própria gravação (05/10/2026).
      if (versao !== null) versoes.current[routeId] = versao + 1;
      await carregarRotas();
    },
    [versaoDe, falhaDeEscrita, avisarRotaMudou, carregarRotas],
  );

  /** Nome do cão para as mensagens de falha (a fila do dia é a fonte; sem ele, o próprio id). */
  const nomeDoCao = useCallback(
    (dogId: string) => itensDoDia.current.find((item) => item.dogId === dogId)?.dogName ?? dogId,
    [],
  );

  /** Nome do motorista para as mensagens da trava da entrega. */
  const nomeDoMotorista = useCallback(
    (driverId: string) =>
      membrosDoDia.current.find((membro) => membro.user_id === driverId)?.profiles?.full_name?.trim() || 'that driver',
    [],
  );

  /**
   * TRAVA DO DONO (03/10/2026): *"não faz sentido eu colocar o pick-up de um cachorro com um motorista
   * e depois o drop-off com outro"* — o cão desce com quem o buscou, sem exceção. `motoristaDoPickup`
   * é o motorista do pick-up de cada cão do dia (rota sem `phase` é pick-up: é a DEFAULT da migração
   * 202610020053). É a fonte da regra em três lugares: na sugestão (o cão já nasce no bloco dele), na
   * atribuição à mão (recusa outro motorista) e ao criar a perna de drop-off (só leva os cães dele).
   */
  const motoristaDoPickup = useCallback(() => motoristaDoPickupPorCao(routesRef.current), []);

  /** Frase única da recusa — o gestor lê quem buscou e por que não muda. */
  const motivoDaTrava = useCallback(
    (dogId: string, driverId: string) => {
      const dono = motoristaDoPickup().get(dogId);
      if (!dono || dono === driverId) return null;
      return `${nomeDoCao(dogId)} was picked up by ${nomeDoMotorista(dono)} — the drop-off has to stay with ${nomeDoMotorista(dono)}.`;
    },
    [motoristaDoPickup, nomeDoCao, nomeDoMotorista],
  );

  /**
   * A van que vai GRAVADA numa rota que nasce (dono, 01/10/2026 — organização com várias vans):
   *  1. a van que o gestor escolheu para aquele motorista no cartão;
   *  2. sem escolha e com UMA van cadastrada, a padrão (explícito e estável — o mundo de hoje);
   *  3. com DUAS ou mais e nenhuma escolha, NENHUMA (`undefined`): a rota fica sem van de propósito para
   *     o app resolver pela MAIS PRÓXIMA das paradas. É isso que impede a repetição do defeito de
   *     01/10/2026, quando toda rota nascia apontando para a van padrão (que era um cadastro de teste).
   *
   * ⚠️ "UMA van" conta só VANS de verdade: o YARD não é van (dono, 02/10/2026). Sem isso, uma organização
   * com uma van e um yard cairia no caso 3 e a rota nasceria sem van, apesar de só existir uma escolha.
   */
  const totalDeVans = useMemo(() => vans.filter((van) => van.kind !== 'yard').length, [vans]);
  const vanParaRota = useCallback(
    (driverId: string) =>
      vanPorMotorista.current.get(driverId) ?? (totalDeVans <= 1 ? sedePadraoId.current : null) ?? undefined,
    [totalDeVans],
  );

  /**
   * REATIVA a rota do dia que estava CANCELADA (dono, 05/10/2026 — *"tentei fazer o dispatch e não iam
   * para o driver"*, com prints do quadro em 0 stops e da folha de atribuição girando).
   *
   * 🪤 O BURACO: o X cancela a rota e ela sai do quadro (`carregarRotas` filtra `cancelled`). Ao atribuir
   * de novo, o app não encontra rota viva, tenta CRIAR outra — e o banco recusa (UNIQUE
   * `routes_organization_date_driver_phase_key`, erro 23505). O caminho do 23505 relia a rota do dia
   * **sem olhar o status** e devolvia a CANCELADA: a RPC gravava as paradas lá dentro, o motorista nunca
   * recebia (o app dele lê só `published`) e o cão continuava em UNASSIGNED, como se nada tivesse
   * acontecido.
   *
   * Medido no banco de produção em 04/10/2026: a rota `d2347318…` (pickup, Gabriel) estava `cancelled`
   * com **2 paradas criadas DEPOIS do cancelamento** (Ellie 11:25:16Z e Duke 11:26:42Z) — os dois toques
   * do dono no print.
   *
   * A saída é a rota voltar a viver: `draft`, com a trava de versão do resto do quadro. Reativar mantém
   * as paradas que já estavam nela (os cães que o gestor acabou de atribuir) e o fluxo segue normal — o
   * gestor publica quando quiser.
   */
  const reativarRotaCancelada = useCallback(
    async (routeId: string, versao: number | null) => {
      let consulta = supabase
        .from('routes')
        .update({ status: 'draft', lock_version: (versao ?? 1) + 1 })
        .eq('id', routeId)
        .eq('status', 'cancelled');
      if (versao !== null) consulta = consulta.eq('lock_version', versao);
      const { data, error } = await consulta.select('id, lock_version');
      falhaDeEscrita(error);
      if ((data ?? []).length === 0) {
        // Outro aparelho mexeu na rota (ou ela já não está cancelada): nada de seguir calado.
        avisarRotaMudou();
        throw new Error(routeErrorMessage('stale_route'));
      }
      showAlert(
        'Route reactivated',
        "This driver's route for the day had been cancelled and the stops were going nowhere. It is back as a draft — publish it so the driver receives the stops.",
      );
      const nova = (data as { lock_version?: number | null }[])[0]?.lock_version;
      return nova ?? null;
    },
    [avisarRotaMudou, falhaDeEscrita],
  );

  /**
   * A rota do motorista naquele dia: **cria se não existir e NUNCA mexe no que já existe**.
   *
   * 🪤 ACHADO DA VISTORIA (02/10/2026) — era um `upsert` com `status: 'draft'` e o `assign` chama esta
   * função SEMPRE (mesmo quando a rota já existe). Resultado: atribuir um cão a um motorista que já
   * estava na rua **devolvia a rota dele para rascunho** — e o app do motorista só lê rota `published`,
   * então a rota sumia do celular dele no meio do dia, sem aviso nenhum. Mesma família do incidente de
   * 30/09/2026 (rota publicada que virava `completed` com paradas pendentes).
   *
   * Dois aparelhos criando ao mesmo tempo: o banco tem UNIQUE (organização, dia, motorista, fase) — se o insert
   * perder a corrida (23505), relê a rota que o outro aparelho criou.
   */
  const routeIdForDriver = useCallback(async (driverId: string, phase: Perna = 'pickup') => {
    if (phase === 'dropoff' && !fasesDisponiveis.current) throw new Error('Drop-off planning is not available yet.');
    if (!organizationId) throw new Error('Organization not found.');
    const existente = routesRef.current.find((item) => item.driverId === driverId && (item.phase ?? 'pickup') === phase);
    if (existente) return existente.routeId;

    const { data, error } = await supabase.from('routes').insert({
      organization_id: organizationId, route_date: date, driver_id: driverId, status: 'draft',
      ...(fasesDisponiveis.current ? { phase } : {}),
      start_location_id: phase === 'pickup' ? vanParaRota(driverId) : yardId.current,
      // Pick-ups close at the yard; drop-offs start there and close at the van.
      end_location_id: phase === 'pickup' ? yardId.current : vanParaRota(driverId),
    }).select('id, lock_version').single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        let consulta = supabase
          .from('routes').select('id, lock_version, status')
          .eq('organization_id', organizationId).eq('route_date', date).eq('driver_id', driverId);
        if (fasesDisponiveis.current) consulta = consulta.eq('phase', phase);
        const { data: outra } = await consulta.single();
        const linha = outra as { id: string; lock_version?: number | null; status?: string | null } | null;
        const id = linha?.id;
        if (id) {
          if (aplicandoSugestao.current) throw new Error('The routes changed. Create a new suggestion.');
          /**
           * ⚠️ A RELEITURA NÃO PODE DEVOLVER A ROTA CANCELADA. A rota do dia já existe, mas pode estar
           * `cancelled` (o X do quadro) — e aí gravar paradas nela é escrever num documento morto: o
           * motorista não recebe nada (ele lê só `published`) e o cão continua em UNASSIGNED. Nesse caso
           * a rota é REATIVADA como rascunho e o gestor publica.
           */
          const lockVersion = linha?.status === 'cancelled'
            ? await reativarRotaCancelada(id, linha?.lock_version ?? null)
            : linha?.lock_version ?? null;
          if (lockVersion != null) versoes.current[id] = lockVersion;
          return id;
        }
      }
      throw new Error(error.message);
    }
    const criada = data as { id: string; lock_version?: number };
    if (criada.lock_version != null) versoes.current[criada.id] = criada.lock_version;
    return criada.id;
  }, [organizationId, date, vanParaRota, reativarRotaCancelada]);

  /**
   * TROCA A VAN DE UM MOTORISTA (dono, 01/10/2026).
   *
   * Rota que já existe: grava na hora em `routes.start_location_id` — é o campo que decide o ponto do
   * clock in e a partida da sugestão. Rota que ainda não existe: a escolha fica guardada e entra na
   * criação (o gestor escolhe a van antes de atribuir o primeiro cão, que é o caso normal).
   */
  const escolherVan = useCallback(
    async (driverId: string, locationId: string) => {
      vanPorMotorista.current.set(driverId, locationId);
      const rota = routesRef.current.find((item) => item.driverId === driverId && (item.phase ?? 'pickup') === 'pickup');
      if (!rota) return;
      /**
       * 🪤 ACHADO DA VISTORIA (02/10/2026): aqui a van era gravada SEM trava de versão e sem conferir
       * linhas. Com dois gestores na mesma rota, o segundo sobrescrevia a van do primeiro em silêncio
       * (e, se a rota tivesse saído do ar, o app ainda dizia que trocou). Agora usa a mesma trava do
       * `trocarStatus`: `.eq('lock_version', versao)` + `.select('id')`; 0 linha = outro aparelho mexeu.
       */
      const versao = versaoDe(rota.routeId);
      const atualizacao: Record<string, unknown> = { start_location_id: locationId, lock_version: (versao ?? 1) + 1 };
      let consulta = supabase.from('routes').update(atualizacao).eq('id', rota.routeId);
      if (versao !== null) consulta = consulta.eq('lock_version', versao);
      const { data, error } = await consulta.select('id');
      if (error) {
        vanPorMotorista.current.delete(driverId);
        showAlert('Could not change the van', error.message);
        return;
      }
      if (versao !== null && (data ?? []).length === 0) {
        vanPorMotorista.current.delete(driverId);
        showAlert('Could not change the van', routeErrorMessage('stale_route'));
        await carregarRotas();
        return;
      }
      await carregarRotas();
    },
    [carregarRotas, versaoDe],
  );

  /**
   * ESCOLHE O YARD DA ROTA (dono, 05/10/2026 — item 7 do redesenho; ÚNICA escrita NOVA autorizada).
   *
   * Espelha `escolherVan`, com a MESMA trava de versão (`.eq('lock_version', versao)` + `.select('id')`;
   * 0 linha = `stale_route` + `carregarRotas()`), gravando **`routes.end_location_id`** — a coluna que
   * JÁ existe e que o fim do dia do motorista já lê (`vanLocationForRoute(locais, route.end_location_id)`).
   * Sem migração, sem SQL, sem RPC: o mesmo caminho da van. O seletor só existe com rota (o chip do yard
   * mora no cartão), então rota inexistente = nada a gravar.
   */
  const escolherYard = useCallback(
    async (driverId: string, locationId: string) => {
      const rota = routesRef.current.find((item) => item.driverId === driverId && (item.phase ?? 'pickup') === 'pickup');
      if (!rota) return;
      const versao = versaoDe(rota.routeId);
      const atualizacao: Record<string, unknown> = { end_location_id: locationId, lock_version: (versao ?? 1) + 1 };
      let consulta = supabase.from('routes').update(atualizacao).eq('id', rota.routeId);
      if (versao !== null) consulta = consulta.eq('lock_version', versao);
      const { data, error } = await consulta.select('id');
      if (error) {
        showAlert('Could not change the yard', error.message);
        return;
      }
      if (versao !== null && (data ?? []).length === 0) {
        showAlert('Could not change the yard', routeErrorMessage('stale_route'));
        await carregarRotas();
        return;
      }
      await carregarRotas();
    },
    [carregarRotas, versaoDe],
  );

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
  /**
   * 🪤 A RPC `assign_stop_to_route` é VOID: uma escrita recusada pelo banco pode voltar como SUCESSO sem
   * gravar nada — e o quadro fechava a folha como se tivesse atribuído. Dono (04/10/2026, com vídeo:
   * "Tentei fazer um dispatch"): spinner, a folha fecha, o cão continua em UNASSIGNED e NENHUMA mensagem.
   *
   * A conferência é depois da RECARGA: os cães do lote têm de estar nas paradas do dia. Só vale quando a
   * recarga trouxe dados — sem rede, "não achei" não prova nada, e alarme falso é pior que silêncio.
   */
  const conferirAtribuicao = useCallback((esperados: string[], phase: Perna, salvos: number) => {
    /*
     * A conferência só vale com uma LEITURA BOA do dia. Antes o teste era `routesRef.current.length === 0`,
     * e ZERO ROTA é justamente o quadro de quem cancelou a rota do dia: a conferência era pulada e a folha
     * fechava em silêncio com o cão indo para a rota cancelada (medido no banco em 04/10/2026). Agora o
     * sinal é "a carga de rotas deu certo" — sem rede, "não achei" não prova nada.
     */
    if (!rotasCarregadasOk.current) return;
    const naRota = new Set(routesRef.current
      .filter((rota) => (rota.phase ?? 'pickup') === phase)
      .flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
    const faltando = esperados.filter((alvo) => !naRota.has(alvo));
    if (faltando.length === 0) return;
    throw new Error(avisoDeFalhaParcial(
      faltando.map((alvo) => ({ dogId: alvo, dogName: nomeDoCao(alvo), motivo: routeErrorMessage('stale_route') })),
      salvos,
    ));
  }, [nomeDoCao]);

  const assign = useCallback(async (dogId: string, driverId: string, constraint: DispatchConstraint, phase: Perna = 'pickup') => {
    if (phase === 'dropoff') {
      /**
       * TRAVA DO DONO (03/10/2026): o cão desce com quem o buscou. Sem exceção — se o motorista do
       * pick-up não estiver fazendo a entrega, o gestor resolve no pick-up (trocar o cão de lá), e não
       * aqui: a entrega nunca recebe um cão que outro motorista buscou.
       */
      const trava = motivoDaTrava(dogId, driverId);
      if (trava) throw new Error(trava);
      const boarding = itensDoDia.current.some(item => item.dogId === dogId && (item.inVan || item.reservationKind === 'boarding'));
      const eligible = itensDropoff.current.some(item => item.dogId === dogId)
        || routesRef.current.some(r => r.phase === 'dropoff' && r.stops.some(s => s.dogId === dogId));
      if (boarding || !eligible) throw new Error('This dog is not eligible for drop-offs.');
    }
    const routeId = await routeIdForDriver(driverId, phase);
    const naRota = new Set(routesRef.current.filter(rota => (rota.phase ?? 'pickup') === phase).flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
    const junto = [dogId, ...vaoJunto(phase === 'pickup' ? itensDoDia.current : itensDropoff.current, dogId, naRota).map((item) => item.dogId)];
    /**
     * UM erro não cancela o lote (melhoria do dono, 01/10/2026): antes o `break` deixava os irmãos
     * seguintes sem nem serem tentados, e o gestor só via o primeiro motivo. Agora segue tentando os
     * demais e a frase final diz quem ficou de fora. Exceção: `stale_route` invalida a rota INTEIRA
     * (a versão que a tela tem é velha), então ali o lote para e o app avisa como sempre.
     */
    // Nome próprio: `falhas` já é o estado dos erros de carga da tela (linha ~126).
    const naoSalvos: FalhaParcial[] = [];
    let salvos = 0;
    for (const alvo of junto) {
      /**
       * A trava vale também para os irmãos que entram junto: um cão que OUTRO motorista buscou não
       * entra na entrega nem de carona (03/10/2026).
       */
      const travaDoAlvo = phase === 'dropoff' ? motivoDaTrava(alvo, driverId) : null;
      if (travaDoAlvo) {
        naoSalvos.push({ dogId: alvo, dogName: nomeDoCao(alvo), motivo: travaDoAlvo });
        continue;
      }
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
        if (isStaleRouteError(error)) falhaDeEscrita(error);
        naoSalvos.push({
          dogId: alvo,
          dogName: nomeDoCao(alvo),
          motivo: routeErrorMessage(error),
        });
        continue;
      }
      // Cada escrita bem-sucedida incrementa `lock_version` no banco: a próxima precisa da versão nova,
      // senão o Banco recusa como 'stale_route' (a trava é justamente para escrita velha).
      versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
      salvos += 1;
    }
    await carregarRotas();
    if (naoSalvos.length > 0) throw new Error(avisoDeFalhaParcial(naoSalvos, salvos));
    conferirAtribuicao(junto, phase, salvos);
  }, [routeIdForDriver, versaoDe, falhaDeEscrita, carregarRotas, nomeDoCao, motivoDaTrava, conferirAtribuicao]);

  /**
   * CRIAR A PERNA DE DROP-OFF que ainda não existe (Defeito B, dono, 03/10/2026).
   *
   * A seção "Drop-offs · <motorista>" era texto puro ("No drop-off route.") quando a perna do dia nunca
   * nasceu — o gestor não tinha caminho nenhum para criá-la. Esta ação cria a perna do jeito que
   * `assign(…, 'dropoff')` cria: `routeIdForDriver` (insert `status='draft'` com `phase='dropoff'`, começa
   * no YARD e fecha na VAN — a direção da entrega) e põe os cães ELEGÍVEIS do dia (pool de drop-off, sem
   * boarding, ainda sem motorista) como paradas pendentes, UMA RPC por cão — as MESMAS regras da fila de
   * drop-offs (`assign_stop_to_route`). NÃO publica nada: a regra "Drop-offs are draft only" continua.
   * Sem nada a entregar a tela nem oferece a ação (o cálculo de elegíveis mora no quadro).
   */
  const criarPernaDeDropoff = useCallback(async (driverId: string) => {
    if (routesRef.current.some((rota) => rota.driverId === driverId && rota.phase === 'dropoff')) return;
    const naRota = new Set(routesRef.current.filter((rota) => rota.phase === 'dropoff').flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
    /**
     * TRAVA DO DONO (03/10/2026): a perna nova leva SÓ os cães que ESTE motorista buscou (mais os que
     * não têm motorista de pick-up do dia). Cão que outro motorista buscou não entra nem aqui — é o
     * mesmo portão da atribuição à mão e da sugestão.
     */
    const donos = motoristaDoPickup();
    const dele = (dogId: string) => {
      const dono = donos.get(dogId);
      return !dono || dono === driverId;
    };
    const elegiveis = itensDropoff.current.filter((item) => !item.inVan && item.reservationKind !== 'boarding'
      && !naRota.has(item.dogId) && dele(item.dogId));
    if (elegiveis.length === 0) return;
    const routeId = await routeIdForDriver(driverId, 'dropoff');
    const naoSalvos: FalhaParcial[] = [];
    for (const cao of elegiveis) {
      const { error } = await supabase.rpc('assign_stop_to_route', {
        p_route_id: routeId,
        p_dog_id: cao.dogId,
        p_window_start: null,
        p_window_end: null,
        p_exact_time: null,
        p_priority: 'normal',
        p_esperado: versaoDe(routeId),
      });
      if (error) {
        if (isStaleRouteError(error)) falhaDeEscrita(error);
        naoSalvos.push({ dogId: cao.dogId, dogName: cao.dogName, motivo: routeErrorMessage(error) });
        continue;
      }
      versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
    }
    await carregarRotas();
    if (naoSalvos.length > 0) throw new Error(avisoDeFalhaParcial(naoSalvos, elegiveis.length - naoSalvos.length));
    conferirAtribuicao(elegiveis.map((cao) => cao.dogId), 'dropoff', elegiveis.length - naoSalvos.length);
  }, [routeIdForDriver, versaoDe, falhaDeEscrita, carregarRotas, motoristaDoPickup, conferirAtribuicao]);

  /**
   * SUGESTÃO DE ROTA (cliente, áudio de 01/10/2026): *"sugestão de rota automática… leva um tempinho aí
   * de clicar e mandar pro driver certo"*. A conta é PURA (`features/dispatch/routeSuggestion.ts`):
   * junta os cães por endereço e corta a trilha em blocos contíguos, minimizando a distância.
   *
   * Entram: os cães do dia que ainda estão SEM motorista e a van da organização (sede padrão) como
   * ponto de partida. NADA é gravado aqui — a folha mostra e o gestor confirma.
   */
  const assinaturaDaSugestao = useCallback(() => JSON.stringify({
    itens: itensDoDia.current, entregas: itensDropoff.current,
    coordenadas: [...coordenadasPorCao.current.entries()],
    membros: membrosDoDia.current,
    rotas: routesRef.current.map(r => ({ ...r, versao: versoes.current[r.routeId] })),
  }), []);

  const sugerirRotasDoDia = useCallback(async (driverIds?: string[]): Promise<DispatchSuggestion | null> => {
    if (!organizationId || aplicandoSugestao.current) return null;
    const dia = contexto.current.date;
    propostaRef.current = null;
    if (!(await carregarDia()) || !(await carregarRotas())) throw new Error('Could not refresh the day. Try again.');
    const assinatura = assinaturaDaSugestao();
    const propostas: DispatchSuggestion = { blocos: [], semLugar: [], kmTotal: 0 };
    if (fasesDisponiveis.current) propostas.pernas = {
      pickup: { phase: 'pickup', blocos: [], semLugar: [], kmTotal: 0 },
      dropoff: { phase: 'dropoff', blocos: [], semLugar: [], kmTotal: 0 },
    };
    const sedes = await loadOrganizationLocations(supabase, organizationId);
    for (const phase of [planningPhase]) {
      const atribuidos = new Set(routesRef.current.filter(rota => (rota.phase ?? 'pickup') === phase).flatMap((rota) => rota.stops.map((stop) => stop.dogId)));
      const caes = (phase === 'pickup' ? itensDoDia.current : itensDropoff.current)
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
        const rota = routesRef.current.find(r => r.driverId === driver.user_id && (r.phase ?? 'pickup') === phase);
        return !rota || (rota.status === 'draft' && rota.stops.every(s =>
          s.status === 'pending' && !s.pickupPin && !s.dropoffPin));
      });
      if (dia !== contexto.current.date || assinatura !== assinaturaDaSugestao()) return null;
      /*
       * De onde a sugestão parte: a van do motorista escolhido (ou a padrão) — e, com MAIS DE UMA van
       * cadastrada e nenhuma escolha, a MAIS PRÓXIMA dos cães do dia (pergunta do dono, 01/10/2026:
       * organização com várias vans não pode ter todas as rotas saindo sempre da mesma).
       */
      const van = vanDaRota(sedes, disponiveis[0] ? vanPorMotorista.current.get(disponiveis[0].user_id) ?? null : null, caes);
      const inicio = phase === 'dropoff' ? yardCoords.current : van ? { latitude: van.latitude, longitude: van.longitude } : null;
      const motoristas = disponiveis.map(driver => ({ driverId: driver.user_id, driverName: driver.profiles?.full_name?.trim() || 'Driver' }));
      const motoristaDaCasa = new Map<string, Set<string>>();
      for (const rota of routesRef.current.filter(r => (r.phase ?? 'pickup') === phase)) for (const stop of rota.stops) {
        if (!stop.clientId) continue;
        const ids = motoristaDaCasa.get(stop.clientId) ?? new Set<string>();
        ids.add(rota.driverId);
        motoristaDaCasa.set(stop.clientId, ids);
      }
      /**
       * TRAVA DO DONO (03/10/2026) — só na perna de ENTREGA: o cão desce com quem o buscou, sem
       * exceção. `presos` é o cão (e o irmão de casa dele que não tem motorista próprio) preso ao
       * motorista do pick-up; esses cães não entram no rateio dos livres — nascem no bloco do dono.
       * Cão preso cujo motorista NÃO está disponível nesta perna não é oferecido a ninguém: cai em
       * `semLugar` para o gestor acertar o pick-up.
       */
      const presos = new Map<string, string>();
      if (phase === 'dropoff') {
        const doPickup = motoristaDoPickup();
        for (const cao of caes) {
          const dono = doPickup.get(cao.dogId);
          if (dono) presos.set(cao.dogId, dono);
        }
        const casasPresas = new Map<string, string>();
        for (const cao of caes) if (cao.clientId && presos.has(cao.dogId)) casasPresas.set(cao.clientId, presos.get(cao.dogId)!);
        for (const cao of caes) {
          if (presos.has(cao.dogId) || !cao.clientId) continue;
          const dono = casasPresas.get(cao.clientId);
          if (dono) presos.set(cao.dogId, dono);
        }
      }
      const livres = caes.filter(c => !presos.has(c.dogId) && (!c.clientId || !motoristaDaCasa.has(c.clientId)));
      const proposta = sugerirRotas(
        livres, motoristas, inicio,
      );
      // Casa parcialmente atribuída não é repartida para preencher outro carro. Respeitamos também
      // separações manuais já existentes: se há dois motoristas na casa, o restante fica para revisão.
      const fixos = caes.filter(c => !presos.has(c.dogId) && c.clientId && motoristaDaCasa.has(c.clientId));
      for (const cao of fixos) {
        const ids = motoristaDaCasa.get(cao.clientId!)!;
        const motorista = motoristas.find(m => ids.size === 1 && ids.has(m.driverId));
        if (!motorista) { proposta.semLugar.push(cao); continue; }
        let bloco = proposta.blocos.find(b => b.driverId === motorista.driverId);
        if (!bloco) { bloco = { ...motorista, caes: [], km: 0 }; proposta.blocos.push(bloco); }
        bloco.caes.push(cao);
      }
      // Blocos dos cães presos: um bloco por motorista que buscou alguém. Motorista indisponível na
      // perna → o cão vai para revisão (a regra não deixa outro levar).
      const blocosPresos = motoristas.map(m => ({ ...m, caes: [] as CaoParaSugerir[], km: 0 }));
      for (const cao of caes) {
        const dono = presos.get(cao.dogId);
        if (!dono) continue;
        const bloco = blocosPresos.find(b => b.driverId === dono);
        if (!bloco) { proposta.semLugar.push(cao); continue; }
        bloco.caes.push(cao);
      }
      const temPresos = blocosPresos.some(b => b.caes.length > 0);
      // Existing assignments and fixed housemates count toward the same dog workload.
      // Keep the geographic/count-balanced proposal for a fresh phase; only distribute the
      // remaining houses against current loads when some dogs already have a driver.
      const rotasDaFase = routesRef.current.filter(r => (r.phase ?? 'pickup') === phase);
      if (rotasDaFase.some(r => r.stops.length > 0) || temPresos) {
        // O bloco nasce com os cães presos e a carga conta rota atual + presos: é isso que mantém o
        // equilíbrio por NÚMERO DE CÃES (decisão do dono, 02/10/2026) com a trava ligada.
        const blocos = motoristas.map(m => ({ ...m, caes: [...(blocosPresos.find(b => b.driverId === m.driverId)?.caes ?? [])], km: 0 }));
        const cargas = new Map(motoristas.map(m => [m.driverId,
          (rotasDaFase.find(r => r.driverId === m.driverId)?.stops.length ?? 0)
          + (blocos.find(b => b.driverId === m.driverId)?.caes.length ?? 0)]));
        const casas = new Map<string, { caes: CaoParaSugerir[]; preferido: string }>();
        for (const bloco of proposta.blocos) for (const cao of bloco.caes) {
          if (cao.clientId && motoristaDaCasa.has(cao.clientId)) {
            blocos.find(b => b.driverId === bloco.driverId)!.caes.push(cao);
            cargas.set(bloco.driverId, cargas.get(bloco.driverId)! + 1);
          } else {
            const key = cao.clientId ? `house:${cao.clientId}` : `dog:${cao.dogId}`;
            const casa = casas.get(key) ?? { caes: [], preferido: bloco.driverId };
            casa.caes.push(cao);
            casas.set(key, casa);
          }
        }
        for (const casa of [...casas.values()].sort((a, b) => b.caes.length - a.caes.length)) {
          const destino = [...blocos].sort((a, b) => cargas.get(a.driverId)! - cargas.get(b.driverId)!
            || Number(b.driverId === casa.preferido) - Number(a.driverId === casa.preferido))[0];
          destino.caes.push(...casa.caes);
          cargas.set(destino.driverId, cargas.get(destino.driverId)! + casa.caes.length);
        }
        proposta.blocos = blocos.filter(b => b.caes.length > 0);
      }
      if (fixos.length || temPresos || rotasDaFase.some(r => r.stops.length > 0)) {
        proposta.blocos = proposta.blocos.flatMap(bloco => {
          const ordenada = sugerirRotas(bloco.caes, [bloco], inicio);
          proposta.semLugar.push(...ordenada.semLugar);
          return ordenada.blocos;
        });
        proposta.kmTotal = proposta.blocos.reduce((soma, bloco) => soma + bloco.km, 0);
      }
      if (propostas.pernas) propostas.pernas[phase] = { ...proposta, phase };
      propostas.blocos.push(...proposta.blocos.map(bloco => ({ ...bloco, phase })));
      propostas.semLugar.push(...proposta.semLugar);
      propostas.kmTotal += proposta.kmTotal;
    }
    propostaRef.current = { dia, org: organizationId, assinatura, blocos: propostas.blocos };
    return propostas;
  }, [planningPhase, organizationId, carregarDia, carregarRotas, assinaturaDaSugestao]);

  /**
   * A proposta já contém os irmãos: uma RPC por cão, sem chamar assign (que os expandiria de novo).
   * INSERT de rota nova, nunca UPSERT status=draft sobre rota existente. Falha parcial não é rollback:
   * recarregamos o que foi salvo e exigimos nova proposta, evitando replay de um plano velho.
   */
  const aplicarSugestao = useCallback(async (blocos: DispatchSuggestionBlock[]) => {
    if (aplicandoSugestao.current) return;
    const proposta = propostaRef.current;
    propostaRef.current = null;
    const naoSalvos: FalhaParcial[] = [];
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
      if (blocos.some(b => b.phase === 'dropoff') && !fasesDisponiveis.current)
        throw new Error('Drop-off planning is not available yet.');
      for (const bloco of blocos) {
        conferirDia();
        const phase = bloco.phase ?? 'pickup';
        const atribuidos = new Set(routesRef.current.filter(r => (r.phase ?? 'pickup') === phase).flatMap(r => r.stops.map(s => s.dogId)));
        const routeId = await routeIdForDriver(bloco.driverId, phase);
        for (const cao of bloco.caes) {
          conferirDia();
          if (atribuidos.has(cao.dogId)) throw new Error('A dog is already assigned.');
          const { error } = await supabase.rpc('assign_stop_to_route', {
            p_route_id: routeId, p_dog_id: cao.dogId, p_window_start: null, p_window_end: null,
            p_exact_time: null, p_priority: 'normal', p_esperado: versaoDe(routeId),
          });
          if (error) {
            // Mesma regra da atribuição à mão: `stale_route` invalida a rota inteira, o resto é
            // cão a cão (melhoria do dono, 01/10/2026).
            if (isStaleRouteError(error)) falhaDeEscrita(error);
            naoSalvos.push({ dogId: cao.dogId, dogName: cao.dogName, motivo: routeErrorMessage(error) });
            continue;
          }
          versoes.current[routeId] = (versoes.current[routeId] ?? 1) + 1;
          atribuidos.add(cao.dogId);
          salvos++;
        }
      }
      if (naoSalvos.length > 0) throw erroParcial(avisoDeFalhaParcial(naoSalvos, salvos));
    } catch (erro) {
      const texto = erro instanceof Error ? erro.message : 'Could not apply.';
      const jaRelatado = (erro as Error & { parcial?: boolean })?.parcial === true;
      throw new Error(`${jaRelatado ? '' : `${salvos} dogs saved. `}${texto} Create a new suggestion to continue.`);
    } finally {
      try { await carregarRotas(); } finally { aplicandoSugestao.current = false; }
    }
  }, [carregarDia, carregarRotas, assinaturaDaSugestao, fila, versaoDe, falhaDeEscrita, routeIdForDriver]);

  const saveStopConstraint = useCallback(async (routeId: string, dogId: string, constraint: DispatchConstraint) => {
    const parada = routesRef.current.find((rota) => rota.routeId === routeId)?.stops.find((stop) => stop.dogId === dogId);
    if (parada && parada.windowStart === constraint.windowStart && parada.windowEnd === constraint.windowEnd
      && parada.exactTime === constraint.exactTime && parada.priority === constraint.priority) return;
    /**
     * 🪤 ACHADO DA VISTORIA (02/10/2026): a janela era gravada sem conferir linhas. Se a parada tivesse
     * sido removida por outro aparelho, o UPDATE pegava 0 linha, o app ainda marcava a rota como alterada
     * e recarregava — a janela não salvou e ninguém era avisado.
     */
    const { data, error } = await supabase.from('route_stops').update({
      window_start: constraint.windowStart,
      window_end: constraint.windowEnd,
      exact_time: constraint.exactTime,
      priority: constraint.priority,
    }).eq('route_id', routeId).eq('dog_id', dogId).select('id');
    falhaDeEscrita(error);
    if ((data ?? []).length === 0) {
      await carregarRotas();
      throw new Error(`Could not save the time for ${nomeDoCao(dogId)} — the stop may have been removed on another device. Reload and try again.`);
    }
    await marcarRotaAlterada(routeId);
    await carregarRotas();
  }, [falhaDeEscrita, marcarRotaAlterada, carregarRotas, nomeDoCao]);

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
    /**
     * 🪤 ACHADO DA AUDITORIA (02/10/2026): o DELETE não conferia linha. Com a policy bloqueando, o
     * PostgREST devolve SUCESSO com 0 linhas — a parada sumia da tela e continuava no banco.
     * `.select('id')` + 0 linha = aviso, sem fingir que removeu.
     */
    const { data: removidas, error } = await supabase
      .from('route_stops')
      .delete()
      .eq('route_id', routeId)
      .eq('dog_id', dogId)
      .select('id');
    falhaDeEscrita(error);
    if (!removidas || removidas.length === 0) {
      showAlert('Unable to remove this stop', 'The stop was not removed. Ask the manager to check your access.');
      await carregarRotas();
      return;
    }
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
    if (routesRef.current.find(r => r.routeId === routeId)?.phase === 'dropoff') {
      showAlert('Drop-offs are draft only', 'Publishing drop-offs will be available with the driver update.');
      return;
    }
    const versao = versaoDe(routeId);
    const { error } = await supabase.rpc('publish_route', { p_route_id: routeId, p_esperado: versao });
    falhaDeEscrita(error);
    // `publish_route` grava a rota, então o gatilho sobe a `lock_version` em 1. Sem sincronizar a nossa
    // cópia AGORA, uma segunda toque antes de a recarga chegar mandaria a versão velha e o RPC
    // recusaria como `stale_route` — foi o alarme falso de 05/10/2026 (3 publicações em 9 s).
    if (versao !== null) versoes.current[routeId] = versao + 1;
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
  /**
   * CANCELAR DEVOLVE OS CÃES (dono, 04/10/2026): *"no primeiro print do dispatch o x não cancela a rota e
   * nem manda os cachorros para a unassigned de volta"*.
   *
   * A ATRIBUIÇÃO É A PARADA (`route_stops`): a lista de não-atribuídos é o que sobra do dia. Então cancelar
   * tem de APAGAR as paradas da rota — é isso, e só isso, que devolve os cães para a lista.
   *
   * Mesma armadilha da remoção avulsa: DELETE sem conferir linha devolve SUCESSO com 0 linhas quando a
   * policy bloqueia. Aqui a rota tem paradas (o aviso de fechamento contou as pendentes), então 0 linhas é
   * falha de verdade e o gestor precisa saber — nada de fingir que soltou os cães.
   */
  const soltarOsCaes = useCallback(async (routeId: string) => {
    const quantasNaTela = routesRef.current.find((item) => item.routeId === routeId)?.stops.length ?? 0;
    const { data: removidas, error } = await supabase
      .from('route_stops')
      .delete()
      .eq('route_id', routeId)
      .select('id');
    falhaDeEscrita(error);
    const quantas = removidas?.length ?? 0;
    if (quantasNaTela > 0 && quantas < quantasNaTela) {
      showAlert(
        'Unable to free the dogs',
        'The route was cancelled, but the dogs are still assigned. Ask the manager to check the access.',
      );
    }
    return quantas;
  }, [falhaDeEscrita]);

  // Cancela a rota: SOLTA OS CÃES (as paradas são a atribuição) e fecha a rota — ela sai da operação e sai
  // da tela do motorista.
  const cancelRoute = useCallback(async (routeId: string) => {
    await fecharComAviso(routeId, 'cancel', async () => {
      await soltarOsCaes(routeId);
      await trocarStatus(routeId, { status: 'cancelled' });
    });
  }, [fecharComAviso, soltarOsCaes, trocarStatus]);

  // Fecha a rota: ela sai da operacao (motorista deixa de ver) e entra no historico.
  const completeRoute = useCallback(async (routeId: string) => {
    await fecharComAviso(routeId, 'complete', () => trocarStatus(routeId, { status: 'completed' }));
  }, [fecharComAviso, trocarStatus]);

  /**
   * PERNAS DE VIAGEM da rota (conferência do dono, 01/10/2026 — item 5): grava, por parada, o tempo da
   * perna que CHEGA nela — `travel_seconds` na ordem da busca e `dropoff_travel_seconds` na ordem da
   * entrega. É o que faz o ETA do motorista seguir a ROTA (e a mensagem ao tutor sair de um número de
   * rota) em vez de linha reta da posição atual. A matriz já foi paga UMA vez aqui no Optimize; o
   * motorista só lê o que ficou gravado — nenhuma chamada nova ao Google.
   *
   * Best-effort de propósito: se estas escritas falharem, a ORDEM (que é o que o gestor pediu) já está
   * aplicada e o ETA do motorista simplesmente cai na estimativa antiga.
   */
  const gravarPernasDaRota = useCallback(async (
    routeId: string,
    ordemBusca: { dogId: string }[],
    ordemEntrega: { dogId: string }[],
    traffic: TravelTimes | null,
    phase?: Perna,
  ) => {
    if (!traffic) return;
    const segundos = (ids: string[], posicao: number): number | null => {
      const minutos = posicao === 0 ? traffic.homeTo(ids[0]) : traffic.between(ids[posicao - 1], ids[posicao]);
      if (minutos == null) return null;
      const valor = Math.round(minutos * 60);
      return valor > 0 ? valor : null;
    };
    const busca = ordemBusca.map((stop, i) => ({ dogId: stop.dogId, segundos: segundos(ordemBusca.map((s) => s.dogId), i) }));
    const entrega = ordemEntrega.map((stop, i) => ({ dogId: stop.dogId, segundos: segundos(ordemEntrega.map((s) => s.dogId), i) }));
    const porCao = new Map<string, { travel_seconds: number | null; dropoff_travel_seconds: number | null }>();
    for (const item of busca) porCao.set(item.dogId, { travel_seconds: item.segundos, dropoff_travel_seconds: null });
    for (const item of entrega) {
      const atual = porCao.get(item.dogId) ?? { travel_seconds: null, dropoff_travel_seconds: null };
      porCao.set(item.dogId, { ...atual, dropoff_travel_seconds: item.segundos });
    }
    /**
     * 🪤 ACHADO DA VISTORIA (02/10/2026): estas escritas (o TEMPO de cada perna, que é o que faz o ETA do
     * motorista seguir a ROTA) não conferiam linha e falhavam em silêncio — era impossível saber por que o
     * ETA não mudava depois do Optimize. Segue sendo best-effort (a ORDEM já está aplicada), mas o gestor
     * passa a ser avisado do que faltou.
     */
    const semTempo: string[] = [];
    for (const [dogId, pernas] of porCao) {
      const { data, error } = await supabase
        .from('route_stops')
        .update(phase === 'dropoff' ? { dropoff_travel_seconds: pernas.dropoff_travel_seconds } : { travel_seconds: pernas.travel_seconds })
        .eq('route_id', routeId)
        .eq('dog_id', dogId)
        .select('id');
      if (error || (data ?? []).length === 0) semTempo.push(dogId);
    }
    if (semTempo.length > 0) {
      showAlert(
        'Order applied — times not saved',
        `The new order is saved, but ${semTempo.length} stop(s) kept the old estimate, so the driver's ETA will still use the old (straight line) number there. Check your signal and run Optimize again.`,
      );
    }
  }, []);

  const optimize = useCallback(async (routeId: string) => {
    const route = routesRef.current.find((candidate) => candidate.routeId === routeId);
    if (!route) return;
    const phase = route.phase ?? planningPhase;
    const versao = versaoDe(routeId);
    const sorted = (phase === 'dropoff' ? ordemDaEntrega : ordemDaBusca)(route.stops);
    const finished = sorted.filter((stop) => stop.status === 'completed' || stop.status === 'skipped');
    const remaining = sorted.filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
    // "Não há o que otimizar" AVISA (auditoria 02/10/2026): antes a tela voltava muda e o gestor
    // não sabia por que o botão não fez nada.
    if (remaining.length < 2) {
      showAlert(
        'Nothing to optimize',
        remaining.length === 0
          ? 'Every stop on this route is already done or skipped — there is nothing left to order.'
          : 'There is only one stop left to order, so the route is already set.',
      );
      return;
    }

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

    /**
     * As paradas que o otimizador vai ordenar (só as pendentes), no formato que ele entende. Guardadas
     * numa const porque a comparação ANTES → DEPOIS usa exatamente esta lista.
     */
    const paradasOtimizadas = remaining.map((stop) => ({
      dogId: stop.dogId,
      clientName: stop.clientName,
      dogName: stop.dogName,
      latitude: stop.latitude,
      longitude: stop.longitude,
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      exactTime: stop.exactTime,
      priority: stop.priority,
    }));

    const result = optimizeRoute(
      paradasOtimizadas,
      // 3 min de serviço por pick-up (pedido do cliente, 30/09/2026 "três minutinhos por pick-up"):
      // até aqui a tela NÃO passava nada e o otimizador usava o padrão de 8 min. O número é o MESMO
      // da tolerância de atraso do motorista (GRACE_MINUTES) — decisão do dono, um valor só.
      { travel: traffic.travel, serviceMinutes: GRACE_MINUTES },
      phase === 'dropoff' ? yardCoords.current : null,
    );
    if (!result.feasible) {
      showAlert('Cannot optimize this route', result.reason ?? 'The schedule is infeasible.');
      return;
    }
    // As janelas existentes são de busca; a entrega usa a mesma matriz, sem janelas da manhã.
    /**
     * A ENTREGA parte do YARD — pedido do CLIENTE (02/10/2026): *"Posição do driver inicia rota dos drop
     * offs"*; na prática o motorista sai do yard (é onde os cães passam o dia). O dono reforçou no áudio:
     * *"ele otimiza a rota pra onde tá a van (...) o bagulho do yard tem que ser diferente"*. A origem
     * vem de `origemDaEntregaDaRota` (o yard, e SÓ o yard): a VAN nunca entra aqui — ela inicia os
     * pick-ups e finaliza o dia. Sem yard cadastrado isto é `null` e a 1ª perna não entra na conta; o app
     * não "cai na van" por engano.
     */
    const origemDaEntrega = yardCoords.current;
    /**
     * 🪤 ACHADO DA AUDITORIA (02/10/2026): a perna de ENTREGA recebia TODAS as paradas — inclusive
     * concluídas/puladas, que podem não ter coordenada (o cão já saiu) e faziam o Optimize INTEIRO
     * falhar com "Cannot optimize this route". O otimizador da tarde agora recebe só as ELEGÍVEIS
     * (não `completed`/`skipped`); as concluídas ficam fixas no início, como na busca.
     */
    const entrega = result;
    const travasBusca = sorted.map((stop) => ({ dogId: stop.dogId, pin: pinDaParada(stop, 'pickup') }));
    const travasEntrega = sorted.map((stop) => ({ dogId: stop.dogId, pin: pinDaParada(stop, 'dropoff') }));
    // Concluídas ocupam o início; qualquer trava incompatível aparece como conflito.
    const busca = ordenarComTravas([...finished, ...result.stops], [
      ...finished.map((stop, i) => ({ dogId: stop.dogId, pin: { tipo: 'fixed' as const, posicao: i + 1 } })),
      ...travasBusca,
    ], sorted.length);
    const volta = ordenarComTravas([...finished, ...entrega.stops], [
      ...finished.map((stop, i) => ({ dogId: stop.dogId, pin: { tipo: 'fixed' as const, posicao: i + 1 } })),
      ...travasEntrega,
    ], sorted.length);
    const linhas = (ordem: { dogName: string }[]) => ordem.map((stop, i) => `• ${i + 1}. ${stop.dogName}`).join('\n');
    const conflitos = (resultado: typeof busca, perna: string) => resultado.conflitos.map((conflito) =>
      `${perna}: ${conflito.motivo === 'collision' ? 'Conflicting locks' : 'Position outside route'} #${conflito.posicao}: ${conflito.dogIds.map((id) => sorted.find((stop) => stop.dogId === id)?.dogName ?? id).join(', ')}`);
    /**
     * ANTES → DEPOIS (dúvida do dono, 01/10/2026: *"não consigo confirmar se está realmente fazendo a
     * melhor rota"*). As DUAS ordens — a que estava na tela e a que o otimizador propõe — passam pela
     * MESMA conta de deslocamento + serviço, e o alerta mostra a diferença. Só as paradas PENDENTES
     * entram na conta (as concluídas ficam fixas no início das duas ordens e não mudam nada).
     * Quando falta dado para a conta (matriz desligada e parada sem coordenada), a linha não aparece —
     * número inventado seria pior que nenhum.
     */
    const pendentes = new Set(remaining.map((stop) => stop.dogId));
    const opcoesDaConta = { travel: traffic.travel, serviceMinutes: GRACE_MINUTES };
    const comparar = (rotulo: string, idsAntes: string[], idsDepois: string[]) => {
      // A sequência da ENTREGA conta a partir do yard (a mesma origem do `optimizeRoute` da entrega).
      const origem = rotulo === 'Drop-off' ? yardCoords.current : null;
      const antes = minutosDaOrdem(paradasOtimizadas, idsAntes.filter((id) => pendentes.has(id)), opcoesDaConta, origem);
      const depois = minutosDaOrdem(paradasOtimizadas, idsDepois.filter((id) => pendentes.has(id)), opcoesDaConta, origem);
      if (antes == null || depois == null) return null;
      const ganho = Math.round(antes) - Math.round(depois);
      const diferenca = ganho > 0 ? `-${ganho} min` : ganho < 0 ? `+${-ganho} min` : 'no change';
      return `${rotulo}: ${Math.round(antes)} min -> ${Math.round(depois)} min (${diferenca})`;
    };
    const ganhos = [
      comparar('Pick-up', remaining.map((stop) => stop.dogId), busca.ordem.map((stop) => stop.dogId)),
      comparar('Drop-off', ordemDaEntrega(sorted).map((stop) => stop.dogId), volta.ordem.map((stop) => stop.dogId)),
    ].filter((linha): linha is string => Boolean(linha));
    const mensagem = phase === 'dropoff'
      ? `Drop-off:\n${linhas(volta.ordem)}\n\n${[...ganhos.filter(g => g.startsWith('Drop-off')), ...conflitos(volta, 'Drop-off')].join('\n')}`
      : `Pick-up:\n${linhas(busca.ordem)}\n\n${[...ganhos.filter(g => g.startsWith('Pick-up')), ...conflitos(busca, 'Pick-up')].join('\n')}`;
    const origem = traffic.source === 'live' ? 'live traffic' : 'estimated times';
    showAlert(`Optimized route (${origem})`, mensagem, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Apply',
        onPress: () => {
          gravandoOrdens.current.add(routeId);
          // A ordem da ENTREGA é calculada uma vez: serve para gravar a ordem (RPC) e para gravar as
          // pernas da tarde logo depois do ok.
          const entregaIds = ordemDaEntrega(volta.ordem.map((stop, i) => ({ ...stop, dropoffSequence: i + 1 }))).map((stop) => stop.dogId);
          void Promise.resolve(supabase.rpc('apply_route_order', {
            p_route_id: routeId, p_pickup_ids: phase === 'dropoff' ? null : busca.ordem.map((stop) => stop.dogId),
            p_dropoff_ids: phase === 'dropoff' ? entregaIds : null,
            p_esperado: versao,
          })).then(({ error }) => {
            if (!error) {
              versoes.current[routeId] = (versao ?? 1) + 1;
              revisoes.current[routeId] = (revisoes.current[routeId] ?? 0) + 1;
              /*
               * PERNAS DE VIAGEM (item 5 da conferência, 01/10/2026): com a ordem aplicada, grava por
               * parada o tempo da perna que chega nela (busca e entrega). É o dado que o ETA do
               * motorista lê para seguir a ROTA — a matriz do Google já foi paga aqui, nenhuma
               * chamada nova. Best-effort: falhar aqui não desfaz a ordem.
               */
              void gravarPernasDaRota(routeId, busca.ordem, volta.ordem, traffic.travel, phase);
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
  }, [planningPhase, versaoDe, carregarRotas, gravarPernasDaRota]);

  const summary = useMemo(() => ({ date, drivers, dayItems, routes, dogs: caesCadastro, onAddExtraDog: adicionarCaoForaDoCalendario }), [date, drivers, dayItems, routes, caesCadastro, adicionarCaoForaDoCalendario]);

  /**
   * Motorista do pick-up de cada cão (trava da entrega, 03/10/2026) — vai para o quadro para a folha
   * de atribuição não oferecer outro motorista na perna de drop-off.
   */
  const pickupDriverByDog = useMemo(() => motoristaDoPickupPorCao(summary.routes), [summary.routes]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {loading ? <ActivityIndicator testID="dispatch-loading" style={styles.center} color={colors.gold} size="large" /> : (
        <DispatchBoard
          phase={planningPhase} onPhaseChange={setPlanningPhase}
          date={summary.date}
          drivers={summary.drivers}
          dayItems={summary.dayItems}
          dropoffItems={dropoffItems}
          routes={summary.routes}
          driverLocations={driverLocations}
          onAssign={assign}
          onCreateDropoffRoute={criarPernaDeDropoff}
          pickupDriverByDog={pickupDriverByDog}
          onSuggestRoutes={sugerirRotasDoDia}
          onApplySuggestion={aplicarSugestao}
          vans={vans}
          onChooseVan={escolherVan}
          onChooseYard={escolherYard}
          avisoRotaMudou={rotaMudou}
          onReloadRotas={recarregarRotas}
          vanDoMotorista={(driverId) => vanPorMotorista.current.get(driverId) ?? null}
          onOpenStopList={abrirListaDeParadas}
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
