/**
 * Card do gestor para o Google Calendar (duas vias).
 *
 * 1. ESPELHO (app → Google): reservas do app viram eventos com marca própria (`appKey`).
 * 2. IMPORTAÇÃO (Google → app): o que o escritório marca direto no calendário vira reserva no app —
 *    pedido do dono em 23/09/2026 ("as datas que estão marcadas no calendário do cliente fossem para
 *    o aplicativo"). Quem manda em cada reserva é quem a criou: reserva que nasceu no Google muda
 *    (e é cancelada) quando o evento muda/some; reserva que nasceu no app continua com o app.
 *    A janela desta via começa em HOJE (nada do passado entra nem é cancelado).
 *
 * REGRA NOVA (dono, 24/09/2026 — inverte o cadastro automático dos builds 52-54): o escritório escreve
 * no título SÓ o nome do cão e diz o serviço pela COR do evento (verde = boarding, azul = daycare,
 * vermelho = cancelar aquele dia). O app importa apenas agendamento de cão que JÁ existe no cadastro —
 * não cria cliente nem cão. Ficam aqui DUAS listas de pendência, para o escritório agir:
 *   - "not registered in the app": nome que não casa (ou que casa com dois cães) — cadastrar o cão e
 *     sincronizar de novo; o gestor também pode ligar o evento a um cão do cadastro na hora;
 *   - "color not recognized": evento sem cor (ou com cor fora do mapa) — pintar o evento e sincronizar
 *     de novo, porque o app não chuta serviço.
 *
 * CALENDÁRIO (24/09/2026): o escritório guarda os agendamentos num calendário secundário ("bot
 * venda"), então o app passou a LER e ESPELHAR o calendário escolhido pela organização — as duas
 * vias usam o mesmo id, guardado em `organizations.google_calendar_id`. O padrão continua sendo o
 * `primary` quando ninguém escolheu. Trocar de calendário é decisão consciente e avisada: o que já
 * foi espelhado fica no calendário antigo (o app não move nem apaga nada lá).
 *
 * CORES (bug 56, 25/09/2026): o Google ampliou a paleta e o evento passou a carregar uma ETIQUETA
 * (`eventLabelId`) com hex próprio — o "Cobalto" (#4A86E8) do cliente. O cartão lê as etiquetas do
 * calendário escolhido (`GET /calendars/{id}`, escopo `calendar.calendars.readonly`: token antigo
 * precisa reconectar e a tela diz isso, sem erro cru) e mostra, em cada pendência, **o que foi lido**
 * — nome da etiqueta + hex + `colorId` legado — para o suporte parar de adivinhar.
 *
 * Só o gestor chega nesta aba (a lista de abas por papel está em `app/(tabs)/_layout.tsx`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { describeEventColor, type EventLabel } from '@/features/calendar/googleColors';
import { DogPicker } from '@/features/calendar/DogPicker';
import type { DogRef } from '@/features/calendar/dayMath';
import { colors, radii } from '@/features/theme/tokens';
import { supabase } from '@/lib/supabase';

import { getCalendarLabels, listCalendars, type CalendarFetch } from './calendarApi';
import {
  corpoDaEscolha,
  DEFAULT_CALENDAR_ID,
  ehSomenteLeitura,
  escolhaDaOrganizacao,
  explicarFalhaDeEtiquetas,
  explicarFalhaDeListagem,
  nomeDoCalendario,
  ordenarCalendarios,
  rotuloDeAcesso,
  textoDeAvisoDeTroca,
  TEXTO_SOMENTE_LEITURA,
  avisoDeTroca,
  type CalendarChoice,
  type GoogleCalendarEntry,
  type OrganizationCalendarRow,
} from './calendarChoice';
import type { LocalReservation } from './calendarSync';
import { escolhaDaRevisao, supabaseImportPorts } from './importPorts';
import { describeImport, describeImportFailure, kindOf, type BookingForImport, type DogForImport } from './importPlan';
import { runCalendarImport, type ImportReviewItem, type ImportSummary } from './importService';
import { describeSummary, runCalendarSync } from './sync';
import { useCalendarConnection } from './useCalendarConnection';

/**
 * Janela espelhada: de 30 dias atrás a 180 à frente. O recuo evita que o evento desapareça do
 * Google no dia seguinte ao do serviço; o limite à frente impede lista que cresce sem fim
 * (escala recorrente sem data de término é expandida até aqui).
 */
