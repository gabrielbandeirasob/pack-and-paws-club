import { fireEvent, render } from '@testing-library/react-native';
import { LoginForm } from '@/features/auth/LoginForm';

describe('LoginForm', () => {
  it('submits normalized manager credentials', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<LoginForm initialEmail=" Raphael@AutoNestMobile.com " onSignIn={signIn} />);

    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse battery staple');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(signIn).toHaveBeenCalledWith('raphael@autonestmobile.com', 'correct horse battery staple');
  });

  it('requires both email and password', async () => {
    const signIn = jest.fn();
    const screen = await render(<LoginForm initialEmail="" onSignIn={signIn} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter your email and password.')).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });
});
