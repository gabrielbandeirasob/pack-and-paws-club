import { useCallback, useEffect, useState } from 'react';

import { buildDoAparelho } from '@/features/release/buildDoAparelho';
import { decidirVersao, type DecisaoDeVersao } from '@/features/release/regraDeAtualizacao';
import { supabase } from '@/lib/supabase';

export type EstadoDaVersao = {
  /** `true` = não entra: a tela de atualização substitui o app inteiro. */
  obrigatoria: boolean;
  decisao: DecisaoDeVersao;
  buildAtual: number | null;
  buildMinima: number | null;
  /** Primeira leitura em andamento (a tela mostra "checking"). */
  conferindo: boolean;
  /** A leitura falhou (rede/servidor) — informativo; NÃO bloqueia. */
  falhou: boolean;
  rechecar: () => void;
};

/**
 * Lê a build mínima exigida (`app_releases`) e decide se este aparelho pode entrar.
 *
 * Quem escreve nessa tabela é a PUBLICAÇÃO (`build/publish_local_ipa.py`), depois que a build nova está
 * liberada para os testadores externos. O app só lê — não há caminho de escrita para ele (RLS de SELECT).
 */
export function useAtualizacaoObrigatoria(buildAtual: number | null = buildDoAparelho()): EstadoDaVersao {
  const [estado, setEstado] = useState<{ minima: number | null; conferindo: boolean; falhou: boolean }>(
    { minima: null, conferindo: true, falhou: false },
  );
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setEstado((atual) => ({ ...atual, conferindo: true }));
    void supabase
      .from('app_releases')
      .select('platform, min_build')
      .eq('platform', 'ios')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        setEstado({
          minima: error ? null : ((data as { min_build?: number } | null)?.min_build ?? null),
          conferindo: false,
          falhou: Boolean(error),
        });
      });
    return () => {
      cancelado = true;
    };
  }, [tentativa]);

  const rechecar = useCallback(() => setTentativa((n) => n + 1), []);
  const decisao = decidirVersao(buildAtual, estado.minima);

  return {
    obrigatoria: decisao === 'atualizar',
    decisao,
    buildAtual: Number.isFinite(Number(buildAtual)) && Number(buildAtual) > 0 ? Number(buildAtual) : null,
    buildMinima: estado.minima,
    conferindo: estado.conferindo,
    falhou: estado.falhou,
    rechecar,
  };
}
