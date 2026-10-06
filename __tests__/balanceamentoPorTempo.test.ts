import { haversineKm } from '@/features/dispatch/routeOptimizer';
import { balancearRotas, ordenarEMedirRota } from '@/features/dispatch/routeBalancer';
import { sugerirRotas, type BlocoSugerido, type CaoParaSugerir, type MotoristaParaSugerir, type SugestaoDeRotas } from '@/features/dispatch/routeSuggestion';

/**
 * BALANCEAMENTO POR TEMPO DA SUGESTÃO AUTOMÁTICA (pedido do dono, 06/10/2026):
 * *"não quero dividir os cachorros igualmente; quero dividir o TRABALHO da forma mais equilibrada
 * possível"*.
 *
 * Provas que importam aqui:
 *  - 4 + 4 com tempos 35 min e 2h30 NÃO é equilíbrio: o algoritmo redistribui (4 + 4 → 6 + 2);
 *  - rota com MAIS cães, todos pertos, não é desmanchada só para igualar a contagem;
 *  - cão isolado vai para quem consegue buscá-lo sem atravessar duas vezes a cidade;
 *  - as pontas contam: pick-up VAN → cães → YARD e entrega YARD → cães → VAN;
 *  - capacidade da van NUNCA é estourada (o que não cabe volta para o gestor);
 *  - o tempo do serviço de rotas, quando existe, é o tempo usado (não a linha reta);
 *  - o log de DEBUG conta a história da distribuição (e só existe quando pedido).
 */
const LON = -122.14;
const VAN = { latitude: 37.3, longitude: LON };
const YARD = { latitude: 37.5, longitude: LON };
const VELOCIDADE_KPH = 25;
const SERVICO_MIN = 8;

const cao = (dogId: string, latitude: number, longitude = LON, clientId?: string): CaoParaSugerir =>
  ({ dogId, dogName: dogId, clientName: clientId ?? dogId, clientId: clientId ?? null, latitude, longitude });

const motorista = (driverId: string): MotoristaParaSugerir =>
  ({ driverId, driverName: `Driver ${driverId}` });

const blocoDe = (sugestao: SugestaoDeRotas, driverId: string): BlocoSugerido => {
  const bloco = sugestao.blocos.find(item => item.driverId === driverId);
  if (!bloco) throw new Error(`sem bloco para ${driverId}`);
  return bloco;
};

const caesDe = (sugestao: SugestaoDeRotas): string[] =>
  sugestao.blocos.flatMap(bloco => bloco.caes.map(item => item.dogId)).sort();

const minutosPorKm = (km: number): number => (km / VELOCIDADE_KPH) * 60;

type Ponto = { latitude: number | null; longitude: number | null };

const kmEntre = (a: Ponto, b: Ponto): number =>
  haversineKm(a.latitude as number, a.longitude as number, b.latitude as number, b.longitude as number);

/** Minutos de um bloco (a sugestão sempre devolve; o `?? 0` é só para o tipo). */
const minutosDe = (bloco: BlocoSugerido): number => bloco.minutos ?? 0;

/** Diferença entre a rota mais longa e a mais curta (o número que o dono quer ver pequeno). */
const desequilibrio = (sugestao: SugestaoDeRotas): number => {
  const tempos = sugestao.blocos.map(bloco => bloco.minutos ?? 0);
  return Math.max(...tempos) - Math.min(...tempos);
};

/* ------------------------------------------------------------------ *
 * CENÁRIO 1 — mesma quantidade de cães, tempos completamente diferentes
 * ------------------------------------------------------------------ */

