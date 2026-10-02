/**
 * PERFIL — campo de NOME editável pelo PRÓPRIO usuário (dono, 01/10/2026).
 *
 * O motorista corrige o nome que sai na mensagem ao cliente. A policy de self-update já permite; ainda
 * assim o `.select('id')` confere as LINHAS, porque o PostgREST devolve sucesso com 0 linhas quando a
 * policy bloqueia — sem isso o app diria "Name saved." com o nome de volta na recarga.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

/** Uma linha salva = update pegou; `[]` = a policy bloqueou (0 linhas, SEM erro). */
let mockUpdateRows: unknown[] = [];
let mockNomeAtual: string | null = 'Filó Rocha';
let mockUltimoUpdate: { full_name?: string } | null = null;

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'driver', view: 'driver', canSwitchView: false, setView: jest.fn(), isLoading: false }),
}));

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u-1', email: 'bella@packpawsclub.test' } } }),
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

jest.mock('@/lib/supabase', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    let atualizando = false;
    b.select = () => b;
    b.update = (payload: { full_name?: string }) => { atualizando = true; mockUltimoUpdate = payload; return b; };
    for (const metodo of ['eq', 'order', 'gte', 'lte', 'limit']) b[metodo] = () => b;
    b.maybeSingle = async () => (table === 'organization_members'
      ? { data: { created_at: '2026-03-14T12:00:00Z' }, error: null }
      : { data: { full_name: mockNomeAtual }, error: null });
    b.then = (resolve: (v: unknown) => unknown) => {
      let resultado: unknown = { data: null, error: null };
      if (table === 'profiles' && atualizando) {
        resultado = { data: mockUpdateRows, error: null };
        if (Array.isArray(mockUpdateRows) && mockUpdateRows.length > 0) mockNomeAtual = mockUltimoUpdate?.full_name ?? mockNomeAtual;
      }
      return Promise.resolve(resultado).then(resolve);
    };
    return b;
  }
  return { supabase: { from: (tabela: string) => builder(tabela) } };
});

import PerfilDaConta from '../app/(tabs)/profile';

describe('perfil — campo de nome', () => {
  beforeEach(() => { mockUpdateRows = []; mockNomeAtual = 'Filó Rocha'; mockUltimoUpdate = null; });

  it('0 linhas alteradas mostra erro (não finge que salvou)', async () => {
    mockUpdateRows = [];
    const tela = await render(<PerfilDaConta />);
    await waitFor(() => expect(tela.getByDisplayValue('Filó Rocha')).toBeTruthy());

    fireEvent.changeText(tela.getByLabelText('Your name'), 'Filó Rocha Lima');
    await waitFor(() => expect(tela.getByDisplayValue('Filó Rocha Lima')).toBeTruthy());
    fireEvent.press(tela.getByLabelText('Save name'));

    await waitFor(() => expect(tela.getByText('Could not save — your account may not have permission to change this profile.')).toBeTruthy());
  });

  it('1 linha salva: confirma, recarrega e o campo passa a mostrar o nome novo', async () => {
    mockUpdateRows = [{ id: 'u-1' }];
    const tela = await render(<PerfilDaConta />);
    await waitFor(() => expect(tela.getByDisplayValue('Filó Rocha')).toBeTruthy());

    fireEvent.changeText(tela.getByLabelText('Your name'), 'Filó Rocha Lima');
    await waitFor(() => expect(tela.getByDisplayValue('Filó Rocha Lima')).toBeTruthy());
    fireEvent.press(tela.getByLabelText('Save name'));

    await waitFor(() => expect(tela.getByText('Name saved.')).toBeTruthy());
    // recarregou: o campo (e o nome do cartão) passam a mostrar o valor persistido
    expect(tela.getByDisplayValue('Filó Rocha Lima')).toBeTruthy();
    expect(mockUltimoUpdate).toEqual({ full_name: 'Filó Rocha Lima' });
  });

  /**
   * 🪤 VISTORIA (02/10/2026) — RODINHA ETERNA.
   *
   * A tela usava `fullName === null` como "carregando". Com `full_name` NULO no banco (conta criada
   * sem nome) o `null` era dado, não espera — e a rodinha girava PARA SEMPRE, sem cartão, sem campo
   * de nome e sem o botão "Sign out" (que fica dentro do bloco escondido).
   */
  it('perfil SEM nome não trava em rodinha: mostra o cartão, "Add your name" e o Sign out', async () => {
    mockNomeAtual = null;
    const tela = await render(<PerfilDaConta />);

    await waitFor(() => expect(tela.getByLabelText('Sign out')).toBeTruthy());
    expect(tela.queryByTestId('profile-loading')).toBeNull();
    expect(tela.getByText('Add your name')).toBeTruthy();
  });
});
