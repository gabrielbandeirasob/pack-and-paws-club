import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { CalendarConnectionCard, dentroDaJanela, janelaDeEspelho, janelaDeImportacao } from '@/features/integrations/google/CalendarConnectionCard';
import { TEXTO_FALTA_DE_ESCOPO, TEXTO_FALTA_DE_ESCOPO_CORES, TEXTO_SOMENTE_LEITURA } from '@/features/integrations/google/calendarChoice';
import type { LocalReservation } from '@/features/integrations/google/calendarSync';
import type { BookingForImport, DogForImport } from '@/features/integrations/google/importPlan';

jest.mock('@/features/integrations/google/useCalendarConnection');
jest.mock('@/features/integrations/google/sync', () => ({
  runCalendarSync: jest.fn(),
  describeSummary: jest.requireActual('@/features/integrations/google/sync').describeSummary,
}));
// A importacao e testada no seu proprio modulo; aqui o card so precisa dizer o que fez com o resumo.
jest.mock('@/features/integrations/google/importService', () => ({
  runCalendarImport: jest.fn(),
  hasImportChanges: jest.requireActual('@/features/integrations/google/importService').hasImportChanges,
}));
// A lista de calendarios e as cores do calendario vem da API do Google: aqui sao injetadas (nenhuma
// chamada de rede).
jest.mock('@/features/integrations/google/calendarApi', () => ({
  listCalendars: jest.fn(),
  getCalendarLabels: jest.fn(),
  CalendarApiError: jest.requireActual('@/features/integrations/google/calendarApi').CalendarApiError,
}));

/** O que está gravado na ORGANIZAÇÃO (a escolha é por organização, não por aparelho). */
let mockOrganizacao: { google_calendar_id: string | null; google_calendar_summary: string | null } = {
  google_calendar_id: null,
  google_calendar_summary: null,
};

const CAL_PRINCIPAL = 'raphael@packandpawsclub.com';
/** Calendário secundário do escritório: é nele que estão os agendamentos (o print do cliente). */
const CAL_BOT_VENDA = 'bot-venda@group.calendar.google.com';
const CAL_FERIADOS = 'feriados@group.calendar.google.com';

const contaCalendarios = [
  { id: CAL_PRINCIPAL, summary: CAL_PRINCIPAL, primary: true, accessRole: 'owner' },
  { id: CAL_BOT_VENDA, summary: 'bot venda', primary: false, accessRole: 'writer' },
  { id: CAL_FERIADOS, summary: 'Feriados', primary: false, accessRole: 'reader' },
];

/** Escritas no banco: o alvo e conferir o que a tela manda para o Supabase. */
const insercoes: { tabela: string; valores: Record<string, unknown> }[] = [];
const atualizacoes: { tabela: string; valores: Record<string, unknown> }[] = [];
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const chain: Record<string, unknown> = {};
      chain.insert = (valores: Record<string, unknown>) => {
        insercoes.push({ tabela, valores });
        return chain;
      };
      chain.update = (valores: Record<string, unknown>) => {
        atualizacoes.push({ tabela, valores });
        return chain;
      };
      chain.delete = () => chain;
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = async () => ({ data: { id: 'novo-id' }, error: null });
      chain.maybeSingle = async () => ({ data: mockOrganizacao, error: null });
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
      return chain;
    },
  },
}));

const useCalendarConnection = jest.requireMock('@/features/integrations/google/useCalendarConnection').useCalendarConnection as jest.Mock;
const runCalendarSync = jest.requireMock('@/features/integrations/google/sync').runCalendarSync as jest.Mock;
const runCalendarImport = jest.requireMock('@/features/integrations/google/importService').runCalendarImport as jest.Mock;
const listCalendars = jest.requireMock('@/features/integrations/google/calendarApi').listCalendars as jest.Mock;
const getCalendarLabels = jest.requireMock('@/features/integrations/google/calendarApi').getCalendarLabels as jest.Mock;

