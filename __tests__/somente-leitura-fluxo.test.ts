/**
 * FLUXO DE IMPORTAÇÃO COM UM "GOOGLE SOMENTE-LEITURA" (05/10/2026).
 *
 * Isto é o teste que fecha a conta da decisão do dono (*"quero que o aplicativo apenas importe do
 * cliente… remover essa capacidade dele de criar ou mudar o calendário do cliente"*): em vez de checar
 * o código com os olhos, o teste liga o app num **servidor Google falso que ACEITA apenas GET** e roda
 * o fluxo real do gestor de ponta a ponta.
 *
 * Se qualquer parte do app tentar escrever (criar/alterar/apagar evento), a requisição:
 *   * é registrada como ESCRITA (o teste fica vermelho no fim, com o método e a URL), e
 *   * recebe HTTP 403 do "Google", como o Google de verdade faria com um token de leitura.
 *
 * E o mais importante: o fluxo precisa funcionar sem escrever nada — 1 reserva importada (cão
 * cadastrado + cor verde = boarding) e 1 pendência (cão fora do cadastro).
 *
 * Fica este arquivo como a rede de segurança de COMPORTAMENTO; a de CÓDIGO (varredura de fontes,
 * escopos OAuth e módulos do espelho) é `__tests__/sem-escrita-no-google.test.ts`.
 */
import {
  CALENDAR_API,
  getCalendarLabels,
  listAllEvents,
  listCalendars,
  type CalendarFetch,
} from '@/features/integrations/google/calendarApi';
import { DEFAULT_CALENDAR_ID, ordenarCalendarios, interpretarCalendarios } from '@/features/integrations/google/calendarChoice';
import { runCalendarImport, type ImportPorts } from '@/features/integrations/google/importService';
import type { BookingForImport, DogForImport } from '@/features/integrations/google/importPlan';

const CALENDARIO = 'bot-venda@group.calendar.google.com';
const JANELA = { from: '2026-10-05', to: '2027-04-03' };
const RANGE = { timeMin: '2026-10-05T00:00:00Z', timeMax: '2027-04-03T00:00:00Z' };

const CAES: DogForImport[] = [{ id: 'dog-luna', name: 'Luna', clientName: 'Maria' }];
const RESERVAS: BookingForImport[] = [];

/** Eventos como o escritório tem no calendário: um cão cadastrado (verde = boarding) e um sem cadastro. */
const EVENTOS = [
  {
    id: 'ev-luna',
    summary: 'Luna',
    start: { date: '2026-10-06' },
    end: { date: '2026-10-08' },
    colorId: '2', // Sage (verde) = boarding
  },
  {
    id: 'ev-zeus',
    summary: 'Zeus',
    start: { date: '2026-10-07' },
    end: { date: '2026-10-08' },
    colorId: '7', // Peacock (azul) = daycare
  },
];

const ETIQUETAS = {
  labelProperties: {
    eventLabels: [
      { id: 'lab-peacock', name: 'Peacock', backgroundColor: '#039be5' },
      { id: 'lab-basil', name: 'Basil', backgroundColor: '#0b8043' },
    ],
  },
};

/**
 * "Google" que só aceita GET. Qualquer outro método devolve 403 e entra na lista `escritas` — o teste
 * falha se essa lista não estiver vazia no fim.
 */
