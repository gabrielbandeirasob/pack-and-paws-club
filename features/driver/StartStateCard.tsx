/**
 * CARTÃO DE INÍCIO — o estado PRÉ-CLOCK-IN da tela do motorista.
 *
 * Pedido do dono: antes de bater o ponto a tela fica MÍNIMA. Saiu a linha administrativa da jornada
 * (`JOURNEY · Journey not started yet · Details`), o interruptor "Drive today" DESTA tela e as frases
 * repetidas; entrou UM cartão centralizado que diz onde o dia começa e oferece o clock in.
 *
 * Este componente é APRESENTAÇÃO: quem decide o estado (trava do clock in, distância, se está dentro
 * ou fora do raio) é a TELA (`app/(tabs)/driver.tsx`). Aqui só se desenha o que a tela passa —
 * inclusive o aviso de geofence, que é COMPACTO e nunca truncado (o dono recusou o "..."), com os
 * textos completos de antes preservados atrás do "Details".
 *
 * O cartão dos estados COM jornada (clocked in / em rota / fechamento) continua sendo o `ShiftCard`.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ManualReasonSheet } from '@/features/driver/ManualReasonSheet';
import { distanceTextCompacta, type ClockInGate } from '@/features/organization/locations';
import { colors, radii } from '@/features/theme/tokens';

export type StartStateCardProps = {
  /** Nome da van (`organization_locations.name`). null = organização sem van: nada de menção a van. */
  vanName?: string | null;
  /** Endereço da van (endereço + cidade). */
  address?: string | null;
  /** Resultado do portão do clock in. null = organização sem van: sem trava e sem aviso. */
  gate?: ClockInGate | null;
  /** O texto COMPLETO do aviso antigo — revelado pelo "Details", nunca some. */
  gateDetails?: string | null;
  /**
   * Idade legível da amostra de posição ("12 min ago"). Quando vem preenchida, o aviso diz que a
   * leitura é daquele momento — é o caso em que o botão NÃO é travado (`clockInDisabled` falso) porque
   * o GPS fresco do toque ainda pode liberar o clock in. Ver `amostraVencida` em `driver.tsx`.
   */
  gateAge?: string | null;
  /** O clock in está bloqueado agora (fora do raio). A TELA decide. */
  clockInDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  /** A exceção do dono para registrar fora da van (grava a distância no motivo). */
  foraDaVan?: { distanceKm: number; vanName: string } | null;
  navigation?: { kind: 'van' | 'yard'; onPress: () => void };
  onClockIn: (reason: string) => void;
  onClockInAnyway?: (reason: string) => void;
};

/** Texto do aviso de geofence — compacto, uma linha, sem reticências. */
function avisoCompacto(gate: ClockInGate | null | undefined, idade: string | null | undefined): string | null {
  if (!gate || gate.kind === 'no-location') return null;
  if (gate.kind === 'outside') {
    // A idade entra entre parênteses quando a leitura é de um momento anterior: com amostra vencida o
    // botão NÃO é travado (o GPS do toque decide), então o aviso não pode afirmar "agora".
    const quando = idade ? ` (${idade})` : '';
    return `⚠ Outside clock-in area   ${distanceTextCompacta(gate.distanceKm ?? 0)} away${quando} · Clock-in available within ${gate.radiusMeters} m`;
  }
  if (gate.kind === 'inside') return '✓ You are at the van — clock in is open.';
  return 'Position unavailable — clock in is allowed.';
}

