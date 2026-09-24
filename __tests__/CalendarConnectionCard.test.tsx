import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { CalendarConnectionCard, dentroDaJanela, janelaDeEspelho, janelaDeImportacao } from '@/features/integrations/google/CalendarConnectionCard';
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
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res);
      return chain;
    },
  },
}));

const useCalendarConnection = jest.requireMock('@/features/integrations/google/useCalendarConnection').useCalendarConnection as jest.Mock;
const runCalendarSync = jest.requireMock('@/features/integrations/google/sync').runCalendarSync as jest.Mock;
const runCalendarImport = jest.requireMock('@/features/integrations/google/importService').runCalendarImport as jest.Mock;

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

describe('CalendarConnectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    insercoes.length = 0;
    atualizacoes.length = 0;
    runCalendarSync.mockResolvedValue({ created: 2, updated: 0, deleted: 1, failures: [] });
    runCalendarImport.mockResolvedValue({ created: 0, updated: 0, cancelled: 0, review: [], failures: [] });
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
          parsed: { serviceType: 'daycare', dogName: '(no title)', clientName: null, startDate: '2026-10-05', endDate: '2026-10-06', weekdays: [], skipDates: [], openEnded: false },
        },
      ],
    });
    const screen = await render(<CalendarConnectionCard {...props()} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));

    await waitFor(() => expect(screen.getByTestId('google-calendar-revisao')).toBeTruthy());
    expect(screen.getByText('(no title)')).toBeTruthy();
    expect(screen.getByText(/This event has no title — pick the dog and we save it/)).toBeTruthy();
    expect(screen.getByLabelText('Choose dog for ')).toBeTruthy();
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
          parsed: { serviceType: 'boarding', dogName: 'Rex', clientName: null, startDate: '2026-10-05', endDate: '2026-10-07', weekdays: [], skipDates: [], openEnded: false },
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
});
