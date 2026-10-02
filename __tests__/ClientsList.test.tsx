import { fireEvent, render } from '@testing-library/react-native';
import { ClientsList } from '@/features/clients/ClientsList';
import type { ClientWithDogs } from '@/features/clients/types';

/**
 * Espiões do serviço de clientes: provam que a ordenação/filtro são MEMOIZADOS (não refeitos a cada
 * render). O comportamento visível continua o mesmo — os testes abaixo usam a implementação real.
 */
jest.mock('@/features/clients/clientsService', () => {
  const real = jest.requireActual('@/features/clients/clientsService');
  return {
    ...real,
    inactiveCount: jest.fn(real.inactiveCount),
    sortClientsForList: jest.fn(real.sortClientsForList),
    filterClients: jest.fn(real.filterClients),
  };
});

const clients: ClientWithDogs[] = [
  {
    id: '1',
    name: 'Maria Silva',
    phone: '+55 62 99999-0000',
    address_line_1: '123 Main St',
    city: 'Goiania',
    state: 'GO',
    active: true,
    dogs: [{ name: 'Bob', photo_url: 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/bob.jpg' }],
  },
  { id: '2', name: 'Joao Souza', phone: null, address_line_1: null, city: null, state: null, active: false, dogs: [{ name: 'Luna' }, { name: 'Max', photo_url: null }] },
];

describe('ClientsList', () => {
  it('renders clients with their dogs', async () => {
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Joao Souza')).toBeTruthy();
    expect(screen.getByText('Luna')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
  });

  it('shows an empty state and the add button', async () => {
    const onAdd = jest.fn();
    const screen = await render(<ClientsList clients={[]} loading={false} onAddClient={onAdd} onOpenClient={jest.fn()} />);
    expect(screen.getByText('No clients yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add from Contacts' })).toBeTruthy();
  });

  it('abre a edicao ao tocar no cliente (era impossivel editar endereco)', async () => {
    const onOpenClient = jest.fn();
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={onOpenClient} />);
    fireEvent.press(screen.getByLabelText('Edit Maria Silva'));
    expect(onOpenClient).toHaveBeenCalledWith('1');
  });

  it('marca cliente inativo (para poder reativar depois)', async () => {
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    expect(screen.getByText('INACTIVE')).toBeTruthy();
  });

  it('mostra a FOTO do cao já na primeira tela (sem abrir o cliente)', async () => {
    // Pedido do Gabriel (23/09/2026): "quero que na parte dos clientes tenha foto dos cachorros
    // na primeira tela e não apenas quando aperta para editar".
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    expect(screen.getByLabelText('Photo of Bob')).toBeTruthy();
    // quem nao tem foto aparece so com o nome — nunca um espaco/imagem quebrada
    expect(screen.getByText('Luna')).toBeTruthy();
    expect(screen.queryByLabelText('Photo of Luna')).toBeNull();
    expect(screen.queryByLabelText('Photo of Max')).toBeNull();
  });

  it('busca continua achando o cliente pelo nome do cao (com foto no card)', async () => {
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Search clients'), 'bob');
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.queryByText('Joao Souza')).toBeNull();
  });

  /**
   * 🪤 VISTORIA (02/10/2026): a lista era um `ScrollView` que montava TODOS os clientes de uma vez
   * (cada cartão com foto de cão) — com centenas de famílias a tela fica pesada. Agora é `FlatList`
   * (virtualizada): aqui se prova que, com 200 clientes, a tela monta só a PRIMEIRA janela.
   */
  it('a lista é virtualizada: 200 clientes não montam 200 cartões de uma vez', async () => {
    const muitos: ClientWithDogs[] = Array.from({ length: 200 }, (_, indice) => ({
      id: `c${indice}`,
      name: `Cliente ${indice}`,
      phone: null,
      address_line_1: null,
      city: null,
      state: null,
      active: true,
      dogs: [{ name: `Cao ${indice}`, photo_url: null }],
    }));

    const screen = await render(<ClientsList clients={muitos} loading={false} onAddClient={jest.fn()} onOpenClient={jest.fn()} />);

    // O primeiro entra (a janela inicial do FlatList) e o último NÃO é montado.
    expect(screen.getByLabelText('Edit Cliente 0')).toBeTruthy();
    expect(screen.queryByLabelText('Edit Cliente 199')).toBeNull();
  });

  /**
   * 🪤 VISTORIA (02/10/2026) — FILTRO/ORDENAÇÃO SEM MEMO.
   *
   * Ordenar e filtrar a lista a CADA render deixava a busca lenta com muitas famílias. Agora são
   * `useMemo`: um re-render do pai (mesmas props) NÃO reordena nem refiltra.
   */
  it('não reordena nem refiltra quando o pai renderiza de novo com as mesmas props (memo)', async () => {
    const { filterClients, sortClientsForList } = jest.requireMock('@/features/clients/clientsService') as {
      filterClients: jest.Mock;
      sortClientsForList: jest.Mock;
    };
    const onAdd = jest.fn();
    const onOpen = jest.fn();

    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={onAdd} onOpenClient={onOpen} />);
    const ordenacoes = sortClientsForList.mock.calls.length;
    const filtragens = filterClients.mock.calls.length;
    expect(ordenacoes).toBeGreaterThan(0);

    // Mesmas props: o componente roda de novo, mas o memo segura ordenação e filtro.
    await screen.rerender(<ClientsList clients={clients} loading={false} onAddClient={onAdd} onOpenClient={onOpen} />);
    expect(sortClientsForList.mock.calls.length).toBe(ordenacoes);
    expect(filterClients.mock.calls.length).toBe(filtragens);
  });
});
