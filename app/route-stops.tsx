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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { SupabaseClient } from '@supabase/supabase-js';

import { carregarFimDaRota, carregarParadasDaRota, ordenarParaEntrega, type FimDaRota, type ParadaDaRota } from '@/features/dispatch/routeStops';
import { loadRouteEndLocationForDriver } from '@/features/organization/locations';
import { buscaTerminou, entregaTerminou, fechamentoDaRota } from '@/features/driver/routeClosing';
import { jaFeita, marcosDaParada, proximaEntrega, proximaPendente, resumoDaEntrega, resumoDaRota, situacaoDaEntrega } from '@/features/dashboard/stopProgress';
import { BackHeader } from '@/features/ui/BackHeader';
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

/**
 * O FIM da rota para a tela do GESTOR.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): `carregarFimDaRota` só lia `end_location_id`; quando a rota
 * não aponta um fim (caso comum), o gestor NÃO via o cartão de fechamento — enquanto o motorista,
 * na mesma rota, via "Back to the yard". As duas telas discordavam sobre onde o dia fecha. Aqui,
 * sem fim apontado pela rota, cai no YARD cadastrado pela organização pelo MESMO helper do
 * motorista (`loadRouteEndLocationForDriver`) — a fonte é a mesma, o destino é o mesmo.
 */
async function carregarFimDaRotaComYard(client: SupabaseClient, routeId: string): Promise<FimDaRota> {
  const fim = await carregarFimDaRota(client, routeId);
  if (fim.end) return fim;
  const { data } = await client.from('routes').select('organization_id').eq('id', routeId).maybeSingle();
  const organizationId = (data as { organization_id?: string | null } | null)?.organization_id ?? null;
  if (!organizationId) return fim;
  const yard = await loadRouteEndLocationForDriver(client, { organizationId, endLocationId: null });
  return { start: fim.start, end: yard };
}

