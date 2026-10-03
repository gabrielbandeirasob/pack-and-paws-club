import { formatTimeOfDay } from '@/lib/clock';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ordenarParadasDoDia } from '@/features/driver/dayOrder';
import { dogPhotoThumbnailUrl } from '@/features/dogs/dogPhoto';
import type { FechamentoDaRota } from '@/features/driver/routeClosing';
import { notifyButtonState } from '@/features/driver/etaMessage';
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';
import { clockText } from '@/features/driver/shift';
import { marcosDaParada } from '@/features/dashboard/stopProgress';
import { ordenarPelaFase, paradaDaFaseConcluida, paradaEntregavel, podeIniciarDropoff, type DayPhase } from '@/features/driver/dayPhase';
import { agruparEmTarefas, posicoesDasParadas } from '@/features/driver/tasks';
import { RouteMap } from '@/features/maps/RouteMap';
import { colors, radii } from '@/features/theme/tokens';

export type DriverStop = {
  id: string;
  /** Id estável usado para persistir a nova ordem da rota. Pode faltar se a RLS esconder o embed. */
  dogId?: string | null;
  /**
   * Parada agrupada por cliente (migration 029): paradas do MESMO cliente na MESMA rota compartilham
   * este id, e a tela mostra "1 parada, N cães" (cada cão com seu status e seu comprovante).
   */
  groupId?: string | null;
  sequence: number;
  dropoffSequence?: number | null;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  clientName: string;
  dogName: string;
  address: string | null;
  city: string | null;
  instructions: string | null;
  /** Notas do cão que o motorista PRECISA ver (segurança): comportamento e saúde. */
  behaviorNotes?: string | null;
  medicalNotes?: string | null;
  /** Foto do cão no cadastro (bucket público dog-photos): confirma o cão na porta do cliente. */
  dogPhotoUrl?: string | null;
  /** Telefone do tutor: sem ele o botão de avisar não aparece (nada de mandar mensagem no vácuo). */
  clientPhone?: string | null;
  /** Telefone do segundo tutor (migration 037): o aviso de ETA sai numa conversa com os dois números. */
  clientPhone2?: string | null;
  /** Nome do segundo tutor — entra na saudação da mensagem junto com o do cadastro. */
  secondOwnerName?: string | null;
  /** Minutos até esta parada (o mesmo ETA que a tela mostra); null quando não há posição. */
  etaMinutes?: number | null;
  /** Minutos de atraso em relação à janela (0 = no prazo). */
  lateMinutes?: number;
  /** Quando o motorista avisou o tutor desta parada (histórico gravado no servidor). */
  etaNoticeAt?: string | null;
  /** Marcos carimbados no servidor (migration 024): a jornada é deduzida daqui. */
  arrivedAt?: string | null;
  pickedUpAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  /**
   * Marco de ENTREGA (migração 041, carimbado no servidor). É o que fecha a parada de verdade: o 2º
   * toque ("Next") grava `picked_up` + `completed` na hora do pick-up, então sem esta coluna a tarde
   * inteira ficava sem registro (conferência do dono, 01/10/2026).
   */
  deliveredAt?: string | null;
  /**
   * Transferência de cão entre motoristas no meio do dia (item 5, migration 052): o gestor moveu este
   * cão da rota de OUTRO motorista. O histórico (marcos) vem junto na transferência, então a entrega
   * segue habilitada; o motorista lê de quem recebeu e a hora.
   */
  handedFromName?: string | null;
  handedAt?: string | null;
  /** Pernas de viagem gravadas pelo Optimize do gestor (segundos): ETA por rota, não por linha reta. */
  travelSeconds?: number | null;
  dropoffTravelSeconds?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  exactTime?: string | null;
  priority?: 'normal' | 'priority';
};

/**
 * Ações do dia do motorista.
 *
 * `finish` é o 2º toque do fluxo curto (pedido do dono, 30/09/2026: "tem que ser, tipo assim,
 * I arrived e next. Talvez dois cliques"): grava `picked_up` E `completed` no mesmo gesto — dois
 * registros, com o horário carimbado pelo servidor, para o rastro de auditoria não perder o marco do
 * meio. Ele não inventa estado novo: quem grava continua sendo o `act` de `app/(tabs)/driver.tsx`.
 */
export type DriverAction = 'navigate' | 'arrived' | 'picked_up' | 'completed' | 'problem' | 'finish' | 'deliver';

