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

/**
 * A antiga força bruta da "menor distância total dentro do rateio justo de cães" morava aqui. Ela saiu
 * com a regra que provava (06/10/2026): a prova do rateio por CONTAGEM não faz sentido num algoritmo que
 * minimiza TEMPO. No lugar dela, `menorDesequilibrioPorForcaBruta` (abaixo) prova o critério novo.
 */

/**
 * Menor DESEQUILÍBRIO DE TEMPO possível entre TODAS as divisões das casas (força bruta, n pequeno).
 *
 * É o novo critério (substitui a antiga "menor distância dentro do rateio"): o tempo de um grupo é a
 * trilha por vizinho mais próximo saindo da van mais 8 min de serviço por cão — a MESMA conta que o
 * balanceador usa (linha reta a 25 km/h, sem ponta final). Cada cão do teste é uma casa.
 */
function menorDesequilibrioPorForcaBruta(
  caes: CaoParaSugerir[],
  pedacos: number,
  inicio: { latitude: number; longitude: number },
): number {
  const distancia = (aLat: number, aLng: number, bLat: number, bLng: number) => haversineKm(aLat, aLng, bLat, bLng);
  const tempoDoGrupo = (grupo: CaoParaSugerir[]) => {
    const restantes = [...grupo];
    let lat = inicio.latitude;
    let lng = inicio.longitude;
    let minutos = grupo.length * 8;
    while (restantes.length > 0) {
      let melhor = 0;
      for (let i = 1; i < restantes.length; i += 1) {
        const atual = distancia(lat, lng, restantes[i].latitude as number, restantes[i].longitude as number);
        const campeao = distancia(lat, lng, restantes[melhor].latitude as number, restantes[melhor].longitude as number);
        if (atual < campeao) melhor = i;
      }
      const [escolhido] = restantes.splice(melhor, 1);
      minutos += (distancia(lat, lng, escolhido.latitude as number, escolhido.longitude as number) / 25) * 60;
      lat = escolhido.latitude as number;
      lng = escolhido.longitude as number;
    }
    return minutos;
  };
  let melhor = Infinity;
  const distribuir = (indice: number, grupos: CaoParaSugerir[][]): void => {
    if (indice === caes.length) {
      if (grupos.some((grupo) => grupo.length === 0)) return;
      const tempos = grupos.map(tempoDoGrupo);
      melhor = Math.min(melhor, Math.max(...tempos) - Math.min(...tempos));
      return;
    }
    for (const grupo of grupos) {
      grupo.push(caes[indice]);
      distribuir(indice + 1, grupos);
      grupo.pop();
    }
  };
  distribuir(0, Array.from({ length: pedacos }, () => []));
  return melhor;
}

/** Diferença entre a rota mais longa e a mais curta da sugestão (o número que o dono quer pequeno). */
const desequilibrioDaSugestao = (blocos: { minutos?: number }[]): number => {
  const tempos = blocos.map((bloco) => bloco.minutos ?? 0);
  return Math.max(...tempos) - Math.min(...tempos);
};

