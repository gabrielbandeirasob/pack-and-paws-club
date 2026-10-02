/**
 * REGRESSÃO DO FUZZING (auditoria de 02/10/2026) — o Optimize NUNCA pode propor uma rota pior.
 *
 * O defeito: o ganancioso ("vizinho mais próximo") sozinho deixava a rota mais LONGA que a ordem que já
 * estava na tela em ~3% das rotas sorteadas. Exemplo real do fuzz (geometria torta de propósito):
 * ordem original 154,7 min x ordem "otimizada" 170,1 min. O gestor clicava em otimizar e a rota piorava.
 *
 * O conserto: 2-opt a partir da ordem gananciosa E da ordem que já estava na tela, ficando com a melhor.
 */
import { optimizeRoute, minutosDaOrdem } from '@/features/dispatch/routeOptimizer';
import type { OptimizeStop } from '@/features/dispatch/routeOptimizer';

const parada = (dogId: string, latitude: number, longitude: number): OptimizeStop => ({
  dogId, clientName: `Cliente ${dogId}`, dogName: `Cao ${dogId}`,
  latitude, longitude, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal',
});

/** O caso exato que o fuzz pegou. */
const casoReal: OptimizeStop[] = [
  parada('d0', 37.08385, 36.97609),
  parada('d1', 37.15038, 37.00183),
  parada('d2', 37.06056, 36.94064),
  parada('d3', 36.82713, 36.96256),
];
const opcoes = {
  homeLatitude: 36.92524, homeLongitude: 37.03059,
  dropoffLatitude: 37.03990, dropoffLongitude: 37.12775,
  serviceMinutes: 3,
};
const origem = { latitude: 37.03990, longitude: 37.12775 };
const total = (stops: OptimizeStop[], ordem: string[]) => minutosDaOrdem(stops, ordem, opcoes, origem) as number;

describe('Optimize nunca propõe rota pior que a que já estava na tela', () => {
  it('o caso real do fuzz: a ordem que já estava lá ganha (154,7 x 170,1)', () => {
    const atual = total(casoReal, ['d0', 'd1', 'd2', 'd3']);
    const saida = optimizeRoute(casoReal, opcoes, origem);
    const proposta = total(casoReal, saida.stops.map((s) => s.dogId));
    expect(atual).toBeCloseTo(154.69, 1);
    expect(proposta).toBeLessThanOrEqual(atual + 1e-6);
  });

  it('devolve sempre a mesma lista de cães, com sequência 1..N', () => {
    const saida = optimizeRoute(casoReal, opcoes, origem);
    expect(saida.stops.map((s) => s.dogId).sort()).toEqual(['d0', 'd1', 'd2', 'd3']);
    expect(saida.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('o resultado é 2-opt: NENHUMA troca de trecho encurta ainda mais a viagem', () => {
    const saida = optimizeRoute(casoReal, opcoes, origem);
    const ordem = saida.stops.map((s) => s.dogId);
    const referencia = total(casoReal, ordem);
    for (let i = 0; i < ordem.length - 1; i += 1) {
      for (let j = i + 1; j < ordem.length; j += 1) {
        const tentativa = [...ordem];
        const trecho = tentativa.slice(i, j + 1).reverse();
        tentativa.splice(i, trecho.length, ...trecho);
        expect(total(casoReal, tentativa)).toBeGreaterThanOrEqual(referencia - 1e-6);
      }
    }
  });

  it('a ordem original bagunçada NÃO é copiada quando existe algo melhor', () => {
    const bagunçada = [casoReal[1], casoReal[3], casoReal[0], casoReal[2]];
    const atual = total(bagunçada, ['d1', 'd3', 'd0', 'd2']);
    const saida = optimizeRoute(bagunçada, opcoes, origem);
    const proposta = total(bagunçada, saida.stops.map((s) => s.dogId));
    expect(proposta).toBeLessThan(atual);
  });
});
