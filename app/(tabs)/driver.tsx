import { agruparEmTarefas, posicoesDasParadas } from '@/features/driver/tasks';
import { RouteSummary } from '@/features/driver/RouteSummary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type AlertButton } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { todayLocalISO } from '@/features/calendar/dates';
import { DriverRouteView, type DriverAction, type DriverStartPoint, type DriverStop } from '@/features/driver/DriverRouteView';
import { resolveDriverOptimizationOrigin } from '@/features/driver/driverRouteLocation';
import { clockInGate, distanceText, estaNaVan, loadOrganizationLocations, loadRouteEndLocationForDriver, loadVanLocationForDriver, motivoDoClockIn, travaDoClockIn, vanLocationForRoute, type OrganizationLocation } from '@/features/organization/locations';
import { ETA_MAXIMO_PLAUSIVEL_MIN, lateMinutesForStop, minutosAteParada, minutesToStop, nextStopEta, type EtaResult } from '@/features/driver/eta';
import { etaMessageText, etaNoticeError, messengerLink, phaseForStop } from '@/features/driver/etaMessage';

import { NextStopCard, nextActionForStatus } from '@/features/driver/NextStopCard';
import { buscaTerminou, entregaTerminou, fechamentoDaRota } from '@/features/driver/routeClosing';
import { mudarFila, chaveDoPendente, enqueuePending, flushPendingWrites, semPendentesSaidos, RefusedWriteError, abrirFilaDoUsuario, type PendingShift, type PendingWrite } from '@/features/driver/pendingWrites';
import { carregarFase, carregouABusca, gravarBuscaIniciada, gravarFase } from '@/features/driver/dayPhaseStore';
import { ordenarPelaFase, paradaDaFaseConcluida, podeIniciarDropoff, faseEfetiva, etapaDoDia, type DayPhase, type EtapaDoDia } from '@/features/driver/dayPhase';
import { planClockOut } from '@/features/driver/clockOutPlan';
import { pickDriverDisplayName, resolveDriverOrganizationId } from '@/features/driver/driverOrganization';
import { ShiftCard } from '@/features/driver/ShiftCard';
import { usePendingSyncRetry } from '@/features/driver/usePendingSyncRetry';
import { shiftErrorMessage, shiftState, type ManualShift } from '@/features/driver/shift';
import {
  createClosedShift,
  endManualShift,
  loadDriverShifts,
  markEtaNotice,
  startManualShift,
} from '@/features/driver/shiftService';
import { getCurrentDriverLocation, startLocationSharing, type LocationHandle, type LocationUpdate } from '@/features/driver/locationService';
import {
  applyPendingEvents,
  clearRouteSnapshot,
  enqueueEvent,
  isNetworkError,
  loadOutbox,
  loadRouteSnapshot,
  mudarOutbox,
  passosDoEvento,
  semRegistrosSaidos,
  saveRouteSnapshot,
  abrirOutboxDoUsuario,
  type DriverEventStatus,
  type DriverEvent,
} from '@/features/driver/offlineStore';
import { colors, radii } from '@/features/theme/tokens';
import { showAlert } from '@/features/ui/alert';
import { escolherMotivoDoProblema } from '@/features/driver/problemReason';
import { NavigationSheet } from '@/features/maps/NavigationSheet';
import type { NavTarget } from '@/features/maps/links';
import { navigationUrlFor, type NavApp } from '@/features/maps/navigation';
import { loadPreferredNavApp, savePreferredNavApp } from '@/features/maps/preferences';
import { rowToStop, type DriverRouteRow, type DriverStopRow } from '@/features/driver/rows';
import { DriveSwitchRow } from '@/features/auth/DriveSwitchRow';
import { useRoleGuard } from '@/features/auth/useRoleGuard';
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
 * Coordenadas das paradas do dia, na ordem da busca — é o que decide QUAL van vale quando a rota não
 * aponta uma e a organização tem mais de uma van (pergunta do dono, 01/10/2026). Puro e tolerante:
 * parada sem coordenada simplesmente não conta.
 */
function paradasDaLinha(
  linhas?: Array<{
    sequence?: number | null;
    dog?: { client?: { latitude?: number | null; longitude?: number | null } | null } | null;
  }> | null,
): Array<{ latitude: number | null; longitude: number | null }> {
  return (linhas ?? [])
    .slice()
    .sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0))
    .map((linha) => ({
      latitude: linha?.dog?.client?.latitude ?? null,
      longitude: linha?.dog?.client?.longitude ?? null,
    }));
}

