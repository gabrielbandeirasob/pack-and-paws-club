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

/**
 * DE ONDE A ENTREGA COMEÇA — pedido do CLIENTE (02/10/2026): *"Posição do driver inicia rota dos drop
 * offs"*. A primeira perna da sequência de ENTREGA tem de contar de onde o motorista está (na prática o
 * YARD), não da base (a van) — antes o número saía da van e a primeira entrega parecia mais perto/longe
 * do que é.
 */
describe('a ENTREGA começa na posição do motorista (o yard)', () => {
  const yard = { latitude: 37.36, longitude: -121.95 }; // Santa Clara
  const van = { latitude: 37.54, longitude: -122.28 }; // San Mateo (longe do yard)
  const ordem = ['perto do yard', 'longe do yard'];
  const stops = [
    { dogId: 'perto do yard', clientName: 'A', dogName: 'A', latitude: 37.37, longitude: -121.96, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const },
    { dogId: 'longe do yard', clientName: 'B', dogName: 'B', latitude: 37.50, longitude: -122.20, windowStart: null, windowEnd: null, exactTime: null, priority: 'normal' as const },
  ];
  const opcoes = { homeLatitude: van.latitude, homeLongitude: van.longitude, serviceMinutes: 0 };

  it('partindo do yard o total é MENOR do que partindo da van (a 1ª perna é curta)', () => {
    const daVan = minutosDaOrdem(stops, ordem, opcoes);
    const doYard = minutosDaOrdem(stops, ordem, opcoes, yard);
    expect(doYard).not.toBeNull();
    expect(daVan).not.toBeNull();
    expect(doYard as number).toBeLessThan(daVan as number);
  });

  it('sem origem informada, a conta segue partindo da base (nada muda para quem não usa yard)', () => {
    expect(minutosDaOrdem(stops, ordem, opcoes)).toBe(minutosDaOrdem(stops, ordem, opcoes, null));
  });
});
