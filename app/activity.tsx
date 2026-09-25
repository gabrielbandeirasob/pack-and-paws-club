/**
 * Atividade (só gestor) — "quem fez o que" na conta.
 *
 * Melhoria 1 da revisão das contas (agente2, 25/09/2026): a tabela `audit_logs` existia VAZIA e nada
 * escrevia nela. A migration 032 ligou os triggers nas tabelas que o escritório precisa acompanhar
 * (clientes, cães, reservas, rotas, paradas, escalas, turnos, equipe) e esta tela é a leitura.
 *
 * O motorista NÃO vê: a policy `audit_manager_read` devolve zero linhas para ele e a entrada do menu só
 * aparece para o gestor. Nada aqui é editável — é registro.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';
import { describeAuditEntry, tempoRelativo, type AuditEntry } from '@/features/audit/describe';

type Janela = 'today' | 'week';

type Linha = { id: number; autor: string; resumo: string; detalhe: string | null; quando: string };

/** Meia-noite local de hoje (ou de N dias atrás). */
function inicioDoDia(diasAtras: number): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - diasAtras);
}

export default function ActivityScreen() {
  const [janela, setJanela] = useState<Janela>('today');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (escolha: Janela) => {
    setCarregando(true);
    setErro(null);
    try {
      const de = escolha === 'today' ? inicioDoDia(0) : inicioDoDia(6);
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id,action,entity_type,entity_id,actor_user_id,created_at,metadata')
        .gte('created_at', de.toISOString())
        .order('id', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);

      const registros = (data ?? []) as AuditEntry[];
      const autores = [...new Set(registros.map((r) => r.actor_user_id).filter((x): x is string => Boolean(x)))];
      let nomes: Record<string, string> = {};
      if (autores.length > 0) {
        const { data: perfis } = await supabase.from('profiles').select('id,full_name').in('id', autores);
        nomes = Object.fromEntries(
          ((perfis ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? '']),
        );
      }

      setLinhas(registros.map((registro) => {
        const lido = describeAuditEntry(registro, nomes);
        return {
          id: registro.id,
          autor: lido.actor,
          resumo: lido.resumo,
          detalhe: lido.detalhe,
          quando: tempoRelativo(registro.created_at),
        };
      }));
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Could not load the activity.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(janela);
  }, [janela, carregar]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PACK & PAWS CLUB</Text>
        <Text style={styles.title}>Activity</Text>
        <Text style={styles.subtitle}>Who did what — clients, dogs, bookings, routes, shifts and the team.</Text>
      </View>

      <ScrollView style={styles.corpo} contentContainerStyle={styles.corpoConteudo}>
        {/* As abas ficam no corpo CLARO: na faixa do cabeçalho o destaque (verde sobre verde) ficava
            invisível e a aba INATIVA é que parecia selecionada — defeito pego no print da própria tela. */}
        <View style={styles.tabs}>
          {(['today', 'week'] as Janela[]).map((opcao) => (
            <Pressable
              key={opcao}
              accessibilityRole="button"
              accessibilityLabel={opcao === 'today' ? 'Today' : 'Last 7 days'}
              onPress={() => setJanela(opcao)}
              style={[styles.tab, janela === opcao && styles.tabAtiva]}
            >
              <Text style={[styles.tabTexto, janela === opcao && styles.tabTextoAtivo]}>
                {opcao === 'today' ? 'Today' : 'Last 7 days'}
              </Text>
            </Pressable>
          ))}
        </View>
        {carregando ? <ActivityIndicator color={colors.gold} size="large" style={styles.centro} /> : null}
        {!carregando && erro ? <Text style={styles.erro}>{erro}</Text> : null}
        {!carregando && !erro && linhas.length === 0 ? (
          <View style={styles.vazio}>
            <Text style={styles.vazioTitulo}>Nothing yet</Text>
            <Text style={styles.vazioDica}>
              Actions show up here as the team works — a booking cancelled, a client edited, a stop marked done.
            </Text>
          </View>
        ) : null}
        {!carregando && !erro ? linhas.map((linha) => (
          <View key={linha.id} style={styles.cartao} testID={`atividade-${linha.id}`}>
            <Text style={styles.resumo}>
              <Text style={styles.autor}>{linha.autor}</Text> {linha.resumo}
            </Text>
            {linha.detalhe ? <Text style={styles.detalhe}>{linha.detalhe}</Text> : null}
            <Text style={styles.quando}>{linha.quando}</Text>
          </View>
        )) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.voltar}>
          <Text style={styles.voltarTexto}>Back</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.forest700 },
  header: { backgroundColor: colors.forest700, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22, borderBottomLeftRadius: radii.hero, borderBottomRightRadius: radii.hero },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: 'white', fontFamily: 'serif', fontSize: 28, fontWeight: '800', marginTop: 6 },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 6 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 12, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  tabAtiva: { backgroundColor: colors.forest700, borderColor: colors.forest700 },
  tabTexto: { color: colors.ink, fontWeight: '800', fontSize: 12 },
  tabTextoAtivo: { color: 'white' },
  corpo: { flex: 1, backgroundColor: colors.cream },
  corpoConteudo: { padding: 18 },
  centro: { marginTop: 30 },
  erro: { color: colors.urgency, fontWeight: '700', fontSize: 13 },
  vazio: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 18, marginTop: 8 },
  vazioTitulo: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  vazioDica: { color: colors.muted, fontSize: 12, marginTop: 6 },
  cartao: { backgroundColor: colors.paper, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 10 },
  resumo: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  autor: { fontWeight: '900' },
  detalhe: { color: colors.forest700, fontSize: 12, marginTop: 5, fontWeight: '700' },
  quando: { color: colors.muted, fontSize: 11, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  voltar: { marginTop: 10, padding: 14, alignItems: 'center' },
  voltarTexto: { color: colors.forest700, fontWeight: '900', fontSize: 13 },
});
