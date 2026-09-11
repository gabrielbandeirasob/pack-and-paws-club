import { fireEvent, render } from '@testing-library/react-native';
import { AddClientReview } from '@/features/clients/AddClientReview';
import type { ExistingContactClient } from '@/features/clients/clientsService';
import type { NewClientInput } from '@/features/clients/types';

const input: NewClientInput = {
  name: 'Maria Silva',
  phone: '+55 62 99999-0000',
  address_line_1: '123 Main St',
  address_line_2: null,
  city: 'Goiania',
  state: 'GO',
  postal_code: '74000-000',
  source_contact_identifier: 'contact-1',
  pickup_access_instructions: 'Call box 185. Key inside lockbox.',
};

describe('AddClientReview', () => {
  it('shows imported contact data and access instructions', async () => {
    const screen = await render(<AddClientReview initial={input} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('+55 62 99999-0000')).toBeTruthy();
    expect(screen.getByText('123 Main St · Goiania')).toBeTruthy();
    expect(screen.getByText('Call box 185. Key inside lockbox.')).toBeTruthy();
  });

  it('saves the client with no dog (the dog can be added later in the client card)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: [] }));
  });

  it('ja vem com o nome de cachorro lido do contato, e da para editar', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <AddClientReview initial={input} initialDogNames="Mowgli, Kona" onSave={onSave} onCancel={jest.fn()} />,
    );
    expect(screen.getByLabelText('Dog name').props.value).toBe('Mowgli, Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
  });

  it('saves client payload together with the dog', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Bob');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ name: 'Maria Silva' }),
      dogs: ['Bob'],
    }));
  });

  it('accepts two dogs in one field, separated by comma', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli, Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
  });

  it('warns when the contact is already a client and sends the new dog to that record', async () => {
    const existingClient: ExistingContactClient = { id: 'client-1', name: 'Leigh Ann(Mowgli)', hasInstructions: false, dogs: ['Mowgli'] };
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <AddClientReview initial={input} existingClient={existingClient} onSave={onSave} onCancel={jest.fn()} />,
    );
    expect(screen.getByText('ALREADY A CLIENT')).toBeTruthy();
    expect(screen.getByText(/already registered \(dogs: Mowgli\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to existing client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Kona'] }));
  });
});
