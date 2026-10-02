import { fireEvent, render } from '@testing-library/react-native';
import { NewReservationForm, type NewReservationPayload } from '@/features/calendar/NewReservationForm';
import { todayLocalISO } from '@/features/calendar/dates';

const dogs = [
  { id: 'dog-bob', dogName: 'Bob', clientName: 'Maria' },
  { id: 'dog-luna', dogName: 'Luna', clientName: 'John' },
];

const today = todayLocalISO();
// Deterministic dates inside the current month so they are visible in the month picker.
const firstOfMonth = `${today.slice(0, 8)}01`;
const lastDayOfMonth = String(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0');
const lastOfMonth = `${today.slice(0, 8)}${lastDayOfMonth}`;

async function pickDog(screen: Awaited<ReturnType<typeof render>>, dogLabel: string) {
  // O seletor agora abre um painel com busca e agrupa por cliente; a linha tem o rotulo
  // "Select <cão> of <cliente>". dogLabel continua no formato "Cliente · Cão".
  const [clientName, dogName] = dogLabel.split(' · ');
  await fireEvent.press(screen.getByRole('button', { name: 'Select dog' }));
  await fireEvent.press(screen.getByRole('button', { name: `Select ${dogName} of ${clientName}` }));
}

async function pickDate(screen: Awaited<ReturnType<typeof render>>, fieldLabel: string, isoDate: string) {
  await fireEvent.press(screen.getByRole('button', { name: fieldLabel }));
  await fireEvent.press(screen.getByRole('button', { name: `Select ${isoDate} · no care` }));
}

describe('NewReservationForm', () => {
  it('requires a dog and a date to save', async () => {
    const onSave = jest.fn();
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    expect(screen.getByText('Choose a dog and a valid date.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a one-day daycare reservation picked from the calendar', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await pickDog(screen, 'Maria · Bob');
    await pickDate(screen, 'Start date', firstOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-bob', serviceType: 'daycare', startDate: firstOfMonth, endDate: firstOfMonth });
    expect(payload.weekdays).toBeUndefined();
  });

  it('shows the picked date on the field instead of a raw input', async () => {
    const screen = await render(<NewReservationForm dogs={dogs} onSave={jest.fn().mockResolvedValue(undefined)} onCancel={jest.fn()} />);
    await pickDate(screen, 'Start date', firstOfMonth);
    expect(screen.queryByText('YYYY-MM-DD')).toBeNull();
    expect(screen.queryByText('Select a date…')).toBeNull();
  });

  it('switches to boarding and sends a start and end date from the pickers', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Boarding' }));
    await pickDog(screen, 'John · Luna');
    await pickDate(screen, 'Start date', firstOfMonth);
    await pickDate(screen, 'End date', lastOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-luna', serviceType: 'boarding', startDate: firstOfMonth, endDate: lastOfMonth });
  });

  it('trocar para Boarding depois de ligar "Repeat weekly" NÃO manda dias da semana', async () => {
    /**
     * 🪤 ACHADO DA REVISÃO (02/10/2026): o formulário só MOSTRA "Repeat weekly" no daycare, mas o
     * estado não era limpo ao trocar para Boarding — e a Agenda decidia criar SÉRIE SEMANAL pela
     * presença de `weekdays`. Quem ligasse a repetição e trocasse para Boarding salvava uma série de
     * daycare no lugar da hospedagem: a reserva sumia em silêncio (a lista de semanais ganhava um
     * cão que nunca ia ao daycare naquele dia, e a hospedagem não existia).
     */
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Repeat weekly' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Boarding' }));
    await pickDog(screen, 'John · Luna');
    await pickDate(screen, 'Start date', firstOfMonth);
    await pickDate(screen, 'End date', lastOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));

    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload.serviceType).toBe('boarding');
    expect(payload.weekdays).toBeUndefined();
  });

  it('rejects an end date before the start date', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Boarding' }));
    await pickDog(screen, 'John · Luna');
    await pickDate(screen, 'Start date', lastOfMonth);
    await pickDate(screen, 'End date', firstOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    expect(screen.getByText('End date must be on or after the start date.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('sends weekdays when weekly repetition is enabled', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat weekly' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mon' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Wed' }));
    await pickDog(screen, 'Maria · Bob');
    await pickDate(screen, 'Start date', firstOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[0][0] as NewReservationPayload;
    expect(payload.weekdays).toEqual([1, 3]);
  });

  it('defaults transport to off and sends transportRequired true when toggled', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await pickDog(screen, 'Maria · Bob');
    await pickDate(screen, 'Start date', firstOfMonth);
    await fireEvent.press(screen.getByRole('button', { name: 'Save reservation' }));
    expect((onSave.mock.calls[0][0] as NewReservationPayload).transportRequired).toBe(false);

    const second = await render(<NewReservationForm dogs={dogs} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(second.getByRole('button', { name: 'Transport required' }));
    await pickDog(second, 'John · Luna');
    await pickDate(second, 'Start date', firstOfMonth);
    await fireEvent.press(second.getByRole('button', { name: 'Save reservation' }));
    const payload = onSave.mock.calls[1][0] as NewReservationPayload;
    expect(payload).toMatchObject({ dogId: 'dog-luna', serviceType: 'daycare', startDate: firstOfMonth, transportRequired: true });
  });
});
