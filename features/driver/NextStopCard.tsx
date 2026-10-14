import { clockText } from '@/features/driver/shift';
import { proximaParadaDoDia } from '@/features/driver/dayOrder';
import { dogPhotoThumbnailUrl } from '@/features/dogs/dogPhoto';
import { useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverAction, DriverStop } from '@/features/driver/DriverRouteView';
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';
import { notifyButtonState } from '@/features/driver/etaMessage';
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
 * Próxima ação do dia para uma parada, estado por estado. É o MESMO caminho que os botões da lista
 * percorrem em `features/driver/DriverRouteView.tsx`.
 *
 * FLUXO CURTO (pedido do dono, 30/09/2026 — "I arrived e next. Talvez dois cliques"): o ciclo de uma
 * parada passou a ser 2 toques. O 1º é 'arrived'; o 2º é 'finish', que grava pegou + concluiu de uma
 * vez (dois registros, hora do servidor). A parada que já estava em 'picked_up' (rota antiga ou um
 * 2º toque que ficou pela metade) usa o MESMO 'finish' para fechar — nada de status novo.
 *
 * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5): depois do pick-up a parada está `completed`
 * mas o cão está NA VAN — falta entregar. `deliver` é o toque da tarde, que grava `delivered_at`
 * (migração 041). Sem ele o app dava o dia por terminado depois da última busca, às 9 da manhã.
 */
export function nextActionForStatus(status: DriverStop['status'], deliveredAt?: string | null): DriverAction | null {
  if (status === 'pending') return 'arrived';
  if (status === 'arrived') return 'finish';
  if (status === 'picked_up') return 'finish';
  if (status === 'completed' && !deliveredAt) return 'deliver';
  return null;
}

/**
 * AS SAÍDAS do dia para uma parada, na ordem. Na BUSCA é uma saída por toque. Na ENTREGA
 * (`deliver`) são DUAS: confirmar (Delivered) OU reportar problema — o tutor não estava em casa.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): durante a entrega existia só o botão 'Delivered'. Se o tutor
 * não estivesse em casa o motorista não tinha como registrar a falha — o caminho de "Problem"
 * existia só na chegada ('arrived'). O dia nunca fechava e o cão ficava preso na van. Agora a
 * entrega expõe as duas saídas, exatamente como a lista.
 */
export function nextActionsForStatus(status: DriverStop['status'], deliveredAt?: string | null): DriverAction[] {
  const principal = nextActionForStatus(status, deliveredAt);
  if (!principal) return [];
  // Cão já na van (pick-up feito, entrega pendente): o motorista pode entregar OU apontar problema.
  const naEntrega = !deliveredAt && (status === 'picked_up' || status === 'completed');
  return naEntrega ? [principal, 'problem'] : [principal];
}

/** Rótulo do botão da próxima ação, na ordem do dia (texto do motorista, não o nome do status). */
export const NEXT_ACTION_LABEL: Partial<Record<DriverAction, string>> = {
  arrived: 'I arrived',
  finish: 'Next',
  deliver: 'Delivered',
};

/** Rótulo das saídas SECUNDÁRIAS do cartão (a segunda saída da entrega: reportar problema). */
export const SECONDARY_ACTION_LABEL: Partial<Record<DriverAction, string>> = {
  problem: 'Problem',
};

/**
 * Próxima parada do dia: busca pendente primeiro; após as buscas, entrega publicada.
 *
 * "Resolvida" usa a MESMA definição do resto do app (ver `nextStopEta` em features/driver/eta e
 * `resolvido` em features/driver/tasks): `completed` OU `skipped`. Uma parada marcada como problema
 * ('skipped' é o que o botão Problem grava) já saiu da fila do motorista — mostrá-la como "próximo cão"
 * mandaria o motorista de volta para uma casa que ele já reportou como impossível.
 */
export function nextStopFor(stops: DriverStop[]): DriverStop | null {
  return proximaParadaDoDia(stops);
}