export function janelaDeEspelho(hoje = todayLocalISO()): { timeMin: string; timeMax: string } {
  return { timeMin: `${addDaysISO(hoje, -30)}T00:00:00Z`, timeMax: `${addDaysISO(hoje, 180)}T00:00:00Z` };
}

/**
 * Janela da IMPORTAÇÃO: de HOJE (data local) a 180 dias à frente.
 *
 * É independente da janela do espelho de propósito. O espelho continua recuando 30 dias porque o
 * recuo evita que um evento de ontem "suma" da consulta e volte como evento novo; a importação, ao
 * contrário, não pode trazer nada do passado (pedido do dono, 24/09/2026: "de hoje para frente").
 * Com o `from` em hoje, a própria janela é o que impede cancelar uma reserva de ontem que veio do
 * Google só porque ela não aparece mais na consulta — e o planCalendarImport ainda confere de novo.
 */
export function janelaDeImportacao(hoje = todayLocalISO()): { from: string; to: string; timeMin: string; timeMax: string } {
  const from = hoje;
  const to = addDaysISO(hoje, 180);
  return { from, to, timeMin: `${from}T00:00:00Z`, timeMax: `${to}T00:00:00Z` };
}

/** Só o que cai na janela é espelhado (o passado distante e o futuro longe ficam fora). */
export function dentroDaJanela(reservas: LocalReservation[], janela: { timeMin: string; timeMax: string }): LocalReservation[] {
  const inicio = janela.timeMin.slice(0, 10);
  const fim = janela.timeMax.slice(0, 10);
  return reservas.filter((reserva) => (reserva.endDate ?? reserva.startDate) >= inicio && reserva.startDate <= fim);
}