export default function DriverTodayScreen() {
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [navTarget, setNavTarget] = useState<{ stopId: string; target: NavTarget } | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): `getUser` sem erro devolvia sessão ausente, a consulta rodava
   * com `driver_id = ''`, voltava vazia e a tela DIZIA "No published route today". Não é dia vazio —
   * é login perdido. Estado próprio para a tela não mentir ao motorista.
   */
  const [sessaoExpirada, setSessaoExpirada] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  /** Puxar para atualizar (o indicador do RefreshControl). */
  const [atualizando, setAtualizando] = useState(false);
  /** As paradas da tela (para nomear o cão na mensagem da fila). */
  const stopsRef = useRef<DriverStop[]>([]);
  // Mantém a ref alinhada com a tela (a fila offline roda fora do render e precisa do nome do cão).
  useEffect(() => { stopsRef.current = stops; }, [stops]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeVersion, setRouteVersion] = useState<number | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  /**
   * A PERNA do dia (pick-up × drop-off) — cliente, 02/10/2026: *"tem que ter uma mudança clara de
   * rota... ele não tem que fazer essa mudança automática"*. Fica gravada no aparelho pela rota de busca (e por
   * usuário, a mesma regra de dono das filas) e só o MOTORISTA vira — com um botão (decisão do dono).
   */
  const [dropoffStops, setDropoffStops] = useState<DriverStop[] | null>(null);
  const [fase, setFase] = useState<DayPhase>('pickup');
  // View preference only: never overwrites the yard's persisted day phase.
  const pernaVisivel = useRef<DayPhase | null>(null);
  /**
   * A LISTA DE CÃES já foi REVELADA? (dono, 03/10/2026 — *"quero que tudo siga pelas etapas: os cachorros do
   * pick up só apareçam depois de dar clock in e apertar pick up"*). Antes de apertar, a tela mostra SÓ o
   * cartão da jornada; o botão que revela ("Start pick-ups") só existe com a jornada ABERTA — então o
   * "depois do clock in" já vem dele. Gravada no aparelho pela rota de busca × usuário.
   */
  const [buscaIniciada, setBuscaIniciada] = useState(false);
  const buscaIniciadaRef = useRef(false);
  /**
   * A ENTREGA foi liberada NESTA sessão? (dono, 04/10/2026 — *"os cachorros do drop off aparecem antes de
   * apertar no botão que chegou no yard"*).
   *
   * A FASE gravada é do DIA (serve para o app reabrir no meio da operação) — mas ela não pode ABRIR a perna de
   * entrega sozinha: quem abre é o toque do motorista no botão do yard (`iniciarEntregas`). Numa carga nova
   * (abrir o app, trocar de conta, começar outra jornada) a tela volta para a BUSCA, e o botão do yard está
   * lá esperando — é a sequência do dia que o dono definiu.
   */
  const [entregasLiberadas, setEntregasLiberadas] = useState(false);
  const entregasLiberadasRef = useRef(false);
  const entregasPorDia = useRef(new Set<string>());
  // A busca ancora as duas pernas, mantendo inclusive a fase gravada por versões anteriores.
  const faseDoDia = useRef<{ key: string; userId: string; fase: DayPhase } | null>(null);
  /**
   * GERAÇÃO DA ESCRITA DO MOTORISTA (dono, 03/10/2026 — *"o sistema trava e dá roll Back sendo necessário
   * apertar duas vezes"*).
   *
   * Cada toque dele que GRAVA incrementa este contador. Uma carga que começou ANTES do toque traz a
   * resposta VELHA do banco; aplicá-la apaga o que ele acabou de fazer — é o "roll back" (a parada volta
   * a `pending`, a jornada volta a "Clock in") que o obrigava a tocar de novo. Com a geração, a carga
   * sabe que o estado da TELA é mais novo que a resposta e a descarta.
   */
  const geracaoDaEscrita = useRef(0);
  // Uma única ordem de envio para botões e replay: um arrived antigo não pode
  // terminar DEPOIS do Next e sobrescrever completed no servidor.
  const vezDaEscrita = useRef<Promise<unknown>>(Promise.resolve());
  const escritasPendentes = useRef(0);
  const serializarEscrita = useCallback(<T,>(operacao: () => Promise<T>): Promise<T> => {
    const proxima = vezDaEscrita.current.then(operacao);
    vezDaEscrita.current = proxima.catch(() => undefined);
    return proxima;
  }, []);
  const escrever = async (operacao: () => Promise<void>) => {
    // Reserva antes de qualquer await, inclusive GPS, diálogo ou espera da fila.
    const verificarConta = cargaEmAndamento.current !== null || escritasPendentes.current > 0;
    geracaoDaEscrita.current += 1;
    escritasPendentes.current += 1;
    const dono = envioRef.current.driverId;
    try {
      await serializarEscrita(async () => {
        if (verificarConta) {
          try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (user && dono && user.id !== dono) { void load(true); return; }
            if (!user && !isNetworkError(error)) { setSessaoExpirada(true); return; }
          } catch (reason) {
            if (!isNetworkError(reason)) { setSessaoExpirada(true); return; }
            // A escrita offline ainda precisa chegar à fila do dono conhecido.
          }
        }
        await operacao();
      });
    } finally {
      escritasPendentes.current -= 1;
      geracaoDaEscrita.current += 1;
    }
  };
  const [position, setPosition] = useState<LocationUpdate | null>(null);
  /**
   * Preenchido quando a trava da van RECUSOU o clock in por distância: é o que faz o cartão oferecer
   * o registro como exceção (relato do cliente de 01/10/2026 — dia sem jornada porque o toque foi
   * recusado e não havia saída nenhuma).
   */
  const [foraDaVan, setForaDaVan] = useState<{ distanceKm: number; vanName: string } | null>(null);
  const [eta, setEta] = useState<EtaResult | null>(null);
  /**
   * FOTO DE COMPROVANTE — REMOVIDA do app do motorista (pedido do dono, 26/09/2026).
   *
   * "pelas imagens vi que ainda não removeu a necessidade de tirar fotos quando pegar e deixar os
   * cachorros" → ele escolheu a opção mais direta: **um toque marca o passo, sem foto e sem
   * pergunta**. A operação do cliente já havia dito que a foto era "um over" porque "a gente não
   * tem tempo de tirar foto do cachorro" (áudio de 25/09/2026) — na época eu só desliguei a
   * obrigatoriedade por configuração (`proof_*_required = false`), o que ainda deixava a pergunta
   * "Attach a proof photo?" em cada coleta/entrega.
   *
   * O que continua no lugar: as COLUNAS do banco (`*_proof_path`/`*_proof_at`) e as fotos já
   * enviadas — histórico é histórico, o gestor continua vendo o que foi enviado antes. O que saiu
   * foi o passo de foto no fluxo do motorista (o módulo `features/driver/proofCapture.ts` fica
   * parado, com os testes dele, para o dia em que a creche quiser a foto de volta).
   */
  /**
   * SEDE/VAN da organização (migration 034) — pedido da operação em áudio (25/09/2026):
   * "só quando eu chegar na van que eu sou apto a dar o clock in (...) no raio lá".
   *
   * `null` = a organização NÃO cadastrou sede: o clock in continua liberado de qualquer lugar,
   * exatamente como sempre foi. A trava existe SÓ quando este valor tem algo (opt-in).
   */
  const [vanLocation, setVanLocation] = useState<OrganizationLocation | null>(null);
  /** Onde a rota FECHA (o yard) — pedido do cliente, 02/10/2026. */
  const [yardLocation, setYardLocation] = useState<OrganizationLocation | null>(null);
  /**
   * A VAN em que o DIA TERMINA (o fim do drop-off). Resolvida de forma DETERMINÍSTICA — escolha do
   * gestor na rota (`end_location_id`) ou a van PADRÃO — e não pelo "chute" da van mais próxima das
   * paradas. Cliente, 02/10/2026: *"o drop off não está terminando no lugar da van"* (a org tem DUAS
   * vans com o mesmo endereço e coordenadas diferentes, então o chute apontava para a van errada).
   */
  const [vanDeFechamento, setVanDeFechamento] = useState<OrganizationLocation | null>(null);
  /** Chegada à van observada (a jornada deduzida passa a começar aqui, e não no primeiro cão). */
  const [vanArrivalAt, setVanArrivalAt] = useState<string | null>(null);
  const vanArrivalRef = useRef<string | null>(null);
  /** Jornadas manuais de hoje (a deduzida sai dos eventos da rota). */
  const [shifts, setShifts] = useState<ManualShift[]>([]);
  /** Escritas que ficaram na fila local (jornada manual / registro de aviso de ETA). */
  const [pendingWrites, setPendingWrites] = useState<PendingWrite[]>([]);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState<string | null>(null);
  /**
   * Aviso ao tutor: a parada escolhida + o TEXTO já montado no toque (a faixa de horário fica
   * congelada enquanto o motorista decide). Só existe quando há MAIS de um mensageiro: com um só o
   * app abre o mensageiro direto, sem folha de escolha.
   */
  const [driverId, setDriverId] = useState<string | null>(null);
  /** Nome do motorista que assina o aviso ao tutor ("This is {MOTORISTA} from Pack & Paws Club"). */
  const [driverName, setDriverName] = useState<string | null>(null);
  const locationHandle = useRef<LocationHandle | null>(null);
  const realtimeRefresh = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): `load()` era chamado por QUATRO gatilhos ao mesmo tempo (foco
   * da aba, intervalo de 30 s, tempo real com debounce e puxar-para-atualizar) SEM guarda de execução
   * em curso. Cada carga dispara ≥6 requisições + o RPC de limpeza; duas intercaladas também trocavam
   * estado fora de ordem. Esta ref guarda a carga em andamento: a segunda chamada ESPERA a primeira
   * (mesma promessa) em vez de disparar outra tempestade.
   */
  const cargaEmAndamento = useRef<Promise<void> | null>(null);
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

  /**
   * Nome do motorista para assinar o aviso ao tutor. Best-effort, uma vez só.
   *
   * 🪤 DEFEITO DO DONO (áudio, 02/10/2026): a mensagem saía assinada com o nome ANTIGO ("Rafael"/"JP
   * Bueno") MESMO depois de o motorista trocar o nome no app. A causa era a ORDEM: os metadados da
   * conta (`user_metadata.full_name`, gravados no convite e nunca atualizados pelo app) vinham PRIMEIRO
   * e `return` cedo; o `profiles.full_name` — a fonte que a tela Profile edita — só era lido quando os
   * metadados faltavam. Agora é o contrário: perfil do usuário logado PRIMEIRO, o vínculo ativo da
   * organização como alternativa e os metadados por ÚLTIMO (`pickDriverDisplayName`). Sem nome nenhum a
   * mensagem degrada para "This is your driver from Pack & Paws Club" — melhor do que repetir um nome
   * errado para o tutor. Nada aqui pode travar o motorista.
   */
  useEffect(() => {
    let ativo = true;
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const uid = user?.id;
        if (!uid) return;
        // 1) Fonte canônica: o perfil do MOTORISTA LOGADO (é o que a tela Profile deixa ele editar).
        const { data: perfil } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
        const doPerfil = (perfil as { full_name?: unknown } | null)?.full_name;
        // 2) Alternativa: o perfil do vínculo ATIVO do auth.uid() (mesma pessoa, outro caminho de leitura).
        let doVinculo: unknown = null;
        if (typeof doPerfil !== 'string' || doPerfil.trim().length === 0) {
          const { data: vinculo } = await supabase
            .from('organization_members')
            .select('profile:profiles(full_name)')
            .eq('user_id', uid)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();
          doVinculo = (vinculo as { profile?: { full_name?: unknown } | null } | null)?.profile?.full_name ?? null;
        }
        // 3) Último recurso: os metadados da conta (nome do convite — NÃO pode vencer o perfil atual).
        const dosMetadados = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null;
        const nome = pickDriverDisplayName(
          typeof doPerfil === 'string' ? doPerfil : null,
          typeof doVinculo === 'string' ? doVinculo : null,
          dosMetadados,
        );
        if (ativo) setDriverName(nome);
      } catch {
        // Sem o nome, a mensagem sai igual: o motorista não pode ficar sem avisar o tutor por isso.
      }
    })();
    return () => { ativo = false; };
  }, []);

  // A confirmação precisa sobreviver à remoção da fila, inclusive se a próxima
  // leitura da rota cair por rede. Nunca grava eventos recusados neste retrato.
  const confirmarNoCache = useCallback(async (eventos: Array<{ stopId: string; status?: DriverStop['status']; deliveredAt?: string | null }>) => {
    if (!eventos.length) return;
    const snapshot = await loadRouteSnapshot();
    if (!snapshot) return;
    const aplicar = (paradas: DriverStop[]) => {
      for (const evento of eventos) paradas = paradas.map(parada => parada.id !== evento.stopId ? parada : {
        ...parada, status: evento.status ?? parada.status, deliveredAt: evento.deliveredAt ?? parada.deliveredAt,
      });
      return paradas;
    };
    await saveRouteSnapshot({ ...snapshot, stops: aplicar(snapshot.stops),
      routes: snapshot.routes?.map(rota => ({ ...rota, route_stops: (rota.route_stops ?? []).map(stop => {
        const confirmado = aplicar([rowToStop(stop)])[0];
        return { ...stop, status: confirmado.status, delivered_at: confirmado.deliveredAt ?? null };
      }) })),
    });
  }, []);

  const enviarOutbox = useCallback(async (confirmar: (event: DriverEvent) => void = () => undefined): Promise<boolean> => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (user ? user.id !== envioRef.current.driverId : !isNetworkError(authError)) return false;
    // Escritas da jornada/aviso que ficaram na fila local (sem sinal) sobem antes do resto: são
    // registros do dia de trabalho e não podem ficar esquecidos no aparelho.
    // Retrato da fila local (leitura serializada) — a trava NÃO fica presa durante a rede.
    const filaLocal = await mudarFila((fila) => fila);
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
        // Já existe jornada aberta no servidor = o registro da fila é o mesmo: nada a fazer. É uma
        // RECUSA DEFINITIVA (repetir nunca muda) — só por isso a entrada pode sair da fila; ver o
        // 🪤 em `flushPendingWrites` (a vistoria de 02/10/2026 achou a fila sendo apagada em silêncio).
        if (aberta.mode === 'already-open') throw new RefusedWriteError('driver_shifts_uma_aberta');
      });
      // Remove da fila VIVA só o que realmente saiu (subiu ou foi recusado), casando chave +
      // `queuedAt` do retrato. O que foi enfileirado DURANTE o envio fica — nada de gravar
      // "remaining" por cima da fila viva (era o defeito que sumia com o passo recém-salvo).
      await mudarFila((fila) => semPendentesSaidos(fila, filaLocal, resultado.remaining));
      // A carga publica a fila junto das jornadas lidas após o envio; retirar
      // a jornada local antes disso faria o cartão fechar por um instante.
      /**
       * 🪤 ACHADO DA VISTORIA (02/10/2026): o `dropped` era IGNORADO — o registro sumia da fila sem
       * nenhuma mensagem. Agora o motorista é avisado de que o escritório recusou aquele registro.
       */
      if (resultado.dropped > 0) {
        setMessage(
          `Could not save ${resultado.dropped === 1 ? 'a journey record' : `${resultado.dropped} journey records`} — the office did not accept ${resultado.dropped === 1 ? 'this one' : 'these'} (it may already be open there), so ${resultado.dropped === 1 ? 'it was' : 'they were'} removed from the queue. Tell the office.`,
        );
      }
    }

    // Retrato do outbox (leitura serializada): a trava NÃO fica presa durante a rede.
    const events = await mudarOutbox((fila) => fila);
    if (events.length === 0) {
      setPendingSync(0);
      return true;
    }
    const remaining: typeof events = [];
    /** Passos que o SERVIDOR recusou (nome do cão + passo) — vão para a tela, não para o lixo. */
    const recusados: string[] = [];
    const confirmados: DriverEvent[] = [];
    for (let indice = 0; indice < events.length; indice += 1) {
      const event = events[indice];
      /*
       * A fila local guarda os PASSOS ainda não gravados (o passo da foto saiu do app do motorista
       * em 26/09/2026 — ver o comentário em `vanLocation`). O 2º toque do fluxo curto
       * ("Next" = peguei + concluí) tem DOIS passos: eles sobem em ordem, um `update` cada, para o
       * trigger do banco carimbar `picked_up_at` e `completed_at` — a auditoria não perde o marco
       * do meio. Fila antiga (sem `steps`) grava só o `status`, como sempre.
       */
      let parouPorRede = false;
      const passosDoDia = passosDoEvento(event);
      for (const [indicePasso, passo] of passosDoDia.entries()) {
        // A ENTREGA confirmada sem rede sobe junto do ÚLTIMO passo do evento (o `delivered_at` entra
        // na mesma escrita, com o carimbo do servidor).
        const atualizacao: Record<string, unknown> = { status: passo };
        if (event.deliveredAt && indicePasso === passosDoDia.length - 1) atualizacao.delivered_at = event.deliveredAt;
        const { data: gravado, error } = await supabase
          .from('route_stops')
          .update(atualizacao)
          .eq('id', event.stopId)
          .select('id');
        // 🪤 ACHADO DA VISTORIA (02/10/2026): o evento recusado pelo SERVIDOR era DESCARTADO em silêncio
        // (saía da fila e nenhuma mensagem aparecia) — o motorista achava que tinha registrado e o
        // escritório nunca recebia. Agora ele é nomeado na tela.
        const recusado = Boolean(error) ? !isNetworkError(error!.message) : (!gravado || gravado.length === 0);
        if (error || !gravado || gravado.length === 0) {
          if (error && isNetworkError(error.message)) {
            remaining.push(event, ...events.slice(indice + 1));
            parouPorRede = true;
          } else if (recusado) {
            const parada = stopsRef.current.find((item) => item.id === event.stopId);
            recusados.push(parada ? `${parada.dogName} · ${passo}` : passo);
          }
          break;
        }
        const confirmado = { ...event, status: passo, deliveredAt: atualizacao.delivered_at as string | undefined };
        confirmados.push(confirmado);
        confirmar(confirmado);
      }
      if (parouPorRede) break;
    }
    // Remove do outbox VIVO só os passos que realmente saíram (subiram ou foram recusados),
    // casando parada + `createdAt` do retrato. O passo enfileirado DURANTE o envio fica — era o
    // `saveOutbox(remaining)` gravando por cima que APAGAVA o toque recém-enfileirado.
    await confirmarNoCache(confirmados);
    const outboxAtual = await mudarOutbox((fila) => semRegistrosSaidos(fila, events, remaining));
    setPendingSync(outboxAtual.length);
    if (recusados.length > 0) {
      setMessage(`Could not save ${recusados.join(', ')} — the office did not accept ${recusados.length === 1 ? 'this step' : 'these steps'}, so ${recusados.length === 1 ? 'it was' : 'they were'} removed from the queue. Tell the office.`);
    }
    return outboxAtual.length === 0;
  }, [confirmarNoCache]);

  const syncOutbox = useCallback((confirmar?: (event: DriverEvent) => void) =>
    serializarEscrita(() => enviarOutbox(confirmar)), [serializarEscrita, enviarOutbox]);

  /**
   * Carrega a rota do dia.
   *
   * `silencioso` = recarga SEM a tela de "carregando": usada depois de uma escrita do PRÓPRIO motorista
   * (os toques de I arrived / Next / Delivered, que já apareceram na hora na tela) e nas mudanças que
   * chegam por tempo real. Queixa do dono (01/10/2026): *"toda vez que eu apertava next, ou arrive a tela
   * inteira carregava, o que deixa o aplicativo lento e pesado"* — cada toque refazia TUDO (rota, van,
   * jornada e fila) com o spinner por cima, e ainda levava uma segunda recarga do evento de tempo real
   * da própria escrita. Silencioso mantém a lista na tela e reconcilia por baixo.
   */
  const load = useCallback(async (silencioso = false): Promise<void> => {
    if (cargaEmAndamento.current) return cargaEmAndamento.current;
    const execucao = (async () => {
      if (!silencioso) { setLoading(true); setMessage(null); }
      try {
        // Uma carga invalidada é refeita pela MESMA promessa. Chamadas concorrentes
        // continuam coalescidas e o refresh espera a reconciliação, não a leitura velha.
        for (;;) {
          await vezDaEscrita.current;
          if (escritasPendentes.current > 0) continue;
          const geracao = geracaoDaEscrita.current;
          const valida = () => geracao === geracaoDaEscrita.current && escritasPendentes.current === 0;
          let usuarioId = envioRef.current.driverId;
          let semRede = false;
          try {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error || !user) {
              if (error && isNetworkError(error)) throw error;
              setSessaoExpirada(true);
              return;
            }
            if (!valida()) continue;
            usuarioId = user.id;
            await abrirFilaDoUsuario(usuarioId);
            await abrirOutboxDoUsuario(usuarioId);
          } catch (reason) {
            if (!isNetworkError(reason)) throw reason;
            semRede = true;
          }
          if (!valida()) continue;
          // Sem identidade conhecida não se lê/submete cache de outra conta.
          if (!usuarioId) { setOffline(true); return; }
          const mudouUsuario = envioRef.current.driverId !== usuarioId;
          if (mudouUsuario) {
            setStops([]); setShifts([]); setPendingWrites([]); setRouteId(null);
            setDropoffStops(null); setFase('pickup'); setBuscaIniciada(false);
            setVanLocation(null); setYardLocation(null); setVanDeFechamento(null);
          }
          let snapshot = await loadRouteSnapshot();
          let rotas: RouteResult[] | null = null;
          let online = false;
      const campos = 'id, organization_id, lock_version, published_at, start_location_id, end_location_id, route_stops(id, sequence, dropoff_sequence, status, stop_group_id, window_start, window_end, exact_time, priority, pickup_proof_path, dropoff_proof_path, arrived_at, picked_up_at, completed_at, skipped_at, delivered_at, travel_seconds, dropoff_travel_seconds, status_updated_at, eta_notice_at, eta_notice_kind, handed_from_name, handed_at, dog:dogs(id, name, behavior_notes, medical_notes, photo_url, client:clients(name, phone, address_line_1, city, latitude, longitude, client_instructions(pickup_access_instructions))))';
          try {
            const consultar = (comFase: boolean) => supabase.from('routes')
              .select(comFase ? `phase, ${campos}` : campos)
              .eq('driver_id', usuarioId).eq('route_date', todayLocalISO())
              .eq('status', 'published').order('published_at', { ascending: false });
            let resultado = await consultar(true);
            if (resultado.error && ['42703', 'PGRST204'].includes(resultado.error.code) && /phase/.test(resultado.error.message)) resultado = await consultar(false);
            if (resultado.error) throw resultado.error;
            rotas = (resultado.data as unknown as RouteResult[] | null) ?? [];
            online = true;
            semRede = false;
          } catch (reason) {
            if (!isNetworkError(reason)) throw reason;
            semRede = true;
            if (snapshot?.routes && snapshot.routeDate !== todayLocalISO()) snapshot = null;
            rotas = snapshot?.routes ?? null;
          }
          if (!valida()) continue;
          const pickup = rotas?.find(r => (r.phase ?? 'pickup') === 'pickup');
          const dropoff = rotas?.find(r => r.phase === 'dropoff');
          const key = pickup?.id ?? `day:${todayLocalISO()}`;
          let dia = faseDoDia.current;
          let busca = buscaIniciadaRef.current;
          if (dia?.key !== key || dia?.userId !== usuarioId) {
            pernaVisivel.current = null;
            const guardada = await carregarFase(key, usuarioId);
            const atual = faseEfetiva(guardada, pickup?.route_stops ?? []);
            if (atual !== guardada) await gravarFase(key, usuarioId, atual);
            dia = { key, userId: usuarioId, fase: atual };
            busca = await carregouABusca(key, usuarioId);
          }
          const fasePreferida = pernaVisivel.current ?? dia.fase;
          const daTela: DayPhase = fasePreferida === 'dropoff' && Boolean(pickup) && !entregasPorDia.current.has(`${usuarioId}:${key}`)
            && !entregaTerminou(((dropoff ?? pickup)?.route_stops ?? []).map(rowToStop)) ? 'pickup' : fasePreferida;
          const route = daTela === 'dropoff' ? dropoff ?? pickup : pickup;
          const org = route?.organization_id ?? (online ? await resolveDriverOrganizationId(supabase, usuarioId) : null);
          let locais = snapshot?.locations ?? [];
          let van: OrganizationLocation | null = null;
          let yard: OrganizationLocation | null = null;
          if (online && route) {
            van = await loadVanLocationForDriver(supabase, { organizationId: route.organization_id, startLocationId: route.start_location_id ?? null, paradas: paradasDaLinha(route.route_stops) });
            locais = await loadOrganizationLocations(supabase, route.organization_id);
            yard = await loadRouteEndLocationForDriver(supabase, { organizationId: route.organization_id, endLocationId: route.end_location_id ?? null });
          } else if (route) {
            van = vanLocationForRoute(locais, route.start_location_id);
            yard = locais.find(l => l.id === route.end_location_id) ?? locais.find(l => l.kind === 'yard') ?? null;
          }
          if (!valida()) continue;
          envioRef.current = { organizationId: org, driverId: usuarioId, routeId: route?.id ?? null };
          // A resposta da rota é anterior ao sync. Reconciliamos somente os passos
          // CONFIRMADOS, mais a fila restante; uma recusa nunca vira confirmação.
          const confirmados: DriverEvent[] = [];
          const synced = await syncOutbox(event => confirmados.push(event));
          let jornadas: ManualShift[] | null = null;
          try { jornadas = await loadDriverShifts(supabase, { driverId: usuarioId, dayStart: startOfToday(), dayEnd: startOfTomorrow() }); } catch { /* Mantém a jornada local sem rede. */ }
          const fila = await mudarFila(f => f);
          const events = await loadOutbox();
          if (!valida()) continue;
          const reconciliar = (paradas: DriverStop[]) => {
            // Pode haver vários passos confirmados para a mesma parada, em ordem.
            for (const event of confirmados) paradas = applyPendingEvents(paradas, [event]);
            return paradas;
          };
          if (rotas) {
            rotas = rotas.map(r => ({ ...r, route_stops: (r.route_stops ?? []).map(stop => {
              const confirmado = reconciliar([rowToStop(stop)])[0];
              return { ...stop, status: confirmado.status, delivered_at: confirmado.deliveredAt ?? null };
            }) }));
          }
          const base = route ? (route.route_stops ?? []).map(rowToStop) : online ? [] : snapshot?.stops ?? [];
          const confirmadas = reconciliar(base);
          await serializarEscrita(async () => {
            if (!valida()) return;
            if (online && !route) {
              await clearRouteSnapshot();
            } else if (route || snapshot) {
              await saveRouteSnapshot({ savedAt: new Date().toISOString(), publishedAt: route?.published_at ?? snapshot?.publishedAt ?? null,
                stops: confirmadas, routes: rotas ?? undefined, locations: locais, routeDate: todayLocalISO() });
            }
          });
          const identidade = await supabase.auth.getUser();
          if (identidade.data.user && identidade.data.user.id !== usuarioId) continue;
          if (!valida()) continue;
          // Publicação sem await: fase, rota, paradas e jornada pertencem ao mesmo
          // retrato. Nenhuma consulta lenta publica metade de uma tela antiga.
          faseDoDia.current = dia;
          buscaIniciadaRef.current = busca;
          const liberadas = entregasPorDia.current.has(`${usuarioId}:${key}`);
          entregasLiberadasRef.current = liberadas;
          setEntregasLiberadas(liberadas);
          setBuscaIniciada(busca); setFase(daTela);
          setDriverId(usuarioId); setSessaoExpirada(false);
          setRouteId(route?.id ?? null); setRouteVersion(route?.lock_version ?? null); setOrganizationId(org);
          setVanLocation(van); setYardLocation(yard);
          setVanDeFechamento(route ? vanLocationForRoute(locais, route.end_location_id ?? null) : null);
          setDropoffStops(dropoff ? applyPendingEvents(reconciliar((dropoff.route_stops ?? []).map(rowToStop)), events) : null);
          if (jornadas) setShifts(jornadas);
          setPendingWrites(fila); setPendingSync(events.length);
          setPublishedAt(route?.published_at ?? (online ? null : snapshot?.publishedAt ?? null));
          setStops(applyPendingEvents(confirmadas, events));
          setOffline(semRede || !synced);
          if (online) void supabase.rpc('cleanup_driver_locations');
          return;
        }
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : 'Unable to load your route.');
      } finally {
        setLoading(false);
        cargaEmAndamento.current = null;
      }
    })();
    cargaEmAndamento.current = execucao;
    return execucao;
  }, [syncOutbox, serializarEscrita]);

  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): a fila de escritas offline só subia no foco da aba, no tempo real
   * (que precisa de sinal) ou depois de outra escrita — o motorista com sinal intermitente ficava com os
   * passos PRESOS no aparelho até sair da tela e voltar.
   *
   * CUSTO MEDIDO E ECONOMIZADO (auditoria de desempenho, 02/10/2026): o timer era de 30 s rodando
   * também com o app em SEGUNDO PLANO — num dia de ~8 h com o celular no bolso eram ~960 requisições
   * (cada uma refaz rota, van, jornada e fila) sem motivo. Agora a retomada só acontece com pendência
   * REAL e app ABERTO, e ao voltar ao foco tenta na hora (`usePendingSyncRetry`).
   */
  const retomarFilaPendente = useCallback(() => {
    void load(true);
  }, [load]);

  usePendingSyncRetry(pendingSync, retomarFilaPendente);

  /** Puxar para atualizar: recarrega por baixo e sobe a fila de escritas pendentes. */
  const puxarParaAtualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      await load(true);
    } finally {
      setAtualizando(false);
    }
  }, [load]);

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
      // Silencioso: é a escrita do próprio motorista chegando de volta pelo banco (não pode piscar).
      realtimeRefresh.current = setTimeout(() => void load(true), 800);
    };
    /*
     * 🪤 ACHADO DA VISTORIA (02/10/2026): o canal de `routes` era assinado SEM filtro — qualquer
     * mudança em QUALQUER rota de QUALQUER motorista/dia agendava um reload de 800 ms nesta tela.
     * Com RLS o evento pode não chegar; onde chega é recarga desnecessária (bateria/dados). Aqui o
     * canal é filtrado pela organização do motorista.
     */
    const filtroDaOrg = organizationId ? { filter: `organization_id=eq.${organizationId}` } : {};
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'routes', ...filtroDaOrg }, scheduleReload);
    if (routeId) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'route_stops', filter: `route_id=eq.${routeId}` }, scheduleReload);
    }
    channel.subscribe();
    return () => {
      if (realtimeRefresh.current) clearTimeout(realtimeRefresh.current);
      void supabase.removeChannel(channel);
    };
  }, [routeId, organizationId, load]);

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
        /**
         * 🪤 ACHADO DA VISTORIA (02/10/2026): esta escrita era "fire and forget" — nenhum erro era lido.
         * A policy de `driver_locations` só aceita posição de rota `published`: quando o gestor fechava a
         * rota (✓ Done), a van PARAVA de andar no mapa do escritório e ninguém era avisado (o cartão
         * seguia mostrando a última posição, que o frescor depois esconde).
         *
         * Agora o erro é lido: se o escritório parou de aceitar a posição, o app para de compartilhar e
         * DIZ isso ao motorista (em vez de continuar gravando para o vazio).
         */
        void supabase.auth.getUser().then(async ({ data: { user } }) => {
          if (!user || cancelled) return;
          const { error } = await supabase.from('driver_locations').upsert(
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
          if (!error || cancelled) return;
          if (isNetworkError(error.message)) return; // sem sinal: a próxima atualização tenta de novo
          locationHandle.current?.stop();
          locationHandle.current = null;
          setPosition(null);
          setMessage('The office is no longer following your position (the route was closed on their side).');
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

  const act = (stopId: string, action: DriverAction) => escrever(async () => {
    setMessage(null);
    /** Ação do motorista: qualquer carga que já estava em voo nasceu velha (ver `geracaoDaEscrita`). */
    geracaoDaEscrita.current += 1;
    /*
     * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5). Não é troca de status: o pick-up já
     * marcou `completed`; aqui grava-se o marco `delivered_at`, que é o que fecha a parada, devolve o
     * ETA e o botão de avisar na parte da tarde e diz ao gestor em qual entrega o dia está. O horário
     * oficial continua sendo do SERVIDOR (trigger da migração 041); o ISO do aparelho só entra na fila
     * offline como referência.
     */
    if (action === 'deliver') {
      if (fase !== 'dropoff') return;
      const entregueEm = new Date().toISOString();
      const anterior = stops.find((stop) => stop.id === stopId)?.deliveredAt ?? null;
      setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, deliveredAt: entregueEm } : stop)));
      try {
        await enviarOutbox();
        // 🪤 ACHADO DA VISTORIA (02/10/2026): escrita sem conferir linhas. Se a policy/parada recusa, o
        // PostgREST responde SUCESSO com 0 linhas — o cartão ficava "entregue" sem o banco ter gravado.
        const { data: entregue, error } = await supabase
          .from('route_stops')
          .update({ delivered_at: entregueEm })
          .eq('id', stopId)
          .select('id');
        if (error) throw new Error(`The office did not accept this delivery (${error.message}). Check your signal and try again.`);
        if (!entregue || entregue.length === 0) throw new Error('The office did not accept this delivery. Check your signal and try again.');
        await confirmarNoCache([{ stopId, deliveredAt: entregueEm }]);
        const events = await mudarOutbox((fila) => fila.filter((event) => event.stopId !== stopId));
        setPendingSync(events.length);
        if (events.length === 0) setOffline(false);
        void load(true);
      } catch (reason) {
        if (isNetworkError(reason)) {
          const events = await mudarOutbox((fila) => enqueueEvent(fila, {
            stopId,
            status: 'completed',
            deliveredAt: entregueEm,
            createdAt: entregueEm,
          }));
          setPendingSync(events.length);
          setOffline(true);
          setMessage('You are offline. This change is saved on your device and will sync automatically.');
          return;
        }
        setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, deliveredAt: anterior } : stop)));
        setMessage(reason instanceof Error ? reason.message : 'Could not save the delivery. Try again.');
      }
      return;
    }
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
    /**
     * Passos que cada ação grava, NA ORDEM. Toda ação grava pelo menos um status; o 2º toque do
     * fluxo curto ('finish', pedido do dono 30/09/2026) grava DOIS: o cão foi pego E a parada
     * concluída, no mesmo instante — cada um com o carimbo do servidor, preservando os 3 registros
     * de auditoria da parada (chegou / pegou / concluiu).
     */
    const passosDaAcao: Partial<Record<DriverAction, DriverEventStatus[]>> = {
      arrived: ['arrived'],
      picked_up: ['picked_up'],
      completed: ['completed'],
      finish: ['picked_up', 'completed'],
      problem: ['skipped'],
    };
    const passos = passosDaAcao[action];
    if (!passos || passos.length === 0) return;
    /** O estado que a tela mostra na hora: o ÚLTIMO passo da ação. */
    const status = passos[passos.length - 1];

    // PROBLEMA pergunta o motivo ANTES de gravar, para o aviso ao gestor já sair com a explicação
    // (defeito corrigido em 25/09/2026: antes o escritório só sabia que "houve um problema").
    let notaDoProblema: string | null = null;
    if (action === 'problem') {
      notaDoProblema = await escolherMotivoDoProblema();
      if (notaDoProblema === null) return; // desistiu: a parada NÃO é marcada como problema
    }

    const statusAnterior = stops.find((stop) => stop.id === stopId)?.status ?? status;
    let statusConfirmado = statusAnterior;
    setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, status } : stop)));

    /** Grava os passos no banco, NA ORDEM. Lança em QUALQUER falha (quem chama decide o que fazer). */
    const gravarPasso = async () => {
      for (const passo of passos) {
        const atualizacao: Record<string, unknown> = { status: passo };
        // O motivo do problema entra na MESMA escrita: o push do gestor (trigger 033) sai com ele.
        if (notaDoProblema) atualizacao.proof_note = notaDoProblema;
        // Mesma armadilha da entrega: 0 linhas sem erro = passo "gravado" que o banco não recebeu.
        const { data: gravado, error } = await supabase
          .from('route_stops')
          .update(atualizacao)
          .eq('id', stopId)
          .select('id');
        if (error) throw new Error(`The office did not accept this step (${error.message}). Check your signal and try again.`);
        if (!gravado || gravado.length === 0) throw new Error('The office did not accept this step. Check your signal and try again.');
        statusConfirmado = passo;
        await confirmarNoCache([{ stopId, status: passo }]);
      }
    };

    /** O cartao volta para o estado do BANCO (a escrita nao aconteceu). */
    const desfazerStatus = () =>
      setStops((current) => current.map((stop) => (stop.id === stopId ? { ...stop, status: statusConfirmado } : stop)));

    try {
      await enviarOutbox();
      await gravarPasso();
      const events = await mudarOutbox((fila) => fila.filter((event) => event.stopId !== stopId));
      setPendingSync(events.length);
      if (events.length === 0) setOffline(false);
      void load(true);
    } catch (reason) {
      // Falha de rede: a fila local existe para isso — o passo sobe sozinho quando o sinal voltar.
      // Qualquer outra falha devolve o cartão ao estado do BANCO e mostra o motivo na tela: nada de
      // marcar na tela um passo que o banco não recebeu.
      if (isNetworkError(reason)) {
        const events = await mudarOutbox((fila) => enqueueEvent(fila, {
          stopId,
          status,
          // Sem sinal, a fila guarda TODOS os passos da ação (o "Next" tem dois) para o replay
          // gravar cada um — o servidor carimba `picked_up_at` e `completed_at` ao voltar o sinal.
          steps: passos,
          createdAt: new Date().toISOString(),
        }));
        setPendingSync(events.length);
        setOffline(true);
        setMessage('You are offline. This change is saved on your device and will sync automatically.');
        return;
      }

      desfazerStatus();
      setMessage(reason instanceof Error ? reason.message : 'Could not save this step. Try again.');
    }
  });

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
  const journey = useMemo(
    () => shiftState(stops, [...shifts, ...jornadasLocais], new Date(), { vanArrivalAt }),
    [stops, shifts, jornadasLocais, vanArrivalAt],
  );

  /**
   * Chegada à VAN observada pelo GPS (migration 034).
   *
   * Com sede cadastrada, o primeiro ponto DENTRO do raio marca a partida da jornada — é o "cheguei
   * na van" do áudio, e é o que faz a jornada começar na van em vez de no primeiro cão. Quando esse
   * ponto não existe (GPS sem fix, dia começado antes desta atualização), a dedução pelos eventos
   * da rota continua valendo: ninguém fica sem jornada.
   */
  useEffect(() => {
    if (!vanLocation || !position || vanArrivalRef.current) return;
    if (estaNaVan(vanLocation, position)) {
      const agora = new Date().toISOString();
      vanArrivalRef.current = agora;
      setVanArrivalAt(agora);
    }
  }, [vanLocation, position]);

  /**
   * Onde o clock in abre — `null` quando a organização NÃO tem sede (opt-in: o cartão da jornada
   * fica exatamente como sempre foi). O texto é o mesmo em PT-BR do motivo da trava, porque é o
   * motorista da operação brasileira que lê.
   */
  const gateHint = useMemo(() => {
    if (!vanLocation) return null;
    // Endereço da van junto do nome: foi o que faltou para o cliente enxergar que a van da trava
    // estava cadastrada em outro lugar (relato de 01/10/2026 — o motorista "na van" e o app dizendo
    // 15,8 km). Com o endereço na tela, dá para conferir o cadastro em segundos.
    const endereco = [vanLocation.addressLine1, vanLocation.city].filter(Boolean).join(', ');
    const onde = endereco ? `"${vanLocation.name}" (${endereco})` : `"${vanLocation.name}"`;
    if (!position) return `Clock in opens at the van ${onde} (radius of ${vanLocation.radiusMeters} m).`;
    const trava = clockInGate({ location: vanLocation, position });
    if (trava.kind === 'inside') return `You are at the van ${onde} — clock in is open.`;
    if (trava.kind === 'outside') {
      return `Clock in opens at the van ${onde} — you are ${distanceText(trava.distanceKm ?? 0)} away (radius of ${vanLocation.radiusMeters} m).`;
    }
    return `Clock in opens at the van ${onde} (radius of ${vanLocation.radiusMeters} m).`;
  }, [vanLocation, position]);

  const recarregarJornadas = async (motorista: string) => {
    setShifts(await loadDriverShifts(supabase, { driverId: motorista, dayStart: startOfToday(), dayEnd: startOfTomorrow() }));
  };

  const guardarNaFila = async (entrada: PendingWrite) => {
    // Serializado: enfileirar nunca corre por cima de uma subida da fila em andamento.
    const fila = await mudarFila((atual) => enqueuePending(atual, entrada));
    setPendingWrites(fila);
    return fila;
  };

  /** Clock in MANUAL: exceção (esqueceu), por isso o motivo é obrigatório no banco.
   *  `excecao` = o motorista escolheu registrar mesmo FORA do raio da van (botão "Clock in anyway"). */
  const clockIn = (motivo: string, excecao = false) => escrever(async () => {
    setShiftBusy(true);
    setShiftError(null);
    /** Escrita do motorista: carga em voo nasceu velha (ver `geracaoDaEscrita`). */
    geracaoDaEscrita.current += 1;
    const startedAt = new Date().toISOString();
    // Declarado FORA do try: a fila offline do catch também grava o motivo (com a distância, quando
    // o registro é a exceção "fora da van").
    let motivoGravado = motivo;
    try {
      if (!organizationId || !driverId) throw new Error('Organization not found for this account.');

      /*
       * TRAVA DA VAN (opt-in) — pedido da operação em áudio (25/09/2026).
       *
       * Sem sede cadastrada (`vanLocation` nulo) a resposta é `allowed` na hora e o fluxo segue
       * idêntico ao de antes. Com sede: posição fresca do GPS (com o último ponto do
       * compartilhamento como reserva) e a distância em linha reta até a van.
       *
       * ⚠️ CORREÇÃO DE 01/10/2026 — A TRAVA NÃO PODE IMPEDIR O TRABALHO. O cliente relatou o
       * motorista sem conseguir dar o clock in ("mesmo chegando na van") e o dia terminou SEM
       * jornada nenhuma registrada: a recusa sumia com o registro em vez de registrar a exceção.
       * Agora o clock in manual SEMPRE grava; estando FORA do raio, a distância entra no MOTIVO
       * (`start_reason`) — o gestor continua vendo a exceção no relatório de horas e o motorista
       * não fica sem trabalhar. Dentro do raio nada muda (é o que marca a partida na van).
       */
      const posicaoAgora = await resolveDriverOptimizationOrigin(getCurrentDriverLocation, position);
      // AS DUAS LEITURAS VALEM: a fresca (Accuracy.High, do toque) e a que a TELA mostra (amostra do
      // compartilhamento, Balanced). Se qualquer uma diz "está na van", libera — antes, uma leitura
      // fresca ruim recusava o toque de quem estava lendo "você está na van" na própria tela.
      const trava = travaDoClockIn(vanLocation, posicaoAgora, position);
      /*
       * A regra da OPERAÇÃO continua de pé: o caminho NORMAL exige a van — fora do raio o registro
       * não acontece e o motivo aparece no cartão. Mas recusar não pode deixar o motorista SEM
       * jornada (foi o que aconteceu em 01/10/2026: clock in recusado, dia sem nenhum registro), então
       * o cartão passa a oferecer a saída explícita: `excecao` = registro pedido pelo motorista em
       * "Clock in anyway", que grava a DISTÂNCIA dentro do motivo — o gestor vê a exceção no
       * relatório de horas em vez de não ver jornada nenhuma.
       */
      if (!trava.allowed && !excecao) {
        setForaDaVan(
          trava.kind === 'outside'
            ? { distanceKm: trava.distanceKm ?? 0, vanName: vanLocation?.name ?? 'van' }
            : null,
        );
        setShiftError(trava.message);
        return;
      }
      setForaDaVan(null);
      if (trava.kind === 'inside') {
        // Chegou na van: é aqui que a jornada passa a começar (ver `journey` e migration 034).
        vanArrivalRef.current = startedAt;
        setVanArrivalAt(startedAt);
      }
      motivoGravado = motivoDoClockIn(motivo, trava, vanLocation?.name ?? 'van');

      const resultado = await startManualShift(supabase, { organizationId, driverId, routeId, reason: motivoGravado, startedAt });
      if (resultado.mode === 'already-open') {
        setShiftError('You already have a journey open.');
        return;
      }
      await recarregarJornadas(driverId);
      // Sem posição, o registro vale (não travamos), mas o motorista fica sabendo que não deu
      // para conferir a van. Fora do raio, o registro é a EXCEÇÃO que ele pediu.
      setMessage(
        trava.kind === 'outside'
          ? 'Journey started — recorded as an exception (outside the van).'
          : trava.kind === 'no-position'
            ? trava.message
            : 'Journey started — manual record.',
      );
    } catch (causa) {
      if (isNetworkError(causa)) {
        await guardarNaFila({ kind: 'shift', startedAt, endedAt: null, startReason: motivoGravado, endReason: null, routeId, queuedAt: startedAt });
        setMessage('No connection: the journey is saved on your phone and will sync automatically.');
      } else {
        setShiftError(shiftErrorMessage(causa));
      }
    } finally {
      setShiftBusy(false);
    }
  });

  /**
   * Clock out. Três casos: fecha a jornada manual aberta; fecha uma jornada que estava só na fila
   * local; ou fecha (à mão) a jornada que vinha sendo deduzida dos eventos da rota — o intervalo
   * gravado vai da primeira chegada até agora, e o resumo do gestor não conta duas vezes.
   *
   * 🪤 ACHADO DA VISTORIA (02/10/2026): o clock out só enxergava as jornadas do BANCO. A jornada
   * aberta SEM SINAL mora na fila local (`pendingWrites`) e era invisível aqui: o motorista dava
   * clock out, nascia uma SEGUNDA jornada fechada, e a entrada da fila — quando o sinal voltava —
   * subia como jornada ABERTA e ficava órfã para sempre (o dia nunca fechava no relatório de horas).
   * O `planClockOut` decide qual jornada fechar, olhando banco E fila.
   */
  const clockOut = (motivo: string) => escrever(async () => {
    const dia = faseDoDia.current;
    if (dia) entregasPorDia.current.delete(`${dia.userId}:${dia.key}`);
    // Jornada nova começa na BUSCA: a entrega liberada na jornada anterior não vale mais.
    setEntregasLiberadas(false);
    pernaVisivel.current = null;
    entregasLiberadasRef.current = false;
    setShiftBusy(true);
    setShiftError(null);
    /** Escrita do motorista: carga em voo nasceu velha (ver `geracaoDaEscrita`). */
    geracaoDaEscrita.current += 1;
    const agora = new Date().toISOString();
    const plano = planClockOut({
      shifts,
      queue: pendingWrites,
      journeyStartedAt: journey.startedAt,
      now: agora,
      endReason: motivo,
      routeId,
    });
    // O plano pode ter mexido na fila (fechou a jornada que só existia no aparelho): persiste já.
    if (plano.queue !== pendingWrites) {
      setPendingWrites(await mudarFila(() => plano.queue));
    }
    // A jornada abriu sem sinal e NUNCA chegou ao banco: o fechamento fica no aparelho, na MESMA
    // entrada da fila (entrada + saída numa linha só) — nada de criar uma jornada nova e órfã.
    if (plano.fechaNaFila) {
      setMessage('Journey closed.');
      void load(true);
      setShiftBusy(false);
      return;
    }
    try {
      if (!organizationId || !driverId) throw new Error('Organization not found for this account.');
      if (plano.abertaNoBanco) {
        await endManualShift(supabase, { shiftId: plano.abertaNoBanco.id, reason: motivo, endedAt: agora });
      } else {
        await createClosedShift(supabase, {
          organizationId,
          driverId,
          routeId,
          startedAt: plano.startedAt,
          endedAt: agora,
          startReason: plano.startReason,
          endReason: motivo,
        });
      }
      await recarregarJornadas(driverId);
      setMessage('Journey closed.');
    } catch (causa) {
      if (isNetworkError(causa)) {
        // Uma linha só com entrada e saída: nada de meio registro no aparelho.
        await guardarNaFila({ kind: 'shift', startedAt: plano.startedAt, endedAt: agora, startReason: plano.startReason, endReason: motivo, routeId, queuedAt: agora });
        setMessage('No connection: the journey is saved on your phone and will sync automatically.');
      } else {
        setShiftError(shiftErrorMessage(causa));
      }
    } finally {
      setShiftBusy(false);
    }
  });

  /* ------------------------------------------------------------------ *
   * AVISO DE ETA AO TUTOR — mensagem pronta no mensageiro do motorista
   * ------------------------------------------------------------------ */

  /**
   * Texto do aviso: FAIXA de ~30 min (5 antes / 25 depois) montada com a hora do TOQUE.
   * O `now` entra explícito porque a faixa é horário de relógio ("2:05 –2:35 PM").
   */
  const avisoDe = (stop: DriverStop) =>
    etaMessageText({
      clientName: stop.clientName,
      // Segundo tutor (migration 037): a mensagem vai numa conversa com os dois, então cumprimenta
      // os dois ("Good morning, Sarah and Mike!").
      secondOwnerName: stop.secondOwnerName ?? null,
      driverName,
      dogName: stop.dogName,
      phase: phaseForStop(stop.status),
      minutes: stop.etaMinutes ?? 0,
      lateMinutes: stop.lateMinutes ?? 0,
      now: new Date(),
    });

  /** Abre o mensageiro do motorista com o texto pronto e registra o aviso no histórico da parada. */
  const enviarAviso = async (stop: DriverStop, texto: string) => {
    // Os DOIS números, numa conversa só (SMS em grupo no iOS) — pedido do dono, 27/09/2026:
    // "não de forma separada, mas num grupo".
    const link = messengerLink([stop.clientPhone ?? null, stop.clientPhone2 ?? null], texto);
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
      void load(true);
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

  /**
   * Toque no "Notify owner": não há escolha a fazer — o aviso é SEMPRE SMS (o dono tirou o outro
   * mensageiro 100% do projeto, 28/09/2026). Monta o texto e vai direto para o app de mensagens.
   */
  const avisarTutor = (stop: DriverStop) => {
    void enviarAviso(stop, avisoDe(stop));
  };

  /**
   * Paradas com o ETA de cada uma (o botão de avisar mostra "~12 min" e fica âmbar se atrasar), e é
   * ESTE número que o aviso ao tutor usa (`avisoDe` lê `stop.etaMinutes`) — tela e mensagem, um número só.
   *
   * O cálculo é SEMPRE o acumulado por `minutosAteParada`: as pernas gravadas pelo Optimize
   * (`travel_seconds` na ordem da busca, `dropoff_travel_seconds` na entrega) quando existem e, quando
   * não existem, a linha reta perna a perna (da posição atual na 1ª parada da fase e da parada anterior
   * nas demais). Antes, sem as pernas, cada parada era medida da POSIÇÃO ATUAL isolada e a 3ª podia
   * aparecer antes da 2ª (defeito relatado pelo dono em 02/10/2026: 8:06 / 8:10 / 8:04).
   */
  const stopsComEta = useMemo(
    () =>
      stops.map((stop) => {
        const minutos = minutosAteParada(stops, stop.id, position);
        return { ...stop, etaMinutes: minutos, lateMinutes: minutos == null ? 0 : lateMinutesForStop(stop, minutos) };
      }),
    [stops, position],
  );

  /**
   * NEXT STOP (o herói do topo da tela) — pedido do dono em 25/09/2026: depois de otimizar a rota ele
   * não achava mais "o próximo cachorro" nem o botão de informar a chegada no meio da lista. A parada
   * vem da MESMA lista já enriquecida com ETA (stopsComEta), e a ação sai do mesmo mapa de status que os
   * botões da lista usam (features/driver/NextStopCard) — o painel só chama o `act` que já existe.
   */
  /** A lista na ORDEM DA PERNA (busca × entrega): é a que o motorista vê e a que alimenta o cartão
   *  "próxima parada" — sem isto o cartão de cima discordaria da lista depois da virada. */
  const stopsDaFase = useMemo(() => ordenarPelaFase(stopsComEta, fase), [stopsComEta, fase]);
  const proximaParada = useMemo(() =>
    stopsDaFase.find((stop) => !paradaDaFaseConcluida(stop, fase)) ?? null, [stopsDaFase, fase]);

  /**
   * ONDE A ROTA FECHA (pedido do cliente, 02/10/2026): depois da última BUSCA o dia vai para o YARD;
   * depois da última ENTREGA, volta para a VAN. Antes a rota "acabava" no último cão e o motorista não
   * sabia que ainda faltava voltar.
   */
  const fechamento = useMemo(
    () => fechamentoDaRota({
      buscaTerminou: buscaTerminou(stops),
      entregaTerminou: (fase === 'dropoff' || !dropoffStops) && entregaTerminou(stops),
      yard: yardLocation,
      van: vanDeFechamento ?? vanLocation,
    }),
    [stops, fase, dropoffStops, yardLocation, vanLocation, vanDeFechamento],
  );

  /**
   * A ETAPA do dia (dono, 03/10/2026): `pickups` → `to_yard` → `dropoffs` → `to_van`. É o que a tela usa
   * para, depois da ÚLTIMA BUSCA, apresentar o YARD como o passo atual (navegável) antes de liberar o
   * DROP-OFF — e, no fim, a volta à VAN (clock off). As paradas da BUSCA e da ENTREGA vêm das duas pernas
   * quando existem (migração 053); no dia de rota única (`dropoffStops` null) as mesmas servem às duas. A
   * `fase` já chega corrigida por `faseEfetiva` na carga.
   */
  const etapaAtual = useMemo<EtapaDoDia>(
    () => etapaDoDia({
      fase,
      paradasDaBusca: fase === 'pickup' ? stops : [],
      paradasDaEntrega: dropoffStops ?? stops,
    }),
    [fase, stops, dropoffStops],
  );

  /**
   * A VIRADA DE PERNA (busca → entrega) é um ATO DO MOTORISTA (dono, 02/10/2026) e, desde 03/10/2026, ela
   * vive DENTRO do cartão do YARD — que é a ETAPA do momento depois da última busca. O dono, verbatim:
   * *"depois de pegar todos os cachorros é pra ir pro yard, depois do yard começa o drop off"*.
   *
   * O botão dourado da JORNADA saiu de lá de propósito: a virada é UMA só, e o rótulo dela diz a ORDEM
   * (`I'm at the yard — start drop-offs`). Sem yard cadastrado o dia fecha na VAN e a virada continua
   * sendo o botão avulso, com o rótulo de sempre — a mesma regra de `fechamentoDaRota`.
   */
  const podeIniciarEntregas = !entregasLiberadas && stops.length > 0 && fase === 'pickup'
    && (dropoffStops ? buscaTerminou(stops) && !entregaTerminou(dropoffStops) : podeIniciarDropoff(stopsDaFase));
  const iniciarEntregas = () => {
    // Vira a perna e GRAVA no aparelho: o dia não volta a "busca" sozinho.
    void (async () => {
      await cargaEmAndamento.current;
      const dia = faseDoDia.current;
      if (!dia || !routeId || dia.userId !== driverId) return;
      setEntregasLiberadas(true);
      entregasLiberadasRef.current = true;
      entregasPorDia.current.add(`${dia.userId}:${dia.key}`);
      dia.fase = 'dropoff';
      pernaVisivel.current = 'dropoff';
      geracaoDaEscrita.current += 1;
      await gravarFase(dia.key, dia.userId, 'dropoff');
      /*
       * SILENCIOSO de propósito (regra do projeto, `tela-do-motorista-toque-avisos-e-eta`): escrita do
       * próprio motorista NÃO pode jogar a tela em "carregando". Era o `await load()` daqui que fazia a
       * lista sumir e voltar ("o sistema trava") a cada virada de perna.
       */
      void load(true);
    })();
  };

  const escolherPerna = (phase: DayPhase) => {
    if (phase === fase || (phase === 'dropoff' ? !entregasLiberadasRef.current : !buscaIniciadaRef.current)) return;
    pernaVisivel.current = phase;
    // Invalidate an older load; its existing reconciliation loop reads the latest choice.
    geracaoDaEscrita.current += 1;
    void load(true);
  };

  const start = useMemo<DriverStartPoint | null>(() => {
    const location = fase === 'pickup' ? vanLocation : yardLocation;
    if (!location) return null;
    return {
      kind: fase === 'pickup' ? 'van' : 'yard',
      name: location.name,
      address: [location.addressLine1, location.city].filter(Boolean).join(' · ') || null,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }, [fase, vanLocation, yardLocation]);

  // Keep the current leg's destination beside the clock controls, not below the stop list.
  const journeyDestination = fechamento ?? start;

  /**
   * ATALHO "START PICK-UPS" (pedido do dono, 03/10/2026): depois de bater o ponto na van o motorista
   * quer cair DIRETO na fila de busca — antes tinha de arrastar a tela de volta até a lista.
   *
   * É só FOCO: rola até a próxima parada e não grava NADA (nem fase, nem status de cão). Quem marca
   * cão pego continua sendo o toque da parada, e a virada da perna continua sendo o "Start drop-offs".
   * As posições vêm do `onLayout` (o corpo é o índice 0 do conteúdo rolável; a próxima parada é
   * relativa a ele), então funciona com qualquer tamanho de tela e cabeçalho de altura variável.
   */
  const scrollRef = useRef<ScrollView | null>(null);
  const corpoY = useRef(0);
  const proximaParadaY = useRef(0);
  const routeViewY = useRef(0);
  const focarBusca = useCallback(() => {
    scrollRef.current?.scrollTo({ y: corpoY.current + routeViewY.current + proximaParadaY.current, animated: true });
  }, []);
  /**
   * "START PICK-UPS" — a ETAPA do dia (dono, 03/10/2026): a lista de cães só aparece depois que o motorista
   * diz que começou. O toque REVELA a lista, GRAVA a marca no aparelho (a recarga do foco/tempo real não
   * volta a esconder) e traz o próximo cão para a tela. Não grava nada no banco: é revelação de tela.
   */
  const iniciarBusca = useCallback(() => {
    geracaoDaEscrita.current += 1;
    buscaIniciadaRef.current = true;
    setBuscaIniciada(true);
    const dia = faseDoDia.current;
    if (dia && dia.userId === driverId) void gravarBuscaIniciada(dia.key, dia.userId);
    focarBusca();
  }, [driverId, focarBusca]);
  /**
   * A ROTA na tela (próxima parada, mapa e lista de cães) segue a ETAPA do dia: antes de começar, a tela é só
   * o cartão da jornada. Na ENTREGA a lista é a consequência do yard — a virada é que a revela.
   */
  /**
   * O DIA está EM ANDAMENTO? (etapa do dia, dono 03/10/2026 — print do app: com "Journey closed." e o
   * registro manual encerrado, a lista do Billy NÃO pode continuar na tela.)
   *
   * Vale como dia em andamento: jornada ABERTA (turno manual aberto ou deduzida sem fim) e também a
   * jornada DEDUZIDA PELA ROTA — esta é a dedução pelos cães (van/primeiro evento), então o dia segue
   * valendo nas etapas do yard e da entrega mesmo sem turno manual. O que NÃO vale é o turno manual
   * ENCERRADO: ali o motorista bateu o ponto de saída, e o dia acabou para a tela.
   */
  const diaEmAndamento = journey.kind === 'open' || journey.source === 'route';
  const mostrarRota = diaEmAndamento && (fase === 'dropoff' || buscaIniciada);

  /** Início e fechamento usam o app preferido, com fallback para a folha de escolha. */
  const navegarPara = useCallback(async (location: NavTarget | null, stopId: 'start' | 'closing') => {
    if (!location) return;
    const target: NavTarget = {
      address: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
    };
    try {
      const preferred = await loadPreferredNavApp();
      if (preferred) {
        await Linking.openURL(navigationUrlFor(preferred, target));
        return;
      }
    } catch {
      // sem app preferido/erro ao abrir → cai na folha de escolha
    }
    setNavTarget({ stopId, target });
  }, []);

  // A trava acompanha a visão: o gestor que ligou o interruptor também pode dirigir.
  const { liberado, role, isLoading: carregandoPapel } = useRoleGuard('driver');
  if (!liberado) {
    // 🪤 ACHADO DA VISTORIA (02/10/2026): aqui era SÓ a rodinha. Quando a conta não tem vínculo ativo
    // na organização (foi removida, convite nunca aceito), `view` fica `null` e o guard não redireciona
    // NUNCA — o motorista ficava olhando uma rodinha girando para sempre, sem texto e sem saída.
    if (carregandoPapel || role !== null) {
      return (
        <SafeAreaView style={styles.screen} edges={['top']}>
          <ActivityIndicator testID="driver-loading" style={styles.center} color={colors.gold} size="large" />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScrollView contentContainerStyle={styles.semVinculo}>
          <Text style={styles.semVinculoEmoji}>🐾</Text>
          <Text style={styles.semVinculoTitulo}>This account has no daycare</Text>
          <Text style={styles.semVinculoTexto}>
            Your login is not linked to an active daycare. Ask the manager to invite this e-mail again,
            or sign in with the account you use there.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => { void supabase.auth.signOut().then(() => router.replace('/login' as never)); }}
            style={styles.semVinculoBotao}
          >
            <Text style={styles.semVinculoBotaoTexto}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

 const routeTasks = agruparEmTarefas(stopsDaFase);
 const completedTasks = routeTasks.filter(task => task.stops.every(stop => paradaDaFaseConcluida(stop, fase))).length;
 const journeyCard = (stops.length > 0 || organizationId ? (
                <View style={styles.jornada}>
                  <ShiftCard
                    routeStarted={mostrarRota}
                    state={journey}
                    pendingCount={pendingWrites.length}
                    busy={shiftBusy}
                    error={shiftError}
                    gateHint={gateHint}
                    foraDaVan={foraDaVan}
                    navigation={journeyDestination ? {
                      kind: journeyDestination.kind,
                      onPress: () => void navegarPara(journeyDestination, fechamento ? 'closing' : 'start'),
                    } : undefined}
                    /**
                     * START PICK-UPS: só depois do PONTO BATIDO (`journey.kind === 'open'`), na perna de
                     * busca e enquanto ainda houver cão para buscar. Quando a busca termina quem manda é a
                     * VIRADA DA PERNA (logo abaixo) — os dois nunca aparecem juntos: o motorista não fica
                     * com dois botões dourados empilhados sem saber qual é o próximo passo.
                     */
                    onStartPickups={journey.kind === 'open' && stops.length > 0 && fase === 'pickup' && !buscaTerminou(stops) ? iniciarBusca : undefined}
                    /*
                     * A VIRADA DA PERNA (busca → entrega) é um ATO DO MOTORISTA (dono, 02/10/2026) e segue
                     * NESTE cartão, ao lado do "Navigate to yard": depois da última busca o app pede o YARD
                     * (navegável) e a ação só libera o drop-off com a ORDEM explícita no rótulo visível
                     * (`I'm at the yard — start drop-offs`) — dono, verbatim (03/10/2026): *"depois de pegar
                     * todos os cachorros é pra ir pro yard, depois do yard começa o drop off"*.
                     * A condição das DUAS pernas (migração 053) sai de `podeIniciarEntregas`.
                     */
                    onStartDropoffs={podeIniciarEntregas ? iniciarEntregas : undefined}
                    dropoffsLabel={fechamento?.kind === 'yard' ? "I'm at the yard — start drop-offs" : undefined}
                    onClockIn={(motivo) => void clockIn(motivo)}
                    onClockInAnyway={(motivo) => void clockIn(motivo, true)}
                    onClockOut={(motivo) => void clockOut(motivo)}
                  />
                </View>
              ) : null);

 return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/*
       * ROLAGEM ÚNICA vertical — defeito relatado pelo dono em 25/09/2026 ("ainda não estou
       * conseguindo arrastar a página pra baixo"). Antes desta mudança o ÚNICO componente rolável
       * da tela era o ScrollView de dentro do DriverRouteView (mapa + lista de paradas): o
       * cabeçalho, a linha "Next:" e os cartões SMART ROUTE / JOURNEY / NEXT STOP ficavam presos no
       * topo e o conteúdo de baixo não era alcançável. Agora cabeçalho + avisos + cartões +
       * DriverRouteView rolam JUNTOS neste único ScrollView (o scroller interno virou View).
       * A tab bar do expo-router vive fora desta árvore, então não é empurrada nem quebra.
       */}
      <ScrollView
        ref={scrollRef}
        testID="driver-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        /**
         * 🪤 ACHADO DA VISTORIA (02/10/2026): era o único scroller da tela e não tinha puxar para
         * atualizar — o motorista parado com sinal de volta não tinha como forçar nada (e `load()` é
         * quem sobe a fila de escritas offline).
         */
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => void puxarParaAtualizar()} tintColor={colors.gold} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Today&apos;s Route</Text>
          <View style={styles.headerMeta}>
            {routeTasks.length > 0 ? <Text style={styles.date}>{completedTasks} of {routeTasks.length} stops</Text> : null}
            <Text style={styles.statusChip}>{etapaAtual === 'to_van' ? 'Returning to base' : mostrarRota ? 'On route' : 'Ready to start'}</Text>
          </View>
          <DriveSwitchRow dentroDeLista />
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
        {eta && eta.lateMinutes > 0 ? (
          <View style={[styles.etaBanner, eta.lateMinutes > 0 && styles.etaBannerLate]} accessibilityRole="alert">
            <Text style={[styles.etaText, eta.lateMinutes > 0 && styles.etaTextLate]}>
              {eta.lateMinutes > 0
                ? `⚠️ Running ${eta.lateMinutes} min late for ${eta.dogName}`
                : `Next: ${eta.dogName} — ${!eta.temBase ? 'route not timed yet' : eta.minutes <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${eta.minutes} min away` : 'far from your stops'}${position ? '' : ' (sharing location…)'}`}
            </Text>
          </View>
        ) : null}
        <View
          style={styles.body}
          testID="driver-body"
          onLayout={(evento) => { corpoY.current = evento.nativeEvent.layout.y; }}
        >
          {loading ? <ActivityIndicator testID="driver-loading" style={styles.center} color={colors.gold} size="large" /> : (
            <>
              {/*
               * A JORNADA (clock in/out) fica ANTES do vazio: num dia SEM rota publicada o motorista
               * que chega na van ainda precisa bater o ponto (vistoria, 02/10/2026 — o cartão só
               * aparecia junto da lista de paradas, então um dia sem rota não tinha clock in nenhum).
               * Sem rota o cartão só aparece quando a organização do VÍNCULO é conhecida — sem org
               * não há onde gravar a jornada.
               */}
              <View style={styles.jornada}><RouteSummary stops={stopsDaFase} fase={fase} /></View>
              {!mostrarRota || !proximaParada ? journeyCard : null}
              {stops.length > 0 && etapaAtual !== 'to_van' ? <View style={styles.phaseSection}>
                <View style={styles.phaseRow}>{(['pickup', 'dropoff'] as const).map(phase => {
                  const disabled = phase === 'pickup' ? !buscaIniciada : !entregasLiberadas;
                  return <Pressable key={phase} accessibilityRole="button"
                    accessibilityLabel={phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}
                    accessibilityState={{ selected: fase === phase, disabled }} disabled={disabled}
                    onPress={() => escolherPerna(phase)} style={[styles.phaseOption, fase === phase && styles.phaseActive, disabled && styles.phaseDisabled]}>
                    <Text style={[styles.phaseText, fase === phase && styles.phaseTextActive]}>{phase === 'pickup' ? 'Pick-ups' : 'Drop-offs'}</Text>
                  </Pressable>;
                })}</View>
                {!entregasLiberadas ? <Text style={styles.phaseHint}>Use the yard button to start drop-offs.</Text> : null}
                {!buscaIniciada ? <Text style={styles.phaseHint}>Tap Start Route to open the pick-up list.</Text> : null}
              </View> : null}
              {stops.length === 0 ? (
                /*
                 * O VAZIO tem TRÊS motivos diferentes e não pode dizer a mesma frase para todos
                 * (vistoria, 02/10/2026): (1) sessão perdida — antes virava "No published route today";
                 * (2) sem rede — o app não sabe se existe rota; (3) rota PUBLICADA sem paradas — antes se
                 * confundia com "não publicaram" (o motorista achava que o gestor não tinha publicado).
                 */
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>🚚</Text>
                  <Text style={styles.emptyTitle}>
                    {sessaoExpirada ? 'Session expired' : offline ? "Can't reach the office" : routeId ? 'Route published — no stops today' : 'No published route today'}
                  </Text>
                  <Text style={styles.emptyText}>
                    {sessaoExpirada
                      ? 'Sign in again to see your route — your login was lost, this is not an empty day.'
                      : offline
                        ? 'Your route may exist — the app just could not read it. Pull down or wait for the signal to come back; nothing you did here is lost.'
                        : routeId
                          ? 'The office published your route but it has no stops on it — nothing to do today.'
                          : 'When the manager publishes your route, it will appear here with every stop and instruction.'}
                  </Text>
                </View>
              ) : mostrarRota ? (
                <>
                  {/* NEXT STOP: a próxima parada e as ações primárias (navegar / cheguei / próximo passo),
                      sempre no mesmo lugar — logo abaixo do otimizador e ACIMA da lista de paradas.
                      Nenhuma lógica de gravação nova: os callbacks chamam o `act` que já existe. */}
                  {/*
                    * PONTO DE FOCO (dono, 03/10/2026): é este cartão que o "Start pick-ups" traz para a
                    * tela — o motorista volta do ponto batido direto para o próximo cão. O `onLayout`
                    * entrega a posição relativa ao corpo, e o corpo (índice 0 do scroller) dá o resto.
                    */}
                  <DriverRouteView
                    onLayout={(event) => { routeViewY.current = event.nativeEvent.layout.y; }}
                    activeStopId={proximaParada?.id}
                    activeCard={
                  <View
                    style={styles.nextStop}
                    testID={fase === 'pickup' ? 'pickup-focus' : 'dropoff-focus'}
                    onLayout={(evento) => { proximaParadaY.current = evento.nativeEvent.layout.y; }}
                  >
                    {!position ? <Text style={styles.phaseHint}>Location unavailable. Check location permission in Settings; navigation and manual arrival are available.</Text> : null}
                    {proximaParada ? <NextStopCard
                      phase={fase}
                      positionLabel={proximaParada ? `STOP ${posicoesDasParadas(agruparEmTarefas(stopsDaFase)).get(proximaParada.id)?.numero} OF ${agruparEmTarefas(stopsDaFase).length}` : undefined}
                      stop={proximaParada}
                      nextAction={proximaParada ? fase === 'dropoff' ? 'deliver' : nextActionForStatus(proximaParada.status, proximaParada.deliveredAt) : null}
                      onNavigate={(stop) => void act(stop.id, 'navigate')}
                      onAction={(stopId, action) => void act(stopId, action)}
                      // O aviso ao tutor também no cartão grande (o dono procurou aqui, 01/10/2026).
                      onNotifyOwner={avisarTutor}
                    /> : null}
                  </View>
                    }
                    stops={stopsDaFase}
                    onAction={act}
                    onNotifyOwner={avisarTutor}
                    start={start}
                    closing={fechamento}
                    onNavigateClosing={fechamento && etapaAtual === 'to_van' ? () => void navegarPara(fechamento, 'closing') : undefined}
                    fase={fase}
                    etapa={etapaAtual}
                  />
                  {proximaParada ? journeyCard : null}
                </>
              ) : (
                /* ETAPA DO DIA (dono, 03/10/2026): antes de começar, a tela é SÓ o cartão da jornada —
                 * a lista de cães é o trabalho dele e aparece quando ele aperta "Start pick-ups". */
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Clock in and tap Start Route to see today&apos;s stops.</Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
      {/* Aviso flutuante: fica FORA do ScrollView para continuar colado no rodapé da TELA (antes
          vivia no corpo, que tinha flex:1 e ocupava a tela inteira). Dentro do scroller ele herdaria
          a altura do conteúdo e rolaria embora do campo de visão do motorista. */}
      {message ? (
        <Pressable accessibilityRole="button" onPress={() => setMessage(null)} style={styles.message}>
          <Text style={styles.messageText}>{message}</Text>
        </Pressable>
      ) : null}
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
      {/* Aviso de ETA ao tutor: o texto vai pronto, quem envia é o motorista (pedido do cliente).
          A folha só aparece se houver MAIS de um mensageiro; com um só o aviso vai direto (avisarTutor). */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /**
   * SELETOR DE PERNA DO MOTORISTA — MESMO desenho do quadro do gestor (dono, 04/10/2026: *"a caixa
   * seletora do pick-up e drop off tem uma coloração confusa"*): o ativo é verde CLARO com texto escuro,
   * discreto, e não o bloco verde cheio que ocupava metade da tela.
   */
  phaseSection: { marginBottom: 12, gap: 8 },
  phaseRow: { flexDirection: 'row', gap: 4, padding: 4, marginHorizontal: 16, backgroundColor: colors.sage, borderRadius: 12 },
  phaseOption: { flex: 1, minHeight: 44, borderWidth: 0, borderColor: colors.line, borderRadius: 8, padding: 12, alignItems: 'center', backgroundColor: colors.paper },
  phaseActive: { backgroundColor: colors.paper, borderColor: colors.forest700 },
  phaseDisabled: { opacity: 0.5 },
  phaseText: { color: colors.muted, fontWeight: '800' },
  phaseTextActive: { color: colors.forest900 },
  phaseHint: { color: colors.muted, fontSize: 12, marginHorizontal: 16 },
  screen: { flex: 1, backgroundColor: colors.forest700 },
  /** ScrollView externo = o ÚNICO scroller vertical da tela do motorista. */
  scroll: { flex: 1 },
  /** flexGrow: 1 deixa o conteúdo curto (loading / rota vazia) preencher a tela com o fundo creme. */
  scrollContent: { flexGrow: 1 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  eyebrow: { color: colors.gold, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontSize: 24, fontWeight: '800', marginTop: 6 },
  headerMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  statusChip: { color: colors.forest900, backgroundColor: colors.sage, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: '700' },
  date: { color: '#D7E1D4', fontSize: 12, marginTop: 4 },
  offlineBanner: { backgroundColor: '#FBF0D9', borderBottomWidth: 1, borderBottomColor: '#EADFB8', paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { color: '#7A5E12', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  etaBanner: { backgroundColor: colors.sage, paddingHorizontal: 16, paddingVertical: 9 },
  etaBannerLate: { backgroundColor: '#FBEAE6' },
  etaText: { color: colors.forest900, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  etaTextLate: { color: colors.urgency },
  /** flexGrow (não flex) = o corpo flui junto no ScrollView único; flex: 1 aqui prenderia a rolagem. */
  body: { flexGrow: 1, backgroundColor: colors.cream },
  jornada: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 2 },
  /** Espaço do painel NEXT STOP: mesmo respiro horizontal do otimizador e da jornada. */
  nextStop: { paddingTop: 8 },
  center: { marginTop: 80 },
  empty: { alignItems: 'center', paddingHorizontal: 34, marginTop: 90 },
  emptyEmoji: { fontSize: 44 },
  semVinculo: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  semVinculoEmoji: { fontSize: 34 },
  semVinculoTitulo: { fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  semVinculoTexto: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  semVinculoBotao: { marginTop: 6, minHeight: 44, justifyContent: 'center', paddingHorizontal: 22, borderRadius: radii.medium, backgroundColor: colors.forest700 },
  semVinculoBotaoTexto: { color: colors.cream, fontSize: 15, fontWeight: '700' },
  emptyTitle: { fontFamily: 'serif', fontSize: 20, fontWeight: '800', color: colors.forest900, marginTop: 12 },
  emptyText: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 20, marginTop: 8 },
  message: { position: 'absolute', left: 18, right: 18, bottom: 24, backgroundColor: colors.urgency, borderRadius: 12, padding: 12 },
  messageText: { color: 'white', fontWeight: '800', textAlign: 'center', fontSize: 13 },
});
