/**
 * PORTÃO DE VERSÃO — regra + ligação no app (dono, 16/10/2026: "quero que o app do cliente só funcione
 * com a versão mais recente").
 *
 * A decisão em si é pura (`decidirVersao`), e é testada aqui porque é ela que decide se um motorista na
 * rua entra ou não. O caso mais importante é o ÚLTIMO: sem informação NÃO se bloqueia ninguém — servidor
 * fora do ar não pode virar "você não trabalha hoje".
 */
import fs from 'fs';
import path from 'path';

import { buildDoAparelho } from '@/features/release/buildDoAparelho';
import { decidirVersao } from '@/features/release/regraDeAtualizacao';

const raiz = path.resolve(__dirname, '..');
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');

describe('decidirVersao', () => {
  it('build igual à mínima entra (a mínima é a própria build publicada)', () => {
    expect(decidirVersao(166, 166)).toBe('ok');
  });

  it('build ANTERIOR à mínima é barrada', () => {
    expect(decidirVersao(164, 166)).toBe('atualizar');
    expect(decidirVersao(1, 166)).toBe('atualizar');
  });

  it('build mais NOVA que a mínima entra (publicou ontem, mínima de anteontem)', () => {
    expect(decidirVersao(167, 166)).toBe('ok');
  });

  it('SEM INFORMAÇÃO não bloqueia ninguém', () => {
    // leitura falhou (mínima desconhecida), tabela zerada, ou aparelho sem build nativa (web/dev)
    expect(decidirVersao(166, null)).toBe('sem-informacao');
    expect(decidirVersao(166, undefined)).toBe('sem-informacao');
    expect(decidirVersao(166, 0)).toBe('sem-informacao');
    expect(decidirVersao(null, 166)).toBe('sem-informacao');
    expect(decidirVersao(undefined, 166)).toBe('sem-informacao');
    expect(decidirVersao(0, 166)).toBe('sem-informacao');
    expect(decidirVersao(NaN, 166)).toBe('sem-informacao');
  });
});

describe('buildDoAparelho', () => {
  const anterior = process.env.EXPO_PUBLIC_BUILD_ATUAL;

  afterEach(() => {
    if (anterior === undefined) delete process.env.EXPO_PUBLIC_BUILD_ATUAL;
    else process.env.EXPO_PUBLIC_BUILD_ATUAL = anterior;
  });

  it('usa o número do ambiente quando existe — e SÓ no web (harness; web não tem build nativa)', () => {
    process.env.EXPO_PUBLIC_BUILD_ATUAL = '100';
    expect(buildDoAparelho('web')).toBe(100);
    // Em aparelho a simulação é ignorada: quem manda é o número nativo (aqui, sem módulo nativo, nulo).
    expect(buildDoAparelho('ios')).toBeNull();
  });

  it('em jest/web (sem módulo nativo e sem ambiente) devolve nulo — e nulo não bloqueia', () => {
    delete process.env.EXPO_PUBLIC_BUILD_ATUAL;
    expect(buildDoAparelho()).toBeNull();
    expect(decidirVersao(buildDoAparelho(), 166)).toBe('sem-informacao');
  });
});

describe('ligação no app', () => {
  it('o portão roda ANTES das abas e antes do login (build velha não entra em lugar nenhum)', () => {
    const layout = ler('app/_layout.tsx');
    const posicaoDoPortao = layout.indexOf('useAtualizacaoObrigatoria()');
    const posicaoDasAbas = layout.indexOf('name="(tabs)"');
    expect(posicaoDoPortao).toBeGreaterThan(-1);
    expect(posicaoDoPortao).toBeLessThan(posicaoDasAbas);
    expect(layout).toMatch(/if\(versao\.obrigatoria\)return <AtualizacaoObrigatoria/);
  });

  it('a tabela é lida por plataforma e o app NUNCA escreve nela', () => {
    const hook = ler('features/release/useAtualizacaoObrigatoria.ts');
    expect(hook).toContain("from('app_releases')");
    expect(hook).toContain("eq('platform', 'ios')");
    expect(hook).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it('a migração deixa leitura para anon+authenticated (o portão roda deslogado) e escrita para ninguém', () => {
    const sql = ler('supabase/migrations/202610160049_versao_minima_do_app.sql');
    expect(sql).toContain('enable row level security');
    expect(sql).toMatch(/for select to \w+, \w+/);
    expect(sql).not.toMatch(/for (insert|update|delete)/i);
  });
});
