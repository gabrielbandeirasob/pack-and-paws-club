import { ordenarComTravas, ordemDaBusca, ordemDaEntrega, type PinDaParada } from '@/features/dispatch/orderPins';

const paradas = ['A', 'B', 'C', 'D'].map((dogId, i) => ({ dogId, sequence: i + 1 }));
const ids = (lista: { dogId: string }[]) => lista.map((stop) => stop.dogId);
const aplicar = (travas: PinDaParada[]) => ordenarComTravas(paradas, travas, paradas.length);

it('sem travas preserva a ordem e não modifica a entrada', () => {
  expect(aplicar([])).toEqual({ ordem: paradas, conflitos: [] });
  expect(ids(paradas)).toEqual(['A', 'B', 'C', 'D']);
});
it.each([
  ['first', undefined, ['C', 'A', 'B', 'D']],
  ['last', undefined, ['A', 'B', 'D', 'C']],
  ['fixed', 2, ['A', 'C', 'B', 'D']],
] as const)('aplica %s', (tipo, posicao, esperado) => {
  const resultado = aplicar([{ dogId: 'C', pin: { tipo, posicao } }]);
  expect(ids(resultado.ordem)).toEqual(esperado);
  expect(resultado.conflitos).toEqual([]);
});
it('primeiro pedido vence colisão e perdedor mantém ordem relativa calculada', () => {
  const resultado = aplicar([
    { dogId: 'D', pin: { tipo: 'first' } }, { dogId: 'C', pin: { tipo: 'first' } },
  ]);
  expect(ids(resultado.ordem)).toEqual(['D', 'A', 'B', 'C']);
  expect(resultado.conflitos).toEqual([{ dogIds: ['D', 'C'], posicao: 1, motivo: 'collision' }]);
});
it('relata posição maior que a lista', () => {
  expect(aplicar([{ dogId: 'C', pin: { tipo: 'fixed', posicao: 5 } }])).toEqual({
    ordem: paradas, conflitos: [{ dogIds: ['C'], posicao: 5, motivo: 'outside' }],
  });
});
it('último e posição 2 colidem num grupo de dois', () => {
  const resultado = ordenarComTravas(paradas.slice(0, 2), [
    { dogId: 'A', pin: { tipo: 'last' } }, { dogId: 'B', pin: { tipo: 'fixed', posicao: 2 } },
  ], 2);
  expect(ids(resultado.ordem)).toEqual(['B', 'A']);
  expect(resultado.conflitos[0].dogIds).toEqual(['A', 'B']);
});
it('busca centraliza sequence sem mutação', () => {
  expect(ordemDaBusca([...paradas].reverse())).toEqual(paradas);
});
it('entrega usa a ordem própria e nulos ficam por último na ordem da busca', () => {
  const stops = [
    { dogId: 'D', sequence: 4, dropoffSequence: null },
    { dogId: 'A', sequence: 1, dropoffSequence: 2 },
    { dogId: 'C', sequence: 3, dropoffSequence: 1 },
    { dogId: 'B', sequence: 2 },
  ];
  expect(ids(ordemDaEntrega(stops))).toEqual(['C', 'A', 'B', 'D']);
  expect(stops[0].dogId).toBe('D');
  expect(ordemDaEntrega(paradas)).toEqual(paradas);
});
it('entrega vazia', () => expect(ordemDaEntrega([])).toEqual([]));
