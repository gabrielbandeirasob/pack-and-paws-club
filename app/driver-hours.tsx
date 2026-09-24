/**
 * Tela do gestor: JORNADA DOS MOTORISTAS (horas do dia/semana) — pedido do cliente (16/09/2026).
 *
 * "o que o gestor vê: um resumo por motorista: dia, primeira entrada, última saída, tempo total,
 * na tela e exportável (planilha)".
 *
 * Como o número é montado (e por que dá para confiar):
 *  - o que a ROTA conta sozinha (primeira chegada → última conclusão) vem dos marcos carimbados no
 *    SERVIDOR (migration 024) — vale no dia normal, sem o motorista apertar nada;
 *  - os registros MANUAIS (exceção, sempre com motivo) aparecem com selo "manual";
 *  - o total do dia usa a marca mais cedo como entrada e a mais tarde como saída.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  buildDriverDayInputs,
  clockText,
  dayKey,
  durationText,
  summarizeDriverDays,
  summaryToCsv,
  type DriverDaySummary,
} from '@/features/driver/shift';
import { loadDriverNames, loadOrganizationRoutes, loadOrganizationShifts, stopFromRow } from '@/features/driver/shiftService';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type Janela = 'today' | 'week';

function inicioDoDia(offsetDias = 0): string {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + offsetDias).toISOString();
}

export default function DriverHoursScreen() {
  const router = useRouter();
  const [janela, setJanela] = useState<Janela>('today');
  const [resumos, setResumos] = useState<DriverDaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (escolha: Janela) => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sign in again to see the driver hours.');
      const { data: vinculos, error: erroVinculo } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);
      if (erroVinculo) throw new Error(erroVinculo.message);
      const organizationId = (vinculos as { organization_id: string }[] | null)?.[0]?.organization_id;
      if (!organizationId) throw new Error('Organization not found for this account.');

      const de = escolha === 'today' ? inicioDoDia(0) : inicioDoDia(-6);
      const ate = inicioDoDia(1);
      const [rotas, jornadas, nomes] = await Promise.all([
        loadOrganizationRoutes(supabase, { organizationId, from: dayKey(new Date(de)), to: dayKey(new Date()) }),
        loadOrganizationShifts(supabase, { organizationId, from: de, to: ate }),
        loadDriverNames(supabase, organizationId),
      ]);

      const registros = buildDriverDayInputs(
        rotas.map((rota) => ({
          id: rota.id,
          day: rota.route_date,
          driverId: rota.driver_id,
          driverName: (rota.driver_id ? nomes[rota.driver_id] : null) ?? 'Driver',
          stops: (rota.route_stops ?? []).map(stopFromRow),
        })),
        jornadas.map((jornada) => ({
          driverId: jornada.driver_id,
          driverName: nomes[jornada.driver_id] ?? 'Driver',
          startedAt: jornada.started_at,
          endedAt: jornada.ended_at,
          startReason: jornada.start_reason,
          endReason: jornada.end_reason,
        })),
      );
      setResumos(summarizeDriverDays(registros));
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'Could not load the driver hours.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(janela);
  }, [janela, load]);

  const exportar = async () => {
    if (resumos.length === 0) return;
    try {
      await Share.share({ message: summaryToCsv(resumos), title: 'Pack & Paws · driver hours' });
    } catch {
      setError('Could not open the share sheet.');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Driver hours</Text>
        <Text style={styles.subtitle}>First in, last out and total time — from the route itself, plus any manual records.</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.toggle}>
          {(['today', 'week'] as Janela[]).map((opcao) => (
            <Pressable
              key={opcao}
              accessibilityRole="button"
              accessibilityLabel={opcao === 'today' ? 'Show today' : 'Show last 7 days'}
              onPress={() => setJanela(opcao)}
              style={[styles.toggleOption, janela === opcao && styles.toggleAtivo]}
            >
              <Text style={[styles.toggleText, janela === opcao && styles.toggleTextoAtivo]}>{opcao === 'today' ? 'Today' : 'Last 7 days'}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={styles.center} color={colors.gold} size="large" />
        ) : (
          <ScrollView contentContainerStyle={styles.lista} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.erro}>{error}</Text> : null}
            {resumos.length === 0 && !error ? (
              <View style={styles.vazio}>
                <Text style={styles.vazioEmoji}>⏱</Text>
                <Text style={styles.vazioTitulo}>No journey records yet</Text>
                <Text style={styles.vazioTexto}>
                  The day shows up here as soon as the driver marks the first stop (or clocks in by hand).
                </Text>
              </View>
            ) : null}
            {resumos.map((resumo) => (
              <View key={`${resumo.driverId}-${resumo.day}`} style={styles.card} testID={`jornada-${resumo.driverId}-${resumo.day}`}>
                <View style={styles.cardTopo}>
                  <Text style={styles.motorista}>{resumo.driverName}</Text>
                  {resumo.hasManual ? <Text style={styles.seloManual}>MANUAL · {resumo.manualCount}</Text> : null}
                </View>
                <Text style={styles.dia}>{resumo.day}</Text>
                <View style={styles.linhaTempos}>
                  <Text style={styles.tempo}>{clockText(resumo.manualIn ?? resumo.routeIn) ?? '—'} → {clockText(resumo.manualOut ?? resumo.routeOut) ?? 'in progress'}</Text>
                  <Text style={styles.total}>{durationText(resumo.minutes)}</Text>
                </View>
              </View>
            ))}
            {resumos.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Export spreadsheet" onPress={() => void exportar()} style={({ pressed }) => [styles.exportar, pressed && styles.pressed]}>
                <Text style={styles.exportarTexto}>Export spreadsheet (CSV)</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.voltar}>
              <Text style={styles.voltarTexto}>Back</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 26, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  subtitle: { color: '#D7E1D4', fontSize: 12, marginTop: 6, lineHeight: 17 },
  body: { flex: 1, backgroundColor: colors.cream },
  toggle: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 4 },
  toggleOption: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: colors.paper },
  toggleAtivo: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  toggleText: { color: colors.forest700, fontWeight: '800', fontSize: 13 },
  toggleTextoAtivo: { color: 'white' },
  center: { marginTop: 60 },
  lista: { padding: 16, paddingBottom: 40 },
  erro: { color: colors.urgency, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 14, marginBottom: 10 },
  cardTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  motorista: { fontFamily: 'serif', fontSize: 17, fontWeight: '800', color: colors.forest900 },
  seloManual: { color: '#7A5B12', backgroundColor: '#F3D9A4', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  dia: { color: colors.muted, fontSize: 12, marginTop: 3 },
  linhaTempos: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  tempo: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  total: { color: colors.forest700, fontWeight: '900', fontSize: 15 },
  vazio: { alignItems: 'center', marginTop: 60, paddingHorizontal: 26 },
  vazioEmoji: { fontSize: 40 },
  vazioTitulo: { fontFamily: 'serif', fontSize: 18, fontWeight: '800', color: colors.forest900, marginTop: 10 },
  vazioTexto: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 6 },
  exportar: { backgroundColor: colors.gold, borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 8 },
  exportarTexto: { color: colors.forest900, fontWeight: '900', fontSize: 14 },
  voltar: { alignItems: 'center', padding: 14, marginTop: 4 },
  voltarTexto: { color: colors.muted, fontWeight: '800' },
  pressed: { opacity: 0.85 },
});
