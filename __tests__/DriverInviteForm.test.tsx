import { fireEvent, render } from '@testing-library/react-native';
import { DriverInviteForm } from '@/features/drivers/DriverInviteForm';

describe('DriverInviteForm', () => {
  it('requires a name and a valid email', async () => {
    const onInvite = jest.fn();
    const screen = await render(<DriverInviteForm onInvite={onInvite} onDone={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Invite driver' }));
    expect(screen.getByText('Enter the driver name and a valid email.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Carlos');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Invite driver' }));
    expect(screen.getByText('Enter the driver name and a valid email.')).toBeTruthy();
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('invites with a normalized email and reveals the temporary password', async () => {
    const onInvite = jest.fn().mockResolvedValue({ temporaryPassword: 'TmpPass123!' });
    const screen = await render(<DriverInviteForm onInvite={onInvite} onDone={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Carlos Silva');
    await fireEvent.changeText(screen.getByLabelText('Email'), '  Carlos@PackPawsClub.App ');
    await fireEvent.press(screen.getByRole('button', { name: 'Invite driver' }));
    expect(onInvite).toHaveBeenCalledWith('Carlos Silva', 'carlos@packpawsclub.app', 'driver');
    expect(screen.getByText('Temporary password')).toBeTruthy();
    expect(screen.getByText('TmpPass123!')).toBeTruthy();
  });

  it('convida gestor quando o papel Manager esta escolhido', async () => {
    const onInvite = jest.fn().mockResolvedValue({ temporaryPassword: 'TmpPass123!' });
    const screen = await render(<DriverInviteForm onInvite={onInvite} onDone={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('Manager role'));
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Raphael Mendes');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'raphael@packpawsclub.app');
    await fireEvent.press(screen.getByRole('button', { name: 'Invite manager' }));

    expect(onInvite).toHaveBeenCalledWith('Raphael Mendes', 'raphael@packpawsclub.app', 'manager');
    expect(screen.getByText('MANAGER INVITED')).toBeTruthy();
    expect(screen.getByText(/The manager signs in/)).toBeTruthy();
  });

  it('o erro cita o papel escolhido', async () => {
    const screen = await render(<DriverInviteForm onInvite={jest.fn()} onDone={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Manager role'));
    await fireEvent.press(screen.getByRole('button', { name: 'Invite manager' }));
    expect(screen.getByText('Enter the manager name and a valid email.')).toBeTruthy();
  });
});
