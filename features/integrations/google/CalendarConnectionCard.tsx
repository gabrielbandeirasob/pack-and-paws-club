/**
 * Card do gestor para o Google Calendar (duas vias).
 *
 * 1. ESPELHO (app → Google): reservas do app viram eventos com marca própria (`appKey`).
 * 2. IMPORTAÇÃO (Google → app): o que o escritório marca direto no calendário vira reserva no app —
 *    pedido do dono em 23/09/2026 ("as datas que estão marcadas no calendário do cliente fossem para
 *    o aplicativo"). Quem manda em cada reserva é quem a criou: reserva que nasceu no Google muda
 *    (e é cancelada) quando o evento muda/some; reserva que nasceu no app continua com o app.
 *
 * Nada aqui adivinha cadastro: nome de cão que não casa com UM cão do cadastro vai para a lista de
 * REVISÃO, onde o gestor escolhe o cão. É o que evita cliente/cão fantasma por título mal escrito.
 *
 * Só o gestor chega nesta aba (a lista de abas por papel está em `app/(tabs)/_layout.tsx`).
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { DogPicker } from '@/features/calendar/DogPicker';
import type { DogRef } from '@/features/calendar/dayMath';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

import type { CalendarFetch } from './calendarApi';
import type { LocalReservation } from './calendarSync';
import { escolhaDaRevisao, supabaseImportPorts } from './importPorts';
import { kindOf, type BookingForImport, type DogForImport } from './importPlan';
import { runCalendarImport, type ImportReviewItem, type ImportSummary } from './importService';
import { describeSummary, runCalendarSync } from './sync';
import { describeImport } from './importPlan';
import { useCalendarConnection } from './useCalendarConnection';

/**
 * Janela espelhada: de 30 dias atrás a 180 à frente. O recuo evita que o evento desapareça do
 * Google no dia seguinte ao do serviço; o limite à frente impede lista que cresce sem fim
 * (escala recorrente sem data de término é expandida até aqui).
 */
export function janelaDeEspelho(hoje = todayLocalISO()): { timeMin: string; timeMax: string } {
  return { timeMin: `${addDaysISO(hoje, -30)}T00:00:00Z`, timeMax: `${addDaysISO(hoje, 180)}T00:00:00Z` };
}

export function janelaDeImportacao(janela: { timeMin: string; timeMax: string }): { from: string; to: string } {
  return { from: janela.timeMin.slice(0, 10), to: janela.timeMax.slice(0, 10) };
}

/** Só o que cai na janela é espelhado (o passado distante e o futuro longe ficam fora). */
export function dentroDaJanela(reservas: LocalReservation[], janela: { timeMin: string; timeMax: string }): LocalReservation[] {
  const inicio = janela.timeMin.slice(0, 10);
  const fim = janela.timeMax.slice(0, 10);
  return reservas.filter((reserva) => (reserva.endDate ?? reserva.startDate) >= inicio && reserva.startDate <= fim);
}

/** Texto da lista de revisão, por motivo. */
export function motivoDaRevisao(reason: ImportReviewItem['reason']): string {
  if (reason === 'unknown dog') return 'No dog with this name in the app';
  if (reason === 'ambiguous dog') return 'More than one dog with this name — pick the right one';
  if (reason === 'duplicate') return 'A booking like this already exists in the app';
  return 'Could not read the title — pick the dog and we save it';
}

const fetchReal: CalendarFetch = (url, init) => fetch(url, init);

type Props = {
  reservations: LocalReservation[];
  organizationId: string;
  /** Cães para casar o nome do título (e para o gestor escolher na revisão). */
  dogs: DogForImport[];
  /** Reservas e séries já existentes, com o vínculo do Google (para ligar sem duplicar). */
  bookings: BookingForImport[];
  /** Chamado depois de importar, para a agenda recarregar e já mostrar o que veio. */
  onImported?: () => void;
};

