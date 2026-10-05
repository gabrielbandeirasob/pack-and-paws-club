/**
 * AVISO DE ROTA QUE O MOTORISTA NÃO VÊ (dono, 01/10/2026).
 *
 * O motorista só lê rota `published`. Uma rota em rascunho, com todas as paradas prontas, tem a mesma
 * cara de uma publicada no quadro — e o gestor fica achando que o motorista já saiu com o carro.
 */
import { avisoDeRotaInvisivel, rotuloDeStatus } from '@/features/dispatch/routeStatusLabel';

describe('avisoDeRotaInvisivel', () => {
  it('rascunho avisa que o motorista ainda não vê', () => {
    // Redesenho (item 14): a frase longa virou a linha discreta embaixo do badge `Draft`.
    expect(avisoDeRotaInvisivel('draft')).toBe('Not visible to driver yet');
  });

  it('publicada não avisa nada (o motorista está vendo)', () => {
    expect(avisoDeRotaInvisivel('published')).toBeNull();
  });

  it('concluída e cancelada não avisam: sair da tela do motorista foi o resultado da ação do gestor', () => {
    expect(avisoDeRotaInvisivel('completed')).toBeNull();
    expect(avisoDeRotaInvisivel('cancelled')).toBeNull();
  });

  it('sem rota não há aviso', () => {
    expect(avisoDeRotaInvisivel(null)).toBeNull();
    expect(avisoDeRotaInvisivel(undefined)).toBeNull();
  });

  it('o rótulo do status continua o mesmo (não mexi no que o agente2 travou)', () => {
    expect(rotuloDeStatus('draft')).toBe(' · Draft');
    expect(rotuloDeStatus('published')).toBe(' · Published');
    expect(rotuloDeStatus('completed')).toBe(' · Completed');
    expect(rotuloDeStatus('cancelled')).toBe(' · Cancelled');
  });
});
