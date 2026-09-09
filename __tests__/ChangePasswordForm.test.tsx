import { fireEvent, render } from '@testing-library/react-native';
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm';

describe('ChangePasswordForm', () => {
  it('rejects short or mismatched passwords', async () => {
    const update = jest.fn();
    const screen = await render(<ChangePasswordForm onChangePassword={update} />);
    await fireEvent.changeText(screen.getByLabelText('New password'), 'short');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'different');
    await fireEvent.press(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText('Use at least 12 characters and enter the same password twice.')).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it('submits a valid new password', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<ChangePasswordForm onChangePassword={update} />);
    await fireEvent.changeText(screen.getByLabelText('New password'), 'A strong new password 2026!');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'A strong new password 2026!');
    await fireEvent.press(screen.getByRole('button', { name: 'Save new password' }));
    expect(update).toHaveBeenCalledWith('A strong new password 2026!');
  });
});