type Props = {
  /** Próxima parada da rota (null = nada pendente: rota terminada). */
  stop: DriverStop | null;
  positionLabel?: string;
  phase?: 'pickup' | 'dropoff';
  /** Próxima ação do dia para esta parada (`nextActionForStatus`). */
  nextAction: DriverAction | null;
  /** Abre o seletor de app de mapa do sistema — MESMO handler do "Navigate" da lista. */
  onNavigate: (stop: DriverStop) => void;
  /** Executa a ação no MESMO `act` da tela do motorista (status, foto e fila offline saem de lá). */
  onAction: (stopId: string, action: DriverAction) => void;
  /**
   * Avisar o tutor (SMS com o ETA). Fica TAMBÉM aqui, no cartão grande da próxima parada, porque foi
   * aqui que o dono olhou e não achou (01/10/2026: *"n vi essa opçao"*) — o botão existia só na lista,
   * mais abaixo. Sem a prop o cartão fica como era.
   */
  onNotifyOwner?: (stop: DriverStop) => void;
};

export function NextStopCard({ stop, nextAction, onNavigate, onAction, onNotifyOwner, positionLabel, phase }: Props) {
  /** Foto do cão ampliada (pedido do dono, 02/10/2026): toque na miniatura abre em tela cheia. */
  const [fotoAberta, setFotoAberta] = useState(false);
  const [navigatedId, setNavigatedId] = useState<string | null>(null);
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

  const navigatePrimary = !nextAction || (nextAction === 'arrived' && navigatedId !== stop.id);
  const visibleAction = nextAction === 'finish' ? 'Complete pickup' : nextAction === 'deliver' ? 'Complete drop-off' : "I've arrived";
  const endereco = [stop.address, stop.city].filter(Boolean).join(' · ');
  /**
   * MINIATURA (auditoria de desempenho, 02/10/2026): a foto aparece em 64 pt, mas o bucket servia a
   * imagem ORIGINAL (1320x1320, ate ~207 KB). Aqui a source passa pela transformacao do Storage e cai
   * para ~12 KB. A foto GRANDE do modal continua na URL original (e ali que "ver maior" tem sentido).
   */
  const miniatura = dogPhotoThumbnailUrl(stop.dogPhotoUrl);
  const atraso = stop.lateMinutes ?? 0;
  const minutos = stop.etaMinutes;
  /*
   * AVISAR O TUTOR no cartão grande (o dono procurou aqui e não achou, 01/10/2026: *"n vi essa opçao"*).
   * Mesma regra da lista — quem decide rótulo e permissão é `notifyButtonState` —, mas AQUI o botão
   * aparece SEMPRE: desabilitado e com o motivo embaixo quando não dá para avisar. Antes ele simplesmente
   * não existia no cartão, e o motorista ficava sem saber se o app faz isso ou não.
   */
  const aviso = notifyButtonState({
    phone: stop.clientPhone ?? stop.clientPhone2,
    lateMinutes: stop.lateMinutes,
    done: Boolean(stop.deliveredAt) || stop.status === 'skipped',
  });
  /**
   * SAÍDAS que não são a principal. Na entrega, a segunda saída é o 'Problem' (o tutor não estava
   * em casa) — sem ela o motorista ficava sem fechar o dia (achado da vistoria, 02/10/2026).
   */
  const secundarias = nextAction
    ? nextAction === 'deliver' || stop.status === 'arrived' ? ['problem' as const] : nextActionsForStatus(stop.status, stop.deliveredAt).filter((acao) => acao !== nextAction)
    : [];

  return (
    <View testID="active-stop-card" style={styles.card}>
      <View style={styles.stopHeading}><Text style={styles.eyebrow}>{positionLabel ?? 'NEXT STOP'}</Text><Text style={styles.badge}>{phase === 'dropoff' || nextAction === 'deliver' ? 'DROP-OFF' : 'PICK-UP'}</Text></View>
      <View style={styles.dogRow}>
        {/* FOTO DO CÃO (pedido do dono, 02/10/2026): é o que confirma o cão certo na porta. Toca nela
            para ver grande — na rua, com sol, o polegar decide. Sem foto no cadastro, nada aparece. */}
        {miniatura ? (
          <Pressable
            onPress={() => setFotoAberta(true)}
            accessibilityRole="button"
            accessibilityLabel={`Photo of ${stop.dogName} — tap to see it bigger`}
            hitSlop={8}
          >
            <Image source={{ uri: miniatura }} style={styles.dogPhoto} accessibilityLabel={`Photo of ${stop.dogName}`} />
          </Pressable>
        ) : null}
        <View style={styles.dogTextBox}>
          <Text style={styles.title}>{stop.dogName}</Text>
          {endereco ? <Text style={styles.address}>{endereco}</Text> : null}
          {minutos != null ? (
            <Text style={[styles.eta, atraso > 0 && styles.etaLate]}>
              {minutos <= ETA_MAXIMO_PLAUSIVEL_MIN ? `~${minutos} min away` : 'far from your stops'}
              {atraso > 0 ? ` · ${atraso} min late` : ''}
            </Text>
          ) : null}
          {minutos != null && minutos >= 0 && minutos <= ETA_MAXIMO_PLAUSIVEL_MIN ? <Text style={styles.eta}>ETA ~{clockText(new Date(Date.now() + minutos * 60000).toISOString())}</Text> : null}
        </View>
      </View>
      {stop.instructions ? <Text style={styles.safety}>Access · {stop.instructions}</Text> : null}
      {stop.medicalNotes ? <Text style={styles.safety}>Medical · {stop.medicalNotes}</Text> : null}
      {stop.behaviorNotes ? <Text style={styles.safety}>Behavior · {stop.behaviorNotes}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" testID="stop-primary"
          accessibilityLabel={navigatePrimary ? `Next stop: navigate to ${stop.dogName}` : `Next stop: ${NEXT_ACTION_LABEL[nextAction!] ?? nextAction} for ${stop.dogName}`}
          onPress={() => { if (navigatePrimary) { setNavigatedId(stop.id); onNavigate(stop); } else if (nextAction) onAction(stop.id, nextAction); }}
          style={[styles.action, styles.actionDark]}>
          <Text style={styles.actionDarkText}>{navigatePrimary ? 'Navigate' : visibleAction}</Text>
        </Pressable>
        {navigatePrimary && nextAction ? <Pressable accessibilityRole="button"
          accessibilityLabel={`Next stop: ${NEXT_ACTION_LABEL[nextAction] ?? nextAction} for ${stop.dogName}`}
          onPress={() => onAction(stop.id, nextAction)} style={[styles.action, styles.actionSecondary]}>
          <Text style={styles.actionNotifyText}>{visibleAction}</Text>
        </Pressable> : !navigatePrimary ? <Pressable accessibilityRole="button" accessibilityLabel={`Next stop: navigate to ${stop.dogName}`}
          onPress={() => onNavigate(stop)} style={[styles.action, styles.actionSecondary]}>
          <Text style={styles.actionNotifyText}>Navigate</Text>
        </Pressable> : null}
        {/* 2b) A SEGUNDA SAÍDA da entrega: reportar problema (tutor não estava em casa). */}
        {secundarias.map((acao) => (
          <Pressable
            key={acao}
            accessibilityRole="button"
            accessibilityLabel={`Next stop: ${SECONDARY_ACTION_LABEL[acao] ?? acao} for ${stop.dogName}`}
            onPress={() => onAction(stop.id, acao)}
            style={[styles.action, styles.actionSecondary]}
          >
            <Text style={styles.actionProblemText}>Report issue</Text>
          </Pressable>
        ))}
        {/* 3) AVISAR O TUTOR — o mesmo SMS da lista, aqui onde o motorista já está olhando. */}
        {onNotifyOwner ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !aviso.enabled }}
            accessibilityLabel={`Next stop: notify owner ${stop.dogName}`}
            disabled={!aviso.enabled}
            onPress={() => onNotifyOwner(stop)}
            style={[styles.action, styles.actionSecondary, !aviso.enabled && styles.actionOff]}
          >
            <Text style={aviso.tone === 'late' ? styles.actionLateText : styles.actionNotifyText}>
              {aviso.tone === 'late' ? 'Message owner · late' : 'Message owner'}
            </Text>
          </Pressable>
        ) : null}
        {stop.clientPhone || stop.clientPhone2 ? <Pressable accessibilityRole="button" accessibilityLabel={`Call owner ${stop.dogName}`}
          style={[styles.action, styles.actionSecondary]} onPress={() => void Linking.openURL(`tel:${encodeURIComponent(stop.clientPhone ?? stop.clientPhone2 ?? '')}`).catch(() => Alert.alert('Call unavailable', 'Please check that this device can make phone calls.'))}>
          <Text style={styles.actionNotifyText}>Call owner</Text>
        </Pressable> : null}
      </View>
      {/* FOTO AMPLIADA (pedido do dono, 02/10/2026): fundo escuro, cão inteiro no centro e o nome
          embaixo — é o que o motorista confere na porta. Tocar em qualquer lugar fecha. */}
      {stop.dogPhotoUrl ? (
        <Modal visible={fotoAberta} transparent animationType="fade" onRequestClose={() => setFotoAberta(false)}>
          <Pressable
            style={styles.photoBackdrop}
            onPress={() => setFotoAberta(false)}
            accessibilityRole="button"
            accessibilityLabel={`Bigger photo of ${stop.dogName} — tap to close`}
          >
            <Image testID="next-stop-photo-full" source={{ uri: stop.dogPhotoUrl }} style={styles.photoFull} resizeMode="contain" />
            <Text testID="next-stop-photo-caption" style={styles.photoCaption}>{stop.dogName}</Text>
            <Text style={styles.photoHint}>Tap anywhere to close</Text>
          </Pressable>
        </Modal>
      ) : null}
      {onNotifyOwner && aviso.hint ? <Text style={styles.notifyHint}>{aviso.hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Cartão do herói: papel do app com borda dourada para o motorista achar sem procurar. */
  card: { backgroundColor: colors.paper, borderRadius: radii.large, padding: 16, marginBottom: 12 },
  /** Rota terminada: mesmo formato, sem o destaque dourado (não há nada a fazer aqui). */
  safety: { color: colors.ink, fontSize: 14, marginTop: 8 },
  stopHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  badge: { color: colors.forest700, backgroundColor: colors.sage, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, fontSize: 12, fontWeight: '700' },
  actionSecondary: { backgroundColor: 'transparent', minHeight: 44 },
  cardDone: { borderWidth: 1, borderColor: colors.line },
  eyebrow: { color: colors.forest700, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  /** Linha do cão: miniatura tocável à esquerda; nome, endereço e ETA à direita. */
  dogRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  /** Miniatura da foto: 64 pt (acima dos 44 pt de alvo de toque), cantos 12 e borda fina. */
  dogPhoto: { width: 64, height: 64, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.sage },
  dogTextBox: { flex: 1 },
  /** Foto ampliada: fundo escuro (tela na rua, com sol) e o cão inteiro no centro. */
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(12,20,14,0.94)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  photoFull: { width: '100%', height: '72%' },
  photoCaption: { color: 'white', fontFamily: 'serif', fontSize: 20, fontWeight: '800', marginTop: 14 },
  photoHint: { color: 'rgba(255,255,255,0.72)', fontSize: 13, marginTop: 6 },
  title: { color: colors.forest900, fontSize: 24, fontWeight: '800', marginTop: 4 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  address: { color: colors.ink, fontSize: 16, marginTop: 8 },
  eta: { color: colors.forest700, fontSize: 12, fontWeight: '800', marginTop: 4 },
  etaLate: { color: colors.urgency },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  /** Mesmas medidas dos botões da lista (DriverRouteView) para o toque não mudar de tamanho na tela. */
  action: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 15, flexGrow: 1, alignItems: 'center', minWidth: 110 },
  actionDark: { backgroundColor: colors.forest700, width: '100%', minHeight: 56 },
  actionDarkText: { color: 'white', fontWeight: '900', fontSize: 13 },
  /** Avisar o tutor: sage quando é só o ETA, âmbar quando já está atrasado (cores da lista). */
  actionNotify: { backgroundColor: colors.sage },
  actionNotifyText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  actionLate: { backgroundColor: '#F3D9A4' },
  actionLateText: { color: '#7A5B12', fontWeight: '900', fontSize: 13 },
  /** Sem telefone no cadastro: o botão fica visível, apagado, com o motivo embaixo. */
  actionOff: { opacity: 0.5 },
  notifyHint: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 6 },
  actionGold: { backgroundColor: colors.gold },
  actionGoldText: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  /** A segunda saída da entrega (reportar problema): mesma família do "Problem" da lista. */
  actionProblem: { backgroundColor: '#FBEAE6' },
  actionProblemText: { color: colors.urgency, fontWeight: '900', fontSize: 13 },
  actionPhoto: { backgroundColor: colors.sage },
  actionPhotoText: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  actionDisabled: { opacity: 0.45 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
