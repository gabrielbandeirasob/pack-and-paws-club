/**
 * REGRA PURA de republicação (dono, 05/10/2026 — item 15 do redesenho do Dispatch).
 *
 * Antes o `Republish` aparecia SEMPRE numa rota publicada. A pergunta certa é: a rota publicada ainda
 * corresponde ao dia? Ela só precisa ser republicada quando (a) alguma parada dela SAIU do dia
 * confirmado (reserva cancelada/substituída) OU (b) há cão do dia ainda em UNASSIGNED (reserva nova que
 * entrou depois da publicação). `draft` e `completed`/`cancelled` nunca "republicam".
 *
 * Fontes: só o que a tela já tem — `status`, `foraDoDia` e `unassigned`. Nada de consulta nova.
 */
import {
  avisoDeRepublicacao,
  mudancasNaoPublicadas,
  precisaRepublicar,
  type RouteStatus,
} from '@/features/dispatch/routeStatusLabel';

const NADA = { foraDoDia: 0, unassigned: 0 };

describe('mudancasNaoPublicadas', () => {
  it('soma paradas fora do dia + cães ainda sem motorista', () => {
    expect(mudancasNaoPublicadas({ foraDoDia: 1, unassigned: 2 })).toBe(3);
  });

  it('não conta negativos (a tela nunca inventa mudança)', () => {
    expect(mudancasNaoPublicadas({ foraDoDia: -1, unassigned: -3 })).toBe(0);
  });
});

describe('precisaRepublicar', () => {
  const casos: Array<[RouteStatus, { foraDoDia: number; unassigned: number }, boolean, string]> = [
    ['draft', NADA, false, 'draft → não (publicar é o primeiro passo, não republicar)'],
    ['published', NADA, false, 'published sem mudança → não (o defeito que este item corrige)'],
    ['published', { foraDoDia: 1, unassigned: 0 }, true, 'published com parada cancelada → sim'],
    ['published', { foraDoDia: 0, unassigned: 1 }, true, 'published com cão novo ainda em unassigned → sim'],
    ['published', { foraDoDia: 2, unassigned: 3 }, true, 'published com as duas mudanças → sim'],
    ['completed', { foraDoDia: 1, unassigned: 1 }, false, 'completed → não (a rota saiu de circulação)'],
    ['cancelled', { foraDoDia: 1, unassigned: 1 }, false, 'cancelled → não (a rota saiu de circulação)'],
  ];
  it.each(casos)('%s + %j → %s (%s)', (status, mudanca, esperado) => {
    expect(precisaRepublicar(status, mudanca)).toBe(esperado);
  });

  it('sem rota (null/undefined) → não', () => {
    expect(precisaRepublicar(null, { foraDoDia: 1, unassigned: 1 })).toBe(false);
    expect(precisaRepublicar(undefined, { foraDoDia: 1, unassigned: 1 })).toBe(false);
  });
});

describe('avisoDeRepublicacao', () => {
  it('null quando não precisa republicar', () => {
    expect(avisoDeRepublicacao('published', NADA)).toBeNull();
    expect(avisoDeRepublicacao('draft', { foraDoDia: 1, unassigned: 0 })).toBeNull();
  });

  it('singular e plural com a contagem real', () => {
    expect(avisoDeRepublicacao('published', { foraDoDia: 1, unassigned: 0 })).toBe('1 unpublished change');
    expect(avisoDeRepublicacao('published', { foraDoDia: 1, unassigned: 2 })).toBe('3 unpublished changes');
  });
});