function googleSomenteLeitura() {
  const chamadas: string[] = [];
  const escritas: { metodo: string; url: string }[] = [];

  const doFetch: CalendarFetch = async (url, init) => {
    const metodo = init.method || 'GET';
    chamadas.push(`${metodo} ${url.replace(CALENDAR_API, '').split('?')[0]}`);
    if (metodo !== 'GET') {
      escritas.push({ metodo, url: url.slice(0, 160) });
      return { ok: false, status: 403, json: async () => ({ error: { message: 'Request had insufficient authentication scopes.' } }) };
    }
    // Lista de calendários da conta (o seletor).
    if (url.includes('/users/me/calendarList')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            { id: 'raphael@packandpawsclub.com', summary: 'Raphael', primary: true, accessRole: 'owner' },
            { id: CALENDARIO, summary: 'bot venda', accessRole: 'writer' },
          ],
        }),
      };
    }
    // Propriedades do calendário (as etiquetas de cor).
    if (/\/calendars\/[^/]+$/.test(url.split('?')[0])) {
      return { ok: true, status: 200, json: async () => ({ id: CALENDARIO, ...ETIQUETAS }) };
    }
    // Eventos da janela.
    if (url.includes('/events')) {
      return { ok: true, status: 200, json: async () => ({ items: EVENTOS }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  return { doFetch, chamadas, escritas };
}

/** Portas de memória: anotam o que o app GRAVARIA no banco (nada de Supabase aqui). */
function portasDeMemoria() {
  // `serviceType` pode ser `null` (evento sem cor/serviço): o tsc pegou isso — o jest NÃO typechecka.
  const criadas: { eventId: string; dogId: string; serviceType?: string | null; startDate?: string }[] = [];
  const ports: ImportPorts = {
    createBooking: async ({ eventId, dogId, parsed }) => {
      criadas.push({ eventId, dogId, serviceType: parsed.serviceType, startDate: parsed.startDate });
      return 'created';
    },
    updateBooking: async () => undefined,
    cancelBooking: async () => undefined,
    skipRecurringDay: async () => undefined,
    addScheduleExtraDay: async () => undefined,
  };
  return { ports, criadas };
}

describe('importação com o Google SOMENTE-LEITURA', () => {
  it('importa o agendamento do escritório sem NENHUMA requisição de escrita', async () => {
    const google = googleSomenteLeitura();
    const { ports, criadas } = portasDeMemoria();

    // 1) escolher o calendário (o app lê a lista da conta)
    const conta = ordenarCalendarios(interpretarCalendarios(await (await google.doFetch(`${CALENDAR_API}/users/me/calendarList`, { method: 'GET', headers: {} })).json()));
    expect(conta[0].summary).toBe('Raphael');
    const escolhido = conta.find((c) => c.summary === 'bot venda')!.id;

    // 2) ler as cores do calendário escolhido
    const etiquetas = await getCalendarLabels('token', google.doFetch, escolhido);
    expect(etiquetas.map((e) => e.name)).toEqual(['Peacock', 'Basil']);

    // 3) listar os eventos da janela
    const eventos = await listAllEvents('token', RANGE, google.doFetch, escolhido);
    expect(eventos.map((e) => e.id)).toEqual(['ev-luna', 'ev-zeus']);

    // 4) aplicar a importação (a MESMA regra do app e do robô do servidor)
    const resumo = await runCalendarImport({
      accessToken: 'token',
      range: RANGE,
      window: JANELA,
      dogs: CAES,
      reservations: RESERVAS,
      doFetch: google.doFetch,
      ports,
      calendarId: escolhido,
      labels: etiquetas,
    });

    // O agendamento do cão cadastrado entrou (verde = boarding)…
    expect(criadas).toEqual([
      { eventId: 'ev-luna', dogId: 'dog-luna', serviceType: 'boarding', startDate: '2026-10-06' },
    ]);
    expect(resumo.created).toBe(1);
    // …e o cão fora do cadastro virou pendência, não cadastro novo (regra do dono, 24/09/2026).
    expect(resumo.review.map((r) => `${r.title}:${r.reason}`)).toEqual(['Zeus:unknown dog']);

    // A PROVA: nenhuma escrita saiu para o Google em nenhum passo.
    expect(google.escritas).toEqual([]);
    for (const chamada of google.chamadas) expect(chamada.startsWith('GET ')).toBe(true);
  });

  it('o calendário padrão continua sendo `primary` quando ninguém escolheu', () => {
    expect(DEFAULT_CALENDAR_ID).toBe('primary');
  });
});
