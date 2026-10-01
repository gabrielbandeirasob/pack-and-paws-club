/**
 * FRASE DA FALHA PARCIAL NA ATRIBUIÇÃO (melhoria do dono, 01/10/2026).
 *
 * Antes, um erro no meio do lote parava o resto e o gestor só via o primeiro motivo — sem saber quais
 * cães tinham ficado de fora. Agora o app segue tentando e diz, numa frase, quem entrou e quem não.
 */
import { avisoDeFalhaParcial } from '@/features/dispatch/partialWrite';

describe('avisoDeFalhaParcial', () => {
  it('um cão recusado: diz o nome, o motivo e que o outro entrou', () => {
    const frase = avisoDeFalhaParcial([{ dogId: 'ollie', dogName: 'Ollie', motivo: 'permission denied' }], 1);
    expect(frase).toBe('1 dog could not be saved: Ollie — permission denied. 1 dog was saved; try that one again.');
  });

  it('vários cães recusados: lista todos os nomes e conta quantos entraram', () => {
    const frase = avisoDeFalhaParcial([
      { dogId: 'luna', dogName: 'Luna', motivo: 'permission denied' },
      { dogId: 'bella', dogName: 'Bella', motivo: 'permission denied' },
    ], 3);
    expect(frase).toBe('2 dogs could not be saved: Luna, Bella — permission denied. 3 dogs were saved; try those again.');
  });

  it('nada foi salvo: a frase diz isso com todas as letras (não "0 dogs saved")', () => {
    const frase = avisoDeFalhaParcial([
      { dogId: 'luna', dogName: 'Luna', motivo: 'stale_route' },
      { dogId: 'bella', dogName: 'Bella', motivo: 'stale_route' },
    ], 0);
    expect(frase).toBe('2 dogs could not be saved: Luna, Bella — stale_route. Nothing was saved.');
  });

  it('motivos diferentes: mostra o primeiro e avisa que é o primeiro', () => {
    const frase = avisoDeFalhaParcial([
      { dogId: 'luna', dogName: 'Luna', motivo: 'permission denied' },
      { dogId: 'bella', dogName: 'Bella', motivo: 'dog not in the organization' },
    ], 0);
    expect(frase).toContain('— permission denied (first reason shown)');
  });

  it('sem falha não há frase (quem chama não inventa erro)', () => {
    expect(avisoDeFalhaParcial([], 2)).toBe('');
  });
});
