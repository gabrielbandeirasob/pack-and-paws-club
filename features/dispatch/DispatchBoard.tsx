import { formatTimeOfDay } from '@/lib/clock';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { addDaysISO, formatDayLabel } from '@/features/calendar/dates';
import { agruparPorCliente, filtrarCaes, resumoDaBusca } from '@/features/calendar/dogPickerSearch';
import type { BlocoSugerido, SugestaoDeRotas, SugestoesDoDia } from '@/features/dispatch/routeSuggestion';
import type { DogRef } from '@/features/calendar/dayMath';
import { ETA_MAXIMO_PLAUSIVEL_MIN, frescorDaPosicao, isPastDeadline, nextStopEta } from '@/features/driver/eta';
import { ReorderableStops } from '@/features/dispatch/ReorderableStops';
import { TimeWheel } from '@/features/dispatch/TimeWheel';
import { avisoDeRotaInvisivel, avisoDeRepublicacao, precisaRepublicar, rotuloDoBadge } from '@/features/dispatch/routeStatusLabel';
import { SELO_PARADA_FORA_DO_DIA, avisoDeParadasForaDoDia, paradasForaDoDia } from '@/features/dispatch/dayReconciliation';
import { colors, radii } from '@/features/theme/tokens';
import { StopProofChips } from '@/features/dispatch/ProofViewer';
import { showAlert } from '@/features/ui/alert';
import { ordemDaBusca, ordemDaEntrega, pinDaParada, type Perna, type Travas } from '@/features/dispatch/orderPins';
import { plural } from '@/lib/plural';

export type DispatchSuggestionBlock = BlocoSugerido & { phase?: Perna };
export type DispatchSuggestion = Omit<SugestaoDeRotas, 'blocos'> & { blocos: DispatchSuggestionBlock[]; pernas?: SugestoesDoDia };

export type DispatchConstraint = {
  windowStart: string | null;
  windowEnd: string | null;
  exactTime: string | null;
  priority: 'normal' | 'priority';
};

export const EMPTY_CONSTRAINT: DispatchConstraint = { windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' };

export type DispatchDriver = {
  id: string;
  name: string;
  /**
   * Gestor que também dirige (áudio do dono, 27/09/2026): aparece na lista de motoristas do Dispatch
   * para poder receber rota. O rótulo na tela deixa claro que ele é o escritório.
   */
  alsoManager?: boolean;
};
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
  /**
   * Nomes dos cães que moram na MESMA CASA (mesmo cliente) e estão na fila do dia. A folha de
   * atribuição avisa com eles e a atribuição leva todos juntos num clique só — áudio do dono
   * (29/09/2026): *"se eu mandar o Sam para um driver, o Oli vai para o mesmo driver… não faz sentido
   * eu ter que clicar duas vezes para a mesma casa"*.
   */
  houseMates?: string[];
  /** A casa do cão (`dogs.client_id`). Ver `features/dispatch/houseMates.ts`. */
  clientId?: string | null;
  /**
   * Coordenada do ENDEREÇO do cliente — a sugestão de rota (cliente, 01/10/2026) é geográfica, então a
   * fila do dia precisa do ponto de cada cão. Vem da mesma consulta do dia (`clients(latitude,
   * longitude)`); cão sem coordenada NÃO ganha lugar inventado (a sugestão o deixa de fora e avisa).
   */
  latitude?: number | null;
  longitude?: number | null;
};
export type DispatchRouteStop = DispatchStopItem & {
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  latitude: number | null;
  longitude: number | null;
  /** Perna gravada pelo Optimize (migração 041): ordem da BUSCA. */
  travelSeconds?: number | null;
  /** Perna gravada pelo Optimize (migração 042): ordem da ENTREGA. */
  dropoffTravelSeconds?: number | null;
  /** Caminhos das fotos de comprovante no bucket privado (migration 020). */
  pickupProofPath?: string | null;
  dropoffProofPath?: string | null;
} & DispatchConstraint & Travas & { dropoffSequence?: number | null };
export type DispatchRoute = {
  phase?: Perna;
  routeId: string;
  driverId: string;
  status: 'draft' | 'published' | 'completed' | 'cancelled';
  /** Van escolhida para ESTA rota (`routes.start_location_id`). Sem ela, o app decide pela mais próxima. */
  startLocationId?: string | null;
  /** Yard onde ESTA rota termina a busca (`routes.end_location_id`). Sem ele, vale o yard padrão. */
  endLocationId?: string | null;
  stops: DispatchRouteStop[];
};
/**
 * Sede da organização, na versão que o cartão do motorista precisa (pergunta do dono, 01/10/2026).
 *
 * O `kind` existe por causa do relato do dono (02/10/2026, transcrição: *"tá mostrando van 1, van 2,
 * yard, tipo assim, o que é que tem o yard? não é uma van o yard, ele tem que ter o endereço que ele vai
 * finalizar"*). O YARD **não é van**: ele é o ponto onde a BUSCA termina (e a entrega começa), então o
 * cartão o mostra numa linha PRÓPRIA com o endereço — nunca como opção de van. Sem `kind` (chamadas
 * antigas / organizações que nunca usaram yard), a sede vale como van: comportamento idêntico ao de antes.
 */
export type DispatchVan = {
  id: string;
  name: string;
  isDefault: boolean;
  kind?: 'van' | 'yard' | 'other';
  /** Endereço numa linha (rua · cidade), quando houver — o dono quer VER onde o dia finaliza. */
  address?: string | null;
};

type ConstraintKind = 'none' | 'window' | 'exact';

type SheetState =
  | { mode: 'assign'; item: DispatchStopItem; phase?: Perna }
  | { mode: 'edit'; route: DispatchRoute; stop: DispatchRouteStop }
  | null;