/** Conexao falsa no formato que o card consome. */
function conexao(status: 'not_configured' | 'disconnected' | 'connected', extras: Record<string, unknown> = {}) {
  return {
    status,
    email: status === 'connected' ? 'raphael@packandpawsclub.com' : null,
    connect: jest.fn().mockResolvedValue('connected'),
    disconnect: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue('token-123'),
    ...extras,
  };
}

const hoje = todayLocalISO();
const reservas: LocalReservation[] = [
  { id: 'res:futura', dogName: 'Mocha', clientName: 'Elisha', serviceType: 'daycare', startDate: addDaysISO(hoje, 3) },
  { id: 'res:antiga', dogName: 'Bob', clientName: 'Maria', serviceType: 'daycare', startDate: addDaysISO(hoje, -400) },
];

const dogs: DogForImport[] = [{ id: 'dog-luna', name: 'Luna', clientName: 'Maria' }];
const bookings: BookingForImport[] = [];
const onImported = jest.fn();

function props() {
  return { reservations: reservas, organizationId: 'org-1', dogs, bookings, onImported };
}

/**
 * Espera a escolha da organização chegar na tela (a leitura é assíncrona).
 * `toHaveTextContent` (e não `within(...).getByText`) porque a consulta dentro de um nó procura nos
 * FILHOS — o texto do próprio `Text` com testID não é encontrado assim.
 */
async function esperandoEscolha(screen: Awaited<ReturnType<typeof render>>, nome: string) {
  await waitFor(() => expect(screen.getByTestId('google-calendar-escolhido')).toHaveTextContent(nome));
}

