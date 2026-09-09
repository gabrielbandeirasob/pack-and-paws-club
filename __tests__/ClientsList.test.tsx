import { render } from '@testing-library/react-native';
import { ClientsList } from '@/features/clients/ClientsList';
import type { ClientWithDogs } from '@/features/clients/types';

const clients: ClientWithDogs[] = [
  { id: '1', name: 'Maria Silva', phone: '+55 62 99999-0000', address_line_1: '123 Main St', city: 'Goiania', state: 'GO', dogs: ['Bob'] },
  { id: '2', name: 'Joao Souza', phone: null, address_line_1: null, city: null, state: null, dogs: ['Luna', 'Max'] },
];

describe('ClientsList', () => {
  it('renders clients with their dogs', async () => {
    const screen = await render(<ClientsList clients={clients} loading={false} onAddClient={jest.fn()} />);
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Joao Souza')).toBeTruthy();
    expect(screen.getByText('Luna')).toBeTruthy();
    expect(screen.getByText('Max')).toBeTruthy();
  });

  it('shows an empty state and the add button', async () => {
    const onAdd = jest.fn();
    const screen = await render(<ClientsList clients={[]} loading={false} onAddClient={onAdd} />);
    expect(screen.getByText('No clients yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add from Contacts' })).toBeTruthy();
  });
});
