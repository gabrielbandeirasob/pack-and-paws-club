/**
 * RESUMO SEMANAL — pedido do dono (áudio de 27/09/2026, 50 s).
 *
 * "Esse resumo da semana vai apresentar a lista dos cachorros que vieram na semana. Em cada
 * cachorro... 2º dia 12, 4º dia 15, 6º dia 10, daycare... Se você conseguir fazer essa checagem todo
 * sábado, tipo assim, resumo semanal."
 *
 * Como está desenhado:
 * - a semana é de **segunda a sábado** (decisão dele no mesmo dia) — o domingo fecha a semana que
 *   acabou de passar, que é justamente a que o gestor quer conferir nesse dia;
 * - a lista é por CÃO (o gestor procura pelo nome), e cada cão mostra **em que dias veio** e qual foi
 *   o serviço daquele dia (daycare/boarding — o "take care" do áudio era o daycare);
 * - a conta dos cães de cada dia sai do MESMO `buildDay` do calendário (`loadWeekDogs`), para o
 *   resumo não divergir do que o gestor vê no dia.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { landingRouteForRole } from '@/features/navigation/roleTabs';
import { loadWeekDogs } from '@/features/dashboard/dayService';
import { buildWeeklySummary, dayChipLabel, weekDays, weekLabel, weekStart } from '@/features/dashboard/weeklySummary';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

export default function WeekSummaryScreen() {
  const router = useRouter();
  const { role, isLoading: roleLoading } = useOrganizationRole();
  const landing = landingRouteForRole(role, roleLoading);
  useEffect(() => {
    if (landing) router.replace(landing as never);
  }, [landing, router]);

  /** Um dia qualquer da semana mostrada (a segunda e o sábado saem dele). */
  const [ancora, setAncora] = useState(todayLocalISO());
  const [caesPorDia, setCaesPorDia] = useState<Record<string, { dogId: string; dogName: string; clientName: string; serviceType: 'daycare' | 'boarding' }[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [recarregando, setRecarregando] = useState(false);

  const dias = useMemo(() => weekDays(ancora), [ancora]);
  const resumo = useMemo(() => buildWeeklySummary(dias, caesPorDia), [caesPorDia, dias]);
  const semanaAtual = useMemo(() => weekStart(todayLocalISO()), []);

  const carregar = useCallback(async () => {
    setErro(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCarregando(false);
      return;
    }
    const { data: vinculos } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1);
    const organizationId = (vinculos as { organization_id: string }[] | null)?.[0]?.organization_id ?? null;
    if (!organizationId) {
      setErro('Your account is not linked to an organization yet.');
      setCarregando(false);
      return;
    }
    try {
      setCaesPorDia(await loadWeekDogs(supabase, organizationId, dias));
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Could not load the week.');
    }
    setCarregando(false);
    setRecarregando(false);
  }, [dias]);

  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar]),
  );

  const irParaSemana = useCallback((passo: number) => {
    setAncora((atual) => addDaysISO(weekStart(atual), passo * 7));
  }, []);

  const hoje = todayLocalISO();

  if (roleLoading || role !== 'manager') {
    return (
      <SafeAreaView style={styles.tela} edges={['top']}>
        <ActivityIndicator style={styles.rodinha} color={colors.forest700} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.tela} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.conteudo}
        refreshControl={
          <RefreshControl
            refreshing={recarregando}
            onRefresh={() => {
              setRecarregando(true);
              void carregar();
            }}
            tintColor={colors.forest700}
          />
        }
      >
        <Text style={styles.titulo}>Weekly summary</Text>
        <Text style={styles.sub}>Monday to Saturday — who came, day by day.</Text>

        <View style={styles.semanaLinha}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            onPress={() => irParaSemana(-1)}
            style={styles.seta}
          >
            <Text style={styles.setaTexto}>‹</Text>
          </Pressable>
          <View style={styles.semanaCentro}>
            <Text style={styles.semanaRotulo}>{weekLabel(resumo.from, resumo.to)}</Text>
            {weekStart(ancora) !== semanaAtual ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to this week"
                onPress={() => setAncora(hoje)}
                style={styles.pilula}
              >
                <Text style={styles.pilulaTexto}>This week</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next week"
            onPress={() => irParaSemana(1)}
            style={styles.seta}
          >
            <Text style={styles.setaTexto}>›</Text>
          </Pressable>
        </View>

        {carregando ? (
          <ActivityIndicator style={styles.rodinha} color={colors.forest700} size="large" />
        ) : erro ? (
          <View style={styles.cartao}>
            <Text style={styles.erro}>{erro}</Text>
          </View>
        ) : (
          <>
            <View style={styles.diasLinha}>
              {dias.map((dia, indice) => (
                <View key={dia} style={[styles.chipDia, dia === hoje && styles.chipHoje]}>
                  <Text style={[styles.chipDiaTexto, dia === hoje && styles.chipDiaTextoHoje]}>
                    {dayChipLabel(dia)}
                  </Text>
                  <Text style={[styles.chipNumero, dia === hoje && styles.chipDiaTextoHoje]}>
                    {resumo.perDay[indice] ?? 0}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.cartao}>
              <Text style={styles.total}>
                {resumo.totalDogs === 1 ? '1 dog this week' : `${resumo.totalDogs} dogs this week`}
              </Text>
              <Text style={styles.muted}>
                {resumo.totalDogDays === 1 ? '1 visit in total' : `${resumo.totalDogDays} visits in total`}
              </Text>
            </View>

            {resumo.dogs.length === 0 ? (
              <View style={styles.cartao}>
                <Text style={styles.vazio}>No dogs came this week.</Text>
              </View>
            ) : (
              resumo.dogs.map((cao) => (
                <View key={cao.dogId} style={styles.cartao}>
                  <View style={styles.caoTopo}>
                    <Text style={styles.caoNome}>{cao.dogName}</Text>
                    <Text style={styles.caoDias}>
                      {cao.days.length === 1 ? '1 day' : `${cao.days.length} days`}
                    </Text>
                  </View>
                  <Text style={styles.muted}>{cao.clientName}</Text>
                  <View style={styles.visitas}>
                    {cao.days.map((visita) => (
                      <View key={visita.date} style={styles.visita}>
                        <Text style={styles.visitaDia}>{dayChipLabel(visita.date)}</Text>
                        <Text style={styles.visitaServico}>
                          {visita.serviceType === 'boarding' ? 'Boarding' : 'Daycare'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.cream },
  conteudo: { paddingBottom: 30 },
  rodinha: { marginTop: 60 },
  titulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 24, color: colors.ink, marginHorizontal: 18, marginTop: 12 },
  sub: { color: colors.muted, fontSize: 12.5, marginHorizontal: 18, marginTop: 4 },
  semanaLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginTop: 16 },
  seta: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  setaTexto: { color: colors.forest700, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  semanaCentro: { flex: 1, alignItems: 'center' },
  semanaRotulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 15, color: colors.ink },
  // M5 da auditoria (02/10/2026): a pílula "This week" tinha ~23 pt de alvo; sobe para 44 pt.
  pilula: { marginTop: 4, borderWidth: 1, borderColor: colors.forest700, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, minHeight: 44, justifyContent: 'center' },
  pilulaTexto: { color: colors.forest700, fontSize: 12, fontWeight: '800' },
  diasLinha: { flexDirection: 'row', gap: 6, marginHorizontal: 18, marginTop: 16 },
  chipDia: { flex: 1, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, paddingVertical: 8, alignItems: 'center' },
  chipHoje: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  chipDiaTexto: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  chipDiaTextoHoje: { color: 'white' },
  chipNumero: { color: colors.forest700, fontFamily: 'serif', fontWeight: '800', fontSize: 16, marginTop: 2 },
  cartao: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 16, marginHorizontal: 18, marginTop: 12 },
  total: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink },
  // M5 da auditoria (02/10/2026): legendas do resumo semanal com pelo menos 12 pt.
  muted: { color: colors.muted, fontSize: 12, marginTop: 2 },
  vazio: { color: colors.muted, fontSize: 12.5 },
  erro: { color: colors.urgency, fontSize: 12.5, fontWeight: '700' },
  caoTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  caoNome: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink },
  caoDias: { color: colors.forest700, fontSize: 12, fontWeight: '800' },
  visitas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  visita: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: colors.cream },
  visitaDia: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  visitaServico: { color: colors.muted, fontSize: 12, marginTop: 1 },
});
