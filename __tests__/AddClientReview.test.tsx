import { fireEvent, render } from '@testing-library/react-native';
import { AddClientReview } from '@/features/clients/AddClientReview';
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

  it('requires a dog name before saving', async () => {
    const onSave = jest.fn();
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(screen.getByText('Enter the dog name to add this client.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
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
});
