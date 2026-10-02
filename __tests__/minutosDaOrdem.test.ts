/**
 * "O OPTIMIZE ESTÁ FAZENDO A MELHOR ROTA?" — dúvida do dono (01/10/2026): *"cliquei em otimizar e fez
 * algumas mudanças, só não consigo confirmar se está realmente fazendo a melhor rota de pick-up e
 * drop-off"*.
 *
 * A resposta que o app agora dá: o MESMO número (minutos de deslocamento + serviço) para a ordem que
 * estava e para a ordem proposta, com as MESMAS contas do otimizador. Estes vetores travam a conta:
 *  - reordenar para o vizinho mais próximo DIMINUI os minutos;
 *  - com matriz de tráfego (Google, já paga no Optimize), é ela que manda;
 *  - sem coordenada e sem matriz, a função devolve null (o alerta omite a linha em vez de inventar).
 */
import { minutosDaOrdem } from '@/features/dispatch/routeOptimizer';
import type { TravelTimes } from '@/features/dispatch/travelMatrix';

const parada = (dogId: string, latitude: number | null, longitude: number | null) => ({
  dogId, clientName: 'Sarah', dogName: dogId, latitude, longitude,
  windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const,
});

// Três paradas em linha: a ordem "a, c, b" atravessa a cidade; "a, b, c" não.
const LINHA = [parada('a', 37.40, -122.14), parada('b', 37.41, -122.14), parada('c', 37.44, -122.14)];

describe('minutosDaOrdem', () => {
  it('ordem em linha reta custa menos que ordem que vai e volta', () => {
    const opcoes = { serviceMinutes: 3 };
    const boa = minutosDaOrdem(LINHA, ['a', 'b', 'c'], opcoes);
    const ruim = minutosDaOrdem(LINHA, ['a', 'c', 'b'], opcoes);
    expect(boa).not.toBeNull();
    expect(ruim).not.toBeNull();
    expect(ruim as number).toBeGreaterThan(boa as number);
    // 3 paradas x 3 min de serviço entram nas duas contas (é o mesmo conjunto).
    expect(Math.round((boa as number) - 9)).toBeGreaterThanOrEqual(0);
  });

  it('conta o serviço de cada parada (o mesmo número do Optimize)', () => {
    const semServico = minutosDaOrdem(LINHA, ['a', 'b', 'c'], { serviceMinutes: 0 });
    const comServico = minutosDaOrdem(LINHA, ['a', 'b', 'c'], { serviceMinutes: 3 });
    expect(Math.round((comServico as number) - (semServico as number))).toBe(9);
  });

  it('com matriz de tráfego, é a matriz que manda (e não a linha reta)', () => {
    const travel: TravelTimes = {
      homeTo: () => 7,
      between: (de: string, para: string) => (de === 'a' && para === 'b' ? 40 : 1),
    };
    // a→b custa 40 na matriz (trânsito), então a ordem ruim fica ruim de verdade.
    const ruim = minutosDaOrdem(LINHA, ['a', 'b', 'c'], { travel, serviceMinutes: 0 });
    expect(Math.round(ruim as number)).toBe(7 + 40 + 1);
  });

  it('sem coordenada e sem matriz devolve null (nunca inventa número)', () => {
    const semPonto = [parada('a', null, null), parada('b', 37.41, -122.14)];
    expect(minutosDaOrdem(semPonto, ['a', 'b'], { serviceMinutes: 3 })).toBeNull();
    // Mas a matriz real cobre a perna: aí a conta existe.
    const travel: TravelTimes = { homeTo: () => 5, between: () => 2 };
    expect(minutosDaOrdem(semPonto, ['a', 'b'], { travel, serviceMinutes: 0 })).toBe(7);
  });

  it('ordem vazia ou de ids desconhecidos devolve null', () => {
    expect(minutosDaOrdem(LINHA, [], {})).toBeNull();
    expect(minutosDaOrdem(LINHA, ['nao-existe'], {})).toBeNull();
  });
});
