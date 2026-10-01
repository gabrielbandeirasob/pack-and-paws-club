import { sugerirRotas, pontoUtilizavel, type CaoParaSugerir, type MotoristaParaSugerir } from '@/features/dispatch/routeSuggestion';
import { haversineKm } from '@/features/dispatch/routeOptimizer';

/**
 * SUGESTÃO DE ROTA (distribuição + ordem, por geografia) — pedido do cliente em áudio (01/10/2026):
 * *"sugestão de rota automática… leva um tempinho aí de clicar e mandar pro driver certo"*.
 *
 * A prova que importa aqui: a divisão devolvida é a de MENOR distância total entre todas as divisões
 * contíguas possíveis (comparada com força bruta) e nenhum cão é perdido nem trocado de lugar — nem
 * quando dois cães moram no MESMO endereço (mesma coordenada).
 */
const cao = (dogId: string, latitude: number, longitude: number, nome = 'Sarah'): CaoParaSugerir =>
  ({ dogId, clientName: nome, dogName: dogId, latitude, longitude });

const motorista = (driverId: string, latitude?: number, longitude?: number): MotoristaParaSugerir =>
  ({ driverId, driverName: `Driver ${driverId}`, latitude, longitude });

/** 0,01° de latitude ≈ 1,11 km — a linha de cães usada nas contas abaixo. */
const LON = -122.14;
const VAN = { latitude: 37.39, longitude: LON };

const LISTA = [
  cao('a', 37.4, LON),
  cao('b', 37.41, LON),
  cao('c', 37.42, LON),
  cao('d', 37.43, LON),
];

/** Menor distância total possível, testando TODAS as divisões contíguas (n pequeno). */
function minimoPorForcaBruta(caes: CaoParaSugerir[], pedacos: number, inicio: { latitude: number; longitude: number } | null): number {
  const ordem = [...caes];
  // Na força bruta todos os cães têm coordenada (a lista do teste é montada assim).
  const lat = (item: CaoParaSugerir) => item.latitude as number;
  const lng = (item: CaoParaSugerir) => item.longitude as number;
  const custo = (bloco: CaoParaSugerir[]) => {
    let km = inicio ? haversineKm(inicio.latitude, inicio.longitude, lat(bloco[0]), lng(bloco[0])) : 0;
    for (let t = 1; t < bloco.length; t += 1) {
      km += haversineKm(lat(bloco[t - 1]), lng(bloco[t - 1]), lat(bloco[t]), lng(bloco[t]));
    }
    return km;
  };
  let melhor = Infinity;
  const n = ordem.length;
  const cortes = (k: number, de: number, escolhidos: number[]): void => {
    if (k === 1) {
      const blocos: CaoParaSugerir[][] = [];
      let anterior = 0;
      for (const corte of escolhidos) {
        blocos.push(ordem.slice(anterior, corte));
        anterior = corte;
      }
      blocos.push(ordem.slice(anterior));
      melhor = Math.min(melhor, blocos.reduce((soma, bloco) => soma + custo(bloco), 0));
      return;
    }
    for (let i = de; i <= n - k; i += 1) cortes(k - 1, i + 1, [...escolhidos, i]);
  };
  cortes(pedacos, 1, []);
  return melhor;
}

