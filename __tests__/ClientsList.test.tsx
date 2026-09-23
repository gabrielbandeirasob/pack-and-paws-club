import { fireEvent, render } from '@testing-library/react-native';
import { ClientsList } from '@/features/clients/ClientsList';
import type { ClientWithDogs } from '@/features/clients/types';

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
});