export type DriverStartPoint = {
  kind: 'van' | 'yard';
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  start?: DriverStartPoint | null;
  onNavigateStart?: () => void;
  stops: DriverStop[];
  onAction: (stopId: string, action: DriverAction) => Promise<void>;
  /** Abre o mensageiro com o aviso de ETA pronto para o tutor (pedido do cliente, 16/09/2026). */
  onNotifyOwner?: (stop: DriverStop) => void;
  /**
   * ONDE A ROTA FECHA (pedido do cliente, 02/10/2026 — *"as rota de pick up não tão acabando no yard...
   * e as de drop off não tão acabando no local da van"*): o cartão do fim entra depois da lista, quando
   * a busca termina (vai para o yard) e quando a entrega termina (volta para a van).
   */
  closing?: FechamentoDaRota | null;
  /**
   * LEVA o motorista até o fechamento (yard/van) — cliente, 02/10/2026: *"o aplicativo apenas informa
   * que termina no yard, mas na realidade não mudou nada"*. Sem ele, o cartão continua só informativo.
   */
  onNavigateClosing?: () => void;
  /**
   * A PERNA do dia (pick-up × drop-off). A virada é um ATO DO MOTORISTA, não automática — decisão do
   * dono (02/10/2026), depois do áudio do cliente: *"tem que ter uma mudança clara de rota... ele não
   * tem que fazer essa mudança automática"*. Ausente = `pickup` (o dia começa buscando).
   */
  fase?: DayPhase;
  /** Permite decidir a virada com as paradas da perna independente de entrega. */
  canStartDropoffs?: boolean;
  /** Vira o dia para a perna de ENTREGA. Sem ele, o botão "Start drop-offs" não aparece. */
  onStartDropoffs?: () => void;
};

