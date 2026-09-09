import { fireEvent, render } from '@testing-library/react-native';
import { NewReservationForm, type NewReservationPayload } from '@/features/calendar/NewReservationForm';

const dogs = [
  { id: 'dog-bob', dogName: 'Bob', clientName: 'Maria' },
  { id: 'dog-luna', dogName: 'Luna', clientName: 'John' },
];

describe('NewReservationForm', () => {
  it('requires a dog and a date to save', async () => {
    const onSave = jest.fn();
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    expect(screen.getByText('Choose a dog and a valid date.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a one-day daycare reservation', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Select dog' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Maria · Bob' }));
    await fireEvent.changeText(screen.getByLabelText('Start date'), '2026-09-15');
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-bob', serviceType: 'daycare', startDate: '2026-09-15', endDate: '2026-09-15' });
    expect(payload.weekdays).toBeUndefined();
  });

  it('switches to boarding and sends an end date', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Boarding' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Select dog' }));
    await fireEvent.press(screen.getByRole('button', { name: 'John · Luna' }));
    await fireEvent.changeText(screen.getByLabelText('Start date'), '2026-09-05');
    await fireEvent.changeText(screen.getByLabelText('End date'), '2026-09-10');
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-luna', serviceType: 'boarding', startDate: '2026-09-05', endDate: '2026-09-10' });
  });

  it('sends weekdays when weekly repetition is enabled', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat weekly' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mon' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Wed' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Select dog' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Maria · Bob' }));
    await fireEvent.changeText(screen.getByLabelText('Start date'), '2026-09-15');
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload.weekdays).toEqual([1, 3]);
  });

  it('defaults transport to off and sends transportRequired true when toggled', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Select dog' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Maria · Bob' }));
    await fireEvent.changeText(screen.getByLabelText('Start date'), '2026-09-15');
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    expect((onSave.mock.calls[0][0] as NewReservationPayload).transportRequired).toBe(false);

    const second = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(second.getByRole('button', { name: 'Transport required' }));
    await fireEvent.press(second.getByRole('button', { name: 'Select dog' }));
    await fireEvent.press(second.getByRole('button', { name: 'John · Luna' }));
    await fireEvent.changeText(second.getByLabelText('Start date'), '2026-09-16');
    await fireEvent.press(second.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[1][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-luna', serviceType: 'daycare', startDate: '2026-09-16', transportRequired: true });
  });
});
