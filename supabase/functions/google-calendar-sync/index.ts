/**
 * IMPORTAÇÃO AGENDADA DO GOOGLE CALENDAR — roda no SERVIDOR, com o app fechado.
 *
 * Pedido do dono (áudio de 27/09/2026): "o cliente cancelou no dia, ou um dia antes, dois dias
 * antes… altera lá. Aí você vai ver no calendário vermelho". Com a importação só no aparelho, o
 * cancelamento só entra quando alguém abre a Agenda. Aqui ela roda sozinha.
 *
 * Como:
 *  * a credencial (refresh token) vem da tabela `google_calendar_credentials`, CIFRADA;
 *    quem decifra é esta função, com a chave no segredo `GOOGLE_TOKEN_KEY`;
 *  * a regra de importação NÃO é reescrita aqui: vem de `_shared/importacao/*`, gerado do próprio app
 *    (`scripts/gera-importacao-compartilhada.mjs` + teste que falha se a cópia ficar velha);
 *  * o "relógio" é o n8n chamando esta função (a Supabase deste projeto não tem pg_cron);
 *  * chamada protegida por `x-cron-secret`. `?org=<uuid>` roda uma organização só e `?dry=1` faz tudo
 *    MENOS escrever no banco (planeja e conta) — é o modo de prova antes de confiar no automático.
 *
 * O espelho (app → Google) NÃO roda aqui de propósito: ele ESCREVE no calendário do cliente e
 * continua sendo um toque de gente, como decidido em 27/09/2026.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { addDaysISO, todayLocalISO } from '../_shared/importacao/dates.ts';
import { getCalendarLabels } from '../_shared/importacao/calendarApi.ts';
import { supabaseImportPorts } from '../_shared/importacao/importPorts.ts';
import type { ImportPorts } from '../_shared/importacao/importService.ts';
import { runCalendarImport } from '../_shared/importacao/importService.ts';
import type { BookingForImport, DogForImport } from '../_shared/importacao/importPlan.ts';
import { diasPausados } from '../_shared/importacao/localReservations.ts';
import { decifrarTexto } from '../_shared/tokenCrypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
/**
 * O cliente OAuth do app é do tipo **iOS**: o Google aceita o refresh SÓ com o `client_id` (medido em
 * 27/09/2026: sem secret e com token inválido responde `400 invalid_grant` — ou seja, o cliente foi
 * aceito; com secret errado ele responde `401 invalid_client`). O secret fica opcional aqui para o
 * caso de algum dia trocarmos por um cliente Web, que exige.
 */
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

/** Mesma janela do app: de hoje para frente (nada do passado entra). */
function janelaDeImportacao(hoje = todayLocalISO()): { from: string; to: string; timeMin: string; timeMax: string } {
  const to = addDaysISO(hoje, 180);
  return { from: hoje, to, timeMin: `${hoje}T00:00:00Z`, timeMax: `${to}T00:00:00Z` };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Portas de contagem: planeja tudo e não escreve nada (modo `?dry=1`).
 *
 * `createBooking` devolve `'created'` porque é o que a porta de verdade devolve quando a linha entra —
 * nesse modo nada entra, mas o resumo do `dry` conta o que ENTRARIA.
 */
function portasDeContagem(): ImportPorts {
  const nada = async () => undefined;
  return {
    createBooking: async () => 'created' as const,
    updateBooking: nada,
    cancelBooking: nada,
    skipRecurringDay: nada,
    addScheduleExtraDay: nada,
  };
}

type Credencial = {
  organization_id: string;
  refresh_token_encrypted: string;
  calendar_id: string | null;
  connected_email: string | null;
  /** Quem conectou o calendário (o gestor): é ele que assina as linhas que a função cria (created_by). */
  updated_by: string | null;
};

/** Troca o refresh token por um access token novo (o Google expira em ~1 h). */
async function accessTokenDoGoogle(refreshToken: string): Promise<string> {
  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}),
    }),
  });
  const corpo = (await resposta.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!resposta.ok || !corpo.access_token) {
    throw new Error(`google recusou o token (${corpo.error ?? resposta.status})`);
  }
  return corpo.access_token;
}

