/**
 * VETORES DO AGENTE2 — motivo do problema (defeito corrigido em 25/09/2026).
 *
 * O requisito do dono: o escritório precisa saber O QUE aconteceu quando o motorista marca problema —
 * não só que "houve um problema". O texto vai para `proof_note` e o push do gestor já o inclui.
 */
import { textoDoProblema, MOTIVOS_DE_PROBLEMA, PREFIXO_DO_PROBLEMA } from '@/features/driver/problemReason';

it('o motivo vai prefixado para nao ser confundido com observacao de foto', () => {
  expect(textoDoProblema('Client not home')).toBe('Problem: Client not home');
  expect(PREFIXO_DO_PROBLEMA).toBe('Problem: ');
});

it('os motivos oferecidos sao curtos, em ingles e sem repeticao', () => {
  expect(MOTIVOS_DE_PROBLEMA.length).toBeGreaterThanOrEqual(3);
  for (const motivo of MOTIVOS_DE_PROBLEMA) {
    expect(motivo.length).toBeLessThanOrEqual(24);
    expect(motivo).toBe(motivo.trim());
  }
  expect(new Set(MOTIVOS_DE_PROBLEMA).size).toBe(MOTIVOS_DE_PROBLEMA.length);
});

it('espaco extra do motivo nao entra no texto gravado', () => {
  expect(textoDoProblema('  Access blocked  ')).toBe('Problem: Access blocked');
});
