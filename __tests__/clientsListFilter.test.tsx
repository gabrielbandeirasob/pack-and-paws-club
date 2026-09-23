/**
 * Filtro de clientes inativos na lista.
 *
 * Regra: inativo NAO some sozinho (o arquivado ainda e dado do negocio) e ativo vem primeiro.
 * O gestor esconde quando quiser, e o botao diz quantos estao escondidos.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ClientsList } from '@/features/clients/ClientsList';
import type { ClientWithDogs } from '@/features/clients/types';

const clientes: ClientWithDogs[] = [
  { id: 'c-1', name: 'Ana Souza', phone: '4155551234', address_line_1: '100 Market St', city: 'San Francisco', state: 'CA', active: true, dogs: [{ name: 'Mowgli' }] },
  { id: 'c-2', name: 'Zeca Antigo', phone: null, address_line_1: null, city: null, state: null, active: false, dogs: [] },
];

describe('filtro de inativos', () => {
  it('mostra os inativos por padrao, com o botao dizendo quantos sao', async () => {
    const tela = await render(<ClientsList clients={clientes} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    expect(tela.getByText('Ana Souza')).toBeTruthy();
    expect(tela.getByText('Zeca Antigo')).toBeTruthy();
    expect(tela.getByText('INACTIVE')).toBeTruthy();
    expect(tela.getByLabelText('Hide inactive clients')).toBeTruthy();
  });

  it('esconde os inativos quando o gestor pede (e da para voltar)', async () => {
    const tela = await render(<ClientsList clients={clientes} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);

    await fireEvent.press(tela.getByLabelText('Hide inactive clients'));
    await waitFor(() => expect(tela.queryByText('Zeca Antigo')).toBeNull());
    expect(tela.getByText('Ana Souza')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Show inactive clients'));
    await waitFor(() => expect(tela.getByText('Zeca Antigo')).toBeTruthy());
  });

  it('sem inativos o botao nem aparece', async () => {
    const tela = await render(<ClientsList clients={[clientes[0]]} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    expect(tela.queryByLabelText('Hide inactive clients')).toBeNull();
  });
});
