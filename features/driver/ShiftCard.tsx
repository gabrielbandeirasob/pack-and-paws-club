/**
 * Cartão da JORNADA do motorista (clock in / clock out) — ESTADOS COM JORNADA.
 *
 * Pedido do cliente (áudio de 16/09/2026): "quando o driver chegar, ele tem que dar o clock in e
 * depois o clock out". No dia normal ele NÃO aperta nada — a jornada é deduzida dos eventos da
 * rota. Os botões existem para a exceção (esqueceu, imprevisto) e por isso pedem MOTIVO.
 *
 * Desde o redesenho do estado PRÉ-CLOCK-IN (05/10/2026), o cartão de INÍCIO (sem jornada nenhuma) é
 * o `StartStateCard`; este aqui cobre a jornada ABERTA (clock out / Start pick-ups) e FECHADA. A
 * folha do motivo é compartilhada (`ManualReasonSheet`).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManualReasonSheet } from '@/features/driver/ManualReasonSheet';
import { durationText, shiftLabel, type ShiftState } from '@/features/driver/shift';
import { colors } from '@/features/theme/tokens';

type Props = {
  state: ShiftState;
  routeStarted?: boolean;
  /** registros que estão na fila local (sem sinal) e ainda vão subir */
  pendingCount?: number;
  busy?: boolean;
  error?: string | null;
  /**
   * Onde o clock in abre (sede/van cadastrada pelo gestor — migration 034). Nulo = organização sem
   * sede: o cartão fica exatamente como sempre foi, sem nenhuma menção a van.
   */
  gateHint?: string | null;
  /**
   * A trava da van RECUSOU o clock in porque o motorista está fora do raio. Quando vem preenchido,
   * o cartão oferece o registro COMO EXCEÇÃO — foi o que faltava para o dia não terminar sem jornada
   * nenhuma (relato do cliente em 01/10/2026). A distância entra no motivo gravado, então o gestor VÊ
   * a exceção no relatório de horas.
   */
  foraDaVan?: { distanceKm: number; vanName: string } | null;
  /** Navigate independently of the clock-in radius or pending shift writes. */
  navigation?: { kind: 'van' | 'yard'; onPress: () => void };
  /**
   * START PICK-UPS (dono, 03/10/2026): o caminho de volta para a fila de busca depois do ponto batido
   * na van. A tela decide QUANDO ele existe (jornada aberta, perna de busca, cão ainda para buscar) e
   * passa só o FOCO — este cartão não grava nada.
   */
  onStartPickups?: () => void;
  /** A tela mantém a condição existente de buscas concluídas e entregas pendentes. */
  onStartDropoffs?: () => void;
  /**
   * Rótulo VISÍVEL da virada, decidido pela TELA. No passo do YARD (`to_yard`) a tela passa
   * `I'm at the yard — start drop-offs` para deixar a ORDEM clara (sequência do dono, 03/10/2026).
   * O `accessibilityLabel` continua `Start drop-offs` DE PROPÓSITO: é o nome estável para leitores de
   * tela e para os testes que casam por role/name.
   */
  dropoffsLabel?: string;
  onClockIn: (reason: string) => void;
  onClockOut: (reason: string) => void;
  /** Registro de exceção pedido pelo motorista depois da recusa (grava a distância no motivo). */
  onClockInAnyway?: (reason: string) => void;
};

