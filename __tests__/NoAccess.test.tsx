import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { NoAccess } from '@/features/auth/NoAccess';

const mockSignOut = jest.fn().mockResolvedValue({ error: null });

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: (...args: unknown[]) => mockSignOut(...args) } },
}));

describe('NoAccess', () => {
  beforeEach(() => {
    mockSignOut.mockClear();
  });

  it('explica que a conta não está vinculada e mostra o e-mail', async () => {
    const screen = await render(<NoAccess email="motorista@packandpaws.com" />);

    expect(screen.getByText(/not linked to a Pack & Paws team/)).toBeTruthy();
    expect(screen.getByText('motorista@packandpaws.com')).toBeTruthy();
  });

  it('permite tentar de novo (sem sair da conta)', async () => {
    const retry = jest.fn();
    const screen = await render(<NoAccess email="motorista@packandpaws.com" onRetry={retry} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('permite sair da conta', async () => {
    const screen = await render(<NoAccess email="motorista@packandpaws.com" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
  });

  it('não quebra quando o e-mail não vem', async () => {
    const screen = await render(<NoAccess />);

    expect(screen.getByText(/not linked to a Pack & Paws team/)).toBeTruthy();
  });
});
