import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { CalendarConnectionCard, dentroDaJanela, janelaDeEspelho } from '@/features/integrations/google/CalendarConnectionCard';
import type { LocalReservation } from '@/features/integrations/google/calendarSync';

jest.mock('@/features/integrations/google/useCalendarConnection');
jest.mock('@/features/integrations/google/sync', () => ({
  runCalendarSync: jest.fn(),
  describeSummary: jest.requireActual('@/features/integrations/google/sync').describeSummary,
}));

const useCalendarConnection = jest.requireMock('@/features/integrations/google/useCalendarConnection').useCalendarConnection as jest.Mock;
const runCalendarSync = jest.requireMock('@/features/integrations/google/sync').runCalendarSync as jest.Mock;

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

describe('CalendarConnectionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    runCalendarSync.mockResolvedValue({ created: 2, updated: 0, deleted: 1, failures: [] });
  });

  it('explica que o Google nao esta no build, em vez de mostrar botao que nao funciona', async () => {
    useCalendarConnection.mockReturnValue(conexao('not_configured'));
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    expect(screen.getByTestId('google-calendar-nao-configurado')).toBeTruthy();
    expect(screen.queryByTestId('google-calendar-connect')).toBeNull();
  });

  it('oferece conectar quando ha credencial no build e nenhuma conexao ainda', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    expect(ctx.connect).toHaveBeenCalled();
  });

  it('depois de conectar, ja espelha as reservas', async () => {
    const ctx = conexao('disconnected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    await fireEvent.press(screen.getByTestId('google-calendar-connect'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));
  });

  it('com a conta conectada, espelha SO a janela e resume o resultado', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected'));
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    expect(screen.getByText(/raphael@packandpawsclub\.com/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(runCalendarSync).toHaveBeenCalledTimes(1));

    const chamada = runCalendarSync.mock.calls[0][0];
    expect(chamada.accessToken).toBe('token-123');
    // A reserva de 400 dias atras fica fora da janela (30 atras -> 180 a frente).
    expect(chamada.reservations.map((r: LocalReservation) => r.id)).toEqual(['res:futura']);
    await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
    expect(screen.getByText(/2 criada\(s\)/)).toBeTruthy();
  });

  it('desconecta quando o gestor pede', async () => {
    const ctx = conexao('connected');
    useCalendarConnection.mockReturnValue(ctx);
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    await fireEvent.press(screen.getByTestId('google-calendar-disconnect'));
    expect(ctx.disconnect).toHaveBeenCalled();
  });

  it('mostra o erro quando a sincronizacao falha de verdade', async () => {
    useCalendarConnection.mockReturnValue(conexao('connected', { getAccessToken: jest.fn().mockRejectedValue(new Error('A conexão com o Google expirou. Conecte novamente.')) }));
    const screen = await render(<CalendarConnectionCard reservations={reservas} />);

    await fireEvent.press(screen.getByTestId('google-calendar-sync'));
    await waitFor(() => expect(screen.getByTestId('google-calendar-erro')).toBeTruthy());
  });
});

describe('janelaDeEspelho / dentroDaJanela', () => {
  it('cobre 30 dias atras e 180 a frente, em RFC3339', () => {
    const janela = janelaDeEspelho('2026-09-16');
    expect(janela).toEqual({ timeMin: '2026-08-17T00:00:00Z', timeMax: '2027-03-15T00:00:00Z' });
  });

  it('mantem a reserva que termina dentro da janela e descarta o passado distante', () => {
    const janela = janelaDeEspelho('2026-09-16');
    const lista: LocalReservation[] = [
      { id: 'a', dogName: 'A', clientName: 'A', serviceType: 'daycare', startDate: '2026-08-10', endDate: '2026-09-01' },
      { id: 'b', dogName: 'B', clientName: 'B', serviceType: 'daycare', startDate: '2026-01-01', endDate: '2026-01-05' },
      { id: 'c', dogName: 'C', clientName: 'C', serviceType: 'boarding', startDate: '2027-05-01', endDate: '2027-05-10' },
    ];
    expect(dentroDaJanela(lista, janela).map((r) => r.id)).toEqual(['a']);
  });
});