describe('CalendarConnectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insercoes.length = 0;
    atualizacoes.length = 0;
    mockOrganizacao = { google_calendar_id: null, google_calendar_summary: null };
    runCalendarSync.mockResolvedValue({ created: 2, updated: 0, deleted: 1, failures: [] });
    runCalendarImport.mockResolvedValue({ created: 0, updated: 0, cancelled: 0, review: [], failures: [] });
    listCalendars.mockResolvedValue(contaCalendarios);
    getCalendarLabels.mockResolvedValue([]);
  });

  it('explica que o Google nao esta no build, em vez de mostrar botao que nao funciona', async () => {
    useCalendarConnection.mockReturnValue(conexao('not_configured'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    expect(screen.getByTestId('google-calendar-nao-configurado')).toBeTruthy();
    expect(screen.queryByTestId('google-calendar-connect')).toBeNull();
  });

  it('oferece conectar quando ha credencial no build e nenhuma conexao ainda', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    expect(ctx.connect).toHaveBeenCalled();
  });

  it('depois de conectar, ja espelha as reservas', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));
  });

  it('com a conta conectada, espelha SO a janela e resume o resultado', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    expect(screen.getByText(/raphael@packandpawsclub\.com/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));

    const chamada = runCalendarSync.mock.calls[0][0];
    expect(chamada.accessToken).toBe('token-123');
    // A reserva de 400 dias atras fica fora da janela (30 atras -> 180 a frente).
    expect(chamada.reservations.map((r: LocalReservation) => r.id)).toEqual(['res:futura']);
    await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
    // Texto do resumo no idioma da interface (inglês) — o cliente viu a mistura de idiomas.
    expect(screen.getByText(/2 created/)).toBeTruthy();
  });

  it('desconecta quando o gestor pede', async () => {
    const ctx = conexao('connected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-disconnect'));
    expect(ctx.disconnect).toHaveBeenCalled();
  });

  it('mostra o erro quando a sincronizacao falha de verdade', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected', { getAccessToken: jest.fn().mockRejectedValue(new Error('A conexão com o Google expirou. Conecte novamente.')) }));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
  });

  // ------------------------------------------------------------------ importacao (Google -> app)

  it('mostra o que veio do Google junto com o que foi enviado', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({ created: 2, updated: 1, cancelled: 0, review: [], failures: [] });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
    expect(screen.getByText(/2 from Google/)).toBeTruthy();
    // A agenda recarrega para o gestor ja ver as reservas que chegaram.
    expect(onImported).toHaveBeenCalled();
  });

  it('a importação consulta de HOJE para frente — a janela do espelho não vale para ela', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));

    // O espelho continua recuando 30 dias (o recuo evita evento duplicado no Google)...
    expect(runCalendarSync.mock.calls[0][0].range).toEqual(janelaDeEspelho());

    // ...a importação não: nada do passado entra, e a janela é o que também impede cancelar uma
    // reserva de ontem que veio do Google.
    const esperada = janelaDeImportacao();
    const chamada = runCalendarImport.mock.calls[0][0];
    expect(chamada.range).toEqual({ timeMin: esperada.timeMin, timeMax: esperada.timeMax });
    expect(chamada.window).toEqual({ from: esperada.from, to: esperada.to });
    expect(chamada.window.from).toBe(hoje);
    expect(chamada.window.to).toBe(addDaysISO(hoje, 180));
  });

  it('lista o que veio do Google sem nome utilizável, com o motivo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e1',
          title: '',
          date: '2026-10-05',
          reason: 'unreadable',
          parsed: { serviceType: 'daycare', cancels: false, dogName: '(no title)', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());
    expect(screen.getByText('From Google — not registered in the app')).toBeTruthy();
    expect(screen.getByText('(no title)')).toBeTruthy();
    expect(screen.getByText(/This event has no title — pick the dog and we save it/)).toBeTruthy();
    expect(screen.getByLabelText('Choose dog for ')).toBeTruthy();
  });

  it('cão não cadastrado aparece na lista de "not registered" com o motivo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-rex',
          title: 'Rex',
          date: '2026-10-05',
          reason: 'unknown dog',
          parsed: { serviceType: 'boarding', cancels: false, dogName: 'Rex', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());
    expect(screen.getByText(/No dog with this name in the app — register the dog and sync again/)).toBeTruthy();
    // O serviço veio da COR, então o gestor ainda pode ligar o evento a um cão daqui.
    expect(screen.getByLabelText('Choose dog for Rex')).toBeTruthy();
  });

  it('cor não reconhecida aparece na lista própria e NÃO oferece escolher cão (sem serviço não há reserva)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-sem-cor',
          title: 'Pietro',
          date: '2026-10-05',
          reason: 'unrecognized color',
          parsed: { serviceType: null, cancels: false, dogName: 'Pietro', startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-cor-desconhecida')).toBeTruthy());
    expect(screen.getByText('From Google — color not recognized')).toBeTruthy();
    expect(screen.getByText(/No service in this color — green is boarding, blue is daycare/)).toBeTruthy();
    // Sem cor o serviço é indefinido: nada de botão para gravar uma reserva sem `service_type`.
    expect(screen.queryByTestId('google-calendar-revisao')).toBeNull();
    expect(screen.queryByLabelText('Choose dog for Pietro')).toBeNull();
  });

  it('falha da importação mostra o MOTIVO da primeira falha, não só a contagem', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      review: [],
      failures: [
        {
          eventId: 'e-pietro',
          reservationId: undefined,
          error: 'new row for relation "reservations" violates check constraint "reservations_check"',
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    // Antes o gestor via só "1 item(s) from Google could not be saved" e o suporte ficava cego: agora
    // a tela diz QUAL foi o motivo da primeira falha (o erro cru do Postgres traduzido).
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
    expect(screen.getByTestId('google-calendar-erro')).toHaveTextContent(
      '1 item(s) from Google could not be saved. First: end_date before start_date',
    );
  });

  it('ao escolher o cão da revisão, cria a reserva com o evento gravado (anti-duplicata)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'e-rex',
          title: 'Boarding · Rex',
          date: '2026-10-05',
          reason: 'duplicate',
          parsed: { serviceType: 'boarding', cancels: false, dogName: 'Rex', startDate: '2026-10-05', endDate: '2026-10-07', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Choose dog for Boarding · Rex'));
    await fireEvent.press(screen.getByLabelText('Select dog'));
    await fireEvent.press(screen.getByLabelText('Select Luna of Maria'));
    await fireEvent.press(screen.getByTestId('google-calendar-salvar-revisao'));

    await waitFor(() => expect(insercoes.length).toBe(1));
    expect(insercoes[0].tabela).toBe('reservations');
    expect(insercoes[0].valores).toMatchObject({
      organization_id: 'org-1',
      dog_id: 'dog-luna',
      service_type: 'boarding',
      start_date: '2026-10-05',
      end_date: '2026-10-07',
      google_event_id: 'e-rex',
      source: 'google',
    });
    // A pendencia sai da lista.
    expect(screen.queryByTestId('google-calendar-revisao')).toBeNull();
  });

  // ------------------------------------------------------- calendário escolhido pela organização

  it('mostra a conta conectada (mesmo sem e-mail no token) e o calendário escolhido', async () => {
    // O token do app não pede escopo de e-mail: `email` chega nulo (era o defeito do print).
    useCalendarConnection.mockReturnValue(conexao('connected', { email: null }));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);

    // A conta aparece pelo nome do calendário PRINCIPAL da conta conectada...
    await waitFor(() => expect(screen.getByText(/Connected as raphael@packandpawsclub\.com/)).toBeTruthy());
    // ...e o calendário escolhido aparece no cartão.
    await esperandoEscolha(screen, 'bot venda');
    expect(screen.queryByTestId('google-calendar-padrao')).toBeNull();
  });

  it('sem escolha gravada, o padrão continua sendo o calendário principal', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await waitFor(() => expect(screen.getByTestId('google-calendar-padrao')).toBeTruthy());
    await esperandoEscolha(screen, 'Primary calendar');

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));
    expect(runCalendarSync.mock.calls[0][0].calendarId).toBe('primary');
    expect(runCalendarImport.mock.calls[0][0].calendarId).toBe('primary');
  });

  it('o Sync usa o calendário escolhido nas DUAS vias (espelho e importação)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await esperandoEscolha(screen, 'bot venda');
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));
    expect(runCalendarSync.mock.calls[0][0].calendarId).toBe(CAL_BOT_VENDA);
    expect(runCalendarImport.mock.calls[0][0].calendarId).toBe(CAL_BOT_VENDA);
  });

  it('trocar de calendário grava na ORGANIZAÇÃO e avisa que os eventos ficam no calendário antigo', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_BOT_VENDA, google_calendar_summary: 'bot venda' };
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await esperandoEscolha(screen, 'bot venda');

    await fireEvent.press(screen.getByTestId('google-calendar-trocar'));
    // O aviso é do calendário ATUAL: o que já foi espelhado continua lá.
    expect(screen.getByText(/does not move or delete anything there/)).toBeTruthy();
    expect(screen.getByText('Feriados')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Use calendar Feriados'));
    await fireEvent.press(screen.getByTestId('google-calendar-salvar-calendario'));

    await waitFor(() => expect(atualizacoes.length).toBe(1));
    expect(atualizacoes[0].tabela).toBe('organizations');
    expect(atualizacoes[0].valores).toEqual({ google_calendar_id: CAL_FERIADOS, google_calendar_summary: 'Feriados' });

    // A escolha nova vale na hora e o aviso da troca fica na tela.
    await esperandoEscolha(screen, 'Feriados');
    // RegExp (e não string) porque `toHaveTextContent` compara o conteúdo inteiro quando recebe texto.
    expect(screen.getByTestId('google-calendar-aviso-troca')).toHaveTextContent(/bot venda/);
  });

  it('calendário somente leitura: o espelho falha com uma frase que o gestor entende', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    mockOrganizacao = { google_calendar_id: CAL_FERIADOS, google_calendar_summary: 'Feriados' };
    runCalendarSync.mockResolvedValue({
      created: 0,
      updated: 0,
      deleted: 0,
      failures: [{ action: 'create', reservationId: 'res:futura', error: 'criar evento falhou (HTTP 403): The user does not have write access to this calendar.' }],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);
    await esperandoEscolha(screen, 'Feriados');

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
    expect(screen.getByTestId('google-calendar-erro')).toHaveTextContent(TEXTO_SOMENTE_LEITURA);
    // O erro cru da API não vai para a tela do gestor.
    expect(screen.queryByText(/HTTP 403/)).toBeNull();
    // E o cartão já avisa que ali não dá para espelhar.
    expect(screen.getByTestId('google-calendar-escolhido-acesso')).toHaveTextContent(TEXTO_SOMENTE_LEITURA);
  });

  it('token antigo (sem permissão de listar calendários) explica que é preciso reconectar', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    listCalendars.mockRejectedValue(new Error('listar calendários falhou (HTTP 403): Request had insufficient authentication scopes.'));
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-trocar'));

    await waitFor(() =>
      expect(screen.getByTestId('google-calendar-erro-calendarios')).toHaveTextContent(TEXTO_FALTA_DE_ESCOPO),
    );
    expect(screen.getByTestId('google-calendar-recarregar-calendarios')).toBeTruthy();
  });

  // --------------------------------------------------------- cores do calendário (bug 56, labels)

  it('mostra QUAL cor foi lida no item da lista (Cobalto #4A86E8) — o suporte para de adivinhar', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'ev-zara',
          title: 'zara',
          date: '2026-09-26',
          reason: 'unrecognized color',
          // O evento veio pintado com a etiqueta da paleta nova e SEM `colorId`: era o defeito de
          // produção (build 55) que fazia o agendamento do cão cadastrado virar "cor não reconhecida".
          parsed: {
            serviceType: null,
            color: { source: 'label', labelId: 'lab-amarela', labelName: 'Amarelo', backgroundColor: '#ffd666', colorId: null, meaning: null },
            cancels: false,
            dogName: 'zara',
            startDate: '2026-09-26',
            endDate: '2026-09-27',
            weekdays: [],
            skipDates: [],
            openEnded: false,
          },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-cor-desconhecida')).toBeTruthy());

    expect(screen.getByTestId('google-calendar-cor-ev-zara')).toHaveTextContent('Amarelo (#ffd666)');
  });

  it('mostra a cor lida também na lista de cão não cadastrado (nome + hex + colorId legado)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    runCalendarImport.mockResolvedValue({
      created: 0,
      updated: 0,
      cancelled: 0,
      failures: [],
      review: [
        {
          eventId: 'ev-rex',
          title: 'Rex',
          date: '2026-10-05',
          reason: 'unknown dog',
          parsed: {
            serviceType: 'daycare',
            color: { source: 'label', labelId: 'lab-azul', labelName: 'Cobalto', backgroundColor: '#4A86E8', colorId: '7', meaning: { kind: 'service', serviceType: 'daycare' } },
            cancels: false,
            dogName: 'Rex',
            startDate: '2026-10-05',
            endDate: '2026-10-06',
            weekdays: [],
            skipDates: [],
            openEnded: false,
          },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());

    expect(screen.getByTestId('google-calendar-cor-ev-rex')).toHaveTextContent('Cobalto (#4A86E8) · colorId 7 (Peacock)');
  });

  it('token sem o escopo das cores: o cartão explica que é preciso reconectar, sem erro cru', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    getCalendarLabels.mockRejectedValue(
      new Error('ler as cores do calendário falhou (HTTP 403): Request had insufficient authentication scopes.'),
    );
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await waitFor(() =>
      expect(screen.getByTestId('google-calendar-erro-etiquetas')).toHaveTextContent(TEXTO_FALTA_DE_ESCOPO_CORES),
    );
    expect(screen.queryByText(/insufficient authentication scopes/)).toBeNull();

    // E o Sync continua funcionando (o espelho cai no `colorId` legado).
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));
    expect(runCalendarSync.mock.calls[0][0].labels).toEqual([]);
  });

  it('as etiquetas do calendário são lidas uma vez e vão para AS DUAS vias (espelho e importação)', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    getCalendarLabels.mockResolvedValue([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
    const screen = await render(<CalendarConnectionCard {...props()} />);

    // RegExp (e não string): `toHaveTextContent` compara o conteúdo INTEIRO quando recebe texto.
    await waitFor(() => expect(screen.getByTestId('google-calendar-etiquetas')).toHaveTextContent(/1 custom color/));
    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarImport).toHaveBeenCalledTimes(1));

    expect(runCalendarSync.mock.calls[0][0].labels).toEqual([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
    expect(runCalendarImport.mock.calls[0][0].labels).toEqual([{ id: 'lab-azul', name: 'Cobalto', backgroundColor: '#4A86E8' }]);
  });
});