describe('cenário 1 — mesma contagem, tempos muito diferentes: redistribui', () => {
  /** 4 cães colados a 1 km da van + 4 cães espalhados por 50 km de estrada. */
  const perto = [0, 1, 2, 3].map(i => cao(`perto${i}`, 37.309 + i * 0.0005));
  const longe = [0, 1, 2, 3].map(i => cao(`longe${i}`, 37.45 + i * 0.1));

  it('não entrega 4 + 4 quando isso deixa um motorista com o dobro do trabalho', () => {
    const sugestao = sugerirRotas([...perto, ...longe], [motorista('a'), motorista('b')], VAN);
    const tamanhos = sugestao.blocos.map(bloco => bloco.caes.length).sort();
    expect(caesDe(sugestao)).toEqual([...perto, ...longe].map(item => item.dogId).sort());
    // A contagem pode (e deve) sair diferente: o rateio é por tempo.
    expect(tamanhos).not.toEqual([4, 4]);
    expect(tamanhos.reduce((soma, n) => soma + n, 0)).toBe(8);
    // E o desequilíbrio fica MUITO abaixo do 4 + 4 original (que passava de 110 min).
    expect(desequilibrio(sugestao)).toBeLessThan(60);
  });

  it('o 4 + 4 equivalente tem desequilíbrio enorme (a prova de que o cenário é o problema)', () => {
    const quatroPerto = ordenarEMedirRota(perto, { inicio: VAN }).minutos;
    const quatroLonge = ordenarEMedirRota(longe, { inicio: VAN }).minutos;
    expect(Math.abs(quatroLonge - quatroPerto)).toBeGreaterThan(100);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 2 — mais cães, porém todos pertos: NÃO desmanchar o cluster
 * ------------------------------------------------------------------ */

describe('cenário 2 — rota com mais cães, todos pertos', () => {
  /** 6 cães colados a 1 km da van + 3 cães espalhados de 7 km a 18 km. */
  const juntos = [0, 1, 2, 3, 4, 5].map(i => cao(`juntos${i}`, 37.309 + i * 0.00005));
  const espalhados = [cao('e0', 37.36), cao('e1', 37.41), cao('e2', 37.46)];

  it('mantém 6 + 3: igualar para 5 + 4 só pioraria o tempo', () => {
    const sugestao = sugerirRotas([...juntos, ...espalhados], [motorista('a'), motorista('b')], VAN);
    expect(sugestao.blocos.map(bloco => bloco.caes.length).sort()).toEqual([3, 6]);
    expect(desequilibrio(sugestao)).toBeLessThan(20);
    // O 5 + 4 equivalente medido na mão é PIOR:
    const comCinco = Math.abs(
      ordenarEMedirRota([...juntos.slice(0, 5)], { inicio: VAN }).minutos
      - ordenarEMedirRota([...espalhados, juntos[5]], { inicio: VAN }).minutos,
    );
    expect(desequilibrio(sugestao)).toBeLessThan(comCinco);
  });

  it('a casa de 5 continua inteira no mesmo carro', () => {
    // Irmãos de verdade: MESMO endereço (cadastro torto é outro caso, coberto pelo `semLugar`).
    const familia = [0, 1, 2, 3, 4].map(i => ({ ...cao(`ir${i}`, 37.32), clientId: 'familia' }));
    const sugestao = sugerirRotas([...familia, ...espalhados], [motorista('a'), motorista('b')], VAN);
    const blocosDaFamilia = sugestao.blocos.filter(bloco => bloco.caes.some(item => item.clientId === 'familia'));
    expect(blocosDaFamilia).toHaveLength(1);
    expect(blocosDaFamilia[0].caes.filter(item => item.clientId === 'familia')).toHaveLength(5);
    expect(sugestao.semLugar).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 3 — um cão muito distante do cluster atual
 * ------------------------------------------------------------------ */

describe('cenário 3 — o cão fora do cluster', () => {
  const clusterX = [0, 1, 2, 3].map(i => cao(`x${i}`, 37.31 + i * 0.0004));
  const clusterY = [0, 1, 2].map(i => cao(`y${i}`, 37.4 + i * 0.0004));
  const isolado = cao('isolado', 37.42);
  const medir = (caes: CaoParaSugerir[]) => ordenarEMedirRota(caes, { inicio: VAN }).minutos;

  it('fica com o cluster mais próximo dele e o desequilíbrio bate as alternativas simples', () => {
    const sugestao = sugerirRotas([...clusterX, ...clusterY, isolado], [motorista('a'), motorista('b')], VAN);
    const blocoDoIsolado = sugestao.blocos.find(bloco => bloco.caes.some(item => item.dogId === 'isolado'))!;

    // O isolado fica junto do cluster MAIS PRÓXIMO dele (o Y, a 1,1 km) — não sozinho nem colado no X.
    expect(blocoDoIsolado.caes.some(item => item.dogId.startsWith('y'))).toBe(true);
    expect(blocoDoIsolado.caes).not.toHaveLength(1);

    // As três alternativas "arrumadinhas" possíveis, medidas com a MESMA conta:
    const alternativas = [
      Math.abs(medir([...clusterX, isolado]) - medir(clusterY)),
      Math.abs(medir([...clusterY, isolado]) - medir(clusterX)),
      Math.abs(medir([...clusterX, ...clusterY]) - medir([isolado])),
    ];
    expect(caesDe(sugestao)).toHaveLength(8);
    expect(desequilibrio(sugestao)).toBeLessThanOrEqual(Math.min(...alternativas) + 0.5);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 7 — 2 motoristas com 10 cães
 * ------------------------------------------------------------------ */

describe('cenário 7 — 2 motoristas, 10 cães', () => {
  /** 6 cães colados a 1 km da van + 4 espalhados de 13 km a 30 km. */
  const compacto = [0, 1, 2, 3, 4, 5].map(i => cao(`k${i}`, 37.309 + i * 0.00005));
  const espalhados = [cao('z0', 37.42), cao('z1', 37.47), cao('z2', 37.52), cao('z3', 37.57)];

  it('procura tempos próximos mesmo que fique 7 + 3 em vez de 5 + 5', () => {
    const sugestao = sugerirRotas([...compacto, ...espalhados], [motorista('a'), motorista('b')], VAN);
    expect(sugestao.blocos.map(bloco => bloco.caes.length).sort()).toEqual([3, 7]);
    expect(desequilibrio(sugestao)).toBeLessThan(20);
    expect(caesDe(sugestao)).toHaveLength(10);
    const cincoCinco = Math.abs(
      ordenarEMedirRota(compacto.slice(0, 5), { inicio: VAN }).minutos
      - ordenarEMedirRota([...espalhados, compacto[5]], { inicio: VAN }).minutos,
    );
    expect(desequilibrio(sugestao)).toBeLessThan(cincoCinco);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 4 — PICK-UP: VAN → cães → YARD
 * ------------------------------------------------------------------ */

describe('cenário 4 — pick-up termina no yard (VAN → cães → YARD)', () => {
  const linha = [cao('p1', 37.31), cao('p2', 37.33), cao('p3', 37.47)];

  it('a van é a 1ª perna e o yard é a ÚLTIMA — os dois entram no tempo', () => {
    const sugestao = sugerirRotas(linha, [motorista('a')], VAN, { fim: YARD });
    const bloco = blocoDe(sugestao, 'a');
    const esperadoKm = kmEntre(VAN, linha[0]) + kmEntre(linha[0], linha[1]) + kmEntre(linha[1], linha[2])
      + kmEntre(linha[2], YARD);
    expect(bloco.km).toBeCloseTo(esperadoKm, 6);
    expect(minutosDe(bloco)).toBeCloseTo(minutosPorKm(esperadoKm) + linha.length * SERVICO_MIN, 6);
  });

  it('a última parada é a que está mais perto de fechar o dia no yard', () => {
    const sugestao = sugerirRotas(linha, [motorista('a')], VAN, { fim: YARD });
    const bloco = blocoDe(sugestao, 'a');
    expect(bloco.caes[bloco.caes.length - 1].dogId).toBe('p3');
  });

  it('sem yard cadastrado a última perna não existe (o app não inventa ponto)', () => {
    const comYard = blocoDe(sugerirRotas(linha, [motorista('a')], VAN, { fim: YARD }), 'a');
    const semYard = blocoDe(sugerirRotas(linha, [motorista('a')], VAN), 'a');
    expect(minutosDe(comYard) - minutosDe(semYard)).toBeCloseTo(minutosPorKm(kmEntre(linha[2], YARD)), 6);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 5 — DROP-OFF: YARD → cães → VAN
 * ------------------------------------------------------------------ */

describe('cenário 5 — entrega sai do yard e fecha na van (YARD → cães → VAN)', () => {
  const linha = [cao('d1', 37.47), cao('d2', 37.45), cao('d3', 37.33)];

  it('o yard é a 1ª perna e a van é a ÚLTIMA — os dois entram no tempo', () => {
    const sugestao = sugerirRotas(linha, [motorista('a')], YARD, { inicio: YARD, fim: VAN });
    const bloco = blocoDe(sugestao, 'a');
    const esperadoKm = kmEntre(YARD, linha[0]) + kmEntre(linha[0], linha[1]) + kmEntre(linha[1], linha[2])
      + kmEntre(linha[2], VAN);
    expect(bloco.km).toBeCloseTo(esperadoKm, 6);
    expect(minutosDe(bloco)).toBeCloseTo(minutosPorKm(esperadoKm) + linha.length * SERVICO_MIN, 6);
    expect(bloco.caes[bloco.caes.length - 1].dogId).toBe('d3');
  });

  it('as duas pontas contam juntas: sem elas a rota medida seria menor', () => {
    const comPontas = blocoDe(sugerirRotas(linha, [motorista('a')], YARD, { inicio: YARD, fim: VAN }), 'a');
    const semPontas = blocoDe(sugerirRotas(linha, [motorista('a')], null), 'a');
    const pontas = minutosPorKm(kmEntre(YARD, linha[0]) + kmEntre(linha[2], VAN));
    expect(minutosDe(comPontas) - minutosDe(semPontas)).toBeCloseTo(pontas, 6);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 6 — capacidade máxima da van
 * ------------------------------------------------------------------ */

describe('cenário 6 — capacidade da van nunca é estourada', () => {
  const dez = Array.from({ length: 10 }, (_, i) => cao(`c${i}`, 37.31 + i * 0.002));

  it('com vaga para todos, ninguém passa do teto', () => {
    const sugestao = sugerirRotas(dez, [motorista('a'), motorista('b')], VAN, {
      capacidadePorMotorista: new Map([['a', 6], ['b', 6]]),
    });
    for (const bloco of sugestao.blocos) expect(bloco.caes.length).toBeLessThanOrEqual(6);
    expect(caesDe(sugestao)).toHaveLength(10);
    expect(desequilibrio(sugestao)).toBeLessThan(20);
  });

  it('sem vaga para todos, o excedente volta para o gestor — nunca fica em cima do motorista', () => {
    const sugestao = sugerirRotas(dez, [motorista('a'), motorista('b')], VAN, {
      capacidadePorMotorista: new Map([['a', 3], ['b', 3]]),
    });
    for (const bloco of sugestao.blocos) expect(bloco.caes.length).toBeLessThanOrEqual(3);
    expect(caesDe(sugestao).length + sugestao.semLugar.length).toBe(10);
    expect(sugestao.semLugar).toHaveLength(4);
  });

  it('o teto não muda com rota que já existe (carga fixa conta na capacidade)', () => {
    const resultado = balancearRotas(dez, [motorista('a'), motorista('b')], {
      inicio: VAN,
      capacidadePorMotorista: new Map([['a', 4], ['b', 6]]),
      fixosPorMotorista: new Map([['a', [cao('preso1', 37.31), cao('preso2', 37.315)]]]),
    });
    const blocoA = resultado.blocos.find(bloco => bloco.driverId === 'a');
    expect(blocoA ? blocoA.caes.length : 0).toBeLessThanOrEqual(2);   // 4 de teto - 2 presos
    expect(resultado.blocos.every(bloco => bloco.caes.length <= 6)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * CENÁRIO 8 — 3+ motoristas
 * ------------------------------------------------------------------ */

describe('cenário 8 — 3 motoristas: melhorar dois não estraga o terceiro', () => {
  const sul = [0, 1, 2, 3].map(i => cao(`s${i}`, 37.31 + i * 0.0004));
  const centro = [0, 1, 2, 3].map(i => cao(`m${i}`, 37.4 + i * 0.0004));
  const norte = [0, 1, 2, 3].map(i => cao(`n${i}`, 37.5 + i * 0.0004));
  const todos = [...sul, ...centro, ...norte];

  it('as três rotas ficam próximas em tempo (e nenhum motorista fica de fora)', () => {
    const sugestao = sugerirRotas(todos, [motorista('a'), motorista('b'), motorista('c')], VAN);
    const tempos = sugestao.blocos.map(bloco => bloco.minutos ?? 0);
    expect(caesDe(sugestao)).toHaveLength(12);
    expect(sugestao.blocos).toHaveLength(3);
    // O cluster do norte é 22 km ao norte: a tolerância é do tamanho dessa ponta, não zero.
    expect(Math.max(...tempos)).toBeLessThanOrEqual(Math.min(...tempos) * 1.5 + 5);
  });

  it('a busca nunca deixa a distribuição pior do que a semente geográfica, nem alonga a pior rota', () => {
    const semente = balancearRotas(todos, [motorista('a'), motorista('b'), motorista('c')], {
      inicio: VAN, maxIteracoes: 1, maxAvaliacoes: 1,
    });
    const sugestao = sugerirRotas(todos, [motorista('a'), motorista('b'), motorista('c')], VAN);
    const piorDaSemente = Math.max(...semente.blocos.map(bloco => bloco.minutos));
    const piorFinal = Math.max(...sugestao.blocos.map(bloco => bloco.minutos ?? 0));
    expect(desequilibrio(sugestao)).toBeLessThan(semente.desequilibrio);
    expect(piorFinal).toBeLessThanOrEqual(piorDaSemente);
  });
});

/* ------------------------------------------------------------------ *
 * DIA CHEIO — a distribuição nunca pode voltar ao "12 + 1 + 1 + 12"
 * ------------------------------------------------------------------ */

describe('dia cheio (26 cães, 4 motoristas)', () => {
  // 9 casas por "rua", três ruas próximas: é o desenho que já produziu 12+1+1+12 quando a semente do
  // corte contíguo não contava o SERVIÇO de cada cão (achava que 23 cães custavam o mesmo que 1).
  const dia = Array.from({ length: 26 }, (_, i) =>
    cao(`d${i}`, 37.3 + (i % 9) * 0.008 + Math.floor(i / 9) * 0.0004));
  const quatro = ['m0', 'm1', 'm2', 'm3'].map(motorista);

  it('as quatro rotas ficam próximas em tempo, com a contagem saindo 7+7+6+6 em vez de igual', () => {
    const sugestao = sugerirRotas(dia, quatro, VAN, { fim: { latitude: 37.35, longitude: LON } });
    const tempos = sugestao.blocos.map(bloco => bloco.minutos ?? 0);
    expect(sugestao.blocos).toHaveLength(4);
    expect(caesDe(sugestao)).toHaveLength(26);
    expect(sugestao.blocos.map(bloco => bloco.caes.length).sort()).toEqual([6, 6, 7, 7]);
    expect(Math.max(...tempos) - Math.min(...tempos)).toBeLessThan(10);
  });
});

/* ------------------------------------------------------------------ *
 * TEMPOS DO SERVIÇO DE ROTAS e LOG
 * ------------------------------------------------------------------ */

describe('tempos do serviço de rotas (matriz) e log de DEBUG', () => {
  it('usa a matriz do servidor quando ela existe, em vez da linha reta', () => {
    const tres = [cao('t1', 37.31), cao('t2', 37.32), cao('t3', 37.33)];
    const estimado = sugerirRotas(tres, [motorista('a')], VAN);
    // Matriz falsa: 40 min da base até o 1º cão e 45 min entre quaisquer dois cães.
    const matriz = { homeTo: () => 40, between: () => 45 };
    const real = sugerirRotas(tres, [motorista('a')], VAN, { travel: matriz, matrizBase: VAN });
    expect(blocoDe(estimado, 'a').minutos).toBeLessThan(60);
    expect(blocoDe(real, 'a').minutos).toBeCloseTo(40 + 45 + 45 + 3 * SERVICO_MIN, 6);
  });

  it('o log só existe quando pedido e conta a história no formato do dono', () => {
    const perto = [0, 1, 2, 3].map(i => cao(`p${i}`, 37.309 + i * 0.0005));
    const longe = [0, 1, 2, 3].map(i => cao(`l${i}`, 37.45 + i * 0.1));
    const motoristas = [motorista('a'), motorista('b')];
    expect(balancearRotas([...perto, ...longe], motoristas, { inicio: VAN }).debug).toEqual([]);
    const comLog = balancearRotas([...perto, ...longe], motoristas, { inicio: VAN, debug: true }).debug;
    const texto = comLog.join('\n');
    expect(texto).toContain('AUTO ROUTE BALANCER');
    expect(texto).toContain('Initial:');
    expect(texto).toMatch(/Driver a: \d+ dogs \/ \d+ min/);
    expect(texto).toContain('Trying:');
    expect(texto).toMatch(/(Move|Swap) /);
    expect(texto).toMatch(/Previous imbalance: \d+ min/);
    expect(texto).toMatch(/New imbalance: \d+ min/);
    expect(texto).toContain('ACCEPTED');
    expect(comLog.length).toBeLessThanOrEqual(200);
  });

  it('respeita o teto de avaliações (sem tempestade de contas)', () => {
    const muitos = Array.from({ length: 24 }, (_, i) => cao(`d${i}`, 37.3 + i * 0.004));
    const resultado = balancearRotas(muitos, [motorista('a'), motorista('b'), motorista('c')], {
      inicio: VAN, maxAvaliacoes: 60,
    });
    // O teto vale para a BUSCA; a medida final de cada bloco (2-opt, depois do teto) entra depois.
    expect(resultado.avaliacoes).toBeLessThanOrEqual(60 + resultado.blocos.length + 2);
    expect(caesDe({ blocos: resultado.blocos, semLugar: resultado.semLugar, kmTotal: resultado.kmTotal })).toHaveLength(24);
  });
});
