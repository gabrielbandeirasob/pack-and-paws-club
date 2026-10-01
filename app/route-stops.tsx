/**
 * PARADAS DA ROTA — a lista que o gestor abre ao tocar no motorista em "Today's routes".
 *
 * Pedido do CLIENTE (áudio de 01/10/2026, encaminhado pelo dono): *"no Today's Routes seria ideal se
 * você conseguisse clicar no driver e abrir uma lista dos pick-up que tem e os que ainda falta e que
 * hora foi feita cada pick-up"*. A tela mostra, parada por parada: cliente · cão, endereço, situação e
 * a HORA de cada marco (chegada e conclusão), carimbada no servidor desde a migration 024.
 *
 * Recebe o `route` por parâmetro (a Home já tem o id na mão) e, opcionalmente, o `driver` e o `day`
 * para o cabeçalho — sem isso, nada de consulta extra só para escrever o título.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { carregarParadasDaRota, type ParadaDaRota } from '@/features/dispatch/routeStops';
import { jaFeita, marcosDaParada, proximaPendente, resumoDaEntrega, resumoDaRota } from '@/features/dashboard/stopProgress';
import { formatDayLabel } from '@/features/calendar/dates';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

/** Rótulos da situação da parada (mesmos do app do motorista — a operação lê em inglês). */
const SITUACAO: Record<string, string> = {
  pending: 'Pending',
  arrived: 'Arrived',
  picked_up: 'Dog picked up',
  completed: 'Completed',
  skipped: 'Problem',
};

export default function RouteStopsScreen() {
  const router = useRouter();
  const parametros = useLocalSearchParams<{ route?: string; driver?: string; day?: string }>();
  const routeId = typeof parametros.route === 'string' ? parametros.route : null;
  const motorista = typeof parametros.driver === 'string' && parametros.driver.trim() ? parametros.driver.trim() : 'Driver';
  const dia = typeof parametros.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parametros.day) ? parametros.day : null;

  const [paradas, setParadas] = useState<ParadaDaRota[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!routeId) {
      setErro('Route not found.');
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const lista = await carregarParadasDaRota(supabase, routeId);
      if (lista === null) {
        setErro('This route is not available on this account.');
        setParadas([]);
      } else {
        setParadas(lista);
      }
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Could not load the route.');
    } finally {
      setCarregando(false);
    }
  }, [routeId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const resumo = useMemo(() => resumoDaRota(paradas), [paradas]);
  const entrega = useMemo(() => resumoDaEntrega(paradas), [paradas]);
  const proxima = useMemo(() => proximaPendente(paradas), [paradas]);

  return (
    <SafeAreaView style={styles.tela} edges={['top']}>
      <View style={styles.topo}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.voltar}>
          <Text style={styles.voltarTexto}>‹ Back</Text>
        </Pressable>
        <Text style={styles.titulo}>Route stops</Text>
        <Text style={styles.sub}>
          {motorista}
          {dia ? ` · ${formatDayLabel(dia)}` : ''}
          {paradas.length > 0 ? ` · ${resumo} · ${entrega}` : ''}
        </Text>
      </View>

      {carregando ? (
        <ActivityIndicator style={styles.rodinha} color={colors.gold} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.conteudo}>
          {erro ? <Text style={styles.erro}>{erro}</Text> : null}

          {!erro && paradas.length === 0 ? (
            <View style={styles.cartao}>
              <Text style={styles.vazio}>No stops on this route.</Text>
            </View>
          ) : null}

          {!erro && paradas.length > 0 ? (
            <View style={styles.cartao}>
              <Text style={styles.cartaoTitulo}>Pick-ups</Text>
              <Text style={styles.resumo}>{resumo}</Text>
              <Text style={styles.proxima}>
                {proxima ? `Next: ${proxima.dogName} · ${marcosDaParada(proxima)}` : 'All stops done 🎉'}
              </Text>
            </View>
          ) : null}

          {paradas.map((parada) => {
            const feita = jaFeita(parada);
            return (
              <View key={parada.id} testID={`parada-${parada.id}`} style={[styles.linha, feita && styles.linhaFeita]}>
                <View style={styles.linhaTopo}>
                  <Text style={styles.posicao}>{parada.sequence}</Text>
                  <Text style={styles.cao}>{parada.clientName} · {parada.dogName}</Text>
                  <Text style={[styles.selo, feita && styles.seloFeito]}>{SITUACAO[parada.status] ?? parada.status}</Text>
                </View>
                {parada.address ? <Text style={styles.endereco}>{parada.address}</Text> : null}
                <Text style={[styles.marcos, feita && styles.marcosFeito]}>{marcosDaParada(parada)}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.cream },
  topo: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 22, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  voltar: { paddingVertical: 4 },
  voltarTexto: { color: '#D7E1D4', fontWeight: '800', fontSize: 13 },
  titulo: { color: 'white', fontFamily: 'serif', fontWeight: '800', fontSize: 26, marginTop: 8 },
  sub: { color: '#D7E1D4', fontSize: 12, marginTop: 4, letterSpacing: 0.6 },
  conteudo: { paddingBottom: 30 },
  rodinha: { marginTop: 40 },
  erro: { color: colors.urgency, fontWeight: '700', marginHorizontal: 18, marginTop: 14 },
  cartao: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 16, marginHorizontal: 18, marginTop: 14 },
  cartaoTitulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink },
  resumo: { color: colors.forest700, fontWeight: '800', fontSize: 13, marginTop: 4 },
  proxima: { color: colors.muted, fontSize: 12, marginTop: 4 },
  vazio: { color: colors.muted, fontSize: 12 },
  linha: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.medium, padding: 14, marginHorizontal: 18, marginTop: 10 },
  linhaFeita: { opacity: 0.72 },
  linhaTopo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  posicao: { color: colors.muted, fontWeight: '800', fontSize: 12, minWidth: 16 },
  cao: { color: colors.ink, fontWeight: '700', fontSize: 13.5, flex: 1 },
  selo: { color: colors.urgency, fontSize: 10.5, fontWeight: '800' },
  seloFeito: { color: colors.success },
  endereco: { color: colors.muted, fontSize: 12, marginTop: 4, marginLeft: 24 },
  marcos: { color: colors.forest900, fontSize: 12, fontWeight: '700', marginTop: 4, marginLeft: 24 },
  marcosFeito: { color: colors.muted, fontWeight: '600' },
});
