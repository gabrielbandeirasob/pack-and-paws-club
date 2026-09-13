/**
 * Exclusao do cliente na tela de edicao (o que faltava no app).
 *
 * Fluxo real coberto aqui:
 * 1. cliente COM historico (7 reservas, 12 paradas de rota) -> primeiro alerta explica o que
 *    vai junto e oferece "Keep history (inactive)";
 * 2. escolher "Delete" abre a SEGUNDA confirmacao antes de apagar de verdade;
 * 3. apagar de verdade chama o DELETE em clients (o banco cascateia dogs/reservas/paradas) e
 *    volta para a lista;
 * 4. cliente SEM historico -> oferece DESFAZER, que reinsere cliente e caes com os mesmos ids;
 * 5. a saida reversivel (manter historico) so faz UPDATE de active = false;
 * 6. tirar um cachorro do cadastro avisa, marca e permite desfazer antes de salvar.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockChamadas: string[] = [];
const mockVoltar = jest.fn();
/** Contagens que a tela le para montar o aviso; cada teste ajusta o cenario. */
const mockCounts = { reservations: 7, routeStops: 12 };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c-1' }),
  useRouter: () => ({ back: mockVoltar, push: jest.fn(), replace: jest.fn() }),
}));

// O formulario importa o mapa preferido do gestor (AsyncStorage); no jest o modulo nativo nao existe.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('@/lib/supabase', () => {
  const cliente = {
    id: 'c-1',
    organization_id: 'org-1',
    source_contact_identifier: 'contato-9',
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
    b.insert = () => { b._op = 'insert'; return b; };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (b._op !== 'select') mockChamadas.push(`${tabela}.${b._op}`);
      if (tabela === 'clients') {
        if (b._op === 'select') return Promise.resolve({ data: cliente, error: null }).then(resolve);
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
      if (tabela === 'reservations') return Promise.resolve({ data: null, error: null, count: mockCounts.reservations }).then(resolve);
      if (tabela === 'route_stops') return Promise.resolve({ data: null, error: null, count: mockCounts.routeStops }).then(resolve);
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
  beforeEach(() => {
    mockChamadas.length = 0;
    mockVoltar.mockClear();
    mockCounts.reservations = 7;
    mockCounts.routeStops = 12;
  });

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
    // com historico perdido, desfazer NAO e oferecido
    expect(alertas.some((a) => a.title === 'Client deleted')).toBe(false);
    spy.mockRestore();
  });

  it('cliente sem historico: apaga e oferece DESFAZER, que reinsere com os mesmos ids', async () => {
    mockCounts.reservations = 0;
    mockCounts.routeStops = 0;
    const { alertas, spy } = capturarAlertas();
    const tela = await render(<ClientEditScreen />);

    await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
    expect(tela.getByText(/no booking history/)).toBeTruthy();

    fireEvent.press(tela.getByLabelText('Delete client'));
    const confirmacao = alertas[alertas.length - 1];
    expect(confirmacao.title).toBe('Delete this client?');
    expect(confirmacao.buttons?.some((b) => b.text === 'Keep history (inactive)')).toBe(false);

    confirmacao.buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    await waitFor(() => expect(mockChamadas).toContain('clients.delete'));

    const aviso = alertas[alertas.length - 1];
    expect(aviso.title).toBe('Client deleted');
    expect(aviso.message).toContain('Ana Souza');
    expect(mockVoltar).not.toHaveBeenCalled();

    aviso.buttons?.find((b) => b.text === 'Undo')?.onPress?.();
    await waitFor(() => expect(mockChamadas).toContain('clients.insert'));
    await waitFor(() => expect(mockChamadas).toContain('dogs.insert'));
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
