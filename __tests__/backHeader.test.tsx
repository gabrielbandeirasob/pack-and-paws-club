import { fireEvent, render } from '@testing-library/react-native';

/**
 * O BOTÃO DE VOLTAR — o único lugar que desenha o "voltar" do app (pedido do cliente, 04/10/2026).
 *
 * A auditoria das telas mostrou três comportamentos diferentes na mesma jornada (`‹ Back`, um `‹`
 * solto e NENHUM botão). Este vetor trava as regras do componente novo:
 *  - com histórico, volta de verdade;
 *  - SEM histórico (link direto/`replace`), vai para as abas em vez de não fazer nada — era o caso
 *    real de "não tem como voltar dessa tela";
 *  - `canGoBack` que explode (versão antiga do expo-router) não pode deixar o usuário preso.
 */
let mockPodeVoltar = true;
let mockCanGoBack: (() => boolean) | undefined = () => mockPodeVoltar;
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: jest.fn(),
    canGoBack: mockCanGoBack ? () => (mockCanGoBack as () => boolean)() : undefined,
  }),
}));

const BackHeader = require('@/features/ui/BackHeader').BackHeader as typeof import('@/features/ui/BackHeader').BackHeader;

beforeEach(() => {
  mockPodeVoltar = true;
  mockCanGoBack = () => mockPodeVoltar;
  mockBack.mockClear();
  mockReplace.mockClear();
});

it('com histórico, o toque volta para a tela anterior', async () => {
  const tela = await render(<BackHeader title="Driver hours" />);
  const botao = tela.getByLabelText('Go back');

  expect(tela.getByText('‹ Back')).toBeTruthy();
  await fireEvent.press(botao);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('SEM histórico o botão vai para as abas (não deixa o usuário preso)', async () => {
  mockPodeVoltar = false;
  const tela = await render(<BackHeader title="Weekly summary" tone="light" />);

  await fireEvent.press(tela.getByLabelText('Go back'));

  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});

it('aceita outro destino de fallback (tela que pertence a outra raiz)', async () => {
  mockPodeVoltar = false;
  const tela = await render(<BackHeader title="Login" fallback="/login" />);
  await fireEvent.press(tela.getByLabelText('Go back'));
  expect(mockReplace).toHaveBeenCalledWith('/login');
});

it('não deixa preso quando a versão do expo-router não tem canGoBack', async () => {
  mockCanGoBack = undefined;
  const tela = await render(<BackHeader title="Activity" />);
  await fireEvent.press(tela.getByLabelText('Go back'));
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});

it('o alvo de toque é de iOS (≥44pt) e o cabeçalho aceita o conteúdo da direita', async () => {
  const tela = await render(<BackHeader title="Team" eyebrow="PACK & PAWS CLUB" subtitle="Everyone with a login." right={<></>} />);
  const estilo = tela.getByLabelText('Go back').props.style;

  const plano = Array.isArray(estilo) ? Object.assign({}, ...estilo.flat(Infinity)) : estilo;
  expect(plano.minHeight).toBeGreaterThanOrEqual(44);
  expect(tela.getByText('Everyone with a login.')).toBeTruthy();
});
