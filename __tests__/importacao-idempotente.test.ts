/**
 * IMPORTAÇÃO IDEMPOTENTE — o caso que o escritório viu em produção (27/09/2026).
 *
 * O que aconteceu: o gestor tocou em "Sync now" e a tela do Google Calendar mostrou
 * *"26 item(s) from Google could not be saved. First: this event already has a reservation"* — sem nada
 * de errado com o calendário dele.
 *
 * A causa estava na FOTOGRAFIA, não na regra: o plano decide criar/atualizar a partir da lista de
 * reservas que a tela carregou no foco da aba; numa rodada em que ela estava desatualizada, todo evento
 * que já tinha reserva parecia novo, e a criação batia no índice único
 * `reservations_google_event_unico (organization_id, google_event_id)` — 21 reservas já ligadas + 5 que
 * seriam atualizadas = exatamente as 26 linhas. Prova: a MESMA importação rodando no servidor (que lê o
 * banco na hora) devolveu `0 criados · 5 atualizados · 0 para revisar`.
 *
 * O que estes vetores travam daqui pra frente:
 *  1. a importação lê o banco na hora (fotografia fresca) em vez de confiar no estado da tela;
 *  2. violação de único NÃO é falha: é "já está no app" (informação, não erro vermelho);
 *  3. o mesmo evento não vira duas criações na mesma rodada (dois cães no mesmo título).
 */
import { describeImport } from '@/features/integrations/google/importPlan';
import type { BookingForImport, DogForImport, ParsedBooking } from '@/features/integrations/google/importPlan';
import { runCalendarImport, type ImportPorts } from '@/features/integrations/google/importService';
import type { CalendarFetch } from '@/features/integrations/google/calendarApi';
import { supabaseImportPorts } from '@/features/integrations/google/importPorts';
import {
  carregarSnapshotDaImportacao,
  montarCasosDaImportacao,
  type ReservaParaImportar,
  type SerieParaImportar,
} from '@/features/integrations/google/importSnapshot';

const JANELA = { timeMin: '2026-09-27T00:00:00Z', timeMax: '2027-03-26T00:00:00Z' };
const DESDE_HOJE = { from: '2026-09-27', to: '2027-03-26' };
const AZUL = '7';

/** O que o leitor de cor entrega: azul = daycare (mesma paleta do resto da suíte). */
const COR_AZUL: ParsedBooking['color'] = {
  source: 'colorId',
  labelId: null,
  labelName: null,
  backgroundColor: null,
  colorId: '7',
  meaning: { kind: 'service', serviceType: 'daycare' },
};

const PARSED_BASE = {
  serviceType: 'daycare' as const,
  color: COR_AZUL,
  cancels: false,
  dogName: 'Bella',
  startDate: '2026-09-28',
  endDate: '2026-09-28',
  weekdays: [],
  skipDates: [],
  transportRequired: true,
  openEnded: false,
};

const ERRO_UNICO = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "reservations_google_event_unico"',
};

function resposta(itens: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items: itens }) };
}

describe('fotografia fresca: o que o plano lê antes de decidir', () => {
  it('monta reservas e séries com o vínculo do evento (é ele que evita a criação repetida)', () => {
    const reservas: ReservaParaImportar[] = [
      { id: 'r1', dog_id: 'd1', service_type: 'boarding', start_date: '2026-10-05', end_date: '2026-10-08', google_event_id: 'ev-1', source: 'google', status: 'confirmed' },
      { id: 'r2', dog_id: 'd2', service_type: 'daycare', start_date: '2026-10-06', end_date: '2026-10-06', google_event_id: null, source: 'app', status: 'confirmed' },
    ];
    const series: SerieParaImportar[] = [
      { id: 's1', dog_id: 'd3', weekdays: [1, 3, 5], start_date: '2026-09-01', end_date: null, google_event_id: 'ev-2', source: 'google' },
    ];

    const casos = montarCasosDaImportacao(reservas, series);

    expect(casos).toHaveLength(3);
    expect(casos[0]).toMatchObject({ id: 'r1', kind: 'reservation', dogId: 'd1', googleEventId: 'ev-1', status: 'confirmed' });
    expect(casos[1]).toMatchObject({ id: 'r2', googleEventId: null, source: 'app' });
    expect(casos[2]).toMatchObject({ id: 's1', kind: 'recurring', weekdays: [1, 3, 5], status: 'active' });
  });

  it('lê o banco na hora da importação (reservas confirmadas + escalas ativas)', async () => {
    const caminhos: string[] = [];
    const cliente = {
      from: (tabela: string) => ({
        select: (colunas: string) => ({
          eq: (coluna1: string, valor1: string) => ({
            eq: async (coluna2: string, valor2: string) => {
              caminhos.push(`${tabela}:${coluna1}=${valor1}:${coluna2}=${valor2}`);
              return tabela === 'reservations'
                ? { data: [{ id: 'r1', dog_id: 'd1', service_type: 'daycare', start_date: '2026-09-28', end_date: '2026-09-28', google_event_id: 'ev-1', source: 'google', status: 'confirmed' }], error: null }
                : { data: [{ id: 's1', dog_id: 'd2', weekdays: [2], start_date: '2026-09-01', end_date: null, google_event_id: 'ev-9', source: 'google' }], error: null };
            },
          }),
        }),
      }),
    };

    const casos = await carregarSnapshotDaImportacao(cliente as never, 'org-1');

    expect(caminhos).toEqual(['reservations:organization_id=org-1:status=confirmed', 'recurring_schedules:organization_id=org-1:active=true']);
    expect(casos.map((caso) => caso.googleEventId)).toEqual(['ev-1', 'ev-9']);
  });

  it('se a leitura do banco falhar, o erro aparece (não segue com lista vazia em silêncio)', async () => {
    const cliente = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: 'permission denied' } }) }) }),
      }),
    };
    await expect(carregarSnapshotDaImportacao(cliente as never, 'org-1')).rejects.toThrow('permission denied');
  });
});

