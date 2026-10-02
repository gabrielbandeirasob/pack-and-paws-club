/**
 * VISTORIA (02/10/2026) — ESCRITAS DO CADASTRO DO CLIENTE QUE NÃO CONFERIAM LINHAS.
 *
 * Com RLS/policy, o PostgREST devolve SUCESSO com ZERO linha. Quem só olha `error` finge que gravou:
 * o cão "sumia" do formulário (ou o cliente era dado como apagado) sem o banco ter mudado nada.
 * Este arquivo prova, na TELA de verdade:
 *  - UPDATE de cão com 0 linhas = erro na tela e a tela NÃO sai;
 *  - DELETE de cão com 0 linhas = erro na tela e a tela NÃO sai;
 *  - DELETE do cliente com 0 linhas = erro e a tela NÃO sai;
 *  - ao excluir o cliente, as FOTOS dos cães saem do bucket (não ficam órfãs para sempre).
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockVoltar = jest.fn();
const mockWrites: string[] = [];
const mockStorageRemove = jest.fn().mockResolvedValue({ data: [{ name: 'ok' }], error: null });

const mockFoto = 'https://x.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/mowgli.jpg';

const mockCliente = {
  id: 'c-1',
  organization_id: 'org-1',
  source_contact_identifier: 'contato-9',
  name: 'Ana Souza',
  phone: '4155551234',
  second_owner_name: null,
  second_owner_phone: null,
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
  dogs: [{ id: 'dog-1', name: 'Mowgli', breed: null, behavior_notes: null, medical_notes: null, photo_url: mockFoto }],
  client_instructions: null,
};

/** Linhas que cada escrita devolve. `[]` = a policy bloqueou (0 linhas, mas SEM erro). */
let mockDogUpdateRows: unknown[] = [{ id: 'dog-1' }];
let mockDogDeleteRows: unknown[] = [{ id: 'dog-1' }];
let mockClientUpdateRows: unknown[] = [{ id: 'c-1' }];
let mockClientDeleteRows: unknown[] = [{ id: 'c-1' }];
const mockCounts = { reservations: 7, routeStops: 12 };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c-1' }),
  useRouter: () => ({ back: mockVoltar, push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/lib/supabase', () => {
  function builder(tabela: string) {
    let op = 'select';
    const b: Record<string, unknown> = {};
    const mesmo = () => b;
    for (const metodo of ['select', 'eq', 'in', 'gte', 'lt', 'lte', 'order', 'limit', 'single', 'maybeSingle']) {
      b[metodo] = mesmo;
    }
    b.update = () => { op = 'update'; mockWrites.push(`${tabela}.update`); return b; };
    b.delete = () => { op = 'delete'; mockWrites.push(`${tabela}.delete`); return b; };
    b.insert = () => { op = 'insert'; mockWrites.push(`${tabela}.insert`); return b; };
    b.upsert = () => { op = 'upsert'; mockWrites.push(`${tabela}.upsert`); return b; };
    b.then = (resolve: (v: unknown) => unknown) => {
      let resultado: unknown = { data: null, error: null, count: 0 };
      if (tabela === 'clients') {
        if (op === 'select') resultado = { data: mockCliente, error: null };
        else if (op === 'update') resultado = { data: mockClientUpdateRows, error: null };
        else if (op === 'delete') resultado = { data: mockClientDeleteRows, error: null };
      } else if (tabela === 'dogs') {
        if (op === 'select') resultado = { data: null, error: null };
        else if (op === 'update') resultado = { data: mockDogUpdateRows, error: null };
        else if (op === 'delete') resultado = { data: mockDogDeleteRows, error: null };
      } else if (tabela === 'reservations') {
        resultado = { data: null, error: null, count: mockCounts.reservations };
      } else if (tabela === 'route_stops') {
        resultado = { data: null, error: null, count: mockCounts.routeStops };
      } else if (tabela === 'client_instructions') {
        resultado = { data: op === 'select' ? null : [{ id: 'ins-1' }], error: null };
      }
      return Promise.resolve(resultado).then(resolve);
    };
    return b;
  }
  return {
    supabase: {
      from: (tabela: string) => builder(tabela),
      auth: { getUser: async () => ({ data: { user: { id: 'u-0' } } }) },
      storage: { from: () => ({ remove: mockStorageRemove }) },
    },
  };
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

const ultimo = (alertas: { buttons?: Botao[] }[]) => alertas[alertas.length - 1];

beforeEach(() => {
  mockWrites.length = 0;
  mockVoltar.mockClear();
  mockStorageRemove.mockClear();
  mockDogUpdateRows = [{ id: 'dog-1' }];
  mockDogDeleteRows = [{ id: 'dog-1' }];
  mockClientUpdateRows = [{ id: 'c-1' }];
  mockClientDeleteRows = [{ id: 'c-1' }];
  mockCounts.reservations = 7;
  mockCounts.routeStops = 12;
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('salvar cão que o banco não aceitou (0 linha) mostra erro e NÃO fecha a tela', async () => {
  const { spy } = capturarAlertas();
  mockDogUpdateRows = []; // policy bloqueou: 0 linhas, sem erro
  const tela = await render(<ClientEditScreen />);

  await waitFor(() => expect(tela.getByLabelText('Save client')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Save client'));

  await waitFor(() => expect(tela.getByText(/Could not save this dog/)).toBeTruthy());
  expect(mockWrites).toContain('dogs.update');
  expect(mockVoltar).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('remover cão que o banco não apagou (0 linha) mostra erro e NÃO fecha a tela', async () => {
  const { alertas, spy } = capturarAlertas();
  mockDogDeleteRows = [];
  const tela = await render(<ClientEditScreen />);

  await waitFor(() => expect(tela.getByLabelText('Remove Mowgli')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Remove Mowgli'));
  ultimo(alertas).buttons?.find((b) => b.text === 'Remove')?.onPress?.();
  await waitFor(() => expect(tela.getByLabelText('Keep Mowgli')).toBeTruthy());

  fireEvent.press(tela.getByLabelText('Save client'));
  await waitFor(() => expect(tela.getByText(/Could not remove this dog/)).toBeTruthy());
  expect(mockWrites).toContain('dogs.delete');
  expect(mockVoltar).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('excluir cliente que o banco não apagou (0 linha) mostra erro e NÃO fecha a tela', async () => {
  const { alertas, spy } = capturarAlertas();
  mockClientDeleteRows = [];
  const tela = await render(<ClientEditScreen />);

  await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Delete client'));
  ultimo(alertas).buttons?.find((b) => b.text === 'Delete')?.onPress?.(); // com histórico: abre a 2ª confirmação
  ultimo(alertas).buttons?.find((b) => b.text === 'Delete for good')?.onPress?.();

  await waitFor(() => expect(tela.getByText(/Could not delete this client/)).toBeTruthy());
  expect(mockWrites).toContain('clients.delete');
  expect(mockVoltar).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('ao excluir o cliente, as FOTOS dos cães saem do bucket (não ficam órfãs)', async () => {
  const { alertas, spy } = capturarAlertas();
  const tela = await render(<ClientEditScreen />);

  await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Delete client'));
  ultimo(alertas).buttons?.find((b) => b.text === 'Delete')?.onPress?.();
  ultimo(alertas).buttons?.find((b) => b.text === 'Delete for good')?.onPress?.();

  await waitFor(() => expect(mockStorageRemove).toHaveBeenCalledWith(['org-1/dog-1/mowgli.jpg']));
  await waitFor(() => expect(mockVoltar).toHaveBeenCalled());
  spy.mockRestore();
});

it('cliente sem histórico: a foto fica até "Done" (o Desfazer precisa dela) e sai ao confirmar', async () => {
  mockCounts.reservations = 0;
  mockCounts.routeStops = 0;
  const { alertas, spy } = capturarAlertas();
  const tela = await render(<ClientEditScreen />);

  await waitFor(() => expect(tela.getByLabelText('Delete client')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Delete client'));
  ultimo(alertas).buttons?.find((b) => b.text === 'Delete')?.onPress?.();

  await waitFor(() => expect(alertas.some((a) => a.title === 'Client deleted')).toBe(true));
  // Enquanto o Desfazer existe, o arquivo NÃO pode ser apagado (senão o cão voltaria com foto quebrada).
  expect(mockStorageRemove).not.toHaveBeenCalled();

  ultimo(alertas).buttons?.find((b) => b.text === 'Done')?.onPress?.();
  await waitFor(() => expect(mockStorageRemove).toHaveBeenCalledWith(['org-1/dog-1/mowgli.jpg']));
  spy.mockRestore();
});
