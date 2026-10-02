import { fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * TELA "Edit reservation" (aberta ao tocar numa reserva no calendário). Estava com 0% de cobertura.
 *
 * O que este arquivo prova:
 *  - carrega a reserva e PREENCHE o formulário (cão/cliente, datas, notas);
 *  - salvar com sucesso SAI da tela (`router.back`);
 *  - salvar que o banco NÃO aceitou (0 linhas — policy bloqueando; o PostgREST devolve SUCESSO com zero
 *    linha) mostra o erro e NÃO sai: era exatamente o defeito "salvou sem gravar" da vistoria 02/10/2026;
 *  - reserva não encontrada mostra "Reservation not found." em vez de tela em branco;
 *  - erro de leitura aparece na tela.
 */
let mockId: string | undefined = 'res-1';
const mockVoltar = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  useRouter: () => ({ back: mockVoltar, push: jest.fn(), replace: jest.fn() }),
}));

let mockReserva: unknown = null;
let mockLoadError: { message: string } | null = null;
let mockUpdateRows: unknown[] = [{ id: 'res-1' }];
let mockUpdateError: { message: string } | null = null;
const mockUpdatePayload = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      let op = 'select';
      const chain: Record<string, unknown> = {};
      const mesmo = () => chain;
      for (const metodo of ['select', 'eq', 'in', 'lte', 'gte', 'order', 'limit']) chain[metodo] = mesmo;
      chain.update = (payload: unknown) => {
        op = 'update';
        mockUpdatePayload(payload);
        return chain;
      };
      chain.maybeSingle = async () => ({ data: mockReserva, error: mockLoadError });
      chain.single = async () => ({ data: mockReserva, error: mockLoadError });
      chain.then = (res: (v: unknown) => unknown) => {
        const resultado = op === 'update' ? { data: mockUpdateRows, error: mockUpdateError } : { data: mockReserva, error: mockLoadError };
        return Promise.resolve(resultado).then(res);
      };
      return chain;
    },
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
  },
}));

const reservaBase = () => ({
  service_type: 'boarding',
  start_date: '2026-09-16',
  end_date: '2026-09-18',
  transport_required: true,
  status: 'confirmed',
  notes: 'Bring the leash',
  dog: { name: 'Milo', client: { name: 'Ana' } },
});

beforeEach(() => {
  mockId = 'res-1';
  mockReserva = reservaBase();
  mockLoadError = null;
  mockUpdateRows = [{ id: 'res-1' }];
  mockUpdateError = null;
  mockVoltar.mockClear();
  mockUpdatePayload.mockClear();
});

function renderTela() {
  const Tela = require('../app/reservation-edit').default;
  return render(<Tela />);
}

describe('tela Edit reservation', () => {
  it('carrega a reserva e preenche o formulário', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Ana · Milo')).toBeTruthy());

    expect(tela.getByText('Edit reservation')).toBeTruthy();
    expect(tela.getByText('Boarding')).toBeTruthy();
    expect(tela.getByText('Daycare')).toBeTruthy();
    // datas do formulário (campos Start/End) refletem o que veio do banco
    expect(tela.getByText('Wed, Sep 16')).toBeTruthy();
    expect(tela.getByText('Fri, Sep 18')).toBeTruthy();
    expect(tela.getByLabelText('Reservation notes').props.value).toBe('Bring the leash');
    // a reserva é de boarding, então o campo de fim existe (daycare mostraria só um dia)
    expect(tela.getByLabelText('End date')).toBeTruthy();
  });

  it('salvar com sucesso SAI da tela', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByLabelText('Save reservation')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Save reservation'));

    await waitFor(() => expect(mockVoltar).toHaveBeenCalled());
    expect(mockUpdatePayload).toHaveBeenCalledWith(
      expect.objectContaining({ service_type: 'boarding', start_date: '2026-09-16', end_date: '2026-09-18', status: 'confirmed' }),
    );
  });

  it('salvar que o banco NÃO aceitou (0 linhas) mostra erro e NÃO sai', async () => {
    mockUpdateRows = []; // policy bloqueou: sucesso com ZERO linha
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByLabelText('Save reservation')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Save reservation'));

    await waitFor(() => expect(tela.getByText(/Could not save the reservation/)).toBeTruthy());
    expect(mockVoltar).not.toHaveBeenCalled();
  });

  it('reserva não encontrada mostra "Reservation not found." em vez de tela em branco', async () => {
    mockId = undefined;
    mockReserva = null;
    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText('Reservation not found.')).toBeTruthy());
    expect(tela.queryByLabelText('Save reservation')).toBeNull();
  });

  it('erro de leitura da reserva aparece na tela', async () => {
    mockReserva = null;
    mockLoadError = { message: 'permission denied for table reservations' };
    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText('permission denied for table reservations')).toBeTruthy());
  });
});