function addressLine(stop: DriverStop): string | null {
  const parts = [stop.address, stop.city].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function DriverRouteView({ stops, onAction, onNotifyOwner, start, onNavigateStart, closing, onNavigateClosing, fase: faseProp, onStartDropoffs, canStartDropoffs }: Props) {
  const fase: DayPhase = faseProp ?? 'pickup';
  const fire = (stop: DriverStop, action: DriverAction) => onAction(stop.id, action);
  /**
   * A ORDEM segue a PERNA declarada (`fase`), não o estado das paradas. Antes esta linha usava
   * `ordenarParadasDoDia()`, que TROCAVA a ordem sozinho quando a última busca terminava — era
   * exatamente a "mudança automática" que o cliente recusou no áudio de 02/10/2026.
   */
  const ordered = ordenarPelaFase(stops, fase);
  /**
   * TAREFAS do dia: paradas do MESMO cliente viram UMA parada com N cães (migration 029) — o motorista
   * para uma vez e resolve cão por cão, cada um com seu status e seu comprovante (decisão do dono).
   */
  const tarefas = agruparEmTarefas(ordered);
  const posicoes = posicoesDasParadas(tarefas);
  /**
   * Ordem de RENDERIZAÇÃO: parada por parada (não a sequência crua do banco). Os cães da mesma casa
   * ficam vizinhos, embaixo do cabeçalho da parada — senão o "irmão" apareceria depois da casa seguinte.
   */
  const naOrdemDasParadas = tarefas.flatMap((tarefa) => tarefa.stops);

  return (
    /*
     * View, NÃO ScrollView: a rolagem ÚNICA da tela do motorista é o ScrollView de
     * app/(tabs)/driver.tsx (defeito relatado pelo dono em 25/09/2026: "ainda não estou conseguindo
     * arrastar a página pra baixo"). Com dois scrollers aninhados, o de dentro engolia o gesto e o
     * conteúdo acima dele (cabeçalho/cartões) ficava preso no topo. Sem rolagem própria aqui, o
     * mapa e as paradas passam a rolar junto com o resto da página.
     * O antigo contentContainerStyle virou `style` normal e as props exclusivas de ScrollView
     * (showsVerticalScrollIndicator / contentInsetAdjustmentBehavior / automaticallyAdjustContentInsets)
     * saíram daqui — se precisarem existir, existem só no scroller externo. O `scrollEnabled={false}`
     * do mapa (features/maps/RouteMap.tsx) continua igual.
     */
    <View style={styles.list}>
      {/*
        * FASE DO DIA (cliente, 02/10/2026): a perna atual fica EXPLÍCITA no topo — o motorista sabe se
        * está buscando ou entregando, e a virada é um ato dele (botão abaixo), não automática.
        */}
      <View style={styles.closing} testID="day-phase">
        <Text style={styles.closingTag}>{fase === 'pickup' ? 'PICK-UPS' : 'DROP-OFFS'}</Text>
        <Text style={styles.closingTitle}>{fase === 'pickup' ? 'Picking up the dogs' : 'Delivering the dogs'}</Text>
        {fase === 'dropoff' ? (
          <Text style={styles.closingSub}>The pick-up run is over — everything here is a delivery.</Text>
        ) : null}
      </View>
      {start?.name.trim() && onNavigateStart ? (
        <View style={[styles.closing, styles.start]} testID="route-start">
          <Text style={styles.closingTag}>
            {start.kind === 'van' ? 'VAN · where the day starts' : 'YARD · where the drop-offs start'}
          </Text>
          <Text style={styles.closingTitle}>{start.name}</Text>
          {start.address ? <Text style={styles.closingAddress}>{start.address}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Navigate to the start"
              onPress={onNavigateStart}
              style={[styles.action, styles.actionDark]}
              testID="navigate-start"
            >
              <Text style={styles.actionDarkText}>Navigate</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {tarefas.length > 0 ? (
        <RouteMap
          stops={tarefas.map((tarefa, index) => {
            // UM ponto por PARADA (não por cão): dois cães da mesma casa são a mesma parada no mapa.
            const primeiro = tarefa.stops[0];
            const pendente = tarefa.stops.find((stop) => stop.status !== 'completed' && stop.status !== 'skipped');
            return {
              id: tarefa.id,
              sequence: index + 1,
              dogName: tarefa.stops.map((stop) => stop.dogName).join(' · '),
              address: addressLine(primeiro),
              status: (pendente ?? primeiro).status,
              latitude: primeiro.latitude,
              longitude: primeiro.longitude,
            };
          })}
        />
      ) : null}
      {naOrdemDasParadas.map((stop, index) => {
        /*
         * `done` agora depende da PERNA (cliente, 02/10/2026): na busca, conclui no pick-up; na
         * ENTREGA, só `delivered_at` fecha. Antes a lista de drop-off aparecia "toda feita" porque o
         * pick-up já deixa a parada `completed`.
         */
        const done = paradaDaFaseConcluida(stop, fase);
        /*
         * ENTREGA (conferência do dono, 01/10/2026): `done` marca a BUSCA concluída (é o que pinta o
         * cartão), mas a parada só sai da fila quando a entrega é confirmada — `deliveredAt` — ou
         * quando ela virou problema. Sem separar os dois, o botão de avisar o tutor sumia depois do
         * pick-up e o motorista ficava sem mandar o aviso da ENTREGA (defeito relatado).
         */
        const finalizada = stop.status === 'skipped' || Boolean(stop.deliveredAt);
        const paraEntregar = paradaEntregavel(stop, fase);
        const address = addressLine(stop);
        const posicao = posicoes.get(stop.id);
        // Cabeçalho da PARADA: só quando ela tem mais de um cão (mesmo cliente, mesmo endereço).
        const cabecalhoDaParada = Boolean(posicao && posicao.primeiraDoGrupo && posicao.totalNaTarefa > 1);
        // Aviso de ETA: só faz sentido enquanto a parada está viva e o cliente tem telefone.
        // O botão existe se QUALQUER um dos dois tutores tem telefone — o aviso vai para os dois.
        const aviso = notifyButtonState({ phone: stop.clientPhone ?? stop.clientPhone2, lateMinutes: stop.lateMinutes, done: finalizada });
        // O cartao inteiro abre a navegacao. Relato do dono (12/09/2026): "ao clicar nao direciona a
        // aplicativo algum" - antes so o botao Navigate fazia isso, e ele SUMIA quando a parada
        // estava concluida (o bloco de acoes ficava atras de `!done`). Perder a navegacao numa parada
        // concluida e pior: e justamente quando o motorista precisa reconferir o local.
        return (
          <View key={stop.id}>
            {cabecalhoDaParada && posicao ? (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>
                  Stop {posicao.numero} · {posicao.totalNaTarefa} dogs
                </Text>
                <Text style={styles.groupHint}>
                  Same address · {posicao.resolvidos}/{posicao.totalNaTarefa} done
                </Text>
              </View>
            ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open navigation for ${stop.dogName}`}
            onPress={() => fire(stop, 'navigate')}
            style={({ pressed }) => [styles.card, done && styles.cardDone, pressed && styles.cardPressed]}
          >
            <View style={styles.rowTop}>
              {/* Foto do cão (cadastro): é o que confirma que é o cachorro certo na porta — sem
                  ela o motorista só tem o nome. */}
              {stop.dogPhotoUrl ? (
                <Image
                  source={{ uri: dogPhotoThumbnailUrl(stop.dogPhotoUrl) ?? stop.dogPhotoUrl }}
                  style={styles.dogPhoto}
                  accessibilityLabel={`Photo of ${stop.dogName}`}
                />
              ) : null}
              {/* Numera pela posicao na rota (1, 2, 3...). O painel do Dispatch ja fazia assim;
                  aqui saia o campo cru do banco, que pode vir 0 ("0. Maria Silva"). */}
              <Text style={styles.title}>{posicao?.numero ?? index + 1}. {stop.dogName}</Text>
              <StatusBadge status={stop.status} entregue={Boolean(stop.deliveredAt)} />
            </View>
            {address ? <Text style={styles.address}>{address}</Text> : null}
            {stop.exactTime ? <Text style={styles.deadline}>⏱ Must arrive by {formatTimeOfDay(stop.exactTime)}</Text> : stop.windowEnd ? <Text style={styles.deadline}>⏱ Window until {formatTimeOfDay(stop.windowEnd)}</Text> : null}
            {/* HORA DE CADA MARCO (chegada/conclusão), carimbada no servidor desde a migration 024 —
                pedido do cliente em áudio (01/10/2026): "podia aparecer qual cachorro já foi e que
                hora". É a MESMA frase que o gestor lê na lista da rota (módulo `stopProgress`). */}
            <Text style={styles.marcos}>{marcosDaParada(stop, fase)}</Text>
            {!finalizada && stop.etaMinutes != null ? (
              <Text style={[styles.eta, (stop.lateMinutes ?? 0) > 0 && styles.etaLate]}>
                {stop.etaMinutes <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${stop.etaMinutes} min away` : 'far from your stops'}{(stop.lateMinutes ?? 0) > 0 ? ` · ${stop.lateMinutes} min late` : ''}
              </Text>
            ) : null}
            {fase === 'dropoff' && stop.deliveredAt ? <Text style={styles.delivered}>Delivered at {clockText(stop.deliveredAt)}</Text> : null}
            {/* Transferência de cão entre motoristas (item 5, migration 052): de quem veio e a hora. */}
            {stop.handedFromName ? (
              <Text style={styles.notified}>Received from {stop.handedFromName}{stop.handedAt ? ` · ${clockText(stop.handedAt)}` : ''}</Text>
            ) : null}
            {stop.etaNoticeAt ? <Text style={styles.notified}>Owner notified at {clockText(stop.etaNoticeAt)}</Text> : null}
            {stop.instructions ? <View style={styles.instructions}><Text style={styles.instructionsLabel}>ACCESS INSTRUCTIONS</Text><Text style={styles.instructionsText}>{stop.instructions}</Text></View> : null}
            {stop.medicalNotes ? <View style={[styles.care, styles.careMedical]}><Text style={[styles.careLabel, styles.careLabelMedical]}>⚠ MEDICAL</Text><Text style={styles.careText}>{stop.medicalNotes}</Text></View> : null}
            {stop.behaviorNotes ? <View style={[styles.care, styles.careBehavior]}><Text style={styles.careLabel}>BEHAVIOR</Text><Text style={styles.careText}>{stop.behaviorNotes}</Text></View> : null}
            <View style={styles.actions}>
              {/* sempre visivel, inclusive para parada concluida */}
              <Pressable accessibilityRole="button" accessibilityLabel={`Navigate to ${stop.dogName}`} onPress={() => fire(stop, 'navigate')} style={[styles.action, styles.actionDark]}>
                <Text style={styles.actionDarkText}>Navigate</Text>
              </Pressable>
              {onNotifyOwner && aviso.enabled ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Notify owner ${stop.dogName}`}
                  onPress={() => onNotifyOwner(stop)}
                  style={[styles.action, aviso.tone === 'late' ? styles.actionLate : styles.actionNotify]}
                >
                  <Text style={aviso.tone === 'late' ? styles.actionLateText : styles.actionNotifyText}>
                    {aviso.tone === 'late' ? 'Notify owner · late' : 'Notify owner'}
                  </Text>
                </Pressable>
              ) : null}
              {/*
                * FLUXO DE 2 TOQUES (pedido do dono, 30/09/2026): "I arrived" e depois "Next".
                * O 2º toque grava pegou + concluiu juntos (ação 'finish') — os 3 registros de
                * auditoria continuam existindo, só o trabalho do motorista que encurtou.
                */}
              {!done && fase === 'pickup' && stop.status === 'pending' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Mark arrived ${stop.id}`} onPress={() => fire(stop, 'arrived')} style={[styles.action, styles.actionGold]}>
                  <Text style={styles.actionGoldText}>I arrived</Text>
                </Pressable>
              ) : null}
              {!done && fase === 'pickup' && (stop.status === 'arrived' || stop.status === 'picked_up') ? (
                <>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Next ${stop.dogName}`} onPress={() => fire(stop, 'finish')} style={[styles.action, styles.actionGold]}>
                    <Text style={styles.actionGoldText}>Next</Text>
                  </Pressable>
                  {stop.status === 'arrived' ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Problem ${stop.id}`} onPress={() => fire(stop, 'problem')} style={[styles.action, styles.actionProblem]}>
                      <Text style={styles.actionProblemText}>Problem</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
              {/*
                * ENTREGA — o 3º toque do dia, só na parte da tarde: o cão já está na van (pick-up feito)
                * e o motorista confirma a entrega na casa do tutor. É o dado que faltava para o gestor
                * ver em qual entrega o dia está (pedido do dono, 01/10/2026).
                */}
              {paraEntregar ? (
                <>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Delivered ${stop.dogName}`} onPress={() => fire(stop, 'deliver')} style={[styles.action, styles.actionDelivered]}>
                    <Text style={styles.actionDeliveredText}>Delivered</Text>
                  </Pressable>
                  {/*
                    * ENTREGA SEM SUCESSO (beco sem saída, vistoria 02/10/2026): o bloco de "Problem"
                    * acima só existia na CHEGADA (`arrived`). Depois do 2º toque a parada fica
                    * `completed` SEM entrega e o motorista só tinha "Delivered" — se o tutor não
                    * estivesse em casa o dia nunca fechava. Agora a entrega tem as DUAS saídas,
                    * exatamente como a busca.
                    */}
                  <Pressable accessibilityRole="button" accessibilityLabel={`Problem ${stop.id}`} onPress={() => fire(stop, 'problem')} style={[styles.action, styles.actionProblem]}>
                    <Text style={styles.actionProblemText}>Problem</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </Pressable>
          </View>
        );
      })}

      {/*
        * VIRADA DE FASE — decisão do dono (02/10/2026): *"deve ser um botão do motorista"*. Só aparece
        * quando a BUSCA acabou e ainda há ENTREGA: nada muda sozinho.
        */}
      {fase === 'pickup' && onStartDropoffs && (canStartDropoffs ?? podeIniciarDropoff(stops)) ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start drop-offs"
            onPress={onStartDropoffs}
            style={[styles.action, styles.actionGold]}
            testID="start-dropoffs"
          >
            <Text style={styles.actionGoldText}>Start drop-offs</Text>
          </Pressable>
        </View>
      ) : null}

      {/*
        * O FIM DA ROTA (pedido do cliente, 02/10/2026). Sem ação para tocar: é o destino que faltava —
        * antes a lista acabava no último cão e o motorista não via que o dia ainda tinha uma perna.
        */}
      {closing ? (
        <View style={styles.closing} testID="route-closing">
          <Text style={styles.closingTag}>{closing.kind === 'yard' ? 'YARD' : 'VAN'}</Text>
          <Text style={styles.closingTitle}>{closing.title}</Text>
          <Text style={styles.closingSub}>{closing.subtitle}</Text>
          {closing.address ? <Text style={styles.closingAddress}>{closing.address}</Text> : null}
          {/* NAVEGAR até o fechamento (cliente, 02/10/2026): antes o cartão SÓ informava. */}
          {onNavigateClosing && (closing.latitude != null || closing.longitude != null || closing.address) ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Navigate to the ${closing.kind === 'yard' ? 'yard' : 'van'}`}
                onPress={onNavigateClosing}
                style={[styles.action, styles.actionDark]}
                testID="navigate-closing"
              >
                <Text style={styles.actionDarkText}>Navigate</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Selo do estado da parada. Com a ENTREGA separada (01/10/2026), `completed` deixou de ser o fim:
 * o cão está NA VAN esperando a entrega da tarde. Por isso o selo ganhou o caso "In the van" e o
 * "Delivered" — "Completed" às 9 da manhã num dia em que faltam 6 entregas era leitura errada.
 */
function StatusBadge({ status, entregue }: { status: DriverStop['status']; entregue?: boolean }) {
  const labels: Record<DriverStop['status'], string> = {
    pending: 'Pending', arrived: 'Arrived', picked_up: 'Dog picked up', completed: 'Completed', skipped: 'Problem',
  };
  const colorsByStatus: Record<DriverStop['status'], string> = {
    pending: '#8A6D1F', arrived: colors.forest700, picked_up: colors.success, completed: colors.success, skipped: colors.muted,
  };
  const emTransito = !entregue && (status === 'picked_up' || status === 'completed');
  const rotulo = entregue && status !== 'skipped' ? 'Delivered' : emTransito ? 'In the van' : labels[status];
  const cor = entregue && status !== 'skipped' ? '#2F773D' : emTransito ? '#8A6D1F' : colorsByStatus[status];
  return <Text style={[styles.badge, { color: cor, backgroundColor: `${cor}18` }]}>{rotulo}</Text>;
}

const styles = StyleSheet.create({
  /** Estilo de CONTEÚDO da lista (antes era contentContainerStyle do ScrollView interno). */
  list: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 15, marginBottom: 12 },
  cardDone: { opacity: 0.55 },
  cardPressed: { opacity: 0.9 },
  /** Cabeçalho da PARADA com mais de um cão (mesmo cliente): "Stop 2 · Ana · 2 dogs". */
  groupHeader: { marginTop: 2, marginBottom: 6 },
  groupTitle: { fontFamily: 'serif', fontSize: 13, fontWeight: '900', color: colors.forest700, letterSpacing: 0.2 },
  groupHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dogPhoto: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.sage },
  title: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, flex: 1 },
  badge: { fontSize: 12, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  address: { color: colors.ink, fontSize: 13, marginTop: 6 },
  deadline: { color: '#8A6D1F', fontSize: 12, fontWeight: '800', marginTop: 5 },
  marcos: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 4 },
  eta: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 4 },
  etaLate: { color: colors.urgency },
  notified: { color: colors.muted, fontSize: 12, marginTop: 4 },
  /** Marco de entrega do próprio motorista ("Delivered at 14:05"). */
  delivered: { color: '#2F773D', fontSize: 12, fontWeight: '800', marginTop: 4 },
  instructions: { backgroundColor: '#FBF6E8', borderWidth: 1, borderColor: '#EADFB8', borderRadius: 12, padding: 11, marginTop: 10 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  care: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 8 },
  careMedical: { backgroundColor: '#FDEEEE', borderColor: '#E8BFBF' },
  careBehavior: { backgroundColor: '#F1F4EE', borderColor: '#CFD8C6' },
  careLabel: { color: colors.forest700, fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  careLabelMedical: { color: colors.urgency },
  careText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  action: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 120 },
  actionDark: { backgroundColor: colors.forest700 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  actionProblem: { backgroundColor: '#FBEAE6' },
  closing: {
    marginTop: 14,
    padding: 14,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 2,
  },
  start: { marginBottom: 12 },
  closingTag: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.muted },
  closingTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  closingSub: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  closingAddress: { fontSize: 13, color: colors.forest700, marginTop: 2 },
  actionProblemText: { color: colors.urgency, fontWeight: '900', fontSize: 13 },
  actionNotify: { backgroundColor: colors.sage },
  actionNotifyText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  actionLate: { backgroundColor: '#F3D9A4' },
  actionLateText: { color: '#7A5B12', fontWeight: '900', fontSize: 13 },
  /** Botão de ENTREGA: verde fechado (ação que encerra a parada), distinto do dourado da busca. */
  actionDelivered: { backgroundColor: colors.forest700 },
  actionDeliveredText: { color: colors.cream, fontWeight: '900', fontSize: 13 },
});