/** Texto da lista de revisão, por motivo. */
export function motivoDaRevisao(reason: ImportReviewItem['reason']): string {
  if (reason === 'unknown dog') return 'No dog with this name in the app — register the dog and sync again';
  if (reason === 'ambiguous dog') return 'More than one dog with this name — the app does not guess which one';
  if (reason === 'duplicate') return 'A booking like this already exists in the app';
  if (reason === 'unrecognized color') return 'No service in this color — green is boarding, blue is daycare, purple is a changed day';
  if (reason === 'purple without schedule')
    return 'Purple is a changed day for a fixed-day dog — this dog has no weekly schedule in the app';
  // Único caso que sobra sem nome: título sem nome nenhum (o resto o escritório resolve cadastrando).
  return 'This event has no title — pick the dog and we save it';
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
  const [ocupado, setOcupado] = useState<'conectando' | 'sincronizando' | 'desconectando' | 'escolhendo' | null>(null);
  const [resumo, setResumo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimoEnvio, setUltimoEnvio] = useState<string | null>(null);
  const [revisao, setRevisao] = useState<ImportReviewItem[]>([]);
  const [escolhendo, setEscolhendo] = useState<ImportReviewItem | null>(null);
  const [caoEscolhido, setCaoEscolhido] = useState<DogRef | null>(null);

  // Calendário: escolha da ORGANIZAÇÃO (o escritório inteiro usa o mesmo) + a lista da conta.
  const [escolha, setEscolha] = useState<CalendarChoice>(() => escolhaDaOrganizacao(null));
  const [calendarios, setCalendarios] = useState<GoogleCalendarEntry[]>([]);
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [candidato, setCandidato] = useState<GoogleCalendarEntry | null>(null);
  const [erroCalendarios, setErroCalendarios] = useState<string | null>(null);
  const [carregandoCalendarios, setCarregandoCalendarios] = useState(false);
  const [avisoCalendario, setAvisoCalendario] = useState<string | null>(null);

  // Cores do calendário (paleta NOVA do Google): as etiquetas de `labelProperties.eventLabels`.
  const [etiquetas, setEtiquetas] = useState<EventLabel[]>([]);
  const [erroEtiquetas, setErroEtiquetas] = useState<string | null>(null);

  const janela = useMemo(() => janelaDeEspelho(), []);
  const janelaImport = useMemo(() => janelaDeImportacao(), []);
  const paraEspelhar = useMemo(() => dentroDaJanela(reservations, janela), [reservations, janela]);

  const refsDeCao = useMemo<DogRef[]>(
    () => dogs.map((cao) => ({ id: cao.id, dogName: cao.name, clientName: cao.clientName ?? '' })),
    [dogs],
  );

  /**
   * As pendências em DUAS listas (regra nova): o que o escritório resolve cadastrando o cão — e o
   * gestor até pode ligar o evento a um cão daqui — e o que só se resolve PINTANDO o evento no
   * Google. Na segunda o app nem oferece botão: sem cor não existe serviço para gravar.
   */
  const naoCadastrados = useMemo(
    () => revisao.filter((item) => item.reason !== 'unrecognized color' && item.reason !== 'purple without schedule'),
    [revisao],
  );
  const coresDesconhecidas = useMemo(() => revisao.filter((item) => item.reason === 'unrecognized color'), [revisao]);
  /** ROXO num cão sem escala fixa: não há onde encaixar o dia — lista própria, o escritório resolve. */
  const alteracoesSemEscala = useMemo(() => revisao.filter((item) => item.reason === 'purple without schedule'), [revisao]);

  /** Papel de acesso do calendário escolhido (a lista da conta é quem sabe). */
  const acessoDoEscolhido = useMemo(
    () => calendarios.find((item) => item.id === escolha.calendarId)?.accessRole ?? null,
    [calendarios, escolha.calendarId],
  );

  /** Escolha salva da organização — por organização, não por aparelho. */
  const carregarEscolha = useCallback(async () => {
    if (!organizationId) return;
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('google_calendar_id, google_calendar_summary')
        .eq('id', organizationId)
        .maybeSingle();
      // Erro aqui (coluna ausente, RLS) não derruba a tela: fica no padrão `primary`, que era o
      // comportamento antigo, e o gestor ainda pode escolher e ver o erro na hora de salvar.
      if (error) return;
      setEscolha(escolhaDaOrganizacao(data as OrganizationCalendarRow));
    } catch {
      // Consulta que estoura (coluna que ainda não existe, cliente de teste sem `maybeSingle`)
      // também não pode derrubar a aba: o cartão segue no padrão.
    }
  }, [organizationId]);

  useEffect(() => {
    void carregarEscolha();
  }, [carregarEscolha]);

  /**
   * Calendários da conta conectada. O nome do calendário PRINCIPAL é o que a tela mostra como
   * "conta conectada": o token OAuth do app não pede escopo de e-mail, então o `summary` do primary
   * é a identidade que existe sem pedir permissão nova.
   */
  const carregarCalendarios = useCallback(async () => {
    if (status !== 'connected') return;
    setCarregandoCalendarios(true);
    setErroCalendarios(null);
    try {
      const accessToken = await getAccessToken();
      const lista = ordenarCalendarios(await listCalendars(accessToken, fetchReal));
      setCalendarios(lista);
      // A escolha gravada só tinha o id? Completa o nome com o que o Google devolveu.
      setEscolha((atual) => {
        if (atual.summary) return atual;
        const achado = lista.find((item) => item.id === atual.calendarId);
        return achado ? { ...atual, summary: achado.summary } : atual;
      });
    } catch (error) {
      setErroCalendarios(explicarFalhaDeListagem(error instanceof Error ? error.message : String(error)));
    } finally {
      setCarregandoCalendarios(false);
    }
  }, [getAccessToken, status]);

  useEffect(() => {
    void carregarCalendarios();
  }, [carregarCalendarios]);

  /**
   * Cores do calendário escolhido (etiquetas da paleta NOVA do Google).
   *
   * Devolve a lista para quem chamou (o Sync usa a mesma lista nas DUAS vias, sem ler duas vezes) e
   * NUNCA lança: sem etiqueta — token sem o escopo `calendar.calendars.readonly`, calendário sem
   * etiqueta, erro de rede — o app cai no `colorId` legado, que é o que já funcionava. É por isso que
   * a falha vira uma frase na tela, e não um erro que derruba o Sync.
   */
  const carregarEtiquetas = useCallback(async (): Promise<EventLabel[]> => {
    if (status !== 'connected') return [];
    try {
      const accessToken = await getAccessToken();
      const lista = await getCalendarLabels(accessToken, fetchReal, escolha.calendarId);
      setEtiquetas(lista);
      setErroEtiquetas(null);
      return lista;
    } catch (error) {
      setEtiquetas([]);
      setErroEtiquetas(explicarFalhaDeEtiquetas(error instanceof Error ? error.message : String(error)));
      return [];
    }
  }, [escolha.calendarId, getAccessToken, status]);

  useEffect(() => {
    void carregarEtiquetas();
  }, [carregarEtiquetas]);

  const sincronizar = useCallback(async () => {
    setOcupado('sincronizando');
    setErro(null);
    setResumo(null);
    try {
      const accessToken = await getAccessToken();
      // As etiquetas saem daqui e servem às duas vias: o espelho pinta o evento com a etiqueta do
      // serviço (quando existir) e a importação lê a cor do evento por ela (o caso do "Cobalto").
      const labels = await carregarEtiquetas();
      const summary = await runCalendarSync({
        accessToken,
        reservations: paraEspelhar,
        range: janela,
        doFetch: fetchReal,
        // Mesmo calendário dos dois lados: o espelho escreve onde a importação lê.
        calendarId: escolha.calendarId,
        labels,
      });

      let texto = describeSummary(summary);
      try {
        const importado: ImportSummary = await runCalendarImport({
          accessToken,
          // A importação consulta de HOJE para frente (a janela do espelho não serve aqui: ela
          // recua 30 dias de propósito).
          range: { timeMin: janelaImport.timeMin, timeMax: janelaImport.timeMax },
          window: { from: janelaImport.from, to: janelaImport.to },
          dogs,
          reservations: bookings,
          doFetch: fetchReal,
          ports: supabaseImportPorts(supabase, organizationId),
          calendarId: escolha.calendarId,
          labels,
        });
        const daImportacao = describeImport({
          created: importado.created,
          updated: importado.updated,
          cancelled: importado.cancelled,
          extraDays: importado.extraDays,
          review: importado.review.length,
        });
        if (daImportacao) texto = texto ? `${texto} · ${daImportacao}` : daImportacao;
        setRevisao(importado.review);
        if (importado.created + importado.updated + importado.cancelled + (importado.extraDays ?? 0) > 0) onImported?.();
        if (importado.failures.length) setErro(describeImportFailure(importado.failures));
      } catch (importError) {
        // O espelho já passou: a importação falhando não esconde o que foi enviado.
        setErro(mensagemDeFalha(importError, acessoDoEscolhido));
      }

      setResumo(texto);
      if (summary.failures.length) {
        setErro(
          ehSomenteLeitura(summary.failures[0].error, acessoDoEscolhido)
            ? TEXTO_SOMENTE_LEITURA
            : `${summary.failures.length} event(s) could not be sent.`,
        );
      }
      setUltimoEnvio(new Date().toLocaleTimeString());
    } catch (error) {
      setErro(mensagemDeFalha(error, acessoDoEscolhido));
    } finally {
      setOcupado(null);
    }
  }, [acessoDoEscolhido, bookings, carregarEtiquetas, dogs, escolha.calendarId, getAccessToken, janela, janelaImport, onImported, organizationId, paraEspelhar]);

  /** Liga o evento ao cão escolhido: aproveita reserva igual que já existe, senão cria. */
  const resolverRevisao = useCallback(async () => {
    // Sem serviço (cor não reconhecida) não há reserva para gravar: o evento nem mostra o botão, e
    // esta guarda é a segunda linha de defesa.
    if (!escolhendo || !caoEscolhido || !escolhendo.parsed.serviceType) return;
    setOcupado('sincronizando');
    setErro(null);
    try {
      const escolha2 = escolhaDaRevisao({ parsed: escolhendo.parsed, dogId: caoEscolhido.id, bookings });
      if ('criar' in escolha2) {
        await supabaseImportPorts(supabase, organizationId).createBooking({
          eventId: escolhendo.eventId,
          dogId: caoEscolhido.id,
          kind: kindOf(escolhendo.parsed),
          parsed: escolhendo.parsed,
        });
      } else {
        const tabela = escolha2.kind === 'recurring' ? 'recurring_schedules' : 'reservations';
        const { error } = await supabase
          .from(tabela)
          .update({ google_event_id: escolhendo.eventId, source: 'google' })
          .eq('id', escolha2.id);
        if (error) throw new Error(error.message);
      }
      setRevisao((itens) => itens.filter((item) => item.eventId !== escolhendo.eventId));
      setEscolhendo(null);
      setCaoEscolhido(null);
      setResumo(`Saved from Google · ${escolhendo.parsed.dogName}`);
      onImported?.();
    } catch (error) {
      setErro(mensagemDeFalha(error, acessoDoEscolhido));
    } finally {
      setOcupado(null);
    }
  }, [acessoDoEscolhido, bookings, caoEscolhido, escolhendo, onImported, organizationId]);

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
    setErroCalendarios(null);
    setCalendarios([]);
    setEtiquetas([]);
    setErroEtiquetas(null);
    setSeletorAberto(false);
    setCandidato(null);
  }, [disconnect]);

  const abrirSeletor = useCallback(() => {
    setCandidato(null);
    setSeletorAberto(true);
    // A lista pode ter falhado (token antigo sem o escopo de listar): abrir o seletor tenta de novo.
    if (calendarios.length === 0) void carregarCalendarios();
  }, [calendarios.length, carregarCalendarios]);

  /**
   * Salvar a escolha: por ORGANIZAÇÃO (o escritório inteiro passa a usar o mesmo calendário).
   * Trocar é decisão consciente — o aviso fica na tela dizendo que o que já foi espelhado continua
   * no calendário antigo, e que o próximo Sync é quem passa a usar o novo.
   */
  const usarCalendario = useCallback(async () => {
    if (!candidato) return;
    setOcupado('escolhendo');
    setErro(null);
    try {
      const nova: CalendarChoice = { calendarId: candidato.id, summary: candidato.summary };
      if (organizationId) {
        const { error } = await supabase.from('organizations').update(corpoDaEscolha(nova)).eq('id', organizationId);
        if (error) throw new Error(error.message);
      }
      setAvisoCalendario(avisoDeTroca(escolha, candidato.id));
      setEscolha(nova);
      setSeletorAberto(false);
      setCandidato(null);
      setResumo(`Calendar in use: ${candidato.summary}. Sync now to mirror and import in it.`);
    } catch (error) {
      setErro(mensagemDeFalha(error, null));
    } finally {
      setOcupado(null);
    }
  }, [candidato, escolha, organizationId]);

  const contaConectada = useMemo(() => {
    if (email) return email;
    const principal = calendarios.find((item) => item.primary);
    return principal?.summary ?? null;
  }, [calendarios, email]);

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
            Connected{contaConectada ? ` as ${contaConectada}` : ''} — bookings travel both ways now.
          </Text>

          <View style={styles.calendario} testID="google-calendar-calendario">
            <Text style={styles.calendarioRotulo}>Calendar in use</Text>
            <Text style={styles.calendarioNome} testID="google-calendar-escolhido">
              {nomeDoCalendario(escolha)}
            </Text>
            {rotuloDeAcesso(acessoDoEscolhido) ? (
              <Text style={styles.calendarioAlerta} testID="google-calendar-escolhido-acesso">
                {TEXTO_SOMENTE_LEITURA}
              </Text>
            ) : null}
            {escolha.calendarId === DEFAULT_CALENDAR_ID ? (
              <Text style={styles.calendarioDica} testID="google-calendar-padrao">
                Default — this is the main calendar of the connected account. Pick the office calendar if the
                bookings live somewhere else.
              </Text>
            ) : null}
            <Pressable
              accessibilityLabel="Choose calendar"
              accessibilityRole="button"
              disabled={ocupado !== null}
              onPress={abrirSeletor}
              style={[styles.secondary, ocupado !== null && styles.disabled]}
              testID="google-calendar-trocar"
            >
              <Text style={styles.secondaryText}>Change calendar</Text>
            </Pressable>
            {carregandoCalendarios ? <Text style={styles.calendarioDica}>Loading the calendars of this account…</Text> : null}
            {/* Cores do calendário: quantas etiquetas da paleta nova existem aqui (o que a leitura usa)
                e, quando não deu para ler, a frase que diz ao gestor o que fazer. */}
            {etiquetas.length > 0 ? (
              <Text style={styles.calendarioDica} testID="google-calendar-etiquetas">
                {etiquetas.length} custom color(s) in this calendar — the app reads them by color tone.
              </Text>
            ) : null}
            {erroEtiquetas ? (
              <Text style={styles.calendarioAlerta} testID="google-calendar-erro-etiquetas">
                {erroEtiquetas}
              </Text>
            ) : null}
          </View>

          {avisoCalendario ? (
            <Text style={styles.avisoTroca} testID="google-calendar-aviso-troca">
              {avisoCalendario}
            </Text>
          ) : null}

          <Text style={styles.hint}>
            {paraEspelhar.length} booking(s) mirrored to Google. This is a business-only calendar, so every event
            from today on comes back here — the title is the dog's name and the COLOR of the event says the
            service: green is boarding, blue is daycare, red cancels that day. If the office paints the event with
            one of Google's new color labels, its color tone is what counts. A dog that is not registered in the
            app is never created from here: it waits in the list below for you to register it and sync again.
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

          {naoCadastrados.length > 0 ? (
            <View style={styles.revisao} testID="google-calendar-revisao">
              <Text style={styles.revisaoTitulo}>From Google — not registered in the app</Text>
              <Text style={styles.revisaoDica}>
                Register the dog in the app and sync again — nothing is created from a Google event.
              </Text>
              {naoCadastrados.map((item) => (
                <View key={item.eventId} style={styles.revisaoItem}>
                  <View style={styles.revisaoTexto}>
                    <Text style={styles.revisaoTituloEvento}>{item.title.trim() || '(no title)'}</Text>
                    <Text style={styles.revisaoData}>
                      {item.date} · {motivoDaRevisao(item.reason)}
                    </Text>
                    {/* O que foi LIDO na cor: é o que o suporte precisa para não adivinhar. */}
                    <Text style={styles.revisaoCor} testID={`google-calendar-cor-${item.eventId}`}>
                      {describeEventColor(item.parsed.color)}
                    </Text>
                  </View>
                  {/* Só oferece o botão quando o serviço é conhecido (a cor diz o serviço): sem isso a
                      escolha do cão não teria o que gravar. */}
                  {item.parsed.serviceType ? (
                    <Pressable
                      accessibilityLabel={`Choose dog for ${item.title.trim()}`}
                      accessibilityRole="button"
                      onPress={() => {
                        setEscolhendo(item);
                        setCaoEscolhido(null);
                      }}
                      style={styles.revisaoBotao}
                    >
                      <Text style={styles.revisaoBotaoTexto}>Choose dog</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {alteracoesSemEscala.length > 0 ? (
            <View style={styles.revisao} testID="google-calendar-revisao-escala">
              <Text style={styles.revisaoTitulo}>From Google — changed day without a fixed schedule</Text>
              <Text style={styles.revisaoDica}>
                Purple means this fixed-day client changed the day. This dog has no weekly schedule in the app, so
                nothing is linked: set the dog&apos;s fixed days in the app and sync again.
              </Text>
              {alteracoesSemEscala.map((item) => (
                <View key={item.eventId} style={styles.revisaoItem}>
                  <View style={styles.revisaoTexto}>
                    <Text style={styles.revisaoTituloEvento}>{item.title.trim() || '(no title)'}</Text>
                    <Text style={styles.revisaoData}>
                      {item.date} · {motivoDaRevisao(item.reason)}
                    </Text>
                    <Text style={styles.revisaoCor} testID={`google-calendar-cor-${item.eventId}`}>
                      {describeEventColor(item.parsed.color)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {coresDesconhecidas.length > 0 ? (
            <View style={styles.revisao} testID="google-calendar-cor-desconhecida">
              <Text style={styles.revisaoTitulo}>From Google — color not recognized</Text>
              <Text style={styles.revisaoDica}>
                Paint the event green (boarding), blue (daycare), purple (changed day) or red (cancel that day) in
                Google Calendar and sync again. The app does not guess the service from the title.
              </Text>
              {coresDesconhecidas.map((item) => (
                <View key={item.eventId} style={styles.revisaoItem}>
                  <View style={styles.revisaoTexto}>
                    <Text style={styles.revisaoTituloEvento}>{item.title.trim() || '(no title)'}</Text>
                    <Text style={styles.revisaoData}>
                      {item.date} · {motivoDaRevisao(item.reason)}
                    </Text>
                    {/* É AQUI que o suporte para de adivinhar: sem esta linha, "cor não reconhecida" não
                        dizia QUAL cor o Google mandou (o "Cobalto" #4A86E8 do cliente aparecia como se
                        o evento não tivesse cor nenhuma). */}
                    <Text style={styles.revisaoCor} testID={`google-calendar-cor-${item.eventId}`}>
                      {describeEventColor(item.parsed.color)}
                    </Text>
                  </View>
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

      <Modal visible={seletorAberto} transparent animationType="slide" onRequestClose={() => setSeletorAberto(false)}>
        <View style={styles.fundo}>
          <View style={styles.folha}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.folhaTitulo}>Which calendar?</Text>
              <Text style={styles.folhaSub}>
                The whole office mirrors bookings to, and imports them from, the calendar you pick here.
              </Text>

              {erroCalendarios ? (
                <Text style={styles.error} testID="google-calendar-erro-calendarios">
                  {erroCalendarios}
                </Text>
              ) : null}

              {calendarios.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityLabel={`Use calendar ${item.summary}`}
                  accessibilityRole="button"
                  disabled={ocupado !== null}
                  onPress={() => setCandidato(item)}
                  style={[styles.opcao, candidato?.id === item.id && styles.opcaoEscolhida]}
                  testID={`google-calendar-opcao-${item.id}`}
                >
                  <View style={styles.opcaoTexto}>
                    <Text style={styles.opcaoNome}>{item.summary}</Text>
                    <Text style={styles.opcaoDetalhe}>
                      {[item.primary ? 'Primary' : null, rotuloDeAcesso(item.accessRole)].filter(Boolean).join(' · ') ||
                        'Can read and write'}
                    </Text>
                  </View>
                  {candidato?.id === item.id ? <Text style={styles.opcaoMarca}>✓</Text> : null}
                </Pressable>
              ))}

              {!carregandoCalendarios && calendarios.length === 0 ? (
                <Pressable
                  accessibilityLabel="Try again"
                  accessibilityRole="button"
                  onPress={() => void carregarCalendarios()}
                  style={styles.secondary}
                  testID="google-calendar-recarregar-calendarios"
                >
                  <Text style={styles.secondaryText}>Try again</Text>
                </Pressable>
              ) : null}

              <Text style={styles.avisoTroca}>{textoDeAvisoDeTroca(nomeDoCalendario(escolha))}</Text>

              <Pressable
                accessibilityLabel="Use this calendar"
                accessibilityRole="button"
                disabled={!candidato || ocupado !== null}
                onPress={() => void usarCalendario()}
                style={[styles.salvar, (!candidato || ocupado !== null) && styles.disabled]}
                testID="google-calendar-salvar-calendario"
              >
                <Text style={styles.salvarTexto}>Use this calendar</Text>
              </Pressable>
              <Pressable accessibilityLabel="Cancel" accessibilityRole="button" onPress={() => setSeletorAberto(false)} style={styles.cancelar}>
                <Text style={styles.cancelarTexto}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

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

/** Erro que o gestor entende: calendário de leitura vira a frase combinada, o resto fica como veio. */
function mensagemDeFalha(error: unknown, accessRole: string | null): string {
  const mensagem = error instanceof Error ? error.message : String(error);
  return ehSomenteLeitura(mensagem, accessRole) ? TEXTO_SOMENTE_LEITURA : mensagem;
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
    alignSelf: 'flex-start',
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
  revisaoDica: { color: colors.muted, fontSize: 11, marginTop: 2 },
  revisaoItem: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  revisaoTexto: { flex: 1 },
  revisaoTituloEvento: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  revisaoData: { color: colors.muted, fontSize: 11, marginTop: 2 },
  /** O que foi lido na cor do evento (nome da etiqueta + hex + colorId legado). */
  revisaoCor: { color: colors.muted, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
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
  calendario: { borderTopColor: colors.line, borderTopWidth: 1, marginTop: 10, paddingTop: 8 },
  calendarioRotulo: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  calendarioNome: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 2 },
  calendarioDica: { color: colors.muted, fontSize: 11, marginTop: 4 },
  calendarioAlerta: { color: colors.urgency, fontSize: 11, marginTop: 4 },
  avisoTroca: { color: colors.muted, fontSize: 11, marginTop: 8 },
  opcao: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: radii.small,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    padding: 12,
  },
  opcaoEscolhida: { backgroundColor: colors.sage, borderColor: colors.forest500 },
  opcaoTexto: { flex: 1 },
  opcaoNome: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  opcaoDetalhe: { color: colors.muted, fontSize: 11, marginTop: 2 },
  opcaoMarca: { color: colors.forest900, fontSize: 16, fontWeight: '900' },
});