describe('sugerirRotas — divisão por geografia', () => {
  it('um motorista leva todos os cães, na ordem da trilha a partir da van', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1')], VAN);
    expect(sugestao.blocos).toHaveLength(1);
    expect(sugestao.blocos[0].caes.map((item) => item.dogId)).toEqual(['a', 'b', 'c', 'd']);
    expect(sugestao.semLugar).toEqual([]);
  });

  it('dois motoristas: a divisão é a de MENOR distância total (conferida por força bruta)', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1'), motorista('m2')], VAN);
    const bruto = minimoPorForcaBruta(LISTA, 2, VAN);
    expect(sugestao.blocos.reduce((soma, bloco) => soma + bloco.km, 0)).toBeCloseTo(bruto, 6);
    expect(sugestao.kmTotal).toBeCloseTo(bruto, 6);
  });

  it('três motoristas com cinco cães: idem (força bruta com k=3)', () => {
    const cinco = [...LISTA, cao('e', 37.44, LON)];
    const sugestao = sugerirRotas(cinco, [motorista('m1'), motorista('m2'), motorista('m3')], VAN);
    expect(sugestao.kmTotal).toBeCloseTo(minimoPorForcaBruta(cinco, 3, VAN), 6);
    expect(sugestao.blocos.flatMap((bloco) => bloco.caes).map((item) => item.dogId).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('nenhum cão aparece duas vezes nem some da sugestão', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1'), motorista('m2'), motorista('m3')], VAN);
    const ids = sugestao.blocos.flatMap((bloco) => bloco.caes.map((item) => item.dogId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(LISTA.length);
  });

  it('os blocos são contíguos na trilha (ninguém atravessa a cidade por um cão)', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1'), motorista('m2')], VAN);
    for (const bloco of sugestao.blocos) {
      const posicoes = bloco.caes.map((item) => LISTA.findIndex((cao) => cao.dogId === item.dogId));
      const ordenadas = [...posicoes].sort((x, y) => x - y);
      expect(posicoes).toEqual(ordenadas); // a ordem dentro do bloco segue a trilha
    }
  });
});

describe('sugerirRotas — motoristas em lugares diferentes', () => {
  it('cada motorista fica com o pedaço mais perto dele (norte com norte, sul com sul)', () => {
    const norte = [cao('n1', 37.50, LON), cao('n2', 37.51, LON)];
    const sul = [cao('s1', 37.30, LON), cao('s2', 37.31, LON)];
    const sugestao = sugerirRotas(
      [...norte, ...sul],
      [motorista('motoristaNorte', 37.52, LON), motorista('motoristaSul', 37.29, LON)],
      null,
    );
    const blocoDoNorte = sugestao.blocos.find((bloco) => bloco.driverId === 'motoristaNorte')!;
    const blocoDoSul = sugestao.blocos.find((bloco) => bloco.driverId === 'motoristaSul')!;
    expect(blocoDoNorte.caes.map((item) => item.dogId).sort()).toEqual(['n1', 'n2']);
    expect(blocoDoSul.caes.map((item) => item.dogId).sort()).toEqual(['s1', 's2']);
  });

  it('sem posição de ninguém, a ordem da lista do Dispatch manda', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('primeiro'), motorista('segundo')], VAN);
    expect(sugestao.blocos[0].driverId).toBe('primeiro');
    expect(sugestao.blocos[1].driverId).toBe('segundo');
  });
});

describe('sugerirRotas — casos de borda', () => {
  it('não corta a mesma casa entre motoristas, nem junta homônimos no mesmo ponto', () => {
    const casa = [
      { ...cao('sam', 37.4, LON), clientId: 'jose' },
      { ...cao('ollie', 37.4, LON), clientId: 'jose' },
      { ...cao('vizinho', 37.4, LON), clientId: 'outro' },
    ];
    const proposta = sugerirRotas(casa, [motorista('a'), motorista('b'), motorista('c')], VAN);
    expect(proposta.blocos).toHaveLength(2);
    expect(proposta.blocos.find(b => b.caes.some(c => c.dogId === 'sam'))?.caes.map(c => c.dogId)).toEqual(['sam', 'ollie']);
  });
  it('cão sem coordenada não ganha lugar inventado: vai para "semLugar"', () => {
    const semCadastro = cao('semEndereco', null as unknown as number, null as unknown as number);
    const sugestao = sugerirRotas([...LISTA, semCadastro], [motorista('m1')], VAN);
    expect(sugestao.semLugar.map((item) => item.dogId)).toEqual(['semEndereco']);
    expect(sugestao.blocos[0].caes.map((item) => item.dogId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sem motorista disponível, todos os cães ficam em "semLugar"', () => {
    const sugestao = sugerirRotas(LISTA, [], VAN);
    expect(sugestao.blocos).toEqual([]);
    expect(sugestao.semLugar).toHaveLength(LISTA.length);
  });

  it('sem cão, não há proposta', () => {
    const sugestao = sugerirRotas([], [motorista('m1')], VAN);
    expect(sugestao).toEqual({ blocos: [], semLugar: [], kmTotal: 0 });
  });

  it('mais motoristas do que cães: ninguém recebe rota vazia', () => {
    const sugestao = sugerirRotas([cao('unico', 37.4, LON)], [motorista('m1'), motorista('m2')], VAN);
    expect(sugestao.blocos).toHaveLength(1);
    expect(sugestao.blocos[0].caes).toHaveLength(1);
  });

  it('DOIS cães na mesma casa (mesma coordenada) continuam sendo dois cães distintos', () => {
    const casa = [cao('ollie', 37.45, LON, 'Jose'), cao('sam', 37.45, LON, 'Jose')];
    const sugestao = sugerirRotas([...casa, cao('outro', 37.30, LON, 'Chuck')], [motorista('m1')], VAN);
    const ids = sugestao.blocos[0].caes.map((item) => item.dogId).sort();
    expect(ids).toEqual(['ollie', 'outro', 'sam']);
    expect(sugestao.blocos[0].caes.filter((item) => item.clientName === 'Jose')).toHaveLength(2);
  });

  it('coordenada (0,0) ou fora do planeta conta como sem cadastro', () => {
    expect(pontoUtilizavel(0, 0)).toBeNull();
    expect(pontoUtilizavel(120, 10)).toBeNull();
    expect(pontoUtilizavel('37.4', -122.14)).toBeNull();
    expect(pontoUtilizavel(37.4, -122.14)).toEqual({ latitude: 37.4, longitude: -122.14 });
  });
});
