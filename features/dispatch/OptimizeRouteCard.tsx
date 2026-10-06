/**
 * CARTÃO DO OPTIMIZE ROUTE — pedido do dono, 05/10/2026.
 *
 * Regra de negócio que o cartão anuncia (e que o otimizador passou a respeitar): as PONTAS são fixas.
 * **Pick-up: Van → paradas → Yard.** **Entrega: Yard → paradas → Van.** Van e Yard nunca entram no meio
 * da rota nem são reordenados — o otimizador mexe SÓ nas paradas de cliente.
 *
 * Por que existe (relato do dono): *"não consigo confirmar se está realmente fazendo a melhor rota"* e o
 * pedido literal *"Update the Optimize Route button/card so the dispatcher clearly understands what will
 * happen"*. Antes era um botão seco e a confirmação vinha por alerta depois de aplicar; agora o gestor lê
 * a estrutura ANTES de tocar, vê o estado enquanto roda ("Optimizing Route…" com rodinha e toque
 * desabilitado), lê o ganho depois ("Route Optimized ✓ · 18 min faster · 4.2 mi saved") e pode DESFAZER.
 *
 * Continua a mesma linguagem visual do Dispatch (papel, linha, verde da floresta), sem redesenhar a tela.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';

export type OptimizePhase = 'pickup' | 'dropoff';

export type OptimizeOutcome = {
  minutesBefore: number;
  minutesAfter: number;
  /** Quilômetros (linha reta) antes/depois — `null` quando falta coordenada para a conta. */
  kmBefore: number | null;
  kmAfter: number | null;
};

export type OptimizeCardState = {
  /** Otimização em voo: o botão vira "Optimizing Route…", mostra rodinha e não aceita toque repetido. */
  busy: boolean;
  result: OptimizeOutcome | null;
  /** Motivo legível quando não deu para otimizar (ex.: parada sem endereço/coordenada). */
  error: string | null;
  /** Há ordem anterior guardada para restaurar. */
  canUndo: boolean;
};

export const OPTIMIZE_STATE_INITIAL: OptimizeCardState = { busy: false, result: null, error: null, canUndo: false };

const MI_POR_KM = 0.621371;

/** "0.6 mi" / "12 mi" — milhas é a unidade do cliente (EUA). Ponto decimal, como o resto do app. */
export function milhas(km: number): string {
  const valor = km * MI_POR_KM;
  return `${valor < 10 ? valor.toFixed(1) : Math.round(valor)} mi`;
}

/**
 * A frase que diz o que o botão vai fazer: `Van → 7 pickups → Yard`.
 * Pick-up COMEÇA na van e TERMINA no yard; a entrega é o inverso (regra do dono, 05/10/2026).
 */
export function estruturaDaRota(
  phase: OptimizePhase,
  paradas: number,
  vanName: string,
  yardName: string,
): string {
  const alvo = `${paradas} ${paradas === 1 ? (phase === 'pickup' ? 'pickup' : 'drop-off') : phase === 'pickup' ? 'pickups' : 'drop-offs'}`;
  return phase === 'pickup' ? `${vanName} → ${alvo} → ${yardName}` : `${yardName} → ${alvo} → ${vanName}`;
}

/**
 * O ganho, do jeito que o dono pediu: *"18 min faster · 4.2 mi saved"*.
 *
 * Só afirma o que existe: sem distância (falta coordenada) sai só o tempo; sem ganho de tempo não diz
 * "faster"; e se a conta der PIOR (pode acontecer com janela/horário marcado, onde quem manda é o prazo)
 * o cartão diz a verdade — "+4 min" — em vez de comemorar.
 */
export function ganhoDaOtimizacao(result: OptimizeOutcome): string | null {
  const partes: string[] = [];
  const minutos = Math.round(result.minutesBefore - result.minutesAfter);
  if (minutos !== 0) partes.push(minutos > 0 ? `${minutos} min faster` : `${-minutos} min slower`);
  if (result.kmBefore != null && result.kmAfter != null) {
    const km = result.kmBefore - result.kmAfter;
    if (Math.abs(km) >= 0.05) partes.push(`${milhas(Math.abs(km))} ${km > 0 ? 'saved' : 'added'}`);
  }
  return partes.length > 0 ? partes.join(' · ') : null;
}

