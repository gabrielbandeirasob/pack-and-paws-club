/**
 * TRAVA DE PAPEL das telas do GESTOR (varredura de 16/10/2026).
 *
 * Antes: só `calendar.tsx` e `driver.tsx` tinham trava. O motorista abria as outras telas do gestor
 * por URL direta (build web, deep link, aviso) e elas PINTAVAM conteúdo — medido no app rodando:
 * `/day-summary` mostrava "Revenue", `/clients` listava lares com telefone e endereço, `/dispatch`,
 * `/van-locations`, `/activity` e `/driver-hours` abriam normalmente.
 *
 * Aqui a prova é da peça: quem NÃO está na visão de gestor não pinta o conteúdo e é devolvido para o
 * app dele; quem está, passa.
 */
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (rota: string) => mockReplace(rota) },
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
}));
jest.mock('@/features/auth/useOrganizationRole', () => ({ useOrganizationRole: jest.fn() }));

import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useOrganizationRole } from '@/features/auth/useOrganizationRole';
import { useSomenteGestor } from '@/features/auth/somenteGestor';

const papel = useOrganizationRole as jest.Mock;

/** Uma tela de mentira com a MESMA chamada que as telas do gestor fazem. */
function TelaDeGestor() {
  const bloqueioDePapel = useSomenteGestor();
  if (bloqueioDePapel) return bloqueioDePapel;
  return <Text>conteudo-do-gestor</Text>;
}

function comPapel(view: 'manager' | 'driver' | null, isLoading = false) {
  papel.mockReturnValue({ role: view, view, isLoading, reload: jest.fn(), organizationId: 'org', userId: 'u' });
}

beforeEach(() => {
  mockReplace.mockClear();
  papel.mockReset();
});

describe('useSomenteGestor', () => {
  it('gestor vê a tela', async () => {
    comPapel('manager');
    const tela = await render(<TelaDeGestor />);
    expect(tela.getByText('conteudo-do-gestor')).toBeTruthy();
  });

  it('motorista NÃO vê o conteúdo e é devolvido para a tela dele', async () => {
    comPapel('driver');
    const tela = await render(<TelaDeGestor />);
    expect(tela.queryByText('conteudo-do-gestor')).toBeNull();
    expect(tela.getByTestId('papel-bloqueado')).toBeTruthy();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/driver'));
  });

  it('visão carregando mostra rodinha e não pinta nada do gestor', async () => {
    comPapel('manager', true);
    const tela = await render(<TelaDeGestor />);
    expect(tela.queryByText('conteudo-do-gestor')).toBeNull();
    expect(tela.getByTestId('papel-bloqueado')).toBeTruthy();
  });

  it('conta sem vínculo ativo para na frase (não gira para sempre)', async () => {
    comPapel(null, false);
    const tela = await render(<TelaDeGestor />);
    expect(tela.getByText('This account has no daycare')).toBeTruthy();
    expect(tela.queryByTestId('papel-bloqueado')).toBeNull();
  });
});