/** O que já existe na organização, no formato que a importação entende. */
async function carregarDadosDaOrganizacao(
  admin: ReturnType<typeof createClient>,
  organizationId: string,
): Promise<{ dogs: DogForImport[]; bookings: BookingForImport[] }> {
  const horizonte = addDaysISO(todayLocalISO(), 180);
  const [reservas, series, excecoes, caes] = await Promise.all([
    admin
      .from('reservations')
      .select('id, status, service_type, start_date, end_date, google_event_id, source, goes_to_daycare, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .in('status', ['confirmed', 'cancelled']),
    admin
      .from('recurring_schedules')
      .select('id, weekdays, start_date, end_date, active, google_event_id, source, dog:dogs(id, name, client:clients(name))')
      .eq('organization_id', organizationId)
      .eq('active', true),
    admin
      .from('recurring_exceptions')
      .select('id, recurring_schedule_id, action, start_date, end_date, reason')
      .eq('organization_id', organizationId),
    admin.from('dogs').select('id, name, client:clients(name)').eq('organization_id', organizationId).eq('active', true),
  ]);
  const erro = reservas.error ?? series.error ?? excecoes.error ?? caes.error;
  if (erro) throw new Error(`nao foi possivel carregar os dados da organizacao (${erro.message})`);

  type LinhaDeReserva = {
    id: string;
    status: string;
    service_type: string;
    start_date: string;
    end_date: string | null;
    google_event_id: string | null;
    source: string | null;
    goes_to_daycare: boolean | null;
    dog: { id: string; name: string; client: { name: string } };
  };
  type LinhaDeSerie = LinhaDeReserva & { weekdays: number[] | null; active: boolean };
  type LinhaDeExcecao = {
    id: string;
    recurring_schedule_id: string;
    action: string;
    start_date: string;
    end_date: string | null;
    reason: string | null;
  };

  const listaReservas = ((reservas.data as unknown as LinhaDeReserva[]) ?? []).map((row) => ({
    id: row.id,
    kind: 'reservation' as const,
    dogId: row.dog.id,
    googleEventId: row.google_event_id ?? null,
    source: (row.source ?? 'app') as 'app' | 'google',
    serviceType: row.service_type as BookingForImport['serviceType'],
    startDate: row.start_date,
    endDate: row.end_date,
    weekdays: null,
    skipDates: null,
    status: row.status,
    // Contrato do cliente (28/09/2026): todo boarding passa pelo daycare, menos a chegada fora do
    // horário. Sem o campo aqui, o relógio do servidor comparava `undefined` e atualizava à toa.
    goesToDaycare: row.goes_to_daycare ?? true,
  }));

  const listaExcecoes = ((excecoes.data as unknown as LinhaDeExcecao[]) ?? []).map((row) => ({
    id: row.id,
    scheduleId: row.recurring_schedule_id,
    action: row.action,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
  }));

  const listaSeries = ((series.data as unknown as LinhaDeSerie[]) ?? [])
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id,
      kind: 'recurring' as const,
      dogId: row.dog.id,
      googleEventId: row.google_event_id ?? null,
      source: (row.source ?? 'app') as 'app' | 'google',
      serviceType: 'daycare' as const,
      startDate: row.start_date,
      endDate: row.end_date,
      weekdays: row.weekdays,
      skipDates: diasPausados(
        {
          id: row.id,
          weekdays: row.weekdays ?? [],
          startDate: row.start_date,
          endDate: row.end_date,
          active: true,
        } as never,
        listaExcecoes as never,
        horizonte,
      ),
      status: 'active' as const,
    }));

  const dogs: DogForImport[] = ((caes.data as unknown as { id: string; name: string; client: { name: string } }[]) ?? []).map(
    (row) => ({ id: row.id, name: row.name, clientName: row.client?.name ?? '' }),
  );

  return { dogs, bookings: [...listaReservas, ...listaSeries] };
}

