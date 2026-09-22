import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import { todayLocalISO } from '@/features/calendar/dates';
import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { landingRouteForRole } from '@/features/navigation/roleTabs';
import { packProgress, progressRows, type PackRoute } from '@/features/dashboard/packProgress';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

type StopRow = {
  id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'picked_up' | 'completed' | 'skipped';
  updated_at: string | null;
  dog: { name: string };
};
type RouteRow = { id: string; driver_id: string; status: 'draft' | 'published'; route_stops: StopRow[] };
type DriverRow = { user_id: string; profiles: { full_name: string | null } | null };

/**
 * "Today's progress" — o que o cliente pediu: ver, nas DUAS rotas, quais cães já foram
 * pegos/concluídos no dia e a hora de cada marcação.
 */
export default function DayProgressScreen() {
  const router = useRouter();
  const { role, isLoading: roleLoading } = useOrganizationRole();
  const landing = landingRouteForRole(role, roleLoading);
  useEffect(() => {
    if (landing) router.replace(landing as never);
  }, [landing, router]);

  const [rotas, setRotas] = useState<PackRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
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
      setLoading(false);
      return;
    }

    const [rotasResult, motoristasResult] = await Promise.all([
      supabase
        .from('routes')
        .select('id, driver_id, status, route_stops(id, sequence, status, updated_at, dog:dogs(name))')
        .eq('organization_id', organizationId)
        .eq('route_date', todayLocalISO()),
      supabase
        .from('organization_members')
        .select('user_id, profiles(full_name)')
        .eq('organization_id', organizationId)
        .eq('role', 'driver')
        .eq('status', 'active'),
    ]);
    const falha = rotasResult.error ?? motoristasResult.error;
    if (falha) {
      setErro(falha.message);
      setLoading(false);
      return;
    }

    const nomes = Object.fromEntries(
      ((motoristasResult.data as unknown as DriverRow[]) ?? []).map((m) => [m.user_id, m.profiles?.full_name?.trim() || 'Driver']),
    );
    const rows = ((rotasResult.data as unknown as RouteRow[]) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    setRotas(
      rows.map((row) => ({
        driverName: nomes[row.driver_id] ?? 'Driver',
        status: row.status,
        stops: [...row.route_stops]
          .sort((a, b) => a.sequence - b.sequence)
          .map((stop) => ({ status: stop.status, dogName: stop.dog.name, at: stop.updated_at })),
      })),
    );
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void carregar();
    }, [carregar]),
  );

  const resumo = useMemo(() => packProgress(rotas), [rotas]);
  const linhas = useMemo(() => progressRows(rotas), [rotas]);

  if (roleLoading || role !== 'manager') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ActivityIndicator style={styles.centro} color={colors.gold} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topo}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}>
          <Text style={styles.voltar}>‹ Back</Text>
        </Pressable>
        <Text style={styles.titulo}>Today&apos;s progress</Text>
        <Text style={styles.resumo}>
          {resumo.total === 0
            ? 'Nothing scheduled for today'
            : `${resumo.done} of ${resumo.total} dogs done · ${resumo.left} left`}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.conteudo}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={carregar} tintColor={colors.gold} />}
      >
        {loading && rotas.length === 0 ? (
          <ActivityIndicator style={styles.centro} color={colors.gold} size="large" />
        ) : erro ? (
          <Text style={styles.erro}>{erro}</Text>
        ) : linhas.length === 0 ? (
          <Text style={styles.vazioTexto}>
            No routes for today yet. Assign the dogs in Dispatch and publish the route.
          </Text>
        ) : (
          linhas.map((linha, indice) => (
            <View key={`${linha.driverName}-${indice}`} style={styles.cartao}>
              <View style={styles.cartaoTopo}>
                <Text style={styles.motorista}>{linha.driverName}</Text>
                <Text style={styles.rotaStatus}>
                  {linha.routeStatus === 'published' ? `${linha.stops.length} stops` : `draft · ${linha.stops.length} stops`}
                </Text>
              </View>
              {linha.stops.length === 0 ? (
                <Text style={styles.vazioTexto}>No dogs on this route.</Text>
              ) : (
                linha.stops.map((ponto, i) => (
                  <View key={`${ponto.dogName}-${i}`} style={styles.linhaCao}>
                    <View style={styles.linhaEsq}>
                      <View style={[styles.bolinha, bolinhaStyle(ponto.status)]} />
                      <Text style={styles.cao}>{ponto.dogName}</Text>
                    </View>
                    <View style={styles.linhaDir}>
                      <Text style={[styles.pontoStatus, textoStyle(ponto.status)]}>{ponto.statusLabel}</Text>
                      {ponto.at ? <Text style={styles.hora}>{ponto.at}</Text> : null}
                    </View>
                  </View>
                ))
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function bolinhaStyle(status: string) {
  if (status === 'completed') return styles.bolinhaOk;
  if (status === 'skipped') return styles.bolinhaProblema;
  if (status === 'arrived' || status === 'picked_up') return styles.bolinhaAndamento;
  return styles.bolinhaPendente;
}

function textoStyle(status: string) {
  if (status === 'completed') return styles.textoOk;
  if (status === 'skipped') return styles.textoProblema;
  if (status === 'arrived' || status === 'picked_up') return styles.textoAndamento;
  return styles.textoPendente;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  topo: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  voltar: { color: colors.forest700, fontWeight: '800', fontSize: 14 },
  titulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 26, color: colors.ink, marginTop: 10 },
  resumo: { color: colors.muted, fontSize: 13, marginTop: 5 },
  conteudo: { paddingHorizontal: 18, paddingBottom: 30 },
  centro: { marginTop: 60 },
  erro: { color: colors.urgency, fontWeight: '700', textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  vazioTexto: { color: colors.muted, fontSize: 13 },
  cartao: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.large,
    padding: 15,
    marginBottom: 11,
  },
  cartaoTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  motorista: { fontFamily: 'serif', fontWeight: '800', fontSize: 17, color: colors.ink },
  rotaStatus: { color: colors.muted, fontSize: 12 },
  linhaCao: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  linhaEsq: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  linhaDir: { alignItems: 'flex-end' },
  bolinha: { width: 9, height: 9, borderRadius: 5 },
  bolinhaOk: { backgroundColor: '#2F7D57' },
  bolinhaAndamento: { backgroundColor: colors.gold },
  bolinhaProblema: { backgroundColor: colors.urgency },
  bolinhaPendente: { backgroundColor: '#C9CEC6' },
  cao: { color: colors.ink, fontSize: 14.5, fontWeight: '600' },
  pontoStatus: { fontSize: 12.5, fontWeight: '800' },
  textoOk: { color: '#2F7D57' },
  textoAndamento: { color: '#A8791B' },
  textoProblema: { color: colors.urgency },
  textoPendente: { color: colors.muted },
  hora: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
});