type Props = {
  date: string;
  phase?: Perna;
  onPhaseChange?: (phase: Perna) => void;
  drivers: DispatchDriver[];
  dayItems: DispatchStopItem[];
  dropoffItems?: DispatchStopItem[];
  routes: DispatchRoute[];
  driverLocations?: Record<string, { latitude: number; longitude: number; updatedAt: string }>;
  onAssign: (dogId: string, driverId: string, constraint: DispatchConstraint, phase?: Perna) => Promise<void>;
  /**
   * CRIAR a perna de drop-off que ainda não existe (Defeito B, 03/10/2026): a seção
   * "Drop-offs · <motorista>" era texto puro quando a perna do dia nunca nasceu. A ação cria a perna do
   * jeito que `assign(…, 'dropoff')` cria (`routeIdForDriver`) e põe os cães elegíveis do dia como
   * paradas — SEM publicar ("Drop-offs are draft only"). Sem a prop, o quadro fica como era.
   */
  onCreateDropoffRoute?: (driverId: string) => Promise<void>;
  /**
   * TRAVA DO DONO (03/10/2026): *"não faz sentido eu colocar o pick-up de um cachorro com um motorista
   * e depois o drop-off com outro"* — o cão desce com quem o buscou. Este mapa (cão → motorista do
   * pick-up do dia) faz o quadro: (a) só oferecer "Create drop-off route" para quem buscou algum cão,
   * e (b) na folha de atribuição de entrega, nem listar outro motorista — o cão já vem com o dono
   * selecionado. Sem a prop, o quadro fica como era (é o caminho do app antigo/testes).
   */
  pickupDriverByDog?: ReadonlyMap<string, string>;
  onSaveStop: (routeId: string, dogId: string, constraint: DispatchConstraint) => Promise<void>;
  onRemoveStop: (routeId: string, dogId: string) => Promise<void>;
  onMoveStop: (routeId: string, dogId: string, direction: -1 | 1) => Promise<void>;
  onMoveDropoff?: Props['onMoveStop'];
  onSavePins?: (routeId: string, dogId: string, travas: Travas) => Promise<void>;
  onOptimize: (routeId: string) => Promise<void>;
  onPublish: (routeId: string) => Promise<void>;
  onUnpublish: (routeId: string) => Promise<void>;
  onCancelRoute: (routeId: string) => Promise<void>;
  onCompleteRoute: (routeId: string) => Promise<void>;
  onDateChange: (date: string) => void;
  /** Cães do cadastro, para o gestor adicionar um que não está no calendário do dia. */
  dogs?: DogRef[];
  onAddExtraDog?: (dog: DogRef) => void;
  /**
   * SUGESTÃO DE ROTA (cliente, áudio de 01/10/2026): o app propõe quem leva quais cães e em que ordem,
   * por geografia, e o gestor confirma antes de qualquer escrita. A conta mora na TELA
   * (`features/dispatch/routeSuggestion.ts` é puro); aqui só entra o botão, a folha da proposta e o
   * "Apply". Sem as props o quadro fica exatamente como era.
   */
  onSuggestRoutes?: (driverIds?: string[]) => Promise<DispatchSuggestion | null>;
  onApplySuggestion?: (blocos: DispatchSuggestionBlock[]) => Promise<void>;
  /**
   * VAN POR MOTORISTA (pergunta do dono, 01/10/2026: *"vamos supor que tenhas várias vans, o erro não
   * vai se repetir?"*). As VANS escolhíveis são o que aparece aqui: o cartão mostra a van de cada rota e
   * o gestor escolhe num toque. O YARD não entra como opção (não é van) — ele ganha uma LINHA PRÓPRIA,
   * informativa, com o endereço (dono, 02/10/2026). Sem `onChooseVan` o controle não existe.
   */
  vans?: DispatchVan[];
  onChooseVan?: (driverId: string, locationId: string) => Promise<void>;
  /**
   * YARD ESCOLHÍVEL (dono, 05/10/2026 — item 7 do redesenho; ÚNICA escrita nova): o yard também passa
   * a ser tocável e grava `routes.end_location_id` — a MESMA coluna que o fim do dia do motorista já
   * lê. Espelha o caminho da van (`onChooseVan`); com 0 ou 1 yard o chip é informativo e nada é
   * oferecido. Sem a prop, o yard fica como era.
   */
  onChooseYard?: (driverId: string, locationId: string) => Promise<void>;
  /** Van já escolhida para o motorista quando a rota dele ainda não existe. */
  vanDoMotorista?: (driverId: string) => string | null;
  /**
   * Abrir a LISTA DE PARADAS com a hora de cada uma (a tela `route-stops`).
   *
   * O dono procurou isso no cartão do motorista do Dispatch e não achou (01/10/2026: *"cliquei no cartao
   * do driver e nao vi nada disso"*) — a lista só abria pelo cartão da Home. Com a prop, o cartão do
   * Dispatch ganha um atalho; sem ela nada muda.
   */
  onOpenStopList?: (routeId: string, driverName: string) => void;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A quilometragem é exibida em MILHAS (o cliente é dos EUA), igual ao painel do dia. */
const KM_PER_MILE = 1.609344;

function validTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export const DispatchBoard = memo(function DispatchBoard({ date, phase, onPhaseChange, drivers, dayItems, dropoffItems, routes, driverLocations = {}, onAssign, onCreateDropoffRoute, pickupDriverByDog, onSaveStop, onRemoveStop, onMoveStop, onMoveDropoff, onSavePins, onOptimize, onPublish, onUnpublish, onCancelRoute, onCompleteRoute, onDateChange, dogs = [], onAddExtraDog, onSuggestRoutes, onApplySuggestion, vans, onChooseVan, onChooseYard, vanDoMotorista, onOpenStopList }: Props) {
  const [localPhase, setAssignmentPhase] = useState<Perna>('pickup');
  const assignmentPhase = phase ?? localPhase;
  const escolherPerna = (phase: Perna) => { setAssignmentPhase(phase); onPhaseChange?.(phase); };
  /**
   * ARRASTO EM CURSO (dono, 04/10/2026 — *"quando eu arrasto o cachorro a tela desce ou sobe junto"*).
   * Enquanto o gestor arrasta um cão, o `ScrollView` deste quadro DESLIGA o scroll: sem isso o pan nativo
   * da lista rouba o gesto e a tela rola junto. Volta a ligar assim que o dedo solta (ou o gesto é
   * cancelado) — quem avisa é o `ReorderableStops`.
   */
  const [arrastando, setArrastando] = useState(false);
  const [travas, setTravas] = useState<Travas>({});
  const [sheet, setSheet] = useState<SheetState>(null);
  /**
   * SUGESTÃO DE ROTA: a proposta mostrada na folha e o estado do pedido. Ela NÃO escreve nada — quem
   * escreve é o "Apply", que a tela executa (as mesmas escritas da atribuição à mão).
   */
  const [sugestao, setSugestao] = useState<DispatchSuggestion | null>(null);
  const [sugestaoBusy, setSugestaoBusy] = useState(false);
  const [sugestaoErro, setSugestaoErro] = useState<string | null>(null);
  const [sugestaoInvalida, setSugestaoInvalida] = useState(false);
  const [participantes, setParticipantes] = useState<string[] | null>(null);
  const diaAtual = useRef(date);
  diaAtual.current = date;
  const pedidoAtual = useRef(0);
  const sugestaoEmVoo = useRef(false);
  useEffect(() => {
    pedidoAtual.current++;
    sugestaoEmVoo.current = false;
    setSugestao(null);
    setSugestaoErro(null);
    setSugestaoBusy(false);
    setParticipantes(null);
    return () => { pedidoAtual.current++; };
  }, [date, assignmentPhase]);
  /**
   * Pede a proposta à tela. Nada é gravado aqui: a folha mostra e o gestor decide (decisão do dono:
   * *"mostra a proposta e eu confirmo num toque para aplicar"*).
   */
  const pedirSugestao = async (selecionados?: string[]) => {
    if (!onSuggestRoutes || sugestaoEmVoo.current) return;
    sugestaoEmVoo.current = true;
    const pedido = ++pedidoAtual.current;
    const dia = date;
    const ids = selecionados ?? participantes ?? drivers.map(d => d.id);
    setParticipantes(ids);
    setSugestaoBusy(true);
    setSugestaoInvalida(false);
    setSugestaoErro(null);
    try {
      const proposta = await onSuggestRoutes(ids);
      if (!proposta || pedido !== pedidoAtual.current || dia !== diaAtual.current) return;
      setSugestao(proposta);
      if (proposta.blocos.length === 0) setSugestaoErro('No eligible dogs or drivers. Check mapped addresses and draft routes.');
    } catch (causa) {
      if (pedido === pedidoAtual.current) setSugestaoErro(causa instanceof Error ? causa.message : 'Could not build the suggestion.');
      setSugestaoInvalida(true);
    } finally {
      if (pedido === pedidoAtual.current) { sugestaoEmVoo.current = false; setSugestaoBusy(false); }
    }
  };

  const aplicarSugestao = async () => {
    if (!sugestao || !onApplySuggestion || sugestaoEmVoo.current || sugestaoInvalida) return;
    sugestaoEmVoo.current = true;
    setSugestaoBusy(true);
    setSugestaoErro(null);
    try {
      await onApplySuggestion(sugestao.blocos);
      setSugestao(null);
    } catch (causa) {
      setSugestaoInvalida(true);
      setSugestaoErro(causa instanceof Error ? causa.message : 'Could not apply the suggestion.');
    } finally {
      sugestaoEmVoo.current = false;
      setSugestaoBusy(false);
    }
  };

  const [buscaCao, setBuscaCao] = useState(false);
  /**
   * OVERFLOW do cartão (dono, 05/10/2026 — item 8). As ações menos frequentes (Edit times,
   * Publish/Republish quando NÃO precisa subir, Unpublish, ✓ Done, Cancel route) vivem num menu
   * próprio, para o cartão não competir com o primário (`Optimize route`).
   *
   * 🪤 SÓ UM `Modal` NATIVO POR VEZ (foi o que travou o app no "Add any dog", 05/10/2026): abrir o
   * overflow FECHA a folha de atribuição e a busca de cão, e vice-versa — nunca empilha.
   */
  type MenuState = { driverName: string; route: DispatchRoute; leg: Perna };
  const [menuRota, setMenuRota] = useState<MenuState | null>(null);
  const abrirOverflow = (estado: MenuState) => { setSheet(null); setBuscaCao(false); setSugestao(null); setMenuRota(estado); };
  const abrirSheet = (estado: SheetState) => { setBuscaCao(false); setSugestao(null); setMenuRota(null); setSheet(estado); };
  const abrirBuscaCao = () => { setSheet(null); setSugestao(null); setMenuRota(null); setBuscaCao(true); };
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
    setTravas(sheet.mode === 'edit' ? sheet.stop : {});
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
      // Entrega: o cão já vem com o motorista do pick-up selecionado (trava do dono, 03/10/2026).
      setDriverId(sheet.phase === 'dropoff' ? pickupDriverByDog?.get(sheet.item.dogId) ?? null : null);
    }
  }, [sheet]);

  const assignedDogIds = useMemo(() => new Set(routes.filter(r => (r.phase ?? 'pickup') === assignmentPhase).flatMap((route) => route.stops.map((stop) => stop.dogId))), [routes, assignmentPhase]);
  /**
   * Cães do DIA confirmado, para CONFERIR as paradas da rota (dono, 03/10/2026). A lista de pick-up
   * desenha o que está em `route_stops`, que congela o dia da PUBLICAÇÃO: um cão cancelado depois
   * continua na linha, e o cão novo não entra sozinho. A união dos pools (fila de transporte do dia +
   * pool de drop-off) é o que o dia confirmado oferece hoje — quem não está aí saiu do dia.
   */
  const diaDogIds = useMemo(() => new Set([...dayItems, ...(dropoffItems ?? [])].map((item) => item.dogId)), [dayItems, dropoffItems]);
  /** Fila principal: precisa de transporte e não está já na van. */
  const paraTransporte = useMemo(() => (assignmentPhase === 'pickup' ? dayItems : dropoffItems ?? []).filter((item) => !item.inVan && (assignmentPhase === 'pickup' || item.reservationKind !== 'boarding')), [dayItems, dropoffItems, assignmentPhase]);
  const unassigned = useMemo(() => paraTransporte.filter((item) => !assignedDogIds.has(item.dogId)), [paraTransporte, assignedDogIds]);
  /** Seção separada: já estão na van (sem pickup), mas o gestor pode incluir na rota à mão. */
  const naVan = useMemo(() => dayItems.filter((item) => item.inVan && !assignedDogIds.has(item.dogId)), [dayItems, assignedDogIds]);
  /**
   * 🪤 CLIENTE (áudio de 02/10/2026): *"como ela está em boarding, ele não devia estar criando esse
   * cachorro na volta… ela não tem drop-off para ela, porque ela termina junto com a van"*. Boarding
   * NÃO é parada de rota e NUNCA tem drop-off (decisão do dono no mesmo dia: *"boarding nunca entre no
   * drop-off"*; contrato do Total Pack de 28/09/2026). A seção continua existindo só para o gestor VER
   * quem já está na van — sem botão de incluir na rota, que era justamente por onde um boarding entrava
   * na volta. Nasce RECOLHIDA e abre no toque (print do cliente, 02/10/2026: *"tá aparecendo os boarding
   * na lista"*).
   */
  const [mostrarNaVan, setMostrarNaVan] = useState(false);
  /**
   * DEFEITO B (03/10/2026): perna de drop-off. `entregaveis` são os cães do dia que ainda podem virar
   * parada de uma perna nova (pool de drop-off, sem boarding, ainda sem motorista) — sem nada a entregar
   * a ação não aparece. `criandoDropoff` é só o estado visual do botão.
   */
  const assignedDropoffIds = useMemo(() => new Set(routes.filter((rota) => rota.phase === 'dropoff').flatMap((rota) => rota.stops.map((stop) => stop.dogId))), [routes]);
  const entregaveis = useMemo(() => (dropoffItems ?? []).filter((item) => !item.inVan && item.reservationKind !== 'boarding' && !assignedDropoffIds.has(item.dogId)), [dropoffItems, assignedDropoffIds]);
  /**
   * Quem pode criar a perna de entrega e com QUAIS cães: os que AQUELE motorista buscou (a trava do
   * dono, 03/10/2026) mais os que não têm motorista de pick-up no dia. Sem o mapa, vale a regra antiga
   * (qualquer cão elegível) — é o caminho de quem não passa a prop.
   */
  const entregaveisDoMotorista = useMemo(
    () => (driverId: string) => entregaveis.filter((item) => {
      const dono = pickupDriverByDog?.get(item.dogId);
      return !dono || dono === driverId;
    }),
    [entregaveis, pickupDriverByDog],
  );
  /**
   * Na ENTREGA o cão é de quem o buscou: a folha de atribuição não oferece outro motorista e já abre
   * com o dono selecionado.
   */
  const motoristaPreso = sheet?.mode === 'assign' && sheet.phase === 'dropoff'
    ? pickupDriverByDog?.get(sheet.item.dogId) : undefined;
  const nomeDoPreso = motoristaPreso
    ? drivers.find((driver) => driver.id === motoristaPreso)?.name ?? 'the pick-up driver' : null;
  const motoristasDaFolha = motoristaPreso
    ? drivers.filter((driver) => driver.id === motoristaPreso) : drivers;
  const [criandoDropoff, setCriandoDropoff] = useState<string | null>(null);
  const routesByDriver = useMemo(() => new Map(routes.map((route) => [`${route.driverId}:${route.phase ?? 'pickup'}`, route])), [routes]);
  // Pedido de 04/10: um motorista e uma perna por vez, mantendo a entrega com quem buscou.
  const [motoristaVisivel, setMotoristaVisivel] = useState<string | null>(null);
  const paradasDaPerna = (driverId: string, leg: Perna) => routesByDriver.get(`${driverId}:${leg}`)?.stops.length ?? 0;
  const motoristaVisivelObj = drivers.find((driver) => driver.id === motoristaVisivel) ?? drivers[0] ?? null;
  /**
   * As DUAS rotas do motorista visível. Legado (rota sem `phase`): a MESMA rota serve às duas pernas —
   * a busca usa `sequence` e a entrega usa `dropoff_sequence`, exatamente como na tela da rota do gestor.
   */
  const rotaDoDia = motoristaVisivelObj ? {
    busca: routesByDriver.get(`${motoristaVisivelObj.id}:pickup`),
    entrega: routesByDriver.get(`${motoristaVisivelObj.id}:dropoff`),
  } : null;
  /** Cães que a ação "Create drop-off route" levaria para o motorista visível (regra do dono: quem buscou, entrega). */
  const entregaveisVisiveis = motoristaVisivelObj ? entregaveisDoMotorista(motoristaVisivelObj.id) : [];
  /** O "Suggest routes" é ação do DIA e vive nas ações do cartão (ao lado do Optimize). */
  const podeSugerir = Boolean(onSuggestRoutes && onApplySuggestion) && (assignmentPhase === 'pickup' ? dayItems.length > 0 : (dropoffItems?.length ?? 0) > 0);

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
    for (const perna of ['pickup', 'dropoff'] as const) {
      const pin = pinDaParada(travas, perna);
      if (pin?.tipo === 'fixed' && (!Number.isInteger(pin.posicao) || (pin.posicao ?? 0) < 1)) {
        setError('Position must be between 1 and 99.'); return;
      }
    }
    setWorking(true);
    try {
      const constraint = constraintFromFields();
      if (sheet.mode === 'assign') {
        await onAssign(sheet.item.dogId, driverId as string, constraint, ...(sheet.phase ? [sheet.phase] as const : []));
      } else if (driverId !== sheet.route.driverId) {
        await onSavePins?.(sheet.route.routeId, sheet.stop.dogId, travas);
        await onAssign(sheet.stop.dogId, driverId as string, constraint, ...(sheet.route.phase ? [sheet.route.phase] as const : []));
      } else {
        await onSavePins?.(sheet.route.routeId, sheet.stop.dogId, travas);
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
    const label = `${stop.dogName}`;
    showAlert('Remove stop', `Remove ${label} from the route?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { setSheet(null); void onRemoveStop(route.routeId, stop.dogId); } },
    ]);
  };

  const sheetTitle = sheet ? (sheet.mode === 'assign' ? `Assign ${sheet.item.dogName}` : `Edit ${sheet.stop.dogName}`) : '';
  /**
   * Aviso da casa na folha de atribuição: o gestor vê que os irmãos de casa vão junto ANTES de salvar
   * (áudio do dono, 29/09/2026: *"se eu mandar o Sam para um driver, o Oli vai para o mesmo driver"*).
   */
  const casaAviso = sheet?.mode === 'assign' && (sheet.item.houseMates?.length ?? 0) > 0
    ? `Same house: ${sheet.item.houseMates!.join(' and ')} ${sheet.item.houseMates!.length > 1 ? 'go' : 'goes'} to the same driver.`
    : null;

  return (
    <View style={styles.screen}>
      <View style={styles.header} testID="dispatch-header">
        <View style={styles.dateRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => onDateChange(addDaysISO(date, -1))} style={styles.arrow}>
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>{formatDayLabel(date)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => onDateChange(addDaysISO(date, 1))} style={styles.arrow}>
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.summary}>
          {plural((assignmentPhase === 'pickup' ? dayItems : dropoffItems ?? []).length, 'transport dog', 'transport dogs')} · {plural(drivers.length, 'driver', 'drivers')}
        </Text>
      </View>
      {/*
        * SELETOR DE PERNA (dono, 04/10/2026): desenho PRÓPRIO, de uma linha, separado dos chips de
        * motorista logo abaixo — antes ele vestia o MESMO estilo deles e o dono leu "coloração confusa".
        * O ativo é verde CLARO (`sage`) com texto escuro: discreto, sem bloco verde cheio na tela.
        */}
      <Text style={styles.faseRotulo}>PLANNING</Text>
      <View style={styles.faseSeletor} testID="dispatch-phase-selector">{(['pickup', 'dropoff'] as const).map(phase =>
        <Pressable key={phase} accessibilityRole="button" accessibilityLabel={phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}
          accessibilityState={{ selected: assignmentPhase === phase }} onPress={() => escolherPerna(phase)}
          style={[styles.faseOpcao, assignmentPhase === phase && styles.faseOpcaoAtiva]}>
          <Text style={[styles.faseOpcaoTexto, assignmentPhase === phase && styles.faseOpcaoTextoAtivo]}>{phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}</Text>
        </Pressable>)}</View>
      <ScrollView testID="dispatch-scroll" scrollEnabled={!arrastando} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/*
          * LINHA DE ATRIBUIÇÃO (dono, 05/10/2026 — item 3 do redesenho): a antiga faixa com BORDA
          * TRACEJADA e a frase `Every transport dog is assigned. 🎉` viraram UMA LINHA de status.
          * Tudo atribuído: `✓ All dogs assigned` + `+ Add dog`. Com pendência: o título
          * `N unassigned` (que já existia) + os chips dos cães + `+ Add dog`. Sem borda tracejada,
          * sem cartão grande. O `testID="unassigned-pool"` continua e a contagem fica FORA dele.
          */}
        <View style={styles.assignmentLine}>
          {unassigned.length > 0 ? <Text style={styles.unassignedTitle}>{unassigned.length} unassigned</Text> : null}
          <View testID="unassigned-pool" style={styles.resourcesWrap}>
            {sugestaoErro && !sugestao ? <Text style={styles.sugestaoErro}>{sugestaoErro}</Text> : null}
            {paraTransporte.length === 0 ? (
              <Text style={styles.muted}>No transport dogs need a ride today.</Text>
            ) : unassigned.length === 0 ? (
              <Text numberOfLines={1} style={styles.assignedOk}>✓ All dogs assigned</Text>
            ) : null}
            {unassigned.map((item) => (
              <Pressable key={item.dogId} accessibilityRole="button" accessibilityLabel={`Assign ${item.dogName}`} onPress={() => abrirSheet({ mode: 'assign', item, phase: assignmentPhase === 'dropoff' ? 'dropoff' : undefined })} style={[styles.chip, styles.poolChip]}>
                <Text numberOfLines={1} style={styles.chipText}>{item.dogName}{item.extra ? ' · manual' : ''}</Text>
              </Pressable>
            ))}
            {onAddExtraDog ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add any dog" onPress={() => abrirBuscaCao()} style={styles.addDog}>
                <Text numberOfLines={1} style={styles.addDogText}>+ Add dog</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {/* CHIPS DE MOTORISTA (dono, 05/10/2026 — item 4): compactos (`Raphael 3` / `Gabriel 0`), SEM
            "manager" no chip (o papel continua DENTRO do cartão), selecionado em verde cheio e
            ROLAGEM HORIZONTAL quando houver muitos (`showsHorizontalScrollIndicator={false}`). */}
        {drivers.length > 0 ? (
          <ScrollView testID="dispatch-linha-motoristas" horizontal showsHorizontalScrollIndicator={false}
            style={styles.motoristaScroll} contentContainerStyle={styles.motoristaSeletor}>
            {drivers.map((driver) => {
              const ativo = motoristaVisivelObj?.id === driver.id;
              const quantos = paradasDaPerna(driver.id, assignmentPhase);
              return (
                <Pressable
                  key={driver.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${driver.name}`}
                  accessibilityState={{ selected: ativo }}
                  onPress={() => setMotoristaVisivel(driver.id)}
                  style={[styles.motoristaChip, ativo && styles.motoristaChipAtivo]}
                >
                  <Text numberOfLines={1} style={[styles.motoristaChipTexto, ativo && styles.motoristaChipTextoAtivo]}>
                    {driver.name} {quantos}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {motoristaVisivelObj ? (
          <View>
            <CartaoMotorista
              driver={motoristaVisivelObj} leg={assignmentPhase}
              route={assignmentPhase === 'pickup' ? rotaDoDia?.busca : rotaDoDia?.entrega ?? (rotaDoDia?.busca?.phase === undefined ? rotaDoDia?.busca : undefined)}
              location={driverLocations[motoristaVisivelObj.id]} working={working} setSheet={abrirSheet}
              onMoveStop={onMoveStop} onMoveDropoff={onMoveDropoff} onOptimize={onOptimize} onPublish={onPublish}
              onSuggest={podeSugerir ? pedirSugestao : undefined} suggestionBusy={sugestaoBusy}
              vans={vans} onChooseVan={assignmentPhase === 'pickup' ? onChooseVan : undefined}
              onChooseYard={assignmentPhase === 'pickup' ? onChooseYard : undefined}
              vanDoMotorista={vanDoMotorista} onOpenStopList={onOpenStopList}
              diaDogIds={diaDogIds} unassignedCount={unassigned.length}
              onOpenMenu={abrirOverflow} onOpenAddDog={onAddExtraDog ? abrirBuscaCao : undefined}
              onDraggingChange={setArrastando}
              onUnpublish={onUnpublish} onCancelRoute={onCancelRoute} onCompleteRoute={onCompleteRoute} />
            {/* DEFEITO B (03/10/2026): cria a perna que nunca nasceu — draft, sem publicar. Fica FORA do
                cartão (o cartão não conhece a ação) e aparece quando o motorista visível tem cão para
                entregar e a perna de ENTREGA ainda não existe. */}
            {assignmentPhase === 'dropoff' && !rotaDoDia?.entrega && onCreateDropoffRoute && entregaveisVisiveis.length > 0 ? (
              <View style={styles.pernaVazia}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Create drop-off route for ${motoristaVisivelObj.name}`}
                  disabled={working || criandoDropoff !== null}
                  onPress={() => {
                    setCriandoDropoff(motoristaVisivelObj.id);
                    void onCreateDropoffRoute(motoristaVisivelObj.id)
                      .catch((erro) => showAlert('Could not create the drop-off route', erro instanceof Error ? erro.message : 'Try again.'))
                      .finally(() => setCriandoDropoff(null));
                  }}
                  style={styles.createDropoffButton}
                >
                  <Text style={styles.createDropoffText}>
                    {criandoDropoff === motoristaVisivelObj.id ? 'Creating…' : 'Create drop-off route'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}


        {/*
          Cão em boarding que também faz daycare no dia: já acorda dentro da van e TERMINA o dia nela —
          não é parada de rota e NÃO tem drop-off (decisão do dono, 02/10/2026: *"boarding nunca entre no
          drop-off"*; contrato do Total Pack, 28/09/2026). Esta seção é só INFORMATIVA (quem já está na
          van): antes ela deixava o gestor incluir à mão "caso precise voltar para casa", e era por aí
          que um boarding entrava na rota de volta — o que o cliente apontou no áudio de 02/10/2026.
        */}
        {assignmentPhase === 'pickup' && naVan.length > 0 ? (
          <View style={styles.jaNaVan} testID="dispatch-ja-na-van">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: mostrarNaVan }}
              accessibilityLabel={mostrarNaVan
                ? 'Hide boarding dogs already in the van'
                : 'Show boarding dogs already in the van'}
              onPress={() => setMostrarNaVan((v) => !v)}
              style={styles.naVanCabecalho}
            >
              {/* Item 12: linha discreta `Already in van  N  ⌄` — o bloco tracejado com
                  "Boarding — already in the van (N) ▸ Show" saiu. */}
              <Text style={styles.naVanTitulo}>Already in van</Text>
              <Text style={styles.naVanCount}>{naVan.length}</Text>
              <Text style={styles.naVanChevron}>{mostrarNaVan ? '⌃' : '⌄'}</Text>
            </Pressable>
            {mostrarNaVan ? (
              <>
                <Text style={styles.muted}>
                  They start the day in the van and finish it there too — they are not route stops and never
                  have a drop-off. This list is just so you can see who is already in the van.
                </Text>
                {naVan.map((item) => (
                  <View
                    key={item.dogId}
                    testID={`boarding-na-van-${item.dogId}`}
                    accessibilityLabel={`Boarding ${item.dogName} — already in the van`}
                    style={[styles.chip, styles.chipVan]}
                  >
                    <Text numberOfLines={1} style={styles.chipText}>{item.dogName}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/*
        "Add any dog": o gestor puxa um cão do cadastro que NÃO está no calendário do dia (chegou de
        última hora, ou o transporte não foi marcado na reserva). Não inventa reserva: a parada vive
        só na rota. Pedido do dono (23/09/2026) — controle do Total Pack sem depender do calendário.
      */}
      <Modal visible={buscaCao} transparent animationType="fade" onRequestClose={() => setBuscaCao(false)}>
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, styles.manualDogSheet]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add any dog</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setBuscaCao(false)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              Straight from the registry — no reservation needed today. The stop is created only on the route.
            </Text>
            {buscaCao ? <ManualDogSearch
              dogs={dogs}
              onSelect={(dog) => { onAddExtraDog?.(dog); setBuscaCao(false); }}
            /> : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/*
        SUGESTÃO DE ROTA — a proposta por geografia (cliente, áudio 01/10/2026). Mostra os blocos por
        motorista, na ordem que será GRAVADA, o total de cada perna e o que ficou de fora por falta de
        endereço no cadastro. Nada vai para o banco antes do "Apply".
      */}
      <Modal visible={sugestao !== null} transparent animationType="fade" onRequestClose={() => { if (!sugestaoBusy) setSugestao(null); }}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Suggested routes</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close suggestion" disabled={sugestaoBusy} onPress={() => setSugestao(null)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sugestaoLista}>
            <Text style={styles.sugestaoMotorista}>Who is driving?</Text>
            <View style={styles.sugestaoParticipantes}>
              {drivers.map(driver => {
                const checked = participantes?.includes(driver.id) ?? true;
                return <Pressable key={driver.id} accessibilityRole="checkbox"
                  accessibilityLabel={`Include ${driver.name} in suggestion`}
                  accessibilityState={{ checked }} disabled={sugestaoBusy}
                  onPress={() => void pedirSugestao(checked
                    ? (participantes ?? []).filter(id => id !== driver.id)
                    : [...(participantes ?? []), driver.id])}
                  style={[styles.driverOption, checked && styles.driverOptionActive]}>
                  <Text style={[styles.driverOptionText, checked && styles.driverOptionTextActive]}>
                    {checked ? '✓ ' : ''}{driver.name}{driver.alsoManager ? ' · manager' : ''}
                  </Text>
                </Pressable>;
              })}
            </View>
            <Text style={styles.muted}>
              Geographic estimate, not road mileage or traffic. Same-house dogs stay together.
              New dogs are appended in the suggested order for each phase; existing stops stay unchanged.
              Only draft routes without order locks or started stops can receive dogs.
              Published and closed routes stay unchanged. Nothing is published by Apply.
            </Text>
            {sugestao?.pernas ? [assignmentPhase].map(phase => <View key={phase}>
              <Text style={styles.sugestaoMotorista}>{phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'} · {sugestao.pernas![phase].blocos.reduce((total, b) => total + b.caes.length, 0)} dogs</Text>
              {sugestao.pernas![phase].blocos.length === 0 ? <Text style={styles.muted}>No eligible dogs or drivers for this phase.</Text> : null}
              {sugestao.pernas![phase].semLugar.length > 0 ? <Text style={styles.sugestaoAviso}>
                Not assigned: {sugestao.pernas![phase].semLugar.map(d => `${d.dogName}`).join(', ')}
              </Text> : null}
            </View>) : null}
            {sugestao?.blocos.map((bloco) => (
              <View key={`${bloco.driverId}:${bloco.phase ?? 'pickup'}`} testID={`sugestao-${bloco.driverId}${bloco.phase === 'dropoff' ? '-dropoff' : ''}`} style={styles.sugestaoBloco}>
                <Text style={styles.sugestaoMotorista}>
                  {bloco.phase ? `${bloco.phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'} · ` : ''}{bloco.driverName} · {plural(bloco.caes.length, 'dog', 'dogs')}
                  {bloco.km > 0 ? ` · ${Math.round(bloco.km / KM_PER_MILE)} mi` : ''}
                </Text>
                {bloco.caes.map((cao, indice) => (
                  <Text key={cao.dogId} style={styles.sugestaoCao}>
                    {indice + 1}. {cao.dogName}
                  </Text>
                ))}
              </View>
            ))}
            {sugestao && !sugestao.pernas && sugestao.semLugar.length > 0 ? (
              <Text style={styles.sugestaoAviso}>
                Check coordinates, eligible drivers or an already assigned house (kept out of the suggestion): {sugestao.semLugar.map((cao) => `${cao.dogName}`).join(', ')}
              </Text>
            ) : null}
            {sugestaoErro ? <Text style={styles.error}>{sugestaoErro}</Text> : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Apply suggestion"
              disabled={sugestaoBusy || sugestaoInvalida || (sugestao?.blocos.length ?? 0) === 0}
              onPress={() => void aplicarSugestao()}
              style={styles.saveButton}
            >
              {sugestaoBusy ? <ActivityIndicator color={colors.forest900} /> : <Text style={styles.saveText}>Apply to the routes</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel suggestion" disabled={sugestaoBusy} onPress={() => setSugestao(null)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
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

            {sheet?.mode === 'edit' && sheet.route.phase || sheet?.mode === 'assign' && sheet.phase ?
              <Text style={styles.fieldLabel}>{(sheet.mode === 'edit' ? sheet.route.phase : sheet.phase) === 'dropoff' ? 'Drop-offs' : 'Pick-ups'}</Text> : null}
            {casaAviso ? <Text style={styles.houseHint}>{casaAviso}</Text> : null}
            {/* Trava do dono (03/10/2026): na entrega o outro motorista nem aparece — quem buscou, entrega. */}
            {nomeDoPreso && sheet?.mode === 'assign' ? (
              <Text style={styles.houseHint}>
                {`${sheet.item.dogName} was picked up by ${nomeDoPreso} — the drop-off stays with them.`}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>Driver</Text>
            <View style={styles.driverOptions}>
              {motoristasDaFolha.map((driver) => {
                const active = driver.id === driverId;
                return (
                  <Pressable key={driver.id} accessibilityRole="button" accessibilityLabel={`Driver ${driver.name}`} onPress={() => setDriverId(driver.id)} style={[styles.driverOption, active && styles.driverOptionActive]}>
                    <Text style={[styles.driverOptionText, active && styles.driverOptionTextActive]}>
                      {driver.name}
                      {driver.alsoManager ? ' · manager' : ''}
                    </Text>
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

            {sheet?.mode === 'edit' ? <>
              <Text style={styles.fieldLabel}>Order rule</Text>
              {(['pickup', 'dropoff'] as const).map((perna) => {
                const label = perna === 'pickup' ? 'Pick-up' : 'Drop-off';
                return <View key={perna} style={styles.pinRow}>
                  <Text style={styles.pinLabel}>{label}</Text>
                  {([null, 'first', 'last', 'fixed'] as const).map((tipo) => {
                    const texto = tipo === null ? 'Free' : tipo === 'first' ? '1st' : tipo === 'last' ? 'Last' : 'Position #';
                    const ativo = (travas[`${perna}Pin`] ?? null) === tipo;
                    return <Pressable key={texto} accessibilityRole="button" accessibilityLabel={`${label} rule ${texto}`} accessibilityState={{ selected: ativo }} disabled={working}
                      onPress={() => setTravas((atual) => ({ ...atual, [`${perna}Pin`]: tipo }))}
                      style={[styles.driverOption, styles.pinChip, ativo && styles.driverOptionActive]}>
                      <Text style={[styles.driverOptionText, ativo && styles.driverOptionTextActive]}>{texto}</Text>
                    </Pressable>;
                  })}
                  {travas[`${perna}Pin`] === 'fixed' ? <TextInput accessibilityLabel={`${label} position`} keyboardType="number-pad" maxLength={2}
                    value={travas[`${perna}PinPosition`]?.toString() ?? ''} style={styles.pinInput}
                    onChangeText={(valor) => setTravas((atual) => ({ ...atual, [`${perna}PinPosition`]: valor.replace(/\D/g, '') ? Number(valor.replace(/\D/g, '')) : null }))} /> : null}
                </View>;
              })}
            </> : null}

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

      {/* OVERFLOW DO CARTÃO (dono, 05/10/2026 — item 8): as ações menos frequentes vivem AQUI, para o
          cartão não competir com o primário (`Optimize route`). Menu com UMA instância de `Modal`
          nativo; abrir o overflow já fechou a folha/ busca (ver `abrirOverflow`), nunca empilha. */}
      <Modal visible={menuRota !== null} transparent animationType="fade" onRequestClose={() => setMenuRota(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{menuRota ? `Route — ${menuRota.driverName}` : ''}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setMenuRota(null)} hitSlop={10}>
                <Text style={styles.sheetClose}>✕</Text>
              </Pressable>
            </View>
            {menuRota ? <>
              {onOpenStopList ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Stop list for ${menuRota.driverName}`}
                  onPress={() => { const alvo = menuRota; setMenuRota(null); onOpenStopList(alvo.route.routeId, alvo.driverName); }}
                  style={styles.menuItem}>
                  <Text style={styles.menuItemText}>Edit times</Text>
                </Pressable>
              ) : null}
              {menuRota.leg === 'pickup' && menuRota.route.status === 'published' && !precisaRepublicar(menuRota.route.status, { foraDoDia: paradasForaDoDia(menuRota.route.stops ?? [], diaDogIds).length, unassigned: unassigned.length }) ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Republish ${menuRota.driverName} route`} disabled={working}
                  onPress={() => { const alvo = menuRota; setMenuRota(null); void onPublish(alvo.route.routeId); }}
                  style={styles.menuItem}>
                  <Text style={styles.menuItemText}>Republish</Text>
                </Pressable>
              ) : null}
              {menuRota.route.status === 'published' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Unpublish ${menuRota.driverName} route`} disabled={working}
                  onPress={() => { const alvo = menuRota; setMenuRota(null); void onUnpublish(alvo.route.routeId); }}
                  style={styles.menuItem}>
                  <Text style={styles.menuItemText}>Unpublish</Text>
                </Pressable>
              ) : null}
              {menuRota.route.status === 'published' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Complete ${menuRota.driverName} route`} disabled={working}
                  onPress={() => { const alvo = menuRota; setMenuRota(null); void onCompleteRoute(alvo.route.routeId); }}
                  style={styles.menuItem}>
                  <Text style={styles.menuItemText}>✓ Done</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Cancel ${menuRota.driverName} route`} disabled={working}
                onPress={() => { const alvo = menuRota; setMenuRota(null); void onCancelRoute(alvo.route.routeId); }}
                style={[styles.menuItem, styles.menuDanger]}>
                <Text style={[styles.menuItemText, styles.menuDangerText]}>Cancel route</Text>
              </Pressable>
            </> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setMenuRota(null)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
});

/**
 * Search INSIDE the Dispatch sheet, not a second native Modal. The shared calendar picker owns a
 * Modal; nesting it here dismissed child and parent together after selection. On iOS that is a
 * risky native presentation transition even though the manual dog has already reached the pool.
 * Keep the shared search rules, but only one presenter/backdrop for this workflow.
 */
function ManualDogSearch({ dogs, onSelect }: { dogs: DogRef[]; onSelect: (dog: DogRef) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const found = useMemo(() => filtrarCaes(dogs, term), [dogs, term]);
  const groups = useMemo(() => agruparPorCliente(found), [found]);
  if (!open) return (
    <Pressable accessibilityRole="button" accessibilityLabel="Select dog" onPress={() => setOpen(true)} style={styles.driverOption}>
      <Text style={styles.driverOptionText}>Select dog…</Text>
    </Pressable>
  );
  return <View style={{ flexShrink: 1 }}>
    <Text style={styles.muted}>{resumoDaBusca(dogs.length, found.length, term)}</Text>
    <TextInput accessibilityLabel="Search dog or client" placeholder="Search dog or client…"
      placeholderTextColor={colors.muted} value={term} onChangeText={setTerm}
      autoCorrect={false} autoCapitalize="none" style={styles.manualDogSearch} />
    <ScrollView style={styles.sugestaoLista} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {groups.length === 0 ? <Text style={styles.muted}>No dogs found for “{term}”.</Text> : groups.map(group => (
        <View key={group.cliente}>
          <Text style={styles.fieldLabel}>{group.cliente}</Text>
          {group.caes.map(dog => <Pressable key={dog.id} accessibilityRole="button"
            accessibilityLabel={`Select ${dog.dogName} of ${dog.clientName}`}
            onPress={() => onSelect(dog)} style={styles.driverOption}>
            <Text style={styles.driverOptionText}>{dog.dogName}</Text>
          </Pressable>)}
        </View>
      ))}
    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel dog selection"
      onPress={() => { setTerm(''); setOpen(false); }} style={styles.sheetCancel}>
      <Text style={styles.sheetCancelText}>Cancel</Text>
    </Pressable>
  </View>;
}

type PropsCartao = Pick<Props, 'onMoveStop' | 'onMoveDropoff' | 'onOptimize' | 'onPublish' | 'onUnpublish' | 'onCancelRoute' | 'onCompleteRoute'> & {
  driver: DispatchDriver;
  route?: DispatchRoute;
  leg: Perna;
  /**
   * O cartão avisa o QUADRO quando um arrasto começa/termina (dono, 04/10/2026) — quem desliga o scroll é
   * o `ScrollView` do quadro, que vive fora deste cartão.
   */
  onDraggingChange?: (dragging: boolean) => void;
  location?: { latitude: number; longitude: number; updatedAt: string };
  working: boolean;
  setSheet: (sheet: SheetState) => void;
  onSuggest?: () => Promise<void>;
  suggestionBusy?: boolean;
  vans?: DispatchVan[];
  onChooseVan?: Props['onChooseVan'];
  onChooseYard?: Props['onChooseYard'];
  vanDoMotorista?: Props['vanDoMotorista'];
  onOpenStopList?: Props['onOpenStopList'];
  /** Cães do dia confirmado — a linha confere as paradas contra este conjunto (Defeito A, 03/10/2026). */
  diaDogIds?: ReadonlySet<string>;
  /** Cães do dia ainda SEM motorista nesta perna — a regra de republicação (item 15) usa este número. */
  unassignedCount?: number;
  /** Abre o menu de overflow do cartão (item 8). */
  onOpenMenu?: (estado: { driverName: string; route: DispatchRoute; leg: Perna }) => void;
  /** Abre a busca "Add any dog" do quadro (estado vazio do motorista, item 13). */
  onOpenAddDog?: () => void;
};

const CartaoMotorista = memo(function CartaoMotorista({
  driver, route, leg, location, working, setSheet, onMoveStop, onMoveDropoff, onOptimize, onPublish,
  onUnpublish, onCancelRoute, onCompleteRoute, onSuggest, suggestionBusy,
  vans, onChooseVan, onChooseYard, vanDoMotorista, onOpenStopList, diaDogIds, unassignedCount = 0,
  onOpenMenu, onOpenAddDog, onDraggingChange,
}: PropsCartao) {
  // A rota e as ações pertencem somente à perna selecionada.
  const grupos = useMemo(() => route ? [{ leg, route,
    stops: (leg === 'pickup' ? ordemDaBusca : ordemDaEntrega)(route.stops ?? []),
  }] : [], [route, leg]);
  const stops = grupos[0]?.stops ?? [];
  const totalParadas = stops.length;
  const semParadas = totalParadas === 0;
  const [salvandoVan, setSalvandoVan] = useState(false);
  const [salvandoYard, setSalvandoYard] = useState(false);
  const avisoRota = avisoDeRotaInvisivel(route?.status);
  /**
   * DEFEITO A (dono, 03/10/2026): as paradas vêm de `route_stops` — congeladas na PUBLICAÇÃO. A linha
   * confere contra o dia confirmado: cão que saiu do dia (reserva cancelada/substituída) ganha selo na
   * própria linha e o cartão avisa no topo com o nome. O app NÃO remove a parada sozinho — a saída
   * continua sendo o "Remove from route" da folha "⋯".
   */
  const foraDoDia = useMemo(() => {
    const vistos = new Set<string>();
    const todas = [...(route?.stops ?? [])]
      .filter((parada) => (vistos.has(parada.dogId) ? false : (vistos.add(parada.dogId), true)));
    return paradasForaDoDia(todas, diaDogIds ?? new Set<string>());
  }, [route, diaDogIds]);
  const avisoForaDoDia = avisoDeParadasForaDoDia(foraDoDia);
  /**
   * PUBLICAÇÃO VENCIDA (dono, 05/10/2026 — item 15). Antes o `Republish` aparecia SEMPRE; agora só
   * quando o dia realmente mudou desde a publicação (parada fora do dia OU cão ainda sem motorista).
   * A regra é PURA (`precisaRepublicar`) e usa só o que a tela já tem.
   */
  const mudanca = { foraDoDia: foraDoDia.length, unassigned: unassignedCount };
  const republicar = precisaRepublicar(route?.status, mudanca);
  const avisoRepublicacao = avisoDeRepublicacao(route?.status, mudanca);
  const badgeStatus = route ? (republicar ? 'Needs update' : rotuloDoBadge(route.status)) : '';
  /*
   * VAN DA ROTA (pergunta do dono, 01/10/2026). A van da rota manda; quando ela ainda não existe, vale a
   * escolha que o gestor fez no cartão (fica guardada na tela e vai gravada na rota que nascer). Sem
   * escolha nenhuma o app decide sozinho pela van mais próxima das paradas — o cartão diz isso em letras.
   * VAN ≠ YARD (dono, 02/10/2026): só as VANS são escolhíveis como onde o dia começa; o YARD (onde a
   * busca termina) tem linha própria. Redesenho (05/10/2026, itens 6/7): uma linha compacta de chips e
   * o YARD também TOCÁVEL quando há mais de um (grava `routes.end_location_id`).
   */
  const vanAtiva = route?.startLocationId ?? vanDoMotorista?.(driver.id) ?? null;
  const vansIniciais = (vans ?? []).filter((van) => van.kind !== 'yard');
  const yards = (vans ?? []).filter((van) => van.kind === 'yard');
  const yardPadrao = yards.find((yard) => yard.isDefault) ?? yards[0] ?? null;
  const yardAtivo = route?.endLocationId ?? yardPadrao?.id ?? null;
  const yardAtivoObj = yards.find((yard) => yard.id === yardAtivo) ?? yardPadrao;
  const mostrarRecursos = Boolean(onChooseVan && (vansIniciais.length > 1 || yards.length > 0));
  const escolherVan = async (locationId: string) => {
    if (!onChooseVan || salvandoVan || vanAtiva === locationId) return;
    setSalvandoVan(true);
    try {
      await onChooseVan(driver.id, locationId);
    } finally {
      setSalvandoVan(false);
    }
  };
  const escolherYard = async (locationId: string) => {
    if (!onChooseYard || salvandoYard || yardAtivo === locationId) return;
    setSalvandoYard(true);
    try {
      await onChooseYard(driver.id, locationId);
    } finally {
      setSalvandoYard(false);
    }
  };
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
  // HIERARQUIA DE AÇÕES (item 8): primário = Optimize route; secundário = Suggest; overflow = ⋯.
  const publicarNaLinha = Boolean(route && stops.length > 0 && leg === 'pickup' && (route.status === 'draft' || republicar));
  const mostrarPublicar = Boolean(route && stops.length > 0 && (leg === 'dropoff' || publicarNaLinha));
  return (
    <View key={driver.id} testID={`dispatch-route-${driver.id}-${route?.phase ?? 'pickup'}`} style={styles.driverCard}>
      <View style={styles.driverHeader}>
        <View style={styles.driverIdentity}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{driver.name[0]}</Text></View>
          {/* Precisa de flex:1 (e minWidth:0): sem isso, numa tela estreita os botões de ação
              consomem a linha e sobram ~48pt para o texto - o nome do motorista quebra LETRA POR
              LETRA (relato do dono no iPhone, 12/09/2026). */}
          <View style={styles.driverText} testID={route?.phase === 'dropoff' ? 'driver-info-dropoff' : 'driver-info'}>
            <View style={styles.driverTitleRow}>
              <Text numberOfLines={1} style={styles.driverName}>{driver.name}</Text>
              {/* BADGE DE STATUS (item 5): o status aparece AQUI e em nenhum outro lugar. Vira
                  `Needs update` quando a publicação ficou velha (item 15). */}
              {route ? (
                <View style={[styles.statusBadge, republicar ? styles.statusBadgeAlerta : styles.statusBadgeNeutro]} testID="driver-status-badge">
                  <Text style={[styles.statusBadgeText, republicar ? styles.statusBadgeTextoAlerta : null]}>{badgeStatus}</Text>
                </View>
              ) : null}
              {!semParadas ? <Text style={styles.driverCount}>{totalParadas} stop{totalParadas === 1 ? '' : 's'}</Text> : null}
            </View>
            {/* ESTADO SEM PARADAS (item 13): nada de cartão vazio grande. */}
            {semParadas ? <Text style={styles.emptyStops}>No stops assigned</Text> : null}
            {/* Rascunho NÃO chega ao celular do motorista (item 14): linha discreta, sem bloco. */}
            {avisoRota ? (
              <Text style={styles.draftLine} testID="driver-draft-badge">{avisoRota}</Text>
            ) : null}
            {/* UM aviso por assunto (item 9): aqui só o contador; o detalhe vive na linha da parada. */}
            {avisoForaDoDia ? (
              <Text style={styles.foraDoDiaAviso} testID={`route-off-day-${driver.id}`}>{avisoForaDoDia}</Text>
            ) : null}
            {avisoRepublicacao ? (
              <Text style={styles.republishAviso} testID={`route-needs-update-${driver.id}`}>{avisoRepublicacao}</Text>
            ) : null}
            {route && stops.length > 0 ? (
              <Text style={[styles.muted, eta?.lateMinutes || frescor?.velha ? styles.lateText : null]}>
                {location && frescor
                  ? `📍 ${frescor.texto}${frescor.muitoVelha ? ' · ⚠️ position stale' : frescor.velha ? ' · ⚠️ going stale' : ''}`
                  : '📍 not sharing'}
                {/* ETA só com posição do motorista: sem posição, "~0 min" é número inventado
                    (achado no print de 25/09/2026, com o motorista em "not sharing").
                    Motorista LONGE demais para o número fazer sentido (Defeito C, 03/10/2026: "~23322
                    min to Maui" com 9.716 km de distância): usa o MESMO limite e o MESMO texto do app do
                    motorista (ETA_MAXIMO_PLAUSIVEL_MIN → "far from your stops"). Regra de ETA nova, não. */}
                {eta && location && !frescor?.muitoVelha
                  ? eta.minutes <= ETA_MAXIMO_PLAUSIVEL_MIN
                    ? ` · ~${eta.minutes} min to ${eta.dogName}`
                    : ' · far from your stops'
                  : ''}
                {eta && frescor?.muitoVelha ? ' · ETA hidden (position too old)' : ''}
                {eta && eta.lateMinutes > 0 ? ` · ⚠️ ${eta.lateMinutes} min late` : ''}
              </Text>
            ) : null}
          </View>
        </View>
        {/* VAN e YARD numa LINHA COMPACTA de chips (item 6) — sem "Van"/"Yard" gigantes. Aparece
            também no estado SEM paradas (item 13: o gestor precisa ver onde o dia começa/termina). */}
        {mostrarRecursos ? (
          <View style={styles.recursosWrap}>
            {onChooseVan && vansIniciais.length > 1 ? (
              <View style={styles.vanLinha} testID={`driver-van-${driver.id}`}>
                <Text accessibilityLabel="Van · where the day starts" style={styles.vanRotulo}>🚐</Text>
                <View style={styles.vanChips}>
                  {vansIniciais.map((van) => {
                    const ativa = vanAtiva === van.id;
                    return (
                      <Pressable
                        key={van.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: ativa }}
                        accessibilityLabel={`Use ${van.name} for ${driver.name}`}
                        hitSlop={{ top: 7, bottom: 7, left: 2, right: 2 }}
                        disabled={salvandoVan || working || route?.status === 'completed' || route?.status === 'cancelled'}
                        onPress={() => void escolherVan(van.id)}
                        style={[styles.vanChip, ativa ? styles.vanChipAtiva : null]}
                      >
                        <Text numberOfLines={1} style={[styles.vanChipTexto, ativa ? styles.vanChipTextoAtivo : null]}>
                          {van.name}{van.isDefault ? ' ★' : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!vanAtiva ? <Text style={styles.vanAuto}>auto · nearest</Text> : null}
              </View>
            ) : null}
            {/*
              * YARD (itens 6/7): onde a busca termina. Com 0/1 yard o chip é INFORMATIVO; com 2+ (e a
              * prop `onChooseYard`) vira escolha e grava `routes.end_location_id` pelo caminho da van.
              */}
            {yards.length > 0 && yardAtivoObj ? (
              <View style={styles.vanLinha} testID={`driver-yard-${driver.id}`}>
                <Text accessibilityLabel="Yard · where the pick-up ends" style={styles.vanRotulo}>📍</Text>
                <View style={styles.vanChips}>
                  {yards.length > 1 && onChooseYard ? (
                    yards.map((yard) => {
                      const ativa = yardAtivo === yard.id;
                      return (
                        <Pressable
                          key={yard.id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: ativa }}
                          accessibilityLabel={`Use ${yard.name} for ${driver.name}`}
                          hitSlop={{ top: 7, bottom: 7, left: 2, right: 2 }}
                          disabled={salvandoYard || working || route?.status === 'completed' || route?.status === 'cancelled'}
                          onPress={() => void escolherYard(yard.id)}
                          style={[styles.vanChip, ativa ? styles.vanChipAtiva : null]}
                        >
                          <Text numberOfLines={1} style={[styles.vanChipTexto, ativa ? styles.vanChipTextoAtivo : null]}>
                            {yard.address ? `${yard.name} · ${yard.address}` : yard.name}
                          </Text>
                        </Pressable>
                      );
                    })
                  ) : (
                    <View
                      style={styles.yardChip}
                      accessibilityLabel={`Yard ${yardAtivoObj.name}${yardAtivoObj.address ? ` at ${yardAtivoObj.address}` : ''} — where the pick-up ends`}
                    >
                      <Text numberOfLines={1} style={styles.yardChipTexto}>
                        {yardAtivoObj.address ? `${yardAtivoObj.name} · ${yardAtivoObj.address}` : yardAtivoObj.name}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
        {/* AÇÕES (item 8): [Optimize route] [Suggest] [Publish/Republish changes?] [•••].
            Nada escondido atrás de rolagem — quebra em linhas. */}
        {!semParadas && (route || onSuggest) ? (
          <View testID="dispatch-actions-scroll" style={styles.actionsWrap}>
            <View style={styles.driverActions} testID="driver-actions">
              {route && stops.length >= 2 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Optimize ${driver.name} route`} disabled={working} onPress={() => void onOptimize(route.routeId)} style={styles.primaryButton}>
                  <Text numberOfLines={1} style={styles.primaryText}>Optimize route</Text>
                </Pressable>
              ) : null}
              {onSuggest ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Suggest routes"
                  disabled={working || suggestionBusy} onPress={() => void onSuggest()} style={styles.secondaryButton}>
                  <Text numberOfLines={1} style={styles.secondaryText}>{suggestionBusy ? 'Thinking…' : 'Suggest'}</Text>
                </Pressable>
              ) : null}
              {route && mostrarPublicar ? (
                <Pressable accessibilityRole="button" accessibilityLabel={republicar ? `Republish ${driver.name} route` : `Publish ${driver.name} route`} disabled={working || leg === 'dropoff'} onPress={() => void onPublish(route.routeId)} style={styles.publishButton}>
                  <Text numberOfLines={1} style={styles.publishText}>{leg === 'dropoff' ? 'Draft only' : republicar ? 'Republish changes' : 'Publish route'}</Text>
                </Pressable>
              ) : null}
              {route ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${driver.name}`} onPress={() => onOpenMenu?.({ driverName: driver.name, route, leg })} style={styles.overflowButton}>
                  <Text numberOfLines={1} style={styles.overflowText}>•••</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}
        {/* ESTADO VAZIO (item 13): `No stops assigned` + offer to assign (só quando existe). */}
        {semParadas && (onSuggest || onOpenAddDog) ? (
          <View style={styles.emptyActions}>
            {onSuggest ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Suggest routes" disabled={working || suggestionBusy} onPress={() => void onSuggest()} style={styles.emptyCta}>
                <Text numberOfLines={1} style={styles.emptyCtaText}>{suggestionBusy ? 'Thinking…' : 'Suggest assignments'}</Text>
              </Pressable>
            ) : null}
            {onOpenAddDog ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add a dog by hand" onPress={onOpenAddDog} style={styles.emptyAdd}>
                <Text numberOfLines={1} style={styles.emptyAddText}>+ Add dog</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {!semParadas ? grupos.map(({ leg, route: rotaDaPerna, stops: paradas }) => {
        const moverPerna = leg === 'pickup' ? onMoveStop : onMoveDropoff;
        const foraDoDiaDaPerna = paradasForaDoDia(rotaDaPerna.stops ?? [], diaDogIds ?? new Set<string>());
        return (
        <View key={`${driver.id}-${leg}`} testID={`dispatch-leg-${leg}-${driver.id}`}>
          <Text style={styles.grupoRotulo}>{leg === 'pickup' ? 'Pick-ups' : 'Drop-offs'} · {plural(paradas.length, 'stop', 'stops')}</Text>
          <ReorderableStops stops={paradas} leg={leg} enabled={rotaDaPerna.status === 'draft' && paradas.length > 1 && !working && !!moverPerna}
            onDraggingChange={onDraggingChange}
            onMove={(dogId, direction) => { void moverPerna?.(rotaDaPerna.routeId, dogId, direction); }}>
          {(stop, index, handle, accessibility) => {
            const offDay = foraDoDiaDaPerna.some((parada) => parada.dogId === stop.dogId);
            const problem = stop.status === 'skipped';
            const late = stop.status === 'pending' && isPastDeadline(stop.windowEnd, stop.exactTime);
            const high = stop.priority === 'priority';
            const alert = offDay ? SELO_PARADA_FORA_DO_DIA : problem ? '⚠ Problem' : late ? 'Late' : high ? '⚡ High' : null;
            const details = [offDay && SELO_PARADA_FORA_DO_DIA, problem && 'Problem', late && 'Late', high && 'High priority'].filter(Boolean).join(' · ');
            /* HORA PLANEJADA (item 10): a hora que JÁ existe (janela/exata), sem conta nova. */
            const plannedTime = stop.windowStart ? formatTimeOfDay(stop.windowStart) : stop.exactTime ? formatTimeOfDay(stop.exactTime) : null;
            /* DESLOCAMENTO gravado pelo Optimize (migração 041/042) — nunca inventado na tela. */
            const travelSeconds = leg === 'dropoff' ? stop.dropoffTravelSeconds : stop.travelSeconds;
            const travelText = typeof travelSeconds === 'number' && travelSeconds > 0 ? `${Math.round(travelSeconds / 60)} min away` : null;
            return (
        <View key={`${driver.id}-${leg}-${stop.dogId}`} style={styles.stop}>
          <View style={styles.position}><Text style={styles.positionText}>{index + 1}</Text></View>
          <View style={styles.stopMain} {...accessibility} accessibilityHint={[accessibility.accessibilityHint, details].filter(Boolean).join(' ')}>
            <View style={styles.stopLine}>
              <Text numberOfLines={1} style={styles.stopName}>{stop.dogName}</Text>
              {plannedTime ? <Text style={styles.stopTime}>{plannedTime}</Text> : null}
              {travelText ? <Text style={styles.stopTravel}>{travelText}</Text> : null}
            </View>
            <View style={styles.badgeRow} testID={`stop-badges-${leg}-${stop.dogId}`}>
              {alert ? <View style={[styles.badge, { backgroundColor: `${colors.urgency}18` }]}>
                <Text style={[styles.badgeText, styles.foraDoDiaSelo]} testID={offDay ? `stop-off-day-${stop.dogId}` : undefined}>{alert}</Text>
              </View> : null}
              {pinDaParada(stop, leg) ? <Badge text={`🔒 ${stop[`${leg}Pin`] === 'first' ? '1st' : stop[`${leg}Pin`] === 'last' ? 'last' : `#${stop[`${leg}PinPosition`]}`}`} color={colors.forest700} /> : null}
            </View>
            <StopProofChips pickupPath={stop.pickupProofPath} dropoffPath={stop.dropoffProofPath} />
          </View>
          <View style={styles.stopActions}>
            {handle}
            <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${stop.dogName}`} onPress={() => setSheet({ mode: 'edit', route: rotaDaPerna, stop })} style={styles.stopOptions}>
              <Text style={styles.optionsText}>⋯</Text>
            </Pressable>
          </View>
        </View>
          );
          }}
          </ReorderableStops>
          {paradas.length === 0 ? <Text style={styles.noStops}>{leg === 'pickup' ? 'No pick-up stops yet.' : 'No drop-off stops yet.'}</Text> : null}
        </View>
        );
      }) : null}
    </View>
  );

});

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
      <Text style={[styles.timeTargetValue, !value && styles.timeTargetPlaceholder]}>{value ? formatTimeOfDay(value) : 'Select…'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  manualDogSheet: { maxHeight: '90%' },
  manualDogSearch: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, padding: 12, color: colors.ink, marginVertical: 8 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 4 },
  /** Rótulo do seletor de perna — separa "PLANNING" dos chips de motorista logo abaixo. */
  faseRotulo: { color: '#B9C7B6', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginTop: 4, marginLeft: 14, marginBottom: 4 },
  /**
   * SELETOR DE PERNA (item 2): compacto, com moldura própria. O ativo segue o MESMO critério dos chips
   * de motorista — verde escuro CHEIO com texto claro (antes era `sage`: o dono leu "coloração confusa"
   * com dois verdes diferentes na mesma área).
   */
  faseSeletor: { flexDirection: 'row', alignSelf: 'flex-start', marginLeft: 14, marginBottom: 6, borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, backgroundColor: colors.paper, overflow: 'hidden' },
  faseOpcao: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: colors.line },
  faseOpcaoAtiva: { backgroundColor: colors.forest700 },
  faseOpcaoTexto: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  faseOpcaoTextoAtivo: { color: 'white' },
  pinLabel: { width: 50, fontSize: 12, color: colors.ink },
  pinChip: { paddingHorizontal: 6, paddingVertical: 7 },
  pinInput: { width: 30, borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, color: colors.ink, padding: 3 },
  screen: { flex: 1, backgroundColor: colors.forest700 },
  scroll: { flex: 1, backgroundColor: colors.cream },
  /**
   * COR DO TOPO (dono, 04/10/2026: "parte da data cor ficou esquisita"). O corpo da tela deste quadro e
   * VERDE ESCURO (`screen`), e a faixa da data tinha ficado BRANCA: um bloco branco flutuando no verde,
   * com moldura, e o "PLANNING" cinza-esverdeado sumindo sobre o verde (contraste ~2:1).
   * Aqui o topo volta ao padrao das outras telas: faixa VERDE, texto claro — o quadro fica emendado com
   * o verde e o corpo claro comeca no ScrollView.
   */
  header: { backgroundColor: colors.forest700, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 0 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 0 },
  title: { flexShrink: 1, color: colors.cream, fontFamily: 'serif', fontSize: 21, fontWeight: '800', textTransform: 'capitalize' },
  // M5 da auditoria (02/10/2026): os setas de dia tinham 42×38 pt — abaixo do mínimo de 44 pt.
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.cream, fontSize: 30, fontWeight: '700', lineHeight: 32 },
  summary: { color: '#D7E1D4', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  content: { padding: 12, paddingBottom: 30 },
  /**
   * SELETOR DE MOTORISTA e TROCA DE PERNA (Proposta B, dono 03/10/2026): o quadro desenhava 2N cartões;
   * agora é uma linha de chips (um motorista por vez) + um cartão único com a troca Pick-up | Drop-off.
   * Controles de UMA LINHA FINA, alvo de 44 pt, cores discretas (o dono não quer cor forte em área grande).
   */
  driverSelectorScroll: { flexGrow: 0, marginBottom: 4 },
  /** CHIPS DE MOTORISTA (item 4): linha que ROLA na horizontal (`showsHorizontalScrollIndicator={false}`). */
  motoristaScroll: { flexGrow: 0, marginBottom: 4 },
  motoristaSeletor: { flexDirection: 'row', gap: 6, paddingRight: 4 },
  motoristaChip: { minWidth: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', backgroundColor: '#F4F2EA' },
  motoristaChipAtivo: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  motoristaChipTexto: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  motoristaChipTextoAtivo: { color: 'white' },
  pernaSwitch: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  pernaOpcao: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: '#F4F2EA' },
  pernaOpcaoAtiva: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  pernaTexto: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  pernaTextoAtivo: { color: 'white' },
  pernaSugerir: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 9, paddingHorizontal: 12, backgroundColor: colors.forest500 },
  pernaSugerirTexto: { color: 'white', fontSize: 12, fontWeight: '900' },
  /** Perna sem rota (ex.: drop-off que ainda não nasceu): caixa discreta com a ação de criar. */
  pernaVazia: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  driverCard: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 4 },
  driverHeader: { padding: 6, gap: 4, backgroundColor: '#FAFBF8', borderBottomWidth: 1, borderBottomColor: colors.line },
  driverIdentity: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driverText: { flex: 1, minWidth: 0 },
  driverTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  avatar: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.forest700, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '900', fontSize: 13 },
  driverName: { fontSize: 14, lineHeight: 18, fontWeight: '900', color: colors.ink },
  driverCount: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  /** BADGE DE STATUS (item 5): verde suave = normal; vermelho suave = `Needs update` (item 15). */
  statusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  statusBadgeNeutro: { backgroundColor: colors.sage },
  statusBadgeAlerta: { backgroundColor: `${colors.urgency}18`, borderWidth: 1, borderColor: colors.urgency },
  statusBadgeText: { color: colors.forest900, fontSize: 11, fontWeight: '900' },
  statusBadgeTextoAlerta: { color: colors.urgency },
  /** Rascunho (item 14): linha discreta, sem borda nem bloco. */
  draftLine: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  /** Publicação vencida (item 15): a contagem de mudanças, discreta. */
  republishAviso: { color: colors.urgency, fontSize: 12, fontWeight: '800' },
  emptyStops: { color: colors.ink, fontSize: 13, fontWeight: '800', marginTop: 2 },
  muted: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  lateText: { color: colors.urgency, fontWeight: '800' },
  /**
   * BOTOES DE ACAO DA ROTA — altura minima de 44 pt (medido em 29/09/2026: estavam com 32 px, abaixo
   * do minimo do iOS; sao os botoes que o gestor mais toca no Dispatch). O `justifyContent: center`
   * mantem o texto centrado agora que a altura e fixa.
   */
  publishButton: { backgroundColor: colors.gold, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  publishText: { color: colors.forest900, fontWeight: '900', fontSize: 12 },
  unpublishButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  unpublishText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  completeButton: { backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  completeText: { color: colors.forest900, fontWeight: '900', fontSize: 12 },
  cancelRouteButton: { borderWidth: 1, borderColor: '#E8BFBF', backgroundColor: '#FBEDED', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8, minHeight: 44, minWidth: 44, justifyContent: 'center' },
  cancelRouteText: { color: colors.urgency, fontWeight: '900', fontSize: 12 },
  // A rolagem horizontal mantém todas as ações alcançáveis em uma faixa de 44 pt.
  horizontalRow: { width: '100%', flexGrow: 0 },
  resourcesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /**
   * UNASSIGNED (dono, 04/10/2026): os cães soltos QUEBRAM EM LINHAS em vez de rolar de lado — o
   * pedido é "sabermos quais dogs estão sem motorista e facilitar o serviço", e rolagem horizontal
   * esconderia justamente os cães (o dia dele teve 6 de uma vez).
   */
  resourcesWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6 },
  /**
   * Ações do cartão: o WRAPPER quebra em linhas (`actionsWrap`); o miolo TAMBÉM precisa quebrar —
   * medido no bundle web em 320 px, `[Optimize route][Suggest][Publish route][•••]` somava ~330 px e
   * ficava FORA da tela com `flexWrap: 'nowrap'`. Nada pode ser cortado (item 8/17).
   */
  actionsWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6, marginBottom: 4 },
  driverActions: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap', rowGap: 4, maxWidth: '100%' },
  optimizeButton: { backgroundColor: colors.sage, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  optimizeText: { color: colors.forest900, fontWeight: '900', fontSize: 12 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F0F1ED' },
  /** Rótulo da lista da perna escolhida. */
  grupoRotulo: { color: colors.muted, fontSize: 12, fontWeight: '900', letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 11, paddingTop: 4, paddingBottom: 4 },
  position: { width: 24, height: 24, borderRadius: 8, backgroundColor: '#EDF3EB', alignItems: 'center', justifyContent: 'center' },
  positionText: { color: colors.forest700, fontSize: 12, fontWeight: '900' },
  stopMain: { flex: 1, minWidth: 0 },
  stopTime: { color: colors.forest700, fontSize: 12, lineHeight: 16 },
  stopName: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '900' },
  stopActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stopOptions: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  optionsText: { color: colors.forest700, fontSize: 18, fontWeight: '900', lineHeight: 20 },
  noStops: { color: colors.muted, fontSize: 12, padding: 12 },
  /** Ação "Create drop-off route" (Defeito B, 03/10/2026): discreta, com alvo de 44 pt. */
  createDropoffButton: { alignSelf: 'flex-start', marginTop: 8, marginHorizontal: 12, borderWidth: 1, borderColor: colors.forest500, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  createDropoffText: { color: colors.forest700, fontWeight: '900', fontSize: 12 },
  /**
   * LINHA DE ATRIBUIÇÃO (item 3): uma linha de status, SEM borda tracejada nem cartão grande.
   * Tudo atribuído → `✓ All dogs assigned`; com pendência → o título + os chips dos cães. O `+ Add dog`
   * é um botão compacto de contorno (antes era o chip tracejado `＋ Add any dog`).
   */
  assignmentLine: { marginBottom: 6 },
  assignedOk: { color: colors.success, fontSize: 12, fontWeight: '800', lineHeight: 16 },
  addDog: { borderWidth: 1, borderColor: colors.forest500, backgroundColor: 'white', borderRadius: 999, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  addDogText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  /** "Already in van" (item 12): linha discreta, sem moldura tracejada. */
  jaNaVan: { marginBottom: 4 },
  naVanCabecalho: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44, // alvo de toque (vistoria 02/10/2026)
    gap: 8,
    paddingHorizontal: 6,
  },
  /**
   * "Already in van" (item 12): linha discreta, secundária à rota — título + contagem + chevron.
   * O título era longo e empurrava o "Show" para fora da borda (dono, 04/10/2026); com `flex: 1` +
   * texto curto o affordance fica sempre dentro.
   */
  naVanTitulo: { flex: 1, flexShrink: 1, color: colors.forest700, textTransform: 'uppercase', fontWeight: '900', fontSize: 12 },
  naVanCount: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  naVanChevron: { color: colors.forest700, fontSize: 14, fontWeight: '900' },
  /** Chips de motorista antigos (mantidos por compatibilidade de estilo). */
  motoristaWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, rowGap: 4, marginBottom: 4 },
  /** Van + Yard: quebram em linhas — o endereco do Yard nao fica cortado na borda. */
  recursosWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6, paddingHorizontal: 2, marginBottom: 4 },
  // 🪤 M4 DA AUDITORIA (02/10/2026): o "Show/Hide" era `colors.gold` sobre o cartão claro (~2,3:1).
  // Cor de TEXTO vira `forest700`; o gold continua nas bordas/fundos.
  naVanToque: { color: colors.forest700, fontSize: 12, fontWeight: '700' },
  unassignedTitle: { color: colors.muted, textTransform: 'uppercase', fontWeight: '900', fontSize: 12, marginBottom: 2 },
  sugestaoLista: { maxHeight: 400, flexShrink: 1 },
  sugestaoParticipantes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  /** Rota em rascunho: uma linha fina, âmbar, dizendo que o motorista ainda não vê (não é erro). */
  draftBadge: { alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderColor: colors.gold, backgroundColor: colors.cream, color: colors.forest700, fontSize: 12, fontWeight: '800', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  /** Parada que saiu do dia (Defeito A, 03/10/2026): aviso no topo do cartão e selo na linha, em vermelho. */
  foraDoDiaAviso: { alignSelf: 'flex-start', marginTop: 4, borderWidth: 1, borderColor: colors.urgency, backgroundColor: '#FBEDED', color: colors.urgency, fontSize: 12, fontWeight: '800', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  foraDoDiaSelo: { color: colors.urgency, fontSize: 12, fontWeight: '900' },
  sugestaoErro: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  // Van e Yard compartilham a faixa; os papéis e o endereço continuam acessíveis.
  // MEDIDO em 320 px: com dois yards (endereços longos) a linha estourava a borda. Cada linha ocupa
  // a largura toda e os chips QUEBRAM dentro do espaço que sobra do rótulo — nada sai da tela.
  vanLinha: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '100%' },
  vanRotulo: { color: colors.muted, fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  vanChips: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 },
  vanChip: { maxWidth: 160, minWidth: 44, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, minHeight: 44, justifyContent: 'center', backgroundColor: 'white' },
  vanChipAtiva: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  vanChipTexto: { color: colors.forest700, fontSize: 12, fontWeight: '800' },
  vanChipTextoAtivo: { color: 'white' },
  vanAuto: { color: colors.muted, fontSize: 12, fontStyle: 'italic' },
  /**
   * O YARD NÃO é van escolhível (dono, 02/10/2026: *"não é uma van o yard, ele tem que ter o endereço
   * que ele vai finalizar"*). Ele fica na faixa de recursos, SEM seleção, com endereço acessível — é o ponto onde a
   * busca termina (e a entrega começa), não uma opção. Alvo de 44 pt por consistência com os chips.
   */
  yardChip: { alignSelf: 'flex-start', maxWidth: 180, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, minHeight: 44, justifyContent: 'center', backgroundColor: '#F4F1E7' },
  yardChipTexto: { color: colors.forest700, fontSize: 12, fontWeight: '800' },
  // Atalho para a lista de paradas com hora (o dono procurou aqui, 01/10/2026). Alvo de 44 pt.
  stopListLink: { paddingHorizontal: 6, minWidth: 44, minHeight: 44, justifyContent: 'center' },
  stopListText: { color: colors.forest700, fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  sugestaoBloco: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 11, marginBottom: 9, backgroundColor: '#FAFBF7' },
  sugestaoMotorista: { color: colors.ink, fontWeight: '800', fontSize: 13, marginBottom: 4 },
  sugestaoCao: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  sugestaoAviso: { color: colors.forest900, backgroundColor: colors.sage, borderRadius: 10, padding: 9, fontSize: 12, marginBottom: 10 },
  // M5 da auditoria (02/10/2026): o chip de cão não listado tinha ~31 pt de alvo; sobe para 44 pt.
  poolChip: { marginBottom: 0, maxWidth: 180 },
  chip: { backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 7, borderWidth: 1, borderColor: colors.line, minHeight: 44, justifyContent: 'center' },
  chipText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  /** Botão "Add any dog": pontilhado como a moldura da fila, para não parecer um cão já listado. */
  chipAdd: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B9C4B9', borderRadius: radii.medium, paddingVertical: 9, paddingHorizontal: 8, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', backgroundColor: '#FFFFFF' },
  chipAddText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  /** Chip dos cães que já estão na van: fundo mais claro para não confundir com a fila principal. */
  chipVan: { backgroundColor: colors.sage, borderColor: colors.sage },
  backdrop: { flex: 1, backgroundColor: '#0D1B12AA', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 34 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontFamily: 'serif', fontSize: 19, fontWeight: '800', color: colors.forest900, flex: 1 },
  sheetClose: { color: colors.muted, fontSize: 17, fontWeight: '800', paddingHorizontal: 6 },
  fieldLabel: { color: colors.ink, fontWeight: '800', fontSize: 12, marginTop: 12, marginBottom: 6 },
  fieldHint: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  /**
   * Aviso da casa: "Same house: Ollie goes to the same driver." Fundo suave (sage) para o gestor ver
   * ANTES de salvar que dois cães se movem juntos — pedido do dono, 29/09/2026.
   */
  houseHint: { color: colors.forest900, backgroundColor: colors.sage, borderRadius: 10, padding: 9, fontSize: 12, marginBottom: 10 },
  driverOptions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  driverOption: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  driverOptionActive: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  driverOptionText: { color: colors.ink, fontWeight: '800', fontSize: 13 },
  driverOptionTextActive: { color: 'white' },
  segmented: { flexDirection: 'row', backgroundColor: '#EDE9DC', borderRadius: 12, padding: 4, gap: 0 },
  // M5 da auditoria (02/10/2026): segmento (Any time/window/exact) tinha ~31 pt; sobe para 44 pt.
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: 44, borderRadius: 9 },
  segmentActive: { backgroundColor: colors.forest700 },
  segmentText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  segmentTextActive: { color: 'white' },
  timeRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  timeTarget: { backgroundColor: '#F4F2EA', borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'stretch' },
  timeTargetHalf: { flex: 1, alignSelf: 'auto' },
  timeTargetActive: { borderColor: colors.gold, backgroundColor: '#F8F1E1' },
  timeTargetLabel: { color: colors.muted, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  timeTargetValue: { color: colors.ink, fontWeight: '800', fontSize: 16, marginTop: 3 },
  timeTargetPlaceholder: { color: colors.muted, fontWeight: '500' },
  error: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 10 },
  saveButton: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 16 },
  saveText: { color: colors.forest900, fontWeight: '900', fontSize: 15 },
  // M5 da auditoria (02/10/2026): "Remove from route"/"Cancel" tinham ~32 pt; sobem para 44 pt.
  removeButton: { alignItems: 'center', justifyContent: 'center', padding: 8, minHeight: 44, marginTop: 4 },
  removeText: { color: colors.urgency, fontWeight: '800', fontSize: 13 },
  sheetCancel: { alignItems: 'center', justifyContent: 'center', padding: 8, minHeight: 44, marginTop: 2 },
  sheetCancelText: { color: colors.muted, fontWeight: '800' },
  /*
   * HIERARQUIA DE AÇÕES (item 8). `Optimize route` é o PRIMÁRIO (verde cheio); `Suggest` é o
   * secundário (contorno); o `•••` é o terciário (discreto). Unpublish/Cancel nunca com o peso do
   * primário — eles vivem no overflow, e o destrutivo é vermelho `urgency` por último.
   */
  primaryButton: { backgroundColor: colors.forest700, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  primaryText: { color: 'white', fontWeight: '900', fontSize: 12 },
  secondaryButton: { borderWidth: 1, borderColor: colors.forest500, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  secondaryText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  overflowButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 10, minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  overflowText: { color: colors.forest700, fontWeight: '900', fontSize: 16, lineHeight: 18 },
  /** Linhas do menu de overflow. */
  menuItem: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  menuItemText: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  menuDanger: { borderTopColor: colors.urgency },
  menuDangerText: { color: colors.urgency, fontWeight: '900' },
  /** ESTADO VAZIO do motorista sem paradas (item 13). */
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 6, marginTop: 2, marginBottom: 4 },
  emptyCta: { backgroundColor: colors.forest700, borderRadius: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  emptyCtaText: { color: 'white', fontWeight: '900', fontSize: 12 },
  emptyAdd: { borderWidth: 1, borderColor: colors.forest500, backgroundColor: 'white', borderRadius: 10, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  emptyAddText: { color: colors.forest700, fontWeight: '800', fontSize: 12 },
  /** LINHA DE PARADA (item 10): número · nome · hora · deslocamento numa linha, separador sutil. */
  stopLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  stopTravel: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
