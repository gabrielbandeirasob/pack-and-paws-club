/**
 * SALVAR MOTORISTA — a ALTERAÇÃO QUE NÃO PEGOU tem de virar ERRO.
 *
 * Bug relatado pelo cliente (01/10/2026): o gestor corrigia o nome de um motorista, o app dizia que
 * salvou e o nome voltava na recarga — *"tentou corrigir e voltava"*. Causa: `profiles` só permitia
 * UPDATE da própria linha; quando a policy bloqueia, o PostgREST devolve SUCESSO (sem erro) com
 * **0 linhas**. O app só olhava `error` e fingia que salvou.
 *
 * O conserto: `.select('id')` + tratar `data` vazio como FALHA. Aqui se prova as duas pontas —
 * 0 linhas MOSTRA ERRO; 1 linha salva normalmente.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const membros = [
  { user_id: 'u-1', status: 'active', role: 'driver', profiles: { full_name: 'Sam Costa' } },
];

/** O que cada UPDATE devolve. `[]` = a policy bloqueou (0 linhas, mas SEM erro). */
let mockProfileRows: unknown[] = [];
let mockMemberRows: unknown[] = [];

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

jest.mock('@/features/drivers/DriverInviteForm', () => ({ DriverInviteForm: () => null }));

jest.mock('@/lib/supabase', () => {
  function builder(table: string) {
    let papel = '';
    let atualizando = false;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.update = () => { atualizando = true; return b; };
    b.eq = (campo: string, valor: string) => { if (campo === 'role') papel = valor; return b; };
    for (const metodo of ['order', 'limit', 'gte', 'lt']) b[metodo] = () => b;
    b.delete = () => b;
    b.then = (resolve: (v: unknown) => unknown) => {
      let resultado: unknown = { data: null, error: null, count: 0 };
      if (table === 'organization_members') {
        if (atualizando) resultado = { data: mockMemberRows, error: null };
        else resultado = papel === 'manager'
          ? { data: [{ organization_id: 'org-1' }], error: null }
          : { data: membros, error: null };
      } else if (table === 'profiles') {
        resultado = { data: mockProfileRows, error: null };
      } else if (table === 'routes') {
        resultado = { data: null, error: null, count: 0 };
      }
      return Promise.resolve(resultado).then(resolve);
    };
    return b;
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-0' } } }) },
      from: (tabela: string) => builder(tabela),
    },
  };
});

import DriversScreen from '@/app/drivers';

async function abrirEDispararSalvar() {
  const tela = await render(<DriversScreen />);
  fireEvent.press(await tela.findByLabelText('Edit Sam Costa'));
  await waitFor(() => expect(tela.getByText('Edit team member')).toBeTruthy());
  await waitFor(() => expect(tela.getByLabelText('Save driver')).toBeTruthy());
  fireEvent.press(tela.getByLabelText('Save driver'));
  return tela;
}

describe('salvar motorista — 0 linhas alteradas é FALHA, não sucesso', () => {
  beforeEach(() => { mockProfileRows = []; mockMemberRows = []; });

  it('0 linhas no profiles (policy bloqueou) mostra "Could not save" e NÃO fecha o modal', async () => {
    mockProfileRows = [];
    mockMemberRows = [{ id: 'u-1' }];
    const alertas: { title?: string; message?: string }[] = [];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation((title?: string, message?: string) => {
      alertas.push({ title, message });
    });

    const tela = await abrirEDispararSalvar();

    await waitFor(() => expect(alertas.some((a) => a.title === 'Could not save')).toBe(true));
    const erro = alertas.find((a) => a.title === 'Could not save');
    expect(erro?.message).toBe('The name was not saved — your account may not have permission to change this profile.');
    // o modal continua aberto: nada de fingir que salvou
    expect(tela.getByText('Edit team member')).toBeTruthy();

    alerta.mockRestore();
  });

  it('0 linhas no organization_members (status) também mostra "Could not save"', async () => {
    mockProfileRows = [{ id: 'u-1' }];
    mockMemberRows = [];
    const alertas: { title?: string; message?: string }[] = [];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation((title?: string, message?: string) => {
      alertas.push({ title, message });
    });

    await abrirEDispararSalvar();

    await waitFor(() => expect(alertas.some((a) => a.title === 'Could not save')).toBe(true));
    const erro = alertas.find((a) => a.title === 'Could not save');
    expect(erro?.message).toBe('The status was not saved — your account may not have permission to change this member.');

    alerta.mockRestore();
  });

  it('1 linha salva normalmente: fecha o modal e NÃO mostra erro', async () => {
    mockProfileRows = [{ id: 'u-1' }];
    mockMemberRows = [{ id: 'u-1' }];
    const alertas: { title?: string }[] = [];
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation((title?: string) => {
      alertas.push({ title });
    });

    const tela = await abrirEDispararSalvar();

    await waitFor(() => expect(tela.queryByText('Edit team member')).toBeNull());
    expect(alertas.some((a) => a.title === 'Could not save')).toBe(false);

    alerta.mockRestore();
  });
});