async function sincronizarOrganizacao(
  admin: ReturnType<typeof createClient>,
  credencial: Credencial,
  dry: boolean,
): Promise<Record<string, unknown>> {
  const organizationId = credencial.organization_id;
  const registrar = async (resultado: string): Promise<void> => {
    await admin
      .from('google_calendar_credentials')
      .update({ last_sync_at: new Date().toISOString(), last_sync_result: resultado.slice(0, 900) })
      .eq('organization_id', organizationId);
  };

  try {
    const refreshToken = await decifrarTexto(credencial.refresh_token_encrypted);
    const accessToken = await accessTokenDoGoogle(refreshToken);
    const { dogs, bookings } = await carregarDadosDaOrganizacao(admin, organizationId);
    const calendarId = credencial.calendar_id ?? undefined;
    const labels = await getCalendarLabels(accessToken, fetch, calendarId ?? undefined).catch(() => []);
    const janela = janelaDeImportacao();

    const resumo = await runCalendarImport({
      accessToken,
      range: { timeMin: janela.timeMin, timeMax: janela.timeMax },
      window: { from: janela.from, to: janela.to },
      dogs,
      reservations: bookings,
      doFetch: fetch,
      // Em `dry` nada é escrito: as portas só contam.
      // `criadoPor`: sem JWT na função, o `default auth.uid()` de `created_by` vira NULL e o banco recusa
      // a criação (era o "0 criados · 6 falhas" do relógio). O autor é o gestor que conectou o calendário.
      ports: dry
        ? portasDeContagem()
        : supabaseImportPorts(admin, organizationId, { criadoPor: credencial.updated_by ?? null }),
      calendarId,
      labels,
    });

    /**
     * O QUE FICOU PARA REVISAR, NOMEADO (dono, 28/09/2026: *"o erro persiste, ele não está pegando os
     * agendamentos ao sincronizar"*).
     *
     * O resumo só contava "9 para revisar" — número que não diz nada a quem está do lado do telefone. Um
     * evento que o app não importa é justamente um agendamento que "não está sendo pego": aqui ele entra
     * com o TÍTULO e o MOTIVO (cão fora do cadastro, cor não reconhecida, dois cães com o mesmo nome,
     * duplicado), e é isso que o escritório precisa ver para resolver em minutos.
     */
    const pendencias = resumo.review
      .slice(0, 12)
      .map((item) => `"${item.title}" (${item.date}, ${item.reason})`)
      .join('; ');
    // E o MOTIVO das falhas, cru: é ele que diz se o problema é regra do app, permissão ou dado do
    // calendário. Sem isso, "6 falhas" no log não ajuda ninguém a corrigir.
    const falhas = resumo.failures
      .slice(0, 5)
      // Quem falhou, não só onde: com DOIS cães no mesmo evento, o id do evento não diz qual cão
      // ficou sem reserva (foi o caso do relógio em 28/09/2026).
      .map((item) => `${item.eventId ?? item.reservationId ?? '?'}${item.dogId ? ` · ${item.dogId}` : ''}` +
        `${item.serviceType ? ` · ${item.serviceType}` : ''}${item.semVinculo === undefined ? '' : ` · semVinculo=${item.semVinculo}`}: ${item.error}`)
      .join(' | ');
    const texto =
      `ok${dry ? ' (seco, sem escrever)' : ''} · ${resumo.created} criados · ${resumo.updated} atualizados · ` +
      `${resumo.cancelled} cancelados · ${resumo.extraDays ?? 0} dias extras · ${resumo.review.length} para revisar` +
      (pendencias ? ` [${pendencias}]` : '') +
      (resumo.failures.length ? ` · ${resumo.failures.length} falhas [${falhas}]` : '');
    await registrar(texto);
    return { organization_id: organizationId, ok: true, dry, resumo: texto };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    await registrar(`erro: ${mensagem}`);
    return { organization_id: organizationId, ok: false, erro: mensagem.slice(0, 200) };
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  // Sem o segredo não roda: esta função escreve no banco de um cliente.
  if (!CRON_SECRET || request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!CLIENT_ID) return json({ error: 'falta o segredo GOOGLE_OAUTH_CLIENT_ID' }, 500);

  const url = new URL(request.url);
  const apenasOrg = url.searchParams.get('org');
  const dry = url.searchParams.get('dry') === '1';

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let consulta = admin
    .from('google_calendar_credentials')
    .select('organization_id, refresh_token_encrypted, calendar_id, connected_email, updated_by');
  if (apenasOrg) consulta = consulta.eq('organization_id', apenasOrg);
  const { data, error } = await consulta;
  if (error) return json({ error: `nao foi possivel ler as credenciais (${error.message})` }, 500);

  const credenciais = (data as unknown as Credencial[]) ?? [];
  const resultados: Record<string, unknown>[] = [];
  for (const credencial of credenciais) {
    resultados.push(await sincronizarOrganizacao(admin, credencial, dry));
  }

  return json({ ok: true, dry, organizacoes: resultados.length, resultados });
});
