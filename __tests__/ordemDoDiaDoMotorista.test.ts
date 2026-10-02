import { ordenarParadasDoDia, proximaParadaDoDia } from '@/features/driver/dayOrder';
import { nextStopEta } from '@/features/driver/eta';
import { rowToStop } from '@/features/driver/rows';

const paradas = ['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki'].map((dogName, i) => ({
  id: dogName, dogName, clientName: 'Ana', sequence: i + 1,
  dropoffSequence: 5 - i, status: 'picked_up',
}));
const nomes = (stops: typeof paradas) => stops.map((s) => s.dogName);

it.each(['pending', 'arrived'])('mantém a lista inteira na busca enquanto há %s e troca após a última busca', (status) => {
  const stops = paradas.map((s, i) => ({ ...s, status: i === 2 ? status : i === 0 ? 'completed' : s.status }));
  expect(nomes(ordenarParadasDoDia([...stops].reverse()))).toEqual(['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki']);
  expect(proximaParadaDoDia(stops)?.dogName).toBe('Luna');
  stops[2].status = 'picked_up';
  expect(nomes(ordenarParadasDoDia(stops))).toEqual(['Lucki', 'Filó', 'Luna', 'Mowgli', 'Kona']);
  expect(proximaParadaDoDia(stops)?.dogName).toBe('Lucki');
});

it('desempata entregas por busca e põe NULL/ausente por último, também por busca', () => {
  const stops = paradas.map((s, i) => ({ ...s, dropoffSequence: i < 2 ? null : i === 2 ? undefined : 1 }));
  expect(ordenarParadasDoDia([...stops].reverse()).map((s) => s.dogName)).toEqual(['Filó', 'Lucki', 'Kona', 'Mowgli', 'Luna']);
  expect(proximaParadaDoDia(stops)?.dogName).toBe('Filó');
});

it('rota antiga conserva a ordem da busca na entrega sem alterar a entrada', () => {
  const stops = paradas.map((s) => Object.freeze({ ...s, dropoffSequence: null })).reverse();
  const entrada = [...stops];
  expect(ordenarParadasDoDia(Object.freeze(stops)).map((s) => s.dogName)).toEqual(['Kona', 'Mowgli', 'Luna', 'Filó', 'Lucki']);
  expect(proximaParadaDoDia(stops)?.dogName).toBe('Kona');
  expect(stops).toEqual(entrada);
});

it('busca escolhe menor sequence entre pending e arrived, antes dos embarcados', () => {
  const stops = paradas.map((s, i) => ({ ...s, status: i === 2 ? 'arrived' : i === 3 ? 'pending' : s.status }));
  expect(proximaParadaDoDia([...stops].reverse())?.dogName).toBe('Luna');
});

it('concluídas e puladas ficam na lista: a próxima é a ENTREGA pendente (pulada nunca volta)', () => {
  const stops = paradas.map((s, i) => ({ ...s, status: i === 4 ? 'completed' : i === 3 ? 'skipped' : s.status }));
  expect(nomes(ordenarParadasDoDia(stops))).toEqual(['Lucki', 'Filó', 'Luna', 'Mowgli', 'Kona']);
  /*
   * ENTREGA (conferência do dono, 01/10/2026 — itens 2 e 5): `completed` é o fim da BUSCA, não do dia —
   * o cão está na van e a entrega continua pendente até o marco `delivered_at`. Na ordem da entrega,
   * Lucki (dropoff 1) é a primeira; quem foi marcado como problema (Filó) nunca volta.
   */
  expect(proximaParadaDoDia(stops)?.dogName).toBe('Lucki');
  expect(proximaParadaDoDia(stops.map((s) => ({ ...s, status: 'skipped' })))).toBeNull();
  expect(proximaParadaDoDia(stops.map((s) => ({ ...s, status: 'completed' })))).not.toBeNull();
  expect(proximaParadaDoDia(stops.map((s) => ({ ...s, status: 'completed', deliveredAt: '2026-10-01T21:00:00.000Z' })))).toBeNull();
});

it('lista vazia não tem próxima parada', () => {
  expect(ordenarParadasDoDia([])).toEqual([]);
  expect(proximaParadaDoDia([])).toBeNull();
});

it('ETA conserva a estrutura e acompanha a mudança da busca para a entrega', () => {
  // `temBase: false` = sem posição e sem perna de rota o app não tem base para estimar (vistoria 02/10/2026).
  expect(nextStopEta(paradas, null)).toEqual({ stopId: 'Lucki', clientName: 'Ana', dogName: 'Lucki', minutes: 0, lateMinutes: 0, temBase: false });
  expect(nextStopEta(paradas.map((s, i) => ({ ...s, status: i === 2 ? 'pending' : s.status })), null)?.stopId).toBe('Luna');
});

it.each([1, null, undefined])('mapeia dropoff_sequence %s do banco para o motorista', (dropoff_sequence) => {
  expect(rowToStop({ id: 'Lucki', sequence: 5, dropoff_sequence, status: 'picked_up', window_end: null, exact_time: null, dog: null }).dropoffSequence).toBe(dropoff_sequence ?? null);
});