describe('sugerirRotas — divisão por geografia', () => {
  it('um motorista leva todos os cães, na ordem da trilha a partir da van', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1')], VAN);
    expect(sugestao.blocos).toHaveLength(1);
    expect(sugestao.blocos[0].caes.map((item) => item.dogId)).toEqual(['a', 'b', 'c', 'd']);
    expect(sugestao.semLugar).toEqual([]);
  });

  it('dois motoristas: a DIFERENÇA DE TEMPO é a menor possível (força bruta)', () => {
    // O rateio aritmético de cães saiu de cena (pedido do dono, 06/10/2026): o que a sugestão minimiza é
    // a diferença de TEMPO entre as rotas. Aqui o 2 + 2 continua acontecendo porque é o melhor em tempo —
    // mas quem manda é a conta dos minutos, não `total ÷ motoristas`.
    const sugestao = sugerirRotas(LISTA, [motorista('m1'), motorista('m2')], VAN);
    expect(sugestao.blocos.map((bloco) => bloco.caes.length).sort()).toEqual([2, 2]);
    const bruto = menorDesequilibrioPorForcaBruta(LISTA, 2, VAN);
    expect(desequilibrioDaSugestao(sugestao.blocos)).toBeLessThanOrEqual(bruto + 1);
  });

  it('três motoristas com cinco cães: nenhum cão some e o tempo fica o mais próximo possível', () => {
    const cinco = [...LISTA, cao('e', 37.44, LON)];
    const sugestao = sugerirRotas(cinco, [motorista('m1'), motorista('m2'), motorista('m3')], VAN);
    expect(sugestao.blocos.map((bloco) => bloco.caes.length).sort()).toEqual([1, 2, 2]);
    const bruto = menorDesequilibrioPorForcaBruta(cinco, 3, VAN);
    expect(desequilibrioDaSugestao(sugestao.blocos)).toBeLessThanOrEqual(bruto + 1);
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

/**
 * PESO EQUILIBRADO ENTRE MOTORISTAS (pedido do dono, 01/10/2026: *"está funcionando porém quero que vc dê
 * uma balanceada senão vai ficar muito pesado para algum driver"*).
 *
 * A geografia continua mandando, mas com TETO de cães por motorista: o teto é o rateio justo
 * (total ÷ motoristas, arredondado para cima). Sem teto, um caso de 1 cão perto + 5 longe dava 1 + 5 —
 * geograficamente ótimo e operacionalmente injusto.
 */
describe('sugerirRotas — equilíbrio do peso', () => {
  it('rateia o peso em vez de deixar tudo com um motorista (1 perto + 5 longe = 3 + 3)', () => {
    const perto = [cao('perto', 37.401, LON)];
    // Cinco cães longe (≈11 km ao norte), onde a geografia pura mandaria UM motorista pegar todos.
    const longe = Array.from({ length: 5 }, (_, i) => cao(`longe${i}`, 37.5 + i * 0.001, LON));
    const sugestao = sugerirRotas([...perto, ...longe], [motorista('m1'), motorista('m2')], VAN);
    const tamanhos = sugestao.blocos.map((bloco) => bloco.caes.length).sort();
    expect(tamanhos).toEqual([3, 3]);
    expect(sugestao.blocos.flatMap((bloco) => bloco.caes)).toHaveLength(6);
  });

  it('cinco cães: a casa dos irmãos nunca se parte e a carga fica equilibrada em TEMPO', () => {
    const casa = [0, 1].map((i) => ({ ...cao(`irmao${i}`, 37.5, LON), clientId: 'jose' }));
    const vizinhos = [0, 1, 2].map((i) => ({ ...cao(`vizinho${i}`, 37.55 + i * 0.001, LON), clientId: `c${i}` }));
    const sugestao = sugerirRotas([...casa, ...vizinhos], [motorista('m1'), motorista('m2')], VAN);
    const blocoDosIrmaos = sugestao.blocos.find((bloco) => bloco.caes.some((c) => c.dogId === 'irmao0'));
    // Irmãos no MESMO carro (a casa não se reparte) e nenhum cão perdido — não há mais teto aritmético.
    expect(blocoDosIrmaos?.caes.filter((c) => c.clientId === 'jose').map((c) => c.dogId).sort())
      .toEqual(['irmao0', 'irmao1']);
    expect(sugestao.blocos.flatMap((bloco) => bloco.caes)).toHaveLength(5);
    // O que passou a mandar: a diferença de TEMPO entre os dois carros.
    expect(desequilibrioDaSugestao(sugestao.blocos)).toBeLessThan(20);
  });

  it('caso já equilibrado não muda (2 + 2 continua 2 + 2)', () => {
    const sugestao = sugerirRotas(LISTA, [motorista('m1'), motorista('m2')], VAN);
    expect(sugestao.blocos.map((bloco) => bloco.caes.length).sort()).toEqual([2, 2]);
  });

  it('um motorista só leva tudo, mesmo com teto', () => {
    const longe = Array.from({ length: 7 }, (_, i) => cao(`c${i}`, 37.5 + i * 0.001, LON));
    const sugestao = sugerirRotas(longe, [motorista('m1')], VAN);
    expect(sugestao.blocos[0].caes).toHaveLength(7);
  });
});