describe('violação de único = "já está no app", não falha', () => {
  function clienteQueRecusa(erro: { code: string; message: string }) {
    const chamadas: string[] = [];
    const no = (caminho: string) => ({
      eq: (coluna: string, valor: unknown) => no(`${caminho}:eq(${coluna}=${String(valor)})`),
      select: () => no(`${caminho}:select`),
      single: async () => {
        chamadas.push(caminho);
        return { data: null, error: erro };
      },
      then: async (resolve: (valor: { data: null; error: { code: string; message: string } }) => unknown) => {
        chamadas.push(caminho);
        return resolve({ data: null, error: erro });
      },
    });
    return {
      chamadas,
      from: (tabela: string) => ({ insert: () => no(`${tabela}:insert`) }),
    };
  }

  it('reserva que já existe no app devolve "already" (nada de erro vermelho)', async () => {
    const cliente = clienteQueRecusa(ERRO_UNICO);
    const portas = supabaseImportPorts(cliente as never, 'org-1');
    const parsed: ParsedBooking = PARSED_BASE;

    await expect(portas.createBooking({ eventId: 'ev-1', dogId: 'd1', kind: 'reservation', parsed })).resolves.toBe('already');
  });

  it('erro de verdade continua estourando (não engole tudo)', async () => {
    const cliente = clienteQueRecusa({ code: '42501', message: 'permission denied for table reservations' });
    const portas = supabaseImportPorts(cliente as never, 'org-1');
    const parsed: ParsedBooking = PARSED_BASE;

    await expect(portas.createBooking({ eventId: 'ev-1', dogId: 'd1', kind: 'reservation', parsed })).rejects.toThrow('permission denied');
  });

  it('o resumo conta "já no app" e a frase da tela diz isso, sem falha', async () => {
    const doFetch: CalendarFetch = async () => resposta([
      { id: 'ev-1', summary: 'Bella', colorId: AZUL, start: { date: '2026-09-28' }, end: { date: '2026-09-29' } },
    ]);
    const portas: ImportPorts = {
      createBooking: async () => 'already',
      updateBooking: async () => undefined,
      cancelBooking: async () => undefined,
      skipRecurringDay: async () => undefined,
      addScheduleExtraDay: async () => undefined,
    };

    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [{ id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' }],
      reservations: [],
      doFetch,
      ports: portas,
    });

    expect(resumo).toMatchObject({ created: 0, already: 1, failures: [] });
    expect(resumo.failures).toEqual([]);
    expect(
      describeImport({ created: resumo.created, already: resumo.already, updated: 0, cancelled: 0, review: 0 }),
    ).toBe('1 already in the app');
  });
});

describe('casa com dois cães: duas reservas, um vínculo só', () => {
  it('a 2ª reserva do MESMO evento nasce sem o vínculo (era o erro do índice único)', async () => {
    const doFetch: CalendarFetch = async () => resposta([
      { id: 'ev-dois', summary: 'Bella / Pietro', colorId: AZUL, start: { date: '2026-09-28' }, end: { date: '2026-09-29' } },
    ]);
    const criadas: { dogId: string; semVinculo: boolean }[] = [];
    const portas: ImportPorts = {
      createBooking: async ({ dogId, semVinculo }) => {
        criadas.push({ dogId, semVinculo: Boolean(semVinculo) });
        return 'created';
      },
      updateBooking: async () => undefined,
      cancelBooking: async () => undefined,
      skipRecurringDay: async () => undefined,
      addScheduleExtraDay: async () => undefined,
    };

    const resumo = await runCalendarImport({
      accessToken: 'tok',
      range: JANELA,
      window: DESDE_HOJE,
      dogs: [
        { id: 'dog-bella', name: 'Bella', clientName: 'Leigh Ann' },
        { id: 'dog-pietro', name: 'Pietro', clientName: 'Carlos' },
      ] as DogForImport[],
      reservations: [],
      doFetch,
      ports: portas,
    });

    // A operação quer as DUAS reservas ("é só uma parada": os dois cães vão juntos), e só a primeira
    // fica ligada ao evento — o banco só aceita um vínculo por evento, e era aí que morria com
    // "this event already has a reservation".
    expect(criadas).toEqual([
      { dogId: 'dog-bella', semVinculo: false },
      { dogId: 'dog-pietro', semVinculo: true },
    ]);
    expect(resumo.created).toBe(2);
    expect(resumo.failures).toEqual([]);
    expect(resumo.review).toEqual([]);
  });
});