type Props = {
  phase: OptimizePhase;
  /**
   * Nome do motorista — entra no rótulo acessível do botão (`Optimize Rafael route`). Com mais de um
   * cartão na tela, "Optimize route" sozinho não distingue de quem é o botão (leitor de tela e testes).
   */
  driverName?: string;
  /** Paradas ELEGÍVEIS (o que o otimizador pode mover): sem concluídas, puladas ou canceladas. */
  paradas: number;
  vanName: string;
  yardName: string;
  state: OptimizeCardState;
  onOptimize: () => void;
  onUndo: () => void;
};

export function OptimizeRouteCard({ phase, driverName, paradas, vanName, yardName, state, onOptimize, onUndo }: Props) {
  const podeOtimizar = !state.busy && paradas >= 2;
  const rotulo = state.busy ? 'Optimizing Route…' : state.result ? 'Route Optimized ✓' : 'Optimize route';
  const ganho = state.result ? ganhoDaOtimizacao(state.result) : null;

  return (
    <View style={styles.card} testID="optimize-card">
      <View style={styles.topo}>
        <Text style={styles.titulo}>Optimize Route</Text>
        <Text numberOfLines={1} style={styles.estrutura} testID="optimize-structure">
          {estruturaDaRota(phase, paradas, vanName, yardName)}
        </Text>
      </View>

      {paradas < 2 && !state.busy ? (
        <Text style={styles.dica} testID="optimize-hint">
          {paradas === 0
            ? 'Every stop on this route is already done or skipped — there is nothing left to order.'
            : 'At least 2 stops are needed to optimize this route.'}
        </Text>
      ) : null}

      {state.error ? (
        <Text style={styles.erro} testID="optimize-error">{state.error}</Text>
      ) : null}

      <View style={styles.acoes}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={driverName
            ? (state.busy ? `Optimizing ${driverName} route` : `Optimize ${driverName} route`)
            : (state.busy ? 'Optimizing route' : 'Optimize route')}
          accessibilityState={{ disabled: !podeOtimizar, busy: state.busy }}
          disabled={!podeOtimizar}
          onPress={onOptimize}
          style={[styles.botao, !podeOtimizar && styles.botaoOff]}
          testID="optimize-button"
        >
          {state.busy ? <ActivityIndicator testID="optimize-spinner" size="small" color="#FFFFFF" /> : null}
          <Text numberOfLines={1} style={styles.botaoTexto}>{rotulo}</Text>
        </Pressable>
        {state.result && state.canUndo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo optimization"
            onPress={onUndo}
            style={styles.desfazer}
            testID="optimize-undo"
          >
            <Text style={styles.desfazerTexto}>Undo</Text>
          </Pressable>
        ) : null}
      </View>

      {state.result ? (
        <Text style={styles.resultado} testID="optimize-result">
          {ganho ?? 'Route already in the best order — no time saved.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    marginBottom: 8,
  },
  topo: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  titulo: { color: colors.forest900, fontSize: 13, fontWeight: '900' },
  estrutura: { flexShrink: 1, minWidth: 0, color: colors.muted, fontSize: 12, fontWeight: '700' },
  dica: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  erro: { color: colors.urgency, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  botao: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 9,
    paddingHorizontal: 12,
    backgroundColor: colors.forest500,
  },
  botaoOff: { backgroundColor: colors.muted, opacity: 0.6 },
  botaoTexto: { color: 'white', fontSize: 12, fontWeight: '900' },
  desfazer: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  desfazerTexto: { color: colors.forest700, fontSize: 12, fontWeight: '800' },
  resultado: { color: colors.success, fontSize: 12, fontWeight: '800' },
});
