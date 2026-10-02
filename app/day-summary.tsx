/**
 * HISTÓRICO DO DIA — "clicar lá, dia tal, e ver todas essas informações do dia tal".
 *
 * Pedido da operação (26/09/2026), junto com os 5 indicadores: o gestor precisa voltar num dia
 * passado e ver os MESMOS números que viu naquele dia (daycare, boarding, total de cães, pack e
 * faturamento) + o local da caminhada e a ideia da foto. O que é do dia fica guardado por dia
 * (`daily_plans`, `daily_todos`, `pack_entries` — migração 035); os números de cães saem do
 * calendário daquele dia (mesma conta do `buildDay`), então dia passado não muda sozinho.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { DateField } from '@/features/calendar/DateField';
import { formatDayLabel, todayLocalISO } from '@/features/calendar/dates';
import { dayIndicatorsFrom, formatCents, packRows, sortTodos, type DailyTodo, type DayDog, type PackEntry } from '@/features/dashboard/dayOperation';
import { loadDayDogs, loadDayPlan, loadPackEntries, loadTodos, PLANO_VAZIO, type DayPlan } from '@/features/dashboard/dayService';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type MembroRow = { user_id: string; profiles: { full_name: string | null } | null };

export default function DaySummaryScreen() {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [dia, setDia] = useState(todayLocalISO());
  const [dogs, setDogs] = useState<DayDog[]>([]);
  const [entries, setEntries] = useState<PackEntry[]>([]);
  const [plan, setPlan] = useState<DayPlan>(PLANO_VAZIO);
  const [todos, setTodos] = useState<DailyTodo[]>([]);
  const [membros, setMembros] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .limit(1);
      setOrganizationId((data as { organization_id: string }[] | null)?.[0]?.organization_id ?? null);
    })();
  }, []);

  const carregar = useCallback(async () => {
    if (!organizationId) return;
    setCarregando(true);
    setErro(null);
    try {
      const [listaDogs, listaEntries, plano, listaTodos, membrosResult] = await Promise.all([
        loadDayDogs(supabase, organizationId, dia),
        loadPackEntries(supabase, organizationId, dia),
        loadDayPlan(supabase, organizationId, dia),
        loadTodos(supabase, organizationId, dia),
        supabase.from('organization_members').select('user_id, profiles(full_name)').eq('organization_id', organizationId).eq('status', 'active'),
      ]);
      setDogs(listaDogs);
      setEntries(listaEntries);
      setPlan(plano);
      setTodos(listaTodos);
      setMembros(
        Object.fromEntries(
          ((membrosResult.data as unknown as MembroRow[]) ?? []).map((row) => [row.user_id, row.profiles?.full_name?.trim() || 'Team member']),
        ),
      );
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : String(causa));
    }
    setCarregando(false);
  }, [dia, organizationId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = packRows(dogs, entries);
  const numeros = dayIndicatorsFrom({
    // A MESMA conta da Home (vistoria 02/10/2026): o cão em boarding e daycare no mesmo dia conta uma vez.
    daycareCount: dogs.filter((cao) => cao.serviceType === 'daycare').length,
    boardingCount: dogs.filter((cao) => cao.serviceType === 'boarding').length,
    dogs,
    entries,
    revenueCents: plan.revenueCents,
  });

  return (
    <SafeAreaView style={styles.tela} edges={['top']}>
      <ScrollView contentContainerStyle={styles.conteudo} showsVerticalScrollIndicator={false}>
        <View style={styles.topo}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12} style={styles.voltar}>
            <Text style={styles.voltarTexto}>‹ Back</Text>
          </Pressable>
          <Text style={styles.titulo}>Day summary</Text>
          <Text style={styles.sub}>{formatDayLabel(dia)}</Text>
        </View>

        <View style={styles.cartao}>
          <DateField label="Day" value={dia} onChange={setDia} />
        </View>

        {carregando ? (
          <ActivityIndicator style={styles.rodinha} color={colors.forest700} size="large" />
        ) : erro ? (
          <View style={styles.cartao}>
            <Text style={styles.erro}>{erro}</Text>
          </View>
        ) : (
          <>
            <View style={styles.fileira}>
              <Quadro valor={String(numeros.daycare)} rotulo="Daycare" />
              <Quadro valor={String(numeros.boarding)} rotulo="Boarding" />
              <Quadro valor={String(numeros.totalDogs)} rotulo="Total dogs" />
            </View>
            <View style={styles.fileira}>
              <Quadro valor={String(numeros.pack)} rotulo="Total Pack" destaque legenda="going to the walk" />
              <Quadro valor={plan.revenueCents === null ? '—' : `$${formatCents(plan.revenueCents)}`} rotulo="Revenue" legenda={plan.revenueCents === null ? 'not typed' : 'saved'} />
            </View>

            <View style={styles.cartao}>
              {/* Nome corrigido em 27/09/2026 (áudio do dono): não é "fim do dia" — a foto e o local
                  são decididos no dia anterior. Mesmo nome do cartão da Home. */}
              <Text style={styles.cartaoTitulo}>Day plan</Text>
              <Text style={styles.rotulo}>Walk location</Text>
              <Text style={styles.valor}>{plan.walkLocation ?? '—'}</Text>
              <Text style={styles.rotulo}>Photo of the day — idea</Text>
              <Text style={styles.valor}>{plan.photoIdea ?? '—'}</Text>
            </View>

            <View style={styles.cartao}>
              <Text style={styles.cartaoTitulo}>{`Pack of the day · ${linhas.filter((linha) => linha.inPack).length} of ${linhas.length}`}</Text>
              {linhas.length === 0 ? (
                <Text style={styles.vazio}>No dogs on this day.</Text>
              ) : (
                linhas.map((linha) => (
                  <View key={linha.dogId} style={styles.linhaPack}>
                    <Text style={[styles.cao, !linha.inPack && styles.foraDoPack]}>{linha.dogName}</Text>
                    <Text style={styles.packInfo}>
                      {linha.inPack ? `walking with ${linha.walkerId ? membros[linha.walkerId] ?? 'a team member' : 'nobody yet'}` : 'out of the pack'}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.cartao}>
              <Text style={styles.cartaoTitulo}>To-do of the day</Text>
              {todos.length === 0 ? (
                <Text style={styles.vazio}>Nothing was on the list.</Text>
              ) : (
                sortTodos(todos).map((item) => (
                  <View key={item.id} style={styles.linhaTodo}>
                    <Text style={styles.marca}>{item.done ? '✓' : '○'}</Text>
                    <Text style={[styles.textoTodo, item.done && styles.textoTodoFeito]}>{item.text}</Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Quadro({ valor, rotulo, legenda, destaque = false }: { valor: string; rotulo: string; legenda?: string; destaque?: boolean }) {
  return (
    <View style={[styles.quadro, destaque && styles.quadroDestaque]}>
      <Text style={[styles.quadroValor, destaque && styles.quadroValorDestaque]}>{valor}</Text>
      <Text style={[styles.quadroRotulo, destaque && styles.quadroRotuloDestaque]}>{rotulo}</Text>
      {legenda ? <Text style={styles.quadroLegenda}>{legenda}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.cream },
  conteudo: { paddingBottom: 30 },
  topo: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 22, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  voltar: { paddingVertical: 4 },
  voltarTexto: { color: '#D7E1D4', fontWeight: '800', fontSize: 13 },
  titulo: { color: 'white', fontFamily: 'serif', fontWeight: '800', fontSize: 26, marginTop: 8 },
  sub: { color: '#D7E1D4', fontSize: 12, marginTop: 4, letterSpacing: 0.6 },
  cartao: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 16, marginHorizontal: 18, marginTop: 14 },
  cartaoTitulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink, marginBottom: 8 },
  rodinha: { marginTop: 40 },
  erro: { color: colors.urgency, fontWeight: '700' },
  fileira: { flexDirection: 'row', gap: 9, paddingHorizontal: 18, marginTop: 14 },
  quadro: { flex: 1, backgroundColor: colors.paper, borderRadius: radii.medium, padding: 14, borderWidth: 1, borderColor: colors.line },
  quadroDestaque: { backgroundColor: colors.gold, borderColor: colors.gold },
  quadroValor: { color: colors.forest700, fontFamily: 'serif', fontWeight: '800', fontSize: 22 },
  quadroValorDestaque: { color: colors.forest900 },
  quadroRotulo: { color: colors.muted, fontSize: 11 },
  quadroRotuloDestaque: { color: colors.forest900, fontWeight: '700' },
  quadroLegenda: { color: colors.forest900, fontSize: 12, lineHeight: 15, opacity: 0.75, marginTop: 2 },
  rotulo: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 8, letterSpacing: 0.3 },
  valor: { color: colors.ink, fontSize: 14, marginTop: 2 },
  vazio: { color: colors.muted, fontSize: 12 },
  linhaPack: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line },
  cao: { color: colors.ink, fontWeight: '700', fontSize: 13.5 },
  foraDoPack: { color: colors.muted, textDecorationLine: 'line-through' },
  packInfo: { color: colors.muted, fontSize: 11 },
  linhaTodo: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  marca: { color: colors.success, fontWeight: '900', fontSize: 13 },
  textoTodo: { color: colors.ink, fontSize: 13, flex: 1 },
  textoTodoFeito: { color: colors.muted, textDecorationLine: 'line-through' },
});