export default function RouteStopsScreen() {
  const parametros = useLocalSearchParams<{ route?: string; driver?: string; day?: string }>();
  const routeId = typeof parametros.route === 'string' ? parametros.route : null;
  const motorista = typeof parametros.driver === 'string' && parametros.driver.trim() ? parametros.driver.trim() : 'Driver';
  const dia = typeof parametros.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parametros.day) ? parametros.day : null;

  const [paradas, setParadas] = useState<ParadaDaRota[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [atualizando, setAtualizando] = useState(false);
  /** As sedes que fecham o dia (yard no fim da busca, van no fim das entregas) — cliente, 02/10/2026. */
  const [fimDaRota, setFimDaRota] = useState<FimDaRota>({ start: null, end: null });

  /**
   * GUARDA DE CONCORRÊNCIA (achado da vistoria, 02/10/2026): no primeiro foco o efeito de montagem
   * e o `useFocusEffect` disparam quase juntos. Sem esta trava, as duas corridas liam a rota ao
   * mesmo tempo — consulta dobrada e a lentidão percebida pelo gestor. Agora é UMA carga por foco:
   * enquanto há uma em curso, a seguinte é ignorada (a que completa reescreve o estado).
   */
  const emCurso = useRef(false);

  /**
   * `silencioso` = recarregar sem trocar a tela pela rodinha (a lista fica na frente e o dado se
   * reconcilia por baixo). Usado ao voltar o foco e ao puxar para atualizar.
   */
  const carregar = useCallback(async (silencioso = false) => {
    if (!routeId) {
      setErro('Route not found.');
      setCarregando(false);
      return;
    }
    if (emCurso.current) return;
    emCurso.current = true;
    if (!silencioso) setCarregando(true);
    setErro(null);
    try {
      const lista = await carregarParadasDaRota(supabase, routeId);
      // O FIM da rota (yard/van): pedido do cliente, 02/10/2026 — o gestor vê onde o dia fecha. Sem
      // `end_location_id` na rota, cai no yard da organização (mesma regra da tela do motorista).
      setFimDaRota(await carregarFimDaRotaComYard(supabase, routeId));
      if (lista === null) {
        setErro('This route is not available on this account.');
        setParadas([]);
      } else {
        setParadas(lista);
      }
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Could not load the route.');
    } finally {
      emCurso.current = false;
      if (!silencioso) setCarregando(false);
    }
  }, [routeId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * 🪤 ACHADO DA VISTORIA (02/10/2026): a lista era carregada UMA única vez (por `routeId`), sem foco,
   * sem puxar-para-atualizar e sem tempo real. O gestor abria para ver "quem já foi e a que hora" e o
   * número NÃO mudava mais enquanto o motorista trabalhava — só saía da tela e voltava.
   */
  useFocusEffect(useCallback(() => {
    void carregar(true);
  }, [carregar]));

  const puxarParaAtualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      await carregar(true);
    } finally {
      setAtualizando(false);
    }
  }, [carregar]);

  const resumo = useMemo(() => resumoDaRota(paradas), [paradas]);
  const entrega = useMemo(() => resumoDaEntrega(paradas), [paradas]);
  const proxima = useMemo(() => proximaPendente(paradas), [paradas]);
  /**
   * A TARDE da rota (drop-offs) — cliente, 02/10/2026: *"Onde eu vejo os drop off? Não tá aparecendo. Os
   * pick up estavam."* Mesmas paradas, na ordem de ENTREGA, com o que já foi entregue.
   */
  const paraEntrega = useMemo(() => ordenarParaEntrega(paradas), [paradas]);
  const proximaDaEntrega = useMemo(() => proximaEntrega(paraEntrega), [paraEntrega]);
  const fechamento = useMemo(
    () => fechamentoDaRota({
      buscaTerminou: buscaTerminou(paradas),
      entregaTerminou: entregaTerminou(paradas),
      yard: fimDaRota.end,
      van: fimDaRota.start,
    }),
    [paradas, fimDaRota],
  );

  return (
    <SafeAreaView style={styles.tela} edges={['top']}>
      <BackHeader
        title="Route stops"
        subtitle={`${motorista}${dia ? ` · ${formatDayLabel(dia)}` : ''}${paradas.length > 0 ? ` · ${resumo} · ${entrega}` : ''}`}
      />

      {carregando ? (
        <ActivityIndicator style={styles.rodinha} color={colors.gold} size="large" />
      ) : (
        <ScrollView
          testID="route-stops-lista"
          contentContainerStyle={styles.conteudo}
          refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => void puxarParaAtualizar()} tintColor={colors.gold} />}
        >
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

          {/*
            * DROP-OFFS — a TARDE da rota (cliente, 02/10/2026: *"onde eu vejo os drop off?"*). Mesmas
            * paradas, na ordem de ENTREGA, com a SITUAÇÃO da entrega de cada cão (entregue/pendente/
            * na van). Antes a tela só mostrava a manhã (pick-ups) — era o buraco que ele apontou.
            */}
          {!erro && paradas.length > 0 ? (
            <View style={styles.cartao}>
              <Text style={styles.cartaoTitulo}>Drop-offs</Text>
              <Text style={styles.resumo}>{entrega}</Text>
              <Text style={styles.proxima}>
                {proximaDaEntrega
                  ? `Next: ${proximaDaEntrega.dogName} · ${situacaoDaEntrega(proximaDaEntrega)}`
                  : 'All delivered 🎉'}
              </Text>
            </View>
          ) : null}

          {!erro && paradas.length > 0
            ? paraEntrega.map((parada) => {
                const entregue = Boolean(parada.deliveredAt);
                return (
                  <View key={`entrega-${parada.id}`} testID={`entrega-${parada.id}`} style={[styles.linha, entregue && styles.linhaFeita]}>
                    <View style={styles.linhaTopo}>
                      <Text style={styles.posicao}>{parada.dropoffSequence ?? '–'}</Text>
                      <Text style={styles.cao}>{parada.clientName} · {parada.dogName}</Text>
                      <Text style={[styles.selo, entregue && styles.seloFeito]}>{situacaoDaEntrega(parada)}</Text>
                    </View>
                    {parada.address ? <Text style={styles.endereco}>{parada.address}</Text> : null}
                    <Text style={[styles.marcos, entregue && styles.marcosFeito]}>{marcosDaParada(parada, 'dropoff')}</Text>
                  </View>
                );
              })
            : null}

          {/* O FIM DA ROTA (pedido do cliente, 02/10/2026). Sem ação: é o destino que faltava na lista. */}
          {fechamento ? (
            <View style={styles.fechamento} testID="route-closing">
              <Text style={styles.fechamentoTag}>{fechamento.kind === 'yard' ? 'YARD' : 'VAN'}</Text>
              <Text style={styles.fechamentoTitulo}>{fechamento.title}</Text>
              <Text style={styles.fechamentoSub}>{fechamento.subtitle}</Text>
              {fechamento.address ? <Text style={styles.fechamentoEndereco}>{fechamento.address}</Text> : null}
            </View>
          ) : null}
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
  selo: { color: colors.urgency, fontSize: 12, fontWeight: '800' },
  seloFeito: { color: colors.success },
  endereco: { color: colors.muted, fontSize: 12, marginTop: 4, marginLeft: 24 },
  marcos: { color: colors.forest900, fontSize: 12, fontWeight: '700', marginTop: 4, marginLeft: 24 },
  marcosFeito: { color: colors.muted, fontWeight: '600' },
  fechamento: {
    marginTop: 14,
    padding: 14,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 2,
  },
  fechamentoTag: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.muted },
  fechamentoTitulo: { fontSize: 16, fontWeight: '800', color: colors.ink },
  fechamentoSub: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  fechamentoEndereco: { fontSize: 13, color: colors.forest700, marginTop: 2 },
});
