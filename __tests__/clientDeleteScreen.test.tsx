/**
 * Exclusao do cliente na tela de edicao (o que faltava no app).
 *
 * Fluxo real coberto aqui:
 * 1. cliente COM historico (7 reservas, 12 paradas de rota) -> primeiro alerta explica o que
 *    vai junto e oferece "Keep history (inactive)";
 * 2. escolher "Delete" abre a SEGUNDA confirmacao antes de apagar de verdade;
 * 3. apagar de verdade chama o DELETE em clients (o banco cascateia dogs/reservas/paradas) e
 *    volta para a lista;
 * 4. a saida reversivel (manter historico) so faz UPDATE de active = false.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockChamadas: string[] = [];
const mockVoltar = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c-1' }),
  useRouter: () => ({ back: mockVoltar, push: jest.fn(), replace: jest.fn() }),
}));

// O formulario importa o mapa preferido do gestor (AsyncStorage); no jest o modulo nativo nao existe.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('@/lib/supabase', () => {
  const cliente = {
    id: 'c-1',
    name: 'Ana Souza',
    phone: '4155551234',
    address_line_1: '100 Market St',
    address_line_2: null,
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94103',
    notes: null,
    special_scheduling_instructions: null,
    latitude: 37.79,
    longitude: -122.4,
    active: true,
    dogs: [{ id: 'dog-1', name: 'Mowgli', breed: null, behavior_notes: null, medical_notes: null }],
    client_instructions: null,
  };
  function builder(tabela: string) {
    const b: Record<string, unknown> & { _op: string } = { _op: 'select' };
    b.select = () => b;
    b.eq = () => b;
    b.in = () => b;
    b.gte = () => b;
    b.single = () => b;
    b.update = () => { b._op = 'update'; return b; };
    b.delete = () => { b._op = 'delete'; return b; };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (tabela === 'clients') {
        if (b._op === 'delete') { mockChamadas.push('clients.delete'); return Promise.resolve({ data: null, error: null }).then(resolve); }
        if (b._op === 'update') { mockChamadas.push('clients.update'); return Promise.resolve({ data: null, error: null }).then(resolve); }
        return Promise.resolve({ data: cliente, error: null }).then(resolve);
      }
      if (tabela === 'reservations') return Promise.resolve({ data: null, error: null, count: 7 }).then(resolve);
      if (tabela === 'route_stops') return Promise.resolve({ data: null, error: null, count: 12 }).then(resolve);
      return Promise.resolve({ data: null, error: null, count: 0 }).then(resolve);
    };
    return b;
  }
  return { supabase: { from: (tabela: string) => builder(tabela), auth: { getUser: async () => ({ data: { user: { id: 'u-0' } } }) } } };
});

import ClientEditScreen from '@/app/client-edit';

type Botao = { text?: string; onPress?: () => void };

function capturarAlertas() {
  const alertas: { title?: string; message?: string; buttons?: Botao[] }[] = [];
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((title?: string, message?: string, buttons?: unknown) => {
    alertas.push({ title, message, buttons: buttons as Botao[] });
  });
  return { alertas, spy };
}

describe('excluir cliente', () => {
  beforeEach(() => { mockChamadas.length = 0; mockVoltar.mockClear(); });

  it('avisa o historico (reservas e rotas) antes de apagar e exige a segunda confirmacao', async () => {
    const { alertas, spy } = capturarAlertas();
    const tela = await render(<ClientEditScreen />);

    // a tela mostra o resumo do impacto junto do botao
    await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
    expect(tela.getByText(/7 booking\(s\)/)).toBeTruthy();

    fireEvent.press(tela.getByLabelText('Delete client'));
    const primeiro = alertas[alertas.length - 1];
    expect(primeiro.title).toBe('Delete client with history?');
    expect(primeiro.message).toContain('12 route stops');
    expect(primeiro.buttons?.some((b) => b.text === 'Keep history (inactive)')).toBe(true);

    // escolher Delete ainda NAO apaga: abre a segunda confirmacao
    primeiro.buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    const segundo = alertas[alertas.length - 1];
    expect(segundo.title).toBe('Last check');
    expect(mockChamadas).not.toContain('clients.delete');

    segundo.buttons?.find((b) => b.text === 'Delete for good')?.onPress?.();
    await waitFor(() => expect(mockChamadas).toContain('clients.delete'));
    await waitFor(() => expect(mockVoltar).toHaveBeenCalled());
    spy.mockRestore();
  });

  it('tirar um cachorro do cadastro: avisa, marca como removido e da para desfazer', async () => {
    const { alertas, spy } = capturarAlertas();
    const tela = await render(<ClientEditScreen />);

    await waitFor(() => expect(tela.getByLabelText('Remove Mowgli')).toBeTruthy());
    fireEvent.press(tela.getByLabelText('Remove Mowgli'));

    const aviso = alertas[alertas.length - 1];
    expect(aviso.title).toBe('Remove Mowgli?');
    expect(aviso.message).toContain('Mowgli');
    expect(aviso.message).toContain('calendar');

    aviso.buttons?.find((b) => b.text === 'Remove')?.onPress?.();
    await waitFor(() => expect(tela.getByLabelText('Keep Mowgli')).toBeTruthy());
    expect(tela.getByText(/will be removed/)).toBeTruthy();

    // desfazer antes de salvar
    fireEvent.press(tela.getByLabelText('Keep Mowgli'));
    await waitFor(() => expect(tela.getByLabelText('Remove Mowgli')).toBeTruthy());
    spy.mockRestore();
  });

  it('a saida reversivel so desliga o cliente (UPDATE), sem apagar nada', async () => {
    const { alertas, spy } = capturarAlertas();
    const tela = await render(<ClientEditScreen />);

    await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
    fireEvent.press(tela.getByLabelText('Delete client'));
    alertas[alertas.length - 1].buttons?.find((b) => b.text === 'Keep history (inactive)')?.onPress?.();

    await waitFor(() => expect(mockChamadas).toContain('clients.update'));
    expect(mockChamadas).not.toContain('clients.delete');
    await waitFor(() => expect(mockVoltar).toHaveBeenCalled());
    spy.mockRestore();
  });
});