export function StartStateCard({
  vanName = null,
  address = null,
  gate = null,
  gateDetails = null,
  gateAge = null,
  clockInDisabled = false,
  busy = false,
  error = null,
  foraDaVan = null,
  navigation,
  onClockIn,
  onClockInAnyway,
}: StartStateCardProps) {
  const [pedindo, setPedindo] = useState<null | 'in' | 'in-fora'>(null);
  const [detalhes, setDetalhes] = useState(false);

  const aviso = avisoCompacto(gate, gateAge);
  const raio = gate?.radiusMeters ?? null;

  return (
    <View style={styles.card} testID="cartao-inicio">
      <Text style={styles.titulo}>Ready to start</Text>
      {vanName ? <Text style={styles.van}>Start your day at {vanName}</Text> : null}
      {address ? <Text style={styles.endereco}>{address}</Text> : null}

      {aviso ? (
        <View style={styles.avisoWrap}>
          {/* SEM `numberOfLines`: aviso operacional nunca é cortado com "...". */}
          <Text testID="gate-warning" style={styles.aviso}>{aviso}</Text>
          {gateDetails ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clock-in area details"
              accessibilityState={{ expanded: detalhes }}
              onPress={() => setDetalhes(!detalhes)}
              style={styles.details}
            >
              <Text style={styles.detailsTexto}>Details</Text>
            </Pressable>
          ) : null}
          {detalhes && gateDetails ? <Text testID="gate-warning-details" style={styles.avisoDetalhe}>{gateDetails}</Text> : null}
        </View>
      ) : null}

      <View style={styles.acoes}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clock in"
          accessibilityState={{ disabled: clockInDisabled || busy }}
          disabled={clockInDisabled || busy}
          onPress={() => setPedindo('in')}
          style={({ pressed }) => [styles.botao, styles.primario, (clockInDisabled || busy) && styles.apagado, pressed && styles.pressed]}
        >
          <Text style={styles.primarioTexto}>{clockInDisabled ? 'Clock in 🔒' : 'Clock in'}</Text>
        </Pressable>
        {navigation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Navigate to ${navigation.kind}`}
            onPress={navigation.onPress}
            style={({ pressed }) => [styles.botao, styles.secundario, pressed && styles.pressed]}
          >
            <Text style={styles.secundarioTexto}>Navigate to {navigation.kind}</Text>
          </Pressable>
        ) : null}
      </View>

      {clockInDisabled && raio != null && vanName ? (
        <Text testID="clock-in-radius-hint" style={styles.dicaRaio}>Available within {raio} m of {vanName}</Text>
      ) : null}

      {error ? <Text style={styles.erro}>{error}</Text> : null}

      {/* SAÍDA DE EXCEÇÃO: a van é o caminho normal, mas ninguém fica sem jornada. */}
      {foraDaVan && onClockInAnyway ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clock in anyway"
          disabled={busy}
          onPress={() => setPedindo('in-fora')}
          style={({ pressed }) => [styles.excecao, busy && styles.apagado, pressed && styles.pressed]}
        >
          <Text style={styles.excecaoTexto}>Clock in anyway · outside the van</Text>
        </Pressable>
      ) : null}

      <ManualReasonSheet
        visible={pedindo !== null}
        kind={pedindo === 'in-fora' ? 'in-fora' : 'in'}
        foraDaVan={foraDaVan}
        busy={busy}
        onConfirm={(motivo) => {
          setPedindo(null);
          if (pedindo === 'in-fora') onClockInAnyway?.(motivo);
          else onClockIn(motivo);
        }}
        onClose={() => setPedindo(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', paddingVertical: 14, gap: 4 },
  titulo: { color: colors.forest700, fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
  van: { color: colors.forest900, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  endereco: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  avisoWrap: { alignSelf: 'stretch', marginTop: 8, alignItems: 'center' },
  /** Uma linha, compacta, sem `numberOfLines` e sem `overflow` que corte. */
  aviso: { color: '#7A5B12', backgroundColor: '#FBF0D9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 12, fontWeight: '800', lineHeight: 17, textAlign: 'center', alignSelf: 'stretch' },
  details: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  detailsTexto: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
  avisoDetalhe: { color: colors.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 2 },
  acoes: { flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' },
  botao: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 10, paddingHorizontal: 12 },
  primario: { backgroundColor: colors.forest700, borderWidth: 1, borderColor: colors.forest700 },
  primarioTexto: { color: 'white', fontWeight: '900', fontSize: 14 },
  /** "Navigate to van": secundário OUTLINED (borda e texto forest700 sobre papel), 44 pt de toque. */
  secundario: { borderWidth: 1.5, borderColor: colors.forest700, backgroundColor: colors.paper },
  secundarioTexto: { color: colors.forest700, fontWeight: '900', fontSize: 13, textAlign: 'center' },
  dicaRaio: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  erro: { color: colors.urgency, fontSize: 12, fontWeight: '700', marginTop: 8, lineHeight: 17, textAlign: 'center' },
  excecao: { borderWidth: 1.5, borderColor: colors.urgency, borderRadius: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 10, alignSelf: 'stretch' },
  excecaoTexto: { color: colors.urgency, fontWeight: '900', fontSize: 12.5 },
  apagado: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