export function ShiftCard({ state, routeStarted = false, pendingCount = 0, busy = false, error, gateHint = null, foraDaVan = null, navigation, onStartPickups, onStartDropoffs, dropoffsLabel, onClockIn, onClockOut, onClockInAnyway }: Props) {
  const [pedindo, setPedindo] = useState<'in' | 'out' | 'in-fora' | null>(null);
  const [details, setDetails] = useState(false);

  const aberta = state.kind === 'open';

  return (
    <View style={styles.card} testID="cartao-jornada">
      <View style={styles.topo}>
        <Text style={styles.eyebrow}>JOURNEY</Text>
        <Text style={styles.titulo}>{aberta ? `Clocked in · ${durationText(state.minutes)}` : shiftLabel(state)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Journey details" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={styles.details}><Text style={styles.botaoTexto}>Details</Text></Pressable>
        {pendingCount > 0 ? <Text style={styles.pendente}>{pendingCount} to sync</Text> : null}
      </View>
      {details ? <Text style={styles.dica}>
        {state.source === 'route'
          ? 'Worked out from your route stops — nothing to press.'
          : state.manualOpen
            ? 'Manual journey (exception): this one was entered by hand.'
            : 'Manual record for today.'}
      </Text> : null}
      {/* SEM `numberOfLines`: o aviso nunca é cortado com "...". */}
      {gateHint ? <Text style={styles.gateHint}>{gateHint}</Text> : null}

      <View style={styles.acoes}>
        {navigation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Navigate to ${navigation.kind}`}
            onPress={navigation.onPress}
            style={({ pressed }) => [styles.botao, styles.secundario, pressed && styles.pressed]}
          >
            <Text style={[styles.botaoTexto, styles.navegarTexto]}>Navigate to {navigation.kind}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={aberta ? 'Clock out' : 'Clock in'}
          disabled={busy}
          onPress={() => setPedindo(aberta ? 'out' : 'in')}
          style={({ pressed }) => [styles.botao, !aberta && styles.botaoPrincipal, pressed && styles.pressed, busy && styles.desabilitado]}
        >
          <Text style={[styles.botaoTexto, !aberta && styles.botaoTextoPrincipal]}>
            {aberta ? `Clock out · ${durationText(state.minutes)}` : 'Clock in'}
          </Text>
        </Pressable>
      </View>

      {/*
        * START PICK-UPS (dono, 03/10/2026): o atalho de volta para a lista depois que o ponto foi
        * batido na van. Fica ACIMA do "Start drop-offs" porque é sempre o passo anterior do dia.
        */}
      {onStartPickups ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start pick-ups"
          onPress={onStartPickups}
          style={[styles.iniciarBuscas, routeStarted && { backgroundColor: colors.sage }]}
          testID="start-pickups"
        >
          <Text style={[styles.iniciarBuscasTexto, routeStarted && { color: colors.forest900 }]}>{routeStarted ? 'On route · View next stop' : 'Start Route'}</Text>
        </Pressable>
      ) : null}

      {onStartDropoffs ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start drop-offs"
          onPress={onStartDropoffs}
          style={styles.iniciarEntregas}
          testID="start-dropoffs"
        >
          <Text style={styles.iniciarEntregasTexto}>{dropoffsLabel ?? 'Start drop-offs'}</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={styles.erro}>{error}</Text> : null}

      {/* SAÍDA DE EXCEÇÃO: a van é o caminho normal, mas ninguém fica sem jornada. O motivo continua
          obrigatório e o texto gravado leva a distância (o gestor vê a exceção no relatório de horas). */}
      {foraDaVan && onClockInAnyway ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clock in anyway"
          disabled={busy}
          onPress={() => setPedindo('in-fora')}
          style={({ pressed }) => [styles.botaoExcecao, pressed && styles.pressed, busy && styles.desabilitado]}
        >
          <Text style={styles.botaoExcecaoTexto}>Clock in anyway · outside the van</Text>
        </Pressable>
      ) : null}

      <ManualReasonSheet
        visible={pedindo !== null}
        kind={pedindo ?? 'in'}
        foraDaVan={foraDaVan}
        busy={busy}
        onConfirm={(reason) => {
          setPedindo(null);
          if (pedindo === 'out') onClockOut(reason);
          else if (pedindo === 'in-fora') onClockInAnyway?.(reason);
          else onClockIn(reason);
        }}
        onClose={() => setPedindo(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 8, marginBottom: 8 },
  topo: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  details: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  eyebrow: { color: colors.forest700, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  pendente: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  titulo: { color: colors.forest900, fontSize: 13, fontWeight: '600' },
  dica: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  /** Onde o clock in abre (só existe quando a organização cadastrou a sede/van). Nunca truncado. */
  gateHint: { color: '#7A5B12', backgroundColor: '#FBF0D9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: '800', marginTop: 8, lineHeight: 17 },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 11 },
  botao: { flex: 1, borderRadius: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  botaoPrincipal: { backgroundColor: colors.forest700, borderWidth: 1, borderColor: colors.forest700 },
  /** "Navigate to van/yard": secundário OUTLINED, não texto solto. */
  secundario: { borderWidth: 1.5, borderColor: colors.forest700, backgroundColor: colors.paper },
  botaoExcecao: { borderWidth: 1.5, borderColor: colors.urgency, borderRadius: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 8 },
  botaoExcecaoTexto: { color: colors.urgency, fontWeight: '900', fontSize: 12.5 },
  botaoTexto: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  navegarTexto: { textAlign: 'center', paddingHorizontal: 6 },
  /** Start pick-ups: o passo da MANHÃ (verde cheio) — o dourado fica para a virada do dia. */
  iniciarBuscas: { backgroundColor: colors.forest700, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 15, alignItems: 'center', minWidth: 120, marginTop: 8 },
  iniciarBuscasTexto: { color: 'white', fontWeight: '900', fontSize: 13 },
  iniciarEntregas: { backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 15, alignItems: 'center', minWidth: 120, marginTop: 8 },
  iniciarEntregasTexto: { color: colors.forest900, fontWeight: '900', fontSize: 13 },
  botaoTextoPrincipal: { color: 'white' },
  erro: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 9, lineHeight: 17 },
  pressed: { opacity: 0.85 },
  desabilitado: { opacity: 0.5 },
});
