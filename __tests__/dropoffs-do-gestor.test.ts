import { mapearParada, ordenarParaEntrega, type ParadaDaLinha } from '@/features/dispatch/routeStops';
import { proximaEntrega, situacaoDaEntrega } from '@/features/dashboard/stopProgress';

/**
 * DROP-OFFS NO APP DO GESTOR — cliente, 02/10/2026: *"Onde eu vejo os drop off? Não tá aparecendo. Os
 * pick up estavam."* A tela `route-stops` mostrava só a manhã. Estes testes garantem a tarde: ordem de
 * ENTREGA e a situação de cada cão, na qual o PICK-UP CONCLUÍDO NÃO É ENTREGA.
 */
const linha = (over: Partial<ParadaDaLinha> & { nome: string }): ParadaDaLinha => ({
  id: over.nome,
  sequence: 1,
  dropoff_sequence: null,
  status: 'pending',
  arrived_at: null,
  picked_up_at: null,
  completed_at: null,
  skipped_at: null,
  delivered_at: null,
  exact_time: null,
  window_end: null,
  dog: { name: over.nome, client: { name: 'Ana', address_line_1: null, city: null } },
  ...over,
});

describe('drop-offs do gestor', () => {
  it('ordena pela ordem da ENTREGA; quem não tem ordem vai para o fim (nunca some)', () => {
    const paradas = [
      mapearParada(linha({ nome: 'A', sequence: 1, dropoff_sequence: 3 })),
      mapearParada(linha({ nome: 'B', sequence: 2, dropoff_sequence: 1 })),
      mapearParada(linha({ nome: 'C', sequence: 3, dropoff_sequence: null })),
    ];
    expect(ordenarParaEntrega(paradas).map((parada) => parada.dogName)).toEqual(['B', 'A', 'C']);
  });

  it('situação da entrega: o pick-up concluído NÃO conta como entrega', () => {
    // Cão pego de manhã (status completed) mas ainda não entregue → continua "In the van".
    expect(
      situacaoDaEntrega({ status: 'completed', pickedUpAt: '2026-10-02T15:00:00.000Z', completedAt: '2026-10-02T15:00:00.000Z', deliveredAt: null }),
    ).toBe('In the van');
    // Entregue de tarde → "Delivered · hora".
    expect(
      situacaoDaEntrega({ status: 'completed', pickedUpAt: null, completedAt: null, deliveredAt: '2026-10-02T22:05:00.000Z' }),
    ).toMatch(/^Delivered · /);
    // Cão posto direto na tarde (sem busca) → pendente.
    expect(
      situacaoDaEntrega({ status: 'pending', pickedUpAt: null, completedAt: null, deliveredAt: null }),
    ).toBe('Pending');
    // Problema → Problem.
    expect(
      situacaoDaEntrega({ status: 'skipped', pickedUpAt: null, completedAt: null, deliveredAt: null }),
    ).toBe('Problem');
  });

  it('a próxima entrega ignora quem já foi entregue e quem virou problema', () => {
    const paradas = [
      mapearParada(linha({ nome: 'A', status: 'completed', delivered_at: '2026-10-02T22:00:00.000Z' })),
      mapearParada(linha({ nome: 'B', status: 'completed' })),
      mapearParada(linha({ nome: 'C', status: 'skipped' })),
    ];
    expect(proximaEntrega(paradas)?.dogName).toBe('B');
    expect(proximaEntrega(paradas.filter((parada) => parada.dogName === 'A'))).toBeNull();
  });
});
