/**
 * ESCOLHA DA ORGANIZAÇÃO DE QUEM CHAMA (função `google-calendar-token`).
 *
 * Achado da auditoria de integrações (02/10/2026): a função pegava a primeira organização do gestor
 * (`.limit(1)`) e, quando ele tinha vínculo ativo em MAIS de uma, escolhia uma ARBITRÁRIA — a
 * credencial podia ser gravada/apagada no tenant errado. A decisão é pura e vive em
 * `supabase/functions/_shared/organizacaoDoGestor.ts`; aqui ela é provada caso a caso.
 */
import {
  escolherOrganizacao,
  organizacoesDeVinculos,
} from '../supabase/functions/_shared/organizacaoDoGestor';

describe('organizacoesDeVinculos', () => {
  it('tira duplicatas (vínculo repetido) e vazios', () => {
    expect(
      organizacoesDeVinculos([
        { organization_id: 'org-a' },
        { organization_id: 'org-a' },
        { organization_id: 'org-b' },
        { organization_id: null },
        { organization_id: '  ' },
      ]),
    ).toEqual(['org-a', 'org-b']);
  });

  it('lista nula/vazia vira lista vazia (não explode)', () => {
    expect(organizacoesDeVinculos(null)).toEqual([]);
    expect(organizacoesDeVinculos(undefined)).toEqual([]);
    expect(organizacoesDeVinculos([])).toEqual([]);
  });
});

describe('escolherOrganizacao', () => {
  it('uma só organização: usa ela, sem consultar mais nada', () => {
    expect(escolherOrganizacao(['org-a'], null, null, null)).toBe('org-a');
    expect(escolherOrganizacao(['org-a'], 'cal-x', 'org-fora', 'org-fora')).toBe('org-a');
  });

  it('nenhuma organização: null (a função responde 403)', () => {
    expect(escolherOrganizacao([], null, null, null)).toBeNull();
  });

  it('com calendário informado: usa a organização do gestor configurada com AQUELE calendário', () => {
    expect(escolherOrganizacao(['org-a', 'org-b'], 'cal-bot-venda', 'org-b', 'org-a')).toBe('org-b');
  });

  it('calendário informado mas sem dono entre as organizações: null (409, não chuta)', () => {
    expect(escolherOrganizacao(['org-a', 'org-b'], 'cal-bot-venda', 'org-fora', 'org-a')).toBeNull();
    expect(escolherOrganizacao(['org-a', 'org-b'], 'cal-bot-venda', null, 'org-a')).toBeNull();
  });

  it('sem calendário: usa a organização que JÁ tem credencial (é a linha que check/revoke miram)', () => {
    expect(escolherOrganizacao(['org-a', 'org-b'], null, null, 'org-b')).toBe('org-b');
  });

  it('sem calendário e sem credencial: null (409, em vez de escrever no tenant errado)', () => {
    expect(escolherOrganizacao(['org-a', 'org-b'], null, null, null)).toBeNull();
    expect(escolherOrganizacao(['org-a', 'org-b'], null, null, 'org-fora')).toBeNull();
  });
});