export function CalendarConnectionCard({ reservations, organizationId, dogs, bookings, onImported }: Props) {
  const { status, email, connect, disconnect, getAccessToken } = useCalendarConnection();
  const [ocupado, setOcupado] = useState<'conectando' | 'sincronizando' | 'desconectando' | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<string | null>(null);
  const [revisao, setRevisao] = useState<ImportReviewItem[]>([]);
  const [escolhendo, setEscolhendo] = useState<ImportReviewItem | null>(null);
  const [caoEscolhido, setCaoEscolhido] = useState<DogRef | null>(null);

  const janela = useMemo(() => janelaDeEspelho(), []);
  const paraEspelhar = useMemo(() => dentroDaJanela(reservations, janela), [reservations, janela]);

  const refsDeCao = useMemo<DogRef[]>(
    () => dogs.map((cao) => ({ id: cao.id, dogName: cao.name, clientName: cao.clientName ?? '' })),
    [dogs],
  );

  const sincronizar = useCallback(async () => {
    setOcupado('sincronizando');
    setErro(null);
    setResumo(null);
    try {
      const accessToken = await getAccessToken();
      const summary = await runCalendarSync({ accessToken, reservations: paraEspelhar, range: janela, doFetch: fetchReal });

      let texto = describeSummary(summary);
      try {
        const importado: ImportSummary = await runCalendarImport({
          accessToken,
          range: janela,
          window: janelaDeImportacao(janela),
          dogs,
          reservations: bookings,
          doFetch: fetchReal,
          ports: supabaseImportPorts(supabase, organizationId),
        });
        const daImportacao = describeImport({
          created: importado.created,
          updated: importado.updated,
          cancelled: importado.cancelled,
          review: importado.review.length,
        });
        if (daImportacao) texto = texto ? `${texto} · ${daImportacao}` : daImportacao;
        setRevisao(importado.review);
        if (importado.created + importado.updated + importado.cancelled > 0) onImported?.();
        if (importado.failures.length) setErro(`${importado.failures.length} item(s) from Google could not be saved.`);
      } catch (importError) {
        // O espelho já passou: a importação falhando não esconde o que foi enviado.
        setErro(importError instanceof Error ? importError.message : String(importError));
      }

      setResumo(texto);
      if (summary.failures.length) setErro(`${summary.failures.length} event(s) could not be sent.`);
      setUltimoEnvio(new Date().toLocaleTimeString());
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    } finally {
      setOcupado(null);
    }
  }, [bookings, dogs, getAccessToken, janela, onImported, organizationId, paraEspelhar]);

  /** Liga o evento ao cão escolhido: aproveita reserva igual que já existe, senão cria. */
  const resolverRevisao = useCallback(async () => {
    if (!escolhendo || !caoEscolhido) return;
    setOcupado('sincronizando');
    setErro(null);
    try {
      const escolha = escolhaDaRevisao({ parsed: escolhendo.parsed, dogId: caoEscolhido.id, bookings });
      if ('criar' in escolha) {
        await supabaseImportPorts(supabase, organizationId).createBooking({
          eventId: escolhendo.eventId,
          dogId: caoEscolhido.id,
          kind: kindOf(escolhendo.parsed),
          parsed: escolhendo.parsed,
        });
      } else {
        const tabela = escolha.kind === 'recurring' ? 'recurring_schedules' : 'reservations';
        const { error } = await supabase
          .from(tabela)
          .update({ google_event_id: escolhendo.eventId, source: 'google' })
          .eq('id', escolha.id);
        if (error) throw new Error(error.message);
      }
      setRevisao((itens) => itens.filter((item) => item.eventId !== escolhendo.eventId));
      setEscolhendo(null);
      setCaoEscolhido(null);
      setResumo(`Saved from Google · ${escolhendo.parsed.dogName}`);
      onImported?.();
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    } finally {
      setOcupado(null);
    }
  }, [bookings, caoEscolhido, escolhendo, onImported, organizationId]);

  const conectar = useCallback(async () => {
    setOcupado('conectando');
    setErro(null);
    const resultado = await connect();
    setOcupado(null);
    if (resultado === 'connected') {
      void sincronizar();
    } else if (resultado === 'error') {
      setErro('Could not connect to Google. Try again.');
    }
  }, [connect, sincronizar]);

  const desconectar = useCallback(async () => {
    setOcupado('desconectando');
    await disconnect();
    setOcupado(null);
    setResumo(null);
    setUltimoEnvio(null);
    setRevisao([]);
    setErro(null);
  }, [disconnect]);

  if (status === 'not_configured') {
    return (
      <View style={styles.card} testID="google-calendar-card">
        <Text style={styles.title}>Google Calendar</Text>
        <Text style={styles.body} testID="google-calendar-nao-configurado">
          Google Calendar is not enabled in this build yet, so bookings cannot be mirrored here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="google-calendar-card">
      <Text style={styles.title}>Google Calendar</Text>

      {status === 'connected' ? (
        <>
          <Text style={styles.body} testID="google-calendar-status">
            Connected{email ? ` as ${email}` : ''} — bookings travel both ways now.
          </Text>
          <Text style={styles.hint}>
            {paraEspelhar.length} booking(s) mirrored to Google. This is a business-only calendar, so every event
            comes back here. Use the dog&apos;s name as the title (e.g. &quot;Bella&quot;); unmatched titles wait for review.
          </Text>

          <View style={styles.row}>
            <Pressable
              accessibilityLabel="Sync now"
              accessibilityRole="button"
              disabled={ocupado !== null}
              onPress={() => void sincronizar()}
              style={[styles.primary, ocupado !== null && styles.disabled]}
              testID="google-calendar-sync"
            >
              {ocupado === 'sincronizando' ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryText}>Sync now</Text>}
            </Pressable>
            <Pressable
              accessibilityLabel="Disconnect Google Calendar"
              accessibilityRole="button"
              disabled={ocupado !== null}
              onPress={() => void desconectar()}
              style={[styles.secondary, ocupado !== null && styles.disabled]}
              testID="google-calendar-disconnect"
            >
              <Text style={styles.secondaryText}>Disconnect</Text>
            </Pressable>
          </View>

          {resumo ? (
            <Text style={styles.result} testID="google-calendar-resumo">
              {resumo}
              {ultimoEnvio ? ` · ${ultimoEnvio}` : ''}
            </Text>
          ) : null}

          {revisao.length > 0 ? (
            <View style={styles.revisao} testID="google-calendar-revisao">
              <Text style={styles.revisaoTitulo}>From Google — needs a dog</Text>
              {revisao.map((item) => (
                <View key={item.eventId} style={styles.revisaoItem}>
                  <View style={styles.revisaoTexto}>
                    <Text style={styles.revisaoTituloEvento}>{item.title || '(no title)'}</Text>
                    <Text style={styles.revisaoData}>
                      {item.date} · {motivoDaRevisao(item.reason)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Choose dog for ${item.title}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setEscolhendo(item);
                      setCaoEscolhido(null);
                    }}
                    style={styles.revisaoBotao}
                  >
                    <Text style={styles.revisaoBotaoTexto}>Choose dog</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.body} testID="google-calendar-status">
            Connect the business Google account to see every booking in Google Calendar.
          </Text>
          <Pressable
            accessibilityLabel="Connect Google Calendar"
            accessibilityRole="button"
            disabled={ocupado !== null}
            onPress={() => void conectar()}
            style={[styles.primary, ocupado !== null && styles.disabled]}
            testID="google-calendar-connect"
          >
            {ocupado === 'conectando' ? <ActivityIndicator color={colors.cream} /> : <Text style={styles.primaryText}>Connect Google Calendar</Text>}
          </Pressable>
        </>
      )}

      {erro ? (
        <Text style={styles.error} testID="google-calendar-erro">
          {erro}
        </Text>
      ) : null}

      <Modal visible={escolhendo !== null} transparent animationType="slide" onRequestClose={() => setEscolhendo(null)}>
        <View style={styles.fundo}>
          <View style={styles.folha}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.folhaTitulo}>Which dog is this?</Text>
              <Text style={styles.folhaSub}>
                {escolhendo?.title} · {escolhendo?.date}
              </Text>
              <DogPicker dogs={refsDeCao} selected={caoEscolhido} onSelect={setCaoEscolhido} hint={`${refsDeCao.length} dogs registered`} />
              <Pressable
                accessibilityLabel="Save from Google"
                accessibilityRole="button"
                disabled={!caoEscolhido || ocupado !== null}
                onPress={() => void resolverRevisao()}
                style={[styles.salvar, (!caoEscolhido || ocupado !== null) && styles.disabled]}
                testID="google-calendar-salvar-revisao"
              >
                <Text style={styles.salvarTexto}>Save booking</Text>
              </Pressable>
              <Pressable accessibilityLabel="Cancel" accessibilityRole="button" onPress={() => setEscolhendo(null)} style={styles.cancelar}>
                <Text style={styles.cancelarTexto}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: radii.medium,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  title: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 13, marginTop: 6 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.forest500,
    borderRadius: radii.small,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  primaryText: { color: colors.cream, fontSize: 14, fontWeight: '600' },
  secondary: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  secondaryText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  result: { color: colors.success, fontSize: 12, marginTop: 10 },
  error: { color: colors.urgency, fontSize: 12, marginTop: 10 },
  revisao: { borderTopColor: colors.line, borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  revisaoTitulo: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  revisaoItem: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  revisaoTexto: { flex: 1 },
  revisaoTituloEvento: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  revisaoData: { color: colors.muted, fontSize: 11, marginTop: 2 },
  revisaoBotao: { backgroundColor: colors.sage, borderRadius: radii.small, paddingHorizontal: 10, paddingVertical: 8 },
  revisaoBotaoTexto: { color: colors.forest900, fontSize: 12, fontWeight: '800' },
  fundo: { backgroundColor: 'rgba(0,0,0,0.45)', flex: 1, justifyContent: 'flex-end' },
  folha: { backgroundColor: colors.cream, borderRadius: radii.large, maxHeight: '85%', padding: 18 },
  folhaTitulo: { color: colors.ink, fontFamily: 'serif', fontSize: 18, fontWeight: '800' },
  folhaSub: { color: colors.muted, fontSize: 12, marginBottom: 10, marginTop: 4 },
  salvar: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radii.small, marginTop: 12, padding: 14 },
  salvarTexto: { color: colors.forest900, fontSize: 14, fontWeight: '900' },
  cancelar: { alignItems: 'center', padding: 12 },
  cancelarTexto: { color: colors.muted, fontWeight: '800' },
});
