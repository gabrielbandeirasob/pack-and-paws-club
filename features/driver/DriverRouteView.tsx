import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { notifyButtonState } from '@/features/driver/etaMessage';
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';
import { clockText } from '@/features/driver/shift';
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
  latitude?: number | null;
  longitude?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  exactTime?: string | null;
  priority?: 'normal' | 'priority';
};

export type DriverAction = 'navigate' | 'arrived' | 'picked_up' | 'completed' | 'problem';

type Props = {
  stops: DriverStop[];
  onAction: (stopId: string, action: DriverAction) => Promise<void>;
  /** Abre o mensageiro com o aviso de ETA pronto para o tutor (pedido do cliente, 16/09/2026). */
  onNotifyOwner?: (stop: DriverStop) => void;
};

function addressLine(stop: DriverStop): string | null {
  const parts = [stop.address, stop.city].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function DriverRouteView({ stops, onAction, onNotifyOwner }: Props) {
  const fire = (stop: DriverStop, action: DriverAction) => onAction(stop.id, action);
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
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
        const done = stop.status === 'completed' || stop.status === 'skipped';
        const address = addressLine(stop);
        const posicao = posicoes.get(stop.id);
        // Cabeçalho da PARADA: só quando ela tem mais de um cão (mesmo cliente, mesmo endereço).
        const cabecalhoDaParada = Boolean(posicao && posicao.primeiraDoGrupo && posicao.totalNaTarefa > 1);
        // Aviso de ETA: só faz sentido enquanto a parada está viva e o cliente tem telefone.
        const aviso = notifyButtonState({ phone: stop.clientPhone, lateMinutes: stop.lateMinutes, done });
        // O cartao inteiro abre a navegacao. Relato do dono (12/09/2026): "ao clicar nao direciona a
        // aplicativo algum" - antes so o botao Navigate fazia isso, e ele SUMIA quando a parada
        // estava concluida (o bloco de acoes ficava atras de `!done`). Perder a navegacao numa parada
        // concluida e pior: e justamente quando o motorista precisa reconferir o local.
        return (
          <View key={stop.id}>
            {cabecalhoDaParada && posicao ? (
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>
                  Stop {posicao.numero} · {posicao.clientName} · {posicao.totalNaTarefa} dogs
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
                  source={{ uri: stop.dogPhotoUrl }}
                  style={styles.dogPhoto}
                  accessibilityLabel={`Photo of ${stop.dogName}`}
                />
              ) : null}
              {/* Numera pela posicao na rota (1, 2, 3...). O painel do Dispatch ja fazia assim;
                  aqui saia o campo cru do banco, que pode vir 0 ("0. Maria Silva"). */}
              <Text style={styles.title}>{posicao?.numero ?? index + 1}. {stop.clientName} · {stop.dogName}</Text>
              <StatusBadge status={stop.status} />
            </View>
            {address ? <Text style={styles.address}>{address}</Text> : null}
            {stop.exactTime ? <Text style={styles.deadline}>⏱ Must arrive by {stop.exactTime}</Text> : stop.windowEnd ? <Text style={styles.deadline}>⏱ Window until {stop.windowEnd}</Text> : null}
            {!done && stop.etaMinutes != null ? (
              <Text style={[styles.eta, (stop.lateMinutes ?? 0) > 0 && styles.etaLate]}>
                {stop.etaMinutes <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${stop.etaMinutes} min away` : 'far from your stops'}{(stop.lateMinutes ?? 0) > 0 ? ` · ${stop.lateMinutes} min late` : ''}
              </Text>
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
              {!done && stop.status === 'pending' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Mark arrived ${stop.id}`} onPress={() => fire(stop, 'arrived')} style={[styles.action, styles.actionGold]}>
                  <Text style={styles.actionGoldText}>Arrived</Text>
                </Pressable>
              ) : null}
              {!done && stop.status === 'arrived' ? (
                <>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Picked up ${stop.dogName}`} onPress={() => fire(stop, 'picked_up')} style={[styles.action, styles.actionGold]}>
                    <Text style={styles.actionGoldText}>Dog picked up</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Problem ${stop.id}`} onPress={() => fire(stop, 'problem')} style={[styles.action, styles.actionProblem]}>
                    <Text style={styles.actionProblemText}>Problem</Text>
                  </Pressable>
                </>
              ) : null}
              {!done && stop.status === 'picked_up' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Complete ${stop.id}`} onPress={() => fire(stop, 'completed')} style={[styles.action, styles.actionGold]}>
                  <Text style={styles.actionGoldText}>Completed</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function StatusBadge({ status }: { status: DriverStop['status'] }) {
  const labels: Record<DriverStop['status'], string> = {
    pending: 'Pending', arrived: 'Arrived', picked_up: 'Dog picked up', completed: 'Completed', skipped: 'Problem',
  };
  const colorsByStatus: Record<DriverStop['status'], string> = {
    pending: '#8A6D1F', arrived: colors.forest700, picked_up: '#4E8D5C', completed: '#4E8D5C', skipped: colors.muted,
  };
  return <Text style={[styles.badge, { color: colorsByStatus[status], backgroundColor: `${colorsByStatus[status]}18` }]}>{labels[status]}</Text>;
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
  groupHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dogPhoto: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.sage },
  title: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900, flex: 1 },
  badge: { fontSize: 11, fontWeight: '900', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  address: { color: colors.ink, fontSize: 13, marginTop: 6 },
  deadline: { color: '#8A6D1F', fontSize: 12, fontWeight: '800', marginTop: 5 },
  eta: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 4 },
  etaLate: { color: colors.urgency },
  notified: { color: colors.muted, fontSize: 11, marginTop: 4 },
  instructions: { backgroundColor: '#FBF6E8', borderWidth: 1, borderColor: '#EADFB8', borderRadius: 12, padding: 11, marginTop: 10 },
  instructionsLabel: { color: '#8A6D1F', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  instructionsText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  care: { borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 8 },
  careMedical: { backgroundColor: '#FDEEEE', borderColor: '#E8BFBF' },
  careBehavior: { backgroundColor: '#F1F4EE', borderColor: '#CFD8C6' },
  careLabel: { color: colors.forest700, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  careLabelMedical: { color: colors.urgency },
  careText: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  action: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 120 },
  actionDark: { backgroundColor: colors.forest700 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  actionProblem: { backgroundColor: '#FBEAE6' },
  actionProblemText: { color: colors.urgency, fontWeight: '900', fontSize: 13 },
  actionNotify: { backgroundColor: colors.sage },
  actionNotifyText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  actionLate: { backgroundColor: '#F3D9A4' },
  actionLateText: { color: '#7A5B12', fontWeight: '900', fontSize: 13 },
});
