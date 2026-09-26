import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverAction, DriverStop } from '@/features/driver/DriverRouteView';
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';
import { colors, radii } from '@/features/theme/tokens';

/**
 * PAINEL "NEXT STOP" — o herói do topo da tela do motorista.
 *
 * POR QUE EXISTE (pedido do dono, 25/09/2026): "depois de otimizada a rota tenha um lugar mostrando o
 * próximo cachorro e o botão pra dar a localização... botão pra informar que cheguei... e tirar foto do
 * cachorro". Depois de otimizar, o motorista tinha que caçar o cão certo no meio da lista e o botão de
 * chegada ainda sumia conforme a parada avançava de status. Aqui a PRÓXIMA parada e as três ações
 * primárias ficam sempre no mesmo lugar, na ordem do dia.
 *
 * O QUE ESTE COMPONENTE NÃO FAZ: não fala com rede/banco de dados, não grava status, não mexe na fila
 * offline e não inventa estado novo. Ele é só a tela — quem grava é o `act` de `app/(tabs)/driver.tsx`,
 * o MESMO handler dos botões da lista. Assim não existe um segundo caminho de escrita que possa divergir
 * do primeiro (foto, status e sincronização continuam acontecendo exatamente como antes).
 */

/**
 * Próxima ação do dia para uma parada, estado por estado. É o MESMO caminho que os botões da lista já
 * percorrem em `features/driver/DriverRouteView.tsx` (pending -> Arrived, arrived -> Dog picked up,
 * picked_up -> Completed) — nenhum status novo é criado aqui.
 */
export function nextActionForStatus(status: DriverStop['status']): DriverAction | null {
  if (status === 'pending') return 'arrived';
  if (status === 'arrived') return 'picked_up';
  if (status === 'picked_up') return 'completed';
  return null;
}

/** Rótulo do botão da próxima ação, na ordem do dia (texto do motorista, não o nome do status). */
export const NEXT_ACTION_LABEL: Partial<Record<DriverAction, string>> = {
  arrived: 'I arrived',
  picked_up: 'Dog picked up',
  completed: 'Complete',
};

/**
 * Próxima parada do dia: a de MENOR `sequence` que ainda não foi resolvida.
 *
 * "Resolvida" usa a MESMA definição do resto do app (ver `nextStopEta` em features/driver/eta e
 * `resolvido` em features/driver/tasks): `completed` OU `skipped`. Uma parada marcada como problema
 * ('skipped' é o que o botão Problem grava) já saiu da fila do motorista — mostrá-la como "próximo cão"
 * mandaria o motorista de volta para uma casa que ele já reportou como impossível.
 */
export function nextStopFor(stops: DriverStop[]): DriverStop | null {
  return (
    [...stops]
      .filter((stop) => stop.status !== 'completed' && stop.status !== 'skipped')
      .sort((a, b) => a.sequence - b.sequence)[0] ?? null
  );
}

type Props = {
  /** Próxima parada da rota (null = nada pendente: rota terminada). */
  stop: DriverStop | null;
  /** Próxima ação do dia para esta parada (`nextActionForStatus`). */
  nextAction: DriverAction | null;
  /** Abre o seletor de app de mapa do sistema — MESMO handler do "Navigate" da lista. */
  onNavigate: (stop: DriverStop) => void;
  /** Executa a ação no MESMO `act` da tela do motorista (status, foto e fila offline saem de lá). */
  onAction: (stopId: string, action: DriverAction) => void;
};

export function NextStopCard({ stop, nextAction, onNavigate, onAction }: Props) {
  // Sem parada pendente: o painel continua no topo (o motorista não procura botão que não existe mais),
  // mas sem nenhuma ação — nada de oferecer passo para uma rota que acabou.
  if (!stop) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Text style={styles.eyebrow}>NEXT STOP</Text>
        <Text style={styles.title}>Route finished</Text>
        <Text style={styles.body}>Every dog in today&apos;s route is done. The office can see your progress.</Text>
      </View>
    );
  }

  const endereco = [stop.address, stop.city].filter(Boolean).join(' · ');
  const atraso = stop.lateMinutes ?? 0;
  const minutos = stop.etaMinutes;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>NEXT STOP</Text>
      <Text style={styles.title}>{stop.clientName} · {stop.dogName}</Text>
      {endereco ? <Text style={styles.address}>{endereco}</Text> : null}
      {minutos != null ? (
        <Text style={[styles.eta, atraso > 0 && styles.etaLate]}>
          {minutos <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${minutos} min away` : 'far from your stops'}
          {atraso > 0 ? ` · ${atraso} min late` : ''}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {/* 1) NAVEGAR — reusa o handler de navegação da lista (abre o mapa escolhido pelo motorista). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Next stop: navigate to ${stop.dogName}`}
          onPress={() => onNavigate(stop)}
          style={[styles.action, styles.actionDark]}
        >
          <Text style={styles.actionDarkText}>Navigate</Text>
        </Pressable>
        {/* 2) "I ARRIVED" (ou o passo seguinte do dia, já que a parada pode estar mais adiante). */}
        {nextAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Next stop: ${NEXT_ACTION_LABEL[nextAction] ?? nextAction} for ${stop.dogName}`}
            onPress={() => onAction(stop.id, nextAction)}
            style={[styles.action, styles.actionGold]}
          >
            <Text style={styles.actionGoldText}>{NEXT_ACTION_LABEL[nextAction] ?? nextAction}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Cartão do herói: papel do app com borda dourada para o motorista achar sem procurar. */
  card: { backgroundColor: colors.paper, borderRadius: radii.large, borderWidth: 2, borderColor: colors.gold, padding: 15, marginBottom: 12 },
  /** Rota terminada: mesmo formato, sem o destaque dourado (não há nada a fazer aqui). */
  cardDone: { borderWidth: 1, borderColor: colors.line },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: colors.forest900, fontFamily: 'serif', fontSize: 19, fontWeight: '800', marginTop: 4 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  address: { color: colors.ink, fontSize: 13, marginTop: 5 },
  eta: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 4 },
  etaLate: { color: colors.urgency },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  /** Mesmas medidas dos botões da lista (DriverRouteView) para o toque não mudar de tamanho na tela. */
  action: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 110 },
  actionDark: { backgroundColor: colors.forest700 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  actionPhoto: { backgroundColor: colors.sage },
  actionPhotoText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  actionDisabled: { opacity: 0.45 },
  hint: { color: colors.muted, fontSize: 11, marginTop: 8 },
});
