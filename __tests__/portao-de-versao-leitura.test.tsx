/**
 * LEITURA DA BUILD MÍNIMA (`app_releases`) — o que decide se este aparelho entra (dono, 16/10/2026).
 *
 * As três decisões que importam:
 * - build anterior à mínima  -> barra;
 * - build igual ou mais nova  -> entra;
 * - sem informação (leitura falhou, tabela zerada) -> **NÃO barra**: servidor fora do ar não pode virar
 *   "você não trabalha hoje" para quem está na rua.
 *
 * Um `render` por teste, sem `unmount()` no meio: desmontar dentro do teste deixa `act()` sobreposto e
 * os testes seguintes não montam nada (medido em 16/10/2026 — foi o que derrubou 4 testes seguidos).
 */
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { useAtualizacaoObrigatoria } from '@/features/release/useAtualizacaoObrigatoria';

let mockLinha: { data: unknown; error: unknown } = { data: { platform: 'ios', min_build: 166 }, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signOut: jest.fn() },
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(mockLinha),
      };
      return chain;
    },
  },
}));

function Bancada({ build }: { build: number }) {
  const versao = useAtualizacaoObrigatoria(build);
  return <Text testID="resultado">{`${versao.decisao}|${versao.obrigatoria}|${versao.buildMinima ?? 'x'}`}</Text>;
}

describe('useAtualizacaoObrigatoria', () => {
  beforeEach(() => {
    mockLinha = { data: { platform: 'ios', min_build: 166 }, error: null };
  });

  it('barra a build anterior e mostra o número exigido', async () => {
    const tela = await render(<Bancada build={164} />);
    await waitFor(() => expect(tela.getByTestId('resultado').props.children).toBe('atualizar|true|166'));
  });

  it('libera a build IGUAL à mínima (a mínima é a própria build publicada)', async () => {
    const tela = await render(<Bancada build={166} />);
    await waitFor(() => expect(tela.getByTestId('resultado').props.children).toBe('ok|false|166'));
  });

  it('libera build mais NOVA que a mínima', async () => {
    const tela = await render(<Bancada build={170} />);
    await waitFor(() => expect(tela.getByTestId('resultado').props.children).toBe('ok|false|166'));
  });

  it('leitura FALHOU: não bloqueia (mas fica sabendo que falhou)', async () => {
    mockLinha = { data: null, error: { message: 'network' } };
    const tela = await render(<Bancada build={164} />);
    await waitFor(() => expect(tela.getByTestId('resultado').props.children).toBe('sem-informacao|false|x'));
  });

  it('tabela zerada (nenhuma build publicada ainda) libera todo mundo', async () => {
    mockLinha = { data: { platform: 'ios', min_build: 0 }, error: null };
    const tela = await render(<Bancada build={164} />);
    await waitFor(() => expect(tela.getByTestId('resultado').props.children).toBe('sem-informacao|false|0'));
  });
});
