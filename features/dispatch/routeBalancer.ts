/**
 * BALANCEADOR DE ROTAS POR TEMPO — a inteligência da sugestão automática de rotas.
 *
 * Pedido do dono (06/10/2026): *"não quero dividir os cachorros igualmente; quero dividir o TRABALHO da
 * forma mais equilibrada possível"*. A regra antiga era aritmética — `total ÷ motoristas`, com teto de
 * cães por carro — e produzia o absurdo de 5 cães/35 min para um motorista e 5 cães/1h25 para outro: a
 * MESMA quantidade de cães pode ser uma carga de trabalho completamente diferente.
 *
 * O que manda agora é o TEMPO ESTIMADO DA ROTA INTEIRA, com as pontas:
 *   pick-up:  VAN  → cães → YARD      (1ª perna sai da van, última perna termina no yard)
 *   entrega:  YARD → cães → VAN       (1ª perna sai do yard, última perna termina na van)
 * A geografia entra com peso MÉDIO e a quantidade de cães com peso BAIXO. O objetivo é minimizar
 * `max(duração) − min(duração)` entre os motoristas.
 *
 * Como, sem força bruta e sem tempestade de chamadas de API:
 *  1. SEMENTE geográfica — trilha por vizinho mais próximo cortada em blocos contíguos (o que a sugestão
 *     sempre fez), agora respeitando só a CAPACIDADE quando ela existe; nada de rateio fixo de cães.
 *  2. BUSCA LOCAL — move UMA casa de um motorista para outro e troca casas entre dois motoristas,
 *     reavaliando APENAS as rotas afetadas, com cache por (motorista + conjunto de casas).
 *  3. Aceita a mudança só quando a pontuação global melhora:
 *       score = desequilíbrio(em minutos) + pesoKm·kmTotal + pesoCaes·desvioDeCães
 *     e nunca quando ela fura a capacidade, separa irmãos de casa ou sai do teto de avaliações.
 *  4. Para no limite de iterações/avaliações ou quando nenhuma troca melhora.
 *
 * Nada aqui chama rede: a matriz de tempos REAIS do Google entra por `travel` (uma chamada por perna,
 * feita pelo chamador) e é reaproveitada em todas as avaliações — é o que evita centenas de chamadas.
 *
 * Módulo PURO (sem I/O, sem tela): tudo o que ele sabe está nos argumentos.
 */
import {
  haversineKm,
  minutosDaOrdem,
  quilometrosDaOrdem,
  type OptimizeOptions,
  type OptimizeStop,
} from '@/features/dispatch/routeOptimizer';
import type { TravelTimes } from '@/features/dispatch/travelMatrix';

/** Ponto geográfico já validado (nunca (0,0) nem fora do planeta). */
export type PontoBalanceavel = { latitude: number; longitude: number };

/** Cão como o balanceador enxerga (o mesmo formato que a sugestão já usa). */
export type CaoBalanceavel = {
  dogId: string;
  clientName?: string;
  dogName?: string;
  clientId?: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * A unidade da distribuição é a CASA (irmãos moram no mesmo endereço e NÃO se separam), não o cão.
 * `ponto` nulo = endereço não cadastrado: essas casas não entram no rateio geográfico.
 */
export type CasaBalanceavel<T extends CaoBalanceavel = CaoBalanceavel> = {
  casaId: string;
  caes: T[];
  ponto: PontoBalanceavel | null;
};

export type MotoristaBalanceavel = {
  driverId: string;
  driverName: string;
  /** Posição conhecida do motorista (compartilhamento) — desempata quem fica com cada bloco. */
  latitude?: number | null;
  longitude?: number | null;
};

export type OpcoesDoBalanceamento = {
  /** Matriz de tempos REAIS (Google, via servidor). Ausente = linha reta na velocidade média. */
  travel?: TravelTimes | null;
  /** Base que o servidor usou na matriz: só ela pode responder a 1ª perna com trânsito real. */
  matrizBase?: PontoBalanceavel | null;
  /** De onde as rotas saem (pick-up: a van; entrega: o yard). */
  inicio?: PontoBalanceavel | null;
  /** Onde as rotas terminam (pick-up: o yard; entrega: a van). */
  fim?: PontoBalanceavel | null;
  /** Pontas por motorista (cada um tem a própria van) — vencem `inicio`/`fim`. */
  inicioPorMotorista?: ReadonlyMap<string, PontoBalanceavel | null>;
  fimPorMotorista?: ReadonlyMap<string, PontoBalanceavel | null>;
  /** Cães que o motorista JÁ leva (rota existente, cães presos): contam no TEMPO, não no bloco. */
  fixosPorMotorista?: ReadonlyMap<string, readonly CaoBalanceavel[]>;
  /** Teto de cães por motorista/van. Sem ele, o freio é o tempo (e o peso baixo da contagem). */
  capacidadePorMotorista?: ReadonlyMap<string, number | null | undefined>;
  speedKph?: number;
  serviceMinutes?: number;
  /** Pesos da pontuação: tempo (desequilíbrio, sempre 1) > km > cães. */
  pesoKm?: number;
  pesoCaes?: number;
  maxIteracoes?: number;
  maxAvaliacoes?: number;
  /** Liga a coleta do log "AUTO ROUTE BALANCER" (o chamador decide se e onde imprimir). */
  debug?: boolean;
};

export type BlocoBalanceado<T extends CaoBalanceavel = CaoBalanceavel> = {
  driverId: string;
  driverName: string;
  /** Casas que ESTA sugestão atribui a ele, na ordem da rota. */
  casas: CasaBalanceavel<T>[];
  /** Cães na ordem em que a rota será gravada (irmãos de casa juntos). */
  caes: T[];
  /** Distância da rota inteira em km (com as pontas quando existem). */
  km: number;
  /** Duração estimada da rota inteira em MINUTOS (deslocamento + serviço de cada parada). */
  minutos: number;
  /** Quantos cães ele já levava antes desta sugestão (rota existente / cães presos). */
  caesFixos: number;
};

export type ResultadoDoBalanceamento<T extends CaoBalanceavel = CaoBalanceavel> = {
  blocos: BlocoBalanceado<T>[];
  /** max(duração) − min(duração) da distribuição final, em minutos. */
  desequilibrio: number;
  minutosTotal: number;
  kmTotal: number;
  iteracoes: number;
  avaliacoes: number;
  /** Cães que NÃO entraram em bloco nenhum (sem motorista disponível). Quem chamou decide o destino. */
  semLugar: T[];
  /** Só quando `debug`: linhas no formato pedido pelo dono ("Initial:", "Trying:", "ACCEPTED"). */
  debug: string[];
};

/* ------------------------------------------------------------------ *
 * CONSTANTES (as mesmas contas do cartão do Optimize)
 * ------------------------------------------------------------------ */

const VELOCIDADE_PADRAO_KPH = 25;
const SERVICO_PADRAO_MIN = 8;
const EPS = 1e-6;
/** Distância (km) abaixo da qual duas pontas são "o mesmo lugar" — decide se a matriz vale para a 1ª perna. */
const MESMA_PONTA_KM = 0.05;
const PESO_KM_PADRAO = 0.5;
const PESO_CAES_PADRAO = 1;
const ITERACOES_PADRAO = 60;
const AVALIACOES_PADRAO = 2000;
const LOG_MAX = 160;
const CACHE_MAX = 4000;
/** Minutos "cobrados" por cão acima da capacidade: inviabiliza a distribuição que fura a van. */
const PESO_INFRACAO = 1e6;

type Contexto = {
  options: OptimizeOptions;
  /** Origem da sequência (`null` = a matriz real responde a 1ª perna). */
  origem: PontoBalanceavel | null;
  /** Ponta final (yard no pick-up, van na entrega). */
  destino: PontoBalanceavel | null;
};

/** Contexto exportado só para quem quer medir uma rota com as mesmas contas (ver `medirOrdemDeCasas`). */
export type { Contexto as ContextoDeRota };

/* ------------------------------------------------------------------ *
 * PONTOS E PONTAS
 * ------------------------------------------------------------------ */

/** Coordenada utilizável: número finito, dentro do planeta e fora de "Null Island" (GPS sem fix). */
export function pontoBalanceavel(latitude?: number | null, longitude?: number | null): PontoBalanceavel | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

const kmEntre = (a: PontoBalanceavel, b: PontoBalanceavel): number =>
  haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);

function centroide(pontos: readonly PontoBalanceavel[]): PontoBalanceavel {
  const soma = pontos.reduce(
    (acc, ponto) => ({ latitude: acc.latitude + ponto.latitude, longitude: acc.longitude + ponto.longitude }),
    { latitude: 0, longitude: 0 },
  );
  return { latitude: soma.latitude / pontos.length, longitude: soma.longitude / pontos.length };
}

function velocidadeDe(opcoes: OpcoesDoBalanceamento): number {
  return opcoes.speedKph ?? VELOCIDADE_PADRAO_KPH;
}

/** Contexto de UMA ponta (partida/fim): onde a rota nasce, onde ela termina e o que a matriz pode responder. */
function contextoDePontas(
  partida: PontoBalanceavel | null,
  fim: PontoBalanceavel | null,
  opcoes: OpcoesDoBalanceamento,
): Contexto {
  const travel = opcoes.travel ?? null;
  // A matriz tem UMA base (a van que o servidor recebeu): só ela responde a 1ª perna com trânsito real.
  const matrizNaPartida = Boolean(travel && opcoes.matrizBase && partida
    && kmEntre(partida, opcoes.matrizBase) <= MESMA_PONTA_KM);
  return {
    options: {
      travel,
      speedKph: opcoes.speedKph,
      serviceMinutes: opcoes.serviceMinutes,
      homeLatitude: partida?.latitude ?? null,
      homeLongitude: partida?.longitude ?? null,
      destinationLatitude: fim?.latitude ?? null,
      destinationLongitude: fim?.longitude ?? null,
    },
    // Com a matriz partindo da MESMA ponta, `origem: null` deixa a 1ª perna vir dela; fora disso a 1ª
    // perna sai da linha reta a partir da partida — nunca da base de OUTRO motorista.
    origem: matrizNaPartida ? null : partida,
    destino: fim,
  };
}

/** Contexto de um motorista: as pontas DELE (van própria na partida, yard/van no fim). */
export function contextoDoMotorista(driverId: string, opcoes: OpcoesDoBalanceamento): Contexto {
  const partida = opcoes.inicioPorMotorista?.get(driverId) ?? opcoes.inicio ?? null;
  const fim = opcoes.fimPorMotorista?.get(driverId) ?? opcoes.fim ?? null;
  return contextoDePontas(partida, fim, opcoes);
}

/* ------------------------------------------------------------------ *
 * ROTAS DE UMA CASA (ordem + tempo + distância)
 * ------------------------------------------------------------------ */

/** As paradas do otimizador (sem janela: a sugestão não inventa horário) a partir de cães do dia. */
export function stopsDaRota(caes: readonly CaoBalanceavel[]): OptimizeStop[] {
  return caes.map((cao) => ({
    dogId: cao.dogId,
    clientName: cao.clientName ?? '',
    dogName: cao.dogName ?? cao.dogId,
    latitude: cao.latitude,
    longitude: cao.longitude,
    windowStart: null,
    windowEnd: null,
    exactTime: null,
    priority: 'normal' as const,
  }));
}

function pontoDaParada(parada: OptimizeStop | null | undefined): PontoBalanceavel | null {
  return parada ? pontoBalanceavel(parada.latitude, parada.longitude) : null;
}

/** Serviço de uma parada (o mesmo default de 8 min por cão usado no resto do app). */
function servicoDe(parada: OptimizeStop, opcoes: OpcoesDoBalanceamento): number {
  return parada.serviceMinutes ?? opcoes.serviceMinutes ?? SERVICO_PADRAO_MIN;
}

/**
 * Minutos de uma perna: matriz REAL quando ela cobre o par, senão linha reta na velocidade média.
 * `de` nulo = 1ª perna (aí a matriz só responde se `contexto.origem` for nulo, isto é, se a base da
 * matriz é a própria partida do motorista).
 */
function minutosDaPerna(
  de: OptimizeStop | null,
  para: OptimizeStop,
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): number {
  const matriz = contexto.options.travel;
  if (de) {
    const real = matriz?.between(de.dogId, para.dogId);
    if (typeof real === 'number' && Number.isFinite(real)) return real;
  } else {
    const real = contexto.origem ? null : matriz?.homeTo(para.dogId);
    if (typeof real === 'number' && Number.isFinite(real)) return real;
  }
  const alvo = pontoDaParada(para);
  if (!alvo) return 0;
  const partida = de
    ? pontoDaParada(de)
    : (contexto.origem ?? pontoBalanceavel(contexto.options.homeLatitude, contexto.options.homeLongitude));
  if (!partida) return 0;
  return (kmEntre(partida, alvo) / velocidadeDe(opcoes)) * 60;
}

/** Última perna: da última parada até a ponta final (yard no pick-up, van na entrega). */
function minutosAteDestino(
  ultima: OptimizeStop | null | undefined,
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): number {
  const fim = contexto.destino;
  const ultimo = pontoDaParada(ultima);
  if (!fim || !ultimo) return 0;
  return (kmEntre(ultimo, fim) / velocidadeDe(opcoes)) * 60;
}

/**
 * Agrupa os cães por CASA (irmãos moram no mesmo endereço e não se separam). Sem `clientId`, cada cão é
 * uma casa de um cão só. Casa com cadastro inconsistente (irmãos em pontos diferentes) não entra no
 * rateio geográfico — mesmo critério de sempre: a sugestão não inventa endereço nem parte uma casa.
 */
export function agruparCasas<T extends CaoBalanceavel>(caes: readonly T[]): CasaBalanceavel<T>[] {
  const porCasa = new Map<string, T[]>();
  for (const cao of caes) {
    const chave = cao.clientId ? `c:${cao.clientId}` : `d:${cao.dogId}`;
    porCasa.set(chave, [...(porCasa.get(chave) ?? []), cao]);
  }
  return [...porCasa.entries()].map(([casaId, lista]) => {
    const primeiro = lista[0];
    const ponto = pontoBalanceavel(primeiro.latitude, primeiro.longitude);
    const irmãosNoMesmoPonto = ponto !== null
      && lista.every((cao) => cao.latitude === primeiro.latitude && cao.longitude === primeiro.longitude);
    return { casaId, caes: lista, ponto: irmãosNoMesmoPonto ? ponto : null };
  });
}

/** A parada que representa a casa no trajeto (irmãos compartilham a coordenada). */
type ParadaDeCasa<T extends CaoBalanceavel> = { casa: CasaBalanceavel<T>; parada: OptimizeStop };

const paradaDaCasa = <T extends CaoBalanceavel>(casa: CasaBalanceavel<T>): ParadaDeCasa<T> =>
  ({ casa, parada: stopsDaRota(casa.caes)[0] });

/** Soma manual (sem matriz) dos minutos de uma ordem já definida — devolve número, nunca NaN. */
function minutosNaMao(
  stops: readonly OptimizeStop[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): number {
  let total = 0;
  for (let i = 0; i < stops.length; i += 1) {
    total += minutosDaPerna(i === 0 ? null : stops[i - 1], stops[i], contexto, opcoes)
      + servicoDe(stops[i], opcoes);
  }
  return total + minutosAteDestino(stops[stops.length - 1], contexto, opcoes);
}

/** Soma manual (sem matriz) dos km de uma ordem já definida, com as pontas que tiverem coordenada. */
function kmNaMao(
  stops: readonly OptimizeStop[],
  contexto: Contexto,
): number {
  const inicio = contexto.origem ?? pontoBalanceavel(contexto.options.homeLatitude, contexto.options.homeLongitude);
  let anterior: PontoBalanceavel | null = inicio;
  let total = 0;
  for (const parada of stops) {
    const atual = pontoDaParada(parada);
    if (!atual) continue;
    if (anterior) total += kmEntre(anterior, atual);
    anterior = atual;
  }
  if (anterior && contexto.destino) total += kmEntre(anterior, contexto.destino);
  return total;
}

/**
 * Mede uma ordem de casas JÁ definida: cães expandidos (irmãos juntos) e a conta oficial do app
 * (`minutosDaOrdem`, que inclui a última perna até a ponta final) com queda para a soma manual.
 */
export function medirOrdemDeCasas<T extends CaoBalanceavel>(
  casas: readonly CasaBalanceavel<T>[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): { minutos: number; km: number } {
  const stops = stopsDaRota(casas.flatMap((casa) => casa.caes));
  if (stops.length === 0) return { minutos: 0, km: 0 };
  const ids = stops.map((parada) => parada.dogId);
  const minutos = minutosDaOrdem(stops, ids, contexto.options, contexto.origem);
  const km = quilometrosDaOrdem(stops, ids, contexto.origem, contexto.destino);
  return {
    minutos: minutos === null ? minutosNaMao(stops, contexto, opcoes) : minutos,
    km: km === null ? kmNaMao(stops, contexto) : km,
  };
}

const minutosDeCasas = <T extends CaoBalanceavel>(
  casas: readonly CasaBalanceavel<T>[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): number => medirOrdemDeCasas(casas, contexto, opcoes).minutos;

/**
 * Ordem de um bloco: vizinho mais próximo a partir da partida (casa sem endereço vai para o FIM) e então
 * 2-opt — o mesmo conserto do ganancioso que o cartão do Optimize usa. O objetivo do 2-opt é o TEMPO da
 * rota inteira (com a última perna até o yard/van), então quem fica por último é quem está mais perto de
 * fechar o dia.
 */
function ordenarCasas<T extends CaoBalanceavel>(
  casas: readonly CasaBalanceavel<T>[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
  refinar = true,
): CasaBalanceavel<T>[] {
  const comPonto = casas.filter((casa) => casa.ponto !== null);
  const semPonto = casas.filter((casa) => casa.ponto === null);
  if (comPonto.length > 1) {
    const restantes = comPonto.map(paradaDaCasa);
    const ordem: CasaBalanceavel<T>[] = [];
    let anterior: OptimizeStop | null = null;
    while (restantes.length > 0) {
      let melhor = 0;
      let melhorMinutos = Infinity;
      for (let i = 0; i < restantes.length; i += 1) {
        const minutos = minutosDaPerna(anterior, restantes[i].parada, contexto, opcoes);
        if (minutos < melhorMinutos) {
          melhorMinutos = minutos;
          melhor = i;
        }
      }
      const [escolhida] = restantes.splice(melhor, 1);
      ordem.push(escolhida.casa);
      anterior = escolhida.parada;
    }
    // `refinar = false` é o MEDIDOR BARATO da busca local (vizinho mais próximo, sem 2-opt): a ordem
    // final, que o gestor vê e o Apply grava, sempre passa pelo 2-opt.
    return [...(refinar ? melhorarOrdem2Opt(ordem, contexto, opcoes) : ordem), ...semPonto];
  }
  return [...comPonto, ...semPonto];
}

function melhorarOrdem2Opt<T extends CaoBalanceavel>(
  ordem: readonly CasaBalanceavel<T>[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
  voltasMax = 4,
): CasaBalanceavel<T>[] {
  let melhor = [...ordem];
  let melhorTotal = minutosDeCasas(melhor, contexto, opcoes);
  let melhorou = true;
  let voltas = 0;
  while (melhorou && voltas < voltasMax) {
    melhorou = false;
    voltas += 1;
    for (let i = 0; i < melhor.length - 1; i += 1) {
      for (let j = i + 1; j < melhor.length; j += 1) {
        const tentativa = [...melhor];
        tentativa.splice(i, j - i + 1, ...melhor.slice(i, j + 1).reverse());
        const total = minutosDeCasas(tentativa, contexto, opcoes);
        if (total < melhorTotal - EPS) {
          melhor = tentativa;
          melhorTotal = total;
          melhorou = true;
        }
      }
    }
  }
  return melhor;
}

/**
 * Ordena e mede UMA rota já decidida (quem leva o quê). Serve para a tela do Dispatch reordenar um bloco
 * depois de juntar cães presos/atribuídos e para a entrega medir o bloco com a MESMA conta do balanceador.
 */
export function ordenarEMedirRota<T extends CaoBalanceavel>(
  caes: readonly T[],
  opcoes: OpcoesDoBalanceamento & { motoristaId?: string } = {},
): { caes: T[]; km: number; minutos: number } {
  const contexto = contextoDoMotorista(opcoes.motoristaId ?? '', opcoes);
  const ordenadas = ordenarCasas(agruparCasas(caes), contexto, opcoes);
  const { minutos, km } = medirOrdemDeCasas(ordenadas, contexto, opcoes);
  return { caes: ordenadas.flatMap((casa) => casa.caes), km, minutos };
}

/* ------------------------------------------------------------------ *
 * SEMENTE: o corte contíguo de sempre, agora só limitado pela CAPACIDADE
 * ------------------------------------------------------------------ */

/** Trilha por vizinho mais próximo (a ordem geográfica que os blocos contíguos seguem). */
function trilhaGeografica<T extends CaoBalanceavel>(
  casas: readonly CasaBalanceavel<T>[],
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
): CasaBalanceavel<T>[] {
  const restantes = casas.map(paradaDaCasa);
  const trilha: CasaBalanceavel<T>[] = [];
  let anterior: OptimizeStop | null = null;
  while (restantes.length > 0) {
    let melhor = 0;
    let melhorMinutos = Infinity;
    for (let i = 0; i < restantes.length; i += 1) {
      const minutos = minutosDaPerna(anterior, restantes[i].parada, contexto, opcoes);
      if (minutos < melhorMinutos) {
        melhorMinutos = minutos;
        melhor = i;
      }
    }
    const [escolhida] = restantes.splice(melhor, 1);
    trilha.push(escolhida.casa);
    anterior = escolhida.parada;
  }
  return trilha;
}

/**
 * Corta a trilha em `pedacos` blocos CONTÍGUOS minimizando a soma do deslocamento (programação dinâmica
 * O(n²·K); n é a dezena de casas do dia). Com `limiteCaes`, nenhum bloco pode passar do teto — é o único
 * freio de CONTAGEM que sobrou: o equilíbrio de trabalho passou a ser por tempo (busca local abaixo).
 * Devolve `null` quando não existe corte que caiba no teto (quem chamou decide o que fazer).
 */
function cortarTrilha<T extends CaoBalanceavel>(
  trilha: readonly CasaBalanceavel<T>[],
  pedacos: number,
  contexto: Contexto,
  opcoes: OpcoesDoBalanceamento,
  limiteCaes?: number,
): CasaBalanceavel<T>[][] | null {
  const n = trilha.length;
  if (n === 0) return [];
  if (pedacos <= 1) return limiteCaes !== undefined && n > 0 && trilha.reduce((s, c) => s + c.caes.length, 0) > limiteCaes
    ? null : [[...trilha]];
  if (pedacos > n) return trilha.map((casa) => [casa]);
  const paradas = trilha.map(paradaDaCasa);
  // prefixo[t] = minutos de trilha[0] até trilha[t] seguindo a trilha.
  const prefixo = [0];
  for (let t = 1; t < n; t += 1) {
    prefixo.push(prefixo[t - 1] + minutosDaPerna(paradas[t - 1].parada, paradas[t].parada, contexto, opcoes));
  }
  const prefCaes = [0];
  for (let t = 0; t < n; t += 1) prefCaes.push(prefCaes[t] + trilha[t].caes.length);
  const caesEntre = (i: number, j: number) => prefCaes[j + 1] - prefCaes[i];
  const cabe = (i: number, j: number) => limiteCaes === undefined || caesEntre(i, j) <= limiteCaes;
  /**
   * Custo de um bloco = o TEMPO que aquele motorista gasta: 1ª perna desde a partida + pernas internas +
   * o SERVIÇO de cada cão (o mesmo default de 8 min por parada que a rota medida usa). Antes esta conta
   * era só distância — e sem o serviço o corte contíguo "achava" que 23 cães num bloco custavam o mesmo
   * que 1 (só a 1ª perna), o que jogava a semente em 1/1/1/23.
   */
  const servico = (opcoes.serviceMinutes ?? SERVICO_PADRAO_MIN);
  const custo = (i: number, j: number) => (prefixo[j] - prefixo[i])
    + minutosDaPerna(null, paradas[i].parada, contexto, opcoes)
    + servico * caesEntre(i, j);

  const dp: number[][] = Array.from({ length: pedacos + 1 }, () => new Array(n).fill(Infinity));
  const corte: number[][] = Array.from({ length: pedacos + 1 }, () => new Array(n).fill(-1));
  for (let j = 0; j < n; j += 1) dp[1][j] = cabe(0, j) ? custo(0, j) : Infinity;
  for (let k = 2; k <= pedacos; k += 1) {
    for (let j = k - 1; j < n; j += 1) {
      for (let i = k - 1; i <= j; i += 1) {
        if (!cabe(i, j)) continue;
        // MIN-MAX (e não soma): o que se quer é o bloco mais longo o menor possível — é o mesmo objetivo
        // do balanceamento (`max − min` entre os motoristas).
        const valor = Math.max(dp[k - 1][i - 1], custo(i, j));
        if (valor < dp[k][j]) {
          dp[k][j] = valor;
          corte[k][j] = i;
        }
      }
    }
  }
  if (!Number.isFinite(dp[pedacos][n - 1])) return null;
  if (limiteCaes !== undefined && caesEntre(0, n - 1) > limiteCaes * pedacos) return null;

  const blocos: CasaBalanceavel<T>[][] = [];
  let fim = n - 1;
  for (let k = pedacos; k >= 1; k -= 1) {
    const ini = k === 1 ? 0 : corte[k][fim];
    blocos.unshift(trilha.slice(ini, fim + 1));
    fim = ini - 1;
  }
  return blocos;
}

/** Último recurso (corte contíguo impossível): reparte por casa inteira, sempre para o bloco mais leve. */
function repartirGuloso<T extends CaoBalanceavel>(
  casas: readonly CasaBalanceavel<T>[],
  pedacos: number,
): CasaBalanceavel<T>[][] {
  const blocos: CasaBalanceavel<T>[][] = Array.from({ length: pedacos }, () => []);
  const cargas = new Array(pedacos).fill(0);
  for (const casa of casas) {
    let alvo = 0;
    for (let i = 1; i < pedacos; i += 1) if (cargas[i] < cargas[alvo]) alvo = i;
    blocos[alvo].push(casa);
    cargas[alvo] += casa.caes.length;
  }
  return blocos;
}

/* ------------------------------------------------------------------ *
 * BALANCEAMENTO — o ponto de entrada
 * ------------------------------------------------------------------ */

type AvaliacaoDeRota = {
  /** Casas livres atribuídas, na ordem da ROTA (as casas fixas do motorista ficam fora daqui). */
  casasLivres: CasaBalanceavel<CaoBalanceavel>[];
  caesLivres: CaoBalanceavel[];
  minutos: number;
  km: number;
};

type BlocoDeTrabalho = { motorista: MotoristaBalanceavel; casas: CasaBalanceavel<CaoBalanceavel>[] };

type Nota = { score: number; desequilibrio: number };

/** Descrição legível de uma casa para o log de DEBUG ("Dog 123" / "3 dogs of house Jose"). */
function descreverCasa(casa: CasaBalanceavel<CaoBalanceavel>): string {
  if (casa.caes.length === 1) return `Dog ${casa.caes[0].dogName ?? casa.caes[0].dogId}`;
  return `${casa.caes.length} dogs of house ${casa.caes[0].clientName ?? casa.casaId}`;
}

/**
 * BALANCEIA a distribuição das casas entre os motoristas pelo TEMPO ESTIMADO DA ROTA.
 *
 * Entram: as casas ainda livres (com endereço) + os motoristas disponíveis + as pontas. Saem: um bloco
 * por motorista, com a ordem já otimizada, os minutos e os km. O motorista recebe o TEMPO (com a
 * geografia como peso médio e a contagem de cães como peso baixo) — nunca um rateio aritmético de cães.
 */
export function balancearRotas<T extends CaoBalanceavel>(
  caesLivres: readonly T[],
  motoristas: readonly MotoristaBalanceavel[],
  opcoes: OpcoesDoBalanceamento = {},
): ResultadoDoBalanceamento<T> {
  const log: string[] = [];
  const anotar = (linha: string): void => {
    if (opcoes.debug && log.length < LOG_MAX) log.push(linha);
  };
  const pesoKm = opcoes.pesoKm ?? PESO_KM_PADRAO;
  const pesoCaes = opcoes.pesoCaes ?? PESO_CAES_PADRAO;
  const maxIteracoes = Math.max(1, opcoes.maxIteracoes ?? ITERACOES_PADRAO);
  const maxAvaliacoes = Math.max(1, opcoes.maxAvaliacoes ?? AVALIACOES_PADRAO);
  const cache = new Map<string, AvaliacaoDeRota>();
  let avaliacoes = 0;

  const porId = new Map<string, T>(caesLivres.map((cao) => [cao.dogId, cao]));
  const fixosDe = (driverId: string): CaoBalanceavel[] => [...(opcoes.fixosPorMotorista?.get(driverId) ?? [])];
  const capacidadeDe = (driverId: string): number | null => {
    const valor = opcoes.capacidadePorMotorista?.get(driverId);
    return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : null;
  };

  /**
   * Rota de UM motorista com um conjunto de casas livres: mede a rota INTEIRA (cães que ele já leva + as
   * casas novas) e devolve só as casas novas, na ordem em que serão gravadas. O resultado fica em cache
   * por (motorista + conjunto de casas): a busca local pede a MESMA rota dezenas de vezes, e é isso que
   * mantém as avaliações (e as chamadas de API — aqui, zero) sob controle.
   */
  const avaliar = (
    driverId: string,
    casasLivresDoBloco: readonly CasaBalanceavel<CaoBalanceavel>[],
    refinar = false,
  ): AvaliacaoDeRota => {
    const chave = `${refinar ? 'r' : 'f'}|${driverId}|${casasLivresDoBloco.map((casa) => casa.casaId).sort().join(',')}`;
    const guardada = cache.get(chave);
    if (guardada) return guardada;
    const contexto = contextoDoMotorista(driverId, opcoes);
    const livresId = new Set(casasLivresDoBloco.flatMap((casa) => casa.caes.map((cao) => cao.dogId)));
    const ordenadas = ordenarCasas(
      agruparCasas([...fixosDe(driverId), ...casasLivresDoBloco.flatMap((casa) => casa.caes)]),
      contexto,
      opcoes,
      refinar,
    );
    const { minutos, km } = medirOrdemDeCasas(ordenadas, contexto, opcoes);
    const casasLivres = ordenadas
      .map((casa) => ({
        casaId: casa.casaId,
        ponto: casa.ponto,
        caes: casa.caes.filter((cao) => livresId.has(cao.dogId)),
      }))
      .filter((casa) => casa.caes.length > 0);
    const resultado: AvaliacaoDeRota = {
      casasLivres,
      caesLivres: casasLivres.flatMap((casa) => casa.caes),
      minutos,
      km,
    };
    avaliacoes += 1;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(chave, resultado);
    return resultado;
  };

  /** Cães que o motorista leva: a rota que já existe (fixos) mais o que esta proposta dá a ele. */
  const caesDoMotorista = (driverId: string, casas: readonly CasaBalanceavel<CaoBalanceavel>[]): number =>
    fixosDe(driverId).length + casas.reduce((soma, casa) => soma + casa.caes.length, 0);

  /**
   * PONTUAÇÃO de uma distribuição — a função que a busca local tenta baixar:
   *   score = desequilíbrio (max−min, em MINUTOS) + pesoKm·kmTotal + pesoCaes·desvioDeCães
   * O tempo tem peso 1 sobre a DIFERENÇA entre rotas, então ele domina: qualquer ganho de minutos vale
   * mais que qualquer ajuste de km ou de contagem. Furar a capacidade soma uma penalidade que inviabiliza.
   */
  const pontuar = (blocosAtuais: readonly BlocoDeTrabalho[], avsAtuais: readonly AvaliacaoDeRota[]): Nota => {
    const tempos: number[] = [];
    const kms: number[] = [];
    const caes: number[] = [];
    let infracao = 0;
    blocosAtuais.forEach((bloco, i) => {
      const quantidade = caesDoMotorista(bloco.motorista.driverId, bloco.casas);
      tempos.push(avsAtuais[i].minutos);
      kms.push(avsAtuais[i].km);
      caes.push(quantidade);
      const capacidade = capacidadeDe(bloco.motorista.driverId);
      if (capacidade !== null && quantidade > capacidade) infracao += quantidade - capacidade;
    });
    if (tempos.length === 0) return { score: 0, desequilibrio: 0 };
    const maximo = Math.max(...tempos);
    const minimo = Math.min(...tempos);
    const alvo = caes.reduce((soma, n) => soma + n, 0) / caes.length;
    const desvioCaes = caes.reduce((soma, n) => soma + Math.abs(n - alvo), 0);
    const kmTotal = kms.reduce((soma, km) => soma + km, 0);
    return {
      score: (maximo - minimo) + pesoKm * kmTotal + pesoCaes * desvioCaes + PESO_INFRACAO * infracao,
      desequilibrio: maximo - minimo,
    };
  };

  /* ---------------- 1. SEMENTE geográfica (contígua, só com teto de capacidade) ---------------- */

  const casas: CasaBalanceavel<CaoBalanceavel>[] = agruparCasas(caesLivres)
    .map((casa) => ({ casaId: casa.casaId, ponto: casa.ponto, caes: casa.caes as CaoBalanceavel[] }));
  const comPonto = casas.filter((casa) => casa.ponto !== null);
  const semPonto = casas.filter((casa) => casa.ponto === null);
  if (motoristas.length === 0) {
    return {
      blocos: [], desequilibrio: 0, minutosTotal: 0, kmTotal: 0, iteracoes: 0,
      avaliacoes: 0, semLugar: [...caesLivres], debug: log,
    };
  }

  const inicioGlobal = opcoes.inicio
    ?? (comPonto.length > 0 ? centroide(comPonto.map((casa) => casa.ponto as PontoBalanceavel)) : null);
  const contextoGlobal = contextoDePontas(inicioGlobal, opcoes.fim ?? null, opcoes);
  const trilha = trilhaGeografica(comPonto, contextoGlobal, opcoes);

  const pedacos = Math.min(motoristas.length, trilha.length);
  const capacidades = motoristas
    .map((motorista) => capacidadeDe(motorista.driverId))
    .filter((valor): valor is number => valor !== null);
  const tetoSemente = capacidades.length === motoristas.length ? Math.max(...capacidades) : undefined;
  const chunks = pedacos <= 0
    ? []
    : cortarTrilha(trilha, pedacos, contextoGlobal, opcoes, tetoSemente)
      ?? cortarTrilha(trilha, pedacos, contextoGlobal, opcoes)
      ?? repartirGuloso(trilha, pedacos);

  // Motorista de cada bloco: o que MENOS cães já leva (rota existente) e, empatado, o mais perto da
  // primeira casa do bloco (partida dele = van; sem van conhecida, a posição compartilhada). Sem nada
  // disso, vale a ordem da lista do Dispatch — a mesma que o gestor vê na tela.
  const usados = new Set<string>();
  let blocos: BlocoDeTrabalho[] = chunks.map((chunk) => {
    const primeira = chunk[0].ponto;
    let escolhido = 0;
    let melhorCarga = Infinity;
    let melhorKm = Infinity;
    motoristas.forEach((motorista, indice) => {
      if (usados.has(motorista.driverId)) return;
      const carga = fixosDe(motorista.driverId).length;
      const partida = opcoes.inicioPorMotorista?.get(motorista.driverId)
        ?? pontoBalanceavel(motorista.latitude, motorista.longitude)
        ?? opcoes.inicio ?? null;
      const km = primeira && partida ? kmEntre(partida, primeira) : 0;
      if (carga < melhorCarga || (carga === melhorCarga && km < melhorKm - EPS)) {
        melhorCarga = carga;
        melhorKm = km;
        escolhido = indice;
      }
    });
    usados.add(motoristas[escolhido].driverId);
    return { motorista: motoristas[escolhido], casas: chunk };
  });

  /* ---------------- 2. BUSCA LOCAL (mover e trocar casas até nada melhorar) ---------------- */

  let avs = blocos.map((bloco) => avaliar(bloco.motorista.driverId, bloco.casas));
  let nota = pontuar(blocos, avs);

  const ordemPorTempo = (avsAtuais: readonly AvaliacaoDeRota[], crescente: boolean): number[] =>
    avsAtuais.map((_, i) => i).sort((a, b) => (crescente ? 1 : -1) * (avsAtuais[b].minutos - avsAtuais[a].minutos));

  const descreverResultado = (
    rotulo: string,
    blocosAtuais: readonly BlocoDeTrabalho[],
    avsAtuais: readonly AvaliacaoDeRota[],
  ): void => {
    anotar(rotulo);
    blocosAtuais.forEach((bloco, i) => {
      anotar(`Driver ${bloco.motorista.driverName}: ${caesDoMotorista(bloco.motorista.driverId, bloco.casas)} dogs / ${Math.round(avsAtuais[i].minutos)} min`);
    });
  };

  /** Motorista sem bloco na semente continua candidato (o buscador pode dar cães a ele). */
  const comBloco = new Set(blocos.map((bloco) => bloco.motorista.driverId));
  for (const motorista of motoristas) {
    if (!comBloco.has(motorista.driverId)) blocos.push({ motorista, casas: [] });
  }
  avs = blocos.map((bloco) => avaliar(bloco.motorista.driverId, bloco.casas));
  nota = pontuar(blocos, avs);
  anotar('AUTO ROUTE BALANCER');
  descreverResultado('Initial:', blocos, avs);

  type Lance = {
    blocos: BlocoDeTrabalho[];
    avs: AvaliacaoDeRota[];
    nota: Nota;
    antes: Nota;
    descricao: string[];
  };

  /**
   * MELHOR MOVIMENTO: uma casa sai da rota mais longa e entra em outra (sempre por CASA INTEIRA — irmãos
   * não se separam). Só avalia as DUAS rotas afetadas e nunca fura a capacidade. Devolve o movimento que
   * mais baixa a pontuação, ou `null` quando nenhum movimento melhora.
   */
  const buscarMovimento = (
    blocosAtuais: readonly BlocoDeTrabalho[],
    avsAtuais: readonly AvaliacaoDeRota[],
    notaAtual: Nota,
  ): Lance | null => {
    let melhor: Lance | null = null;
    for (const i of ordemPorTempo(avsAtuais, false)) {
      const casasDaOrigem = blocosAtuais[i].casas;
      if (casasDaOrigem.length === 0) continue;
      for (let h = 0; h < casasDaOrigem.length; h += 1) {
        for (const j of ordemPorTempo(avsAtuais, true)) {
          if (i === j) continue;
          if (avaliacoes >= maxAvaliacoes) return melhor;
          const capacidade = capacidadeDe(blocosAtuais[j].motorista.driverId);
          if (capacidade !== null
            && caesDoMotorista(blocosAtuais[j].motorista.driverId, blocosAtuais[j].casas) + casasDaOrigem[h].caes.length > capacidade) {
            continue;
          }
          const casaMovida = casasDaOrigem[h];
          const avOrigem = avaliar(blocosAtuais[i].motorista.driverId, casasDaOrigem.filter((_, k) => k !== h));
          const avDestino = avaliar(blocosAtuais[j].motorista.driverId, [...blocosAtuais[j].casas, casaMovida]);
          const avsTentativa = [...avsAtuais];
          avsTentativa[i] = avOrigem;
          avsTentativa[j] = avDestino;
          const notaTentativa = pontuar(blocosAtuais, avsTentativa);
          if (notaTentativa.score < notaAtual.score - EPS
            && (!melhor || notaTentativa.score < melhor.nota.score - EPS)) {
            melhor = {
              blocos: blocosAtuais.map((bloco, k) => (k === i
                ? { ...bloco, casas: bloco.casas.filter((_, m) => m !== h) }
                : k === j ? { ...bloco, casas: [...bloco.casas, casaMovida] } : bloco)),
              avs: avsTentativa,
              nota: notaTentativa,
              antes: notaAtual,
              descricao: [
                'Trying:',
                `Move ${descreverCasa(casaMovida)}`,
                `${blocosAtuais[i].motorista.driverName} → ${blocosAtuais[j].motorista.driverName}`,
              ],
            };
          }
        }
      }
    }
    return melhor;
  };

  /**
   * MELHOR TROCA: casa X do motorista A ↔ casa Y do motorista B. Existe porque há ajustes que nenhum
   * movimento simples alcança (trocar dois cães de lugar sem mudar a contagem de nenhum dos dois) — a
   * troca só entra quando melhora a pontuação GLOBAL, então melhorar dois motoristas nunca piora
   * grosseiramente a rota de um terceiro.
   */
  const buscarTroca = (
    blocosAtuais: readonly BlocoDeTrabalho[],
    avsAtuais: readonly AvaliacaoDeRota[],
    notaAtual: Nota,
  ): Lance | null => {
    let melhor: Lance | null = null;
    const ordem = ordemPorTempo(avsAtuais, true);
    for (let a = 0; a < ordem.length; a += 1) {
      const i = ordem[a];
      if (blocosAtuais[i].casas.length === 0) continue;
      for (let b = a + 1; b < ordem.length; b += 1) {
        const j = ordem[b];
        if (blocosAtuais[j].casas.length === 0) continue;
        const idI = blocosAtuais[i].motorista.driverId;
        const idJ = blocosAtuais[j].motorista.driverId;
        const capacidadeI = capacidadeDe(idI);
        const capacidadeJ = capacidadeDe(idJ);
        const cargaBaseI = caesDoMotorista(idI, blocosAtuais[i].casas);
        const cargaBaseJ = caesDoMotorista(idJ, blocosAtuais[j].casas);
        for (let hi = 0; hi < blocosAtuais[i].casas.length; hi += 1) {
          for (let hj = 0; hj < blocosAtuais[j].casas.length; hj += 1) {
            if (avaliacoes >= maxAvaliacoes) return melhor;
            const casaA = blocosAtuais[i].casas[hi];
            const casaB = blocosAtuais[j].casas[hj];
            const cargaI = cargaBaseI - casaA.caes.length + casaB.caes.length;
            const cargaJ = cargaBaseJ - casaB.caes.length + casaA.caes.length;
            if (capacidadeI !== null && cargaI > capacidadeI) continue;
            if (capacidadeJ !== null && cargaJ > capacidadeJ) continue;
            const avI = avaliar(idI, [...blocosAtuais[i].casas.filter((_, m) => m !== hi), casaB]);
            const avJ = avaliar(idJ, [...blocosAtuais[j].casas.filter((_, m) => m !== hj), casaA]);
            const avsTentativa = [...avsAtuais];
            avsTentativa[i] = avI;
            avsTentativa[j] = avJ;
            const notaTentativa = pontuar(blocosAtuais, avsTentativa);
            if (notaTentativa.score < notaAtual.score - EPS
              && (!melhor || notaTentativa.score < melhor.nota.score - EPS)) {
              melhor = {
                blocos: blocosAtuais.map((bloco, k) => (k === i
                  ? { ...bloco, casas: [...bloco.casas.filter((_, m) => m !== hi), casaB] }
                  : k === j ? { ...bloco, casas: [...bloco.casas.filter((_, m) => m !== hj), casaA] } : bloco)),
                avs: avsTentativa,
                nota: notaTentativa,
                antes: notaAtual,
                descricao: [
                  'Trying:',
                  `Swap ${descreverCasa(casaA)} with ${descreverCasa(casaB)}`,
                  `${blocosAtuais[i].motorista.driverName} ↔ ${blocosAtuais[j].motorista.driverName}`,
                ],
              };
            }
          }
        }
      }
    }
    return melhor;
  };

  let iteracoes = 0;
  for (let passo = 0; passo < maxIteracoes && avaliacoes < maxAvaliacoes; passo += 1) {
    iteracoes = passo + 1;
    const lance = buscarMovimento(blocos, avs, nota) ?? buscarTroca(blocos, avs, nota);
    if (!lance) break;
    const anteriores = nota;
    blocos = lance.blocos;
    avs = lance.avs;
    nota = lance.nota;
    if (opcoes.debug && log.length < LOG_MAX - blocos.length - 6) {
      log.push(...lance.descricao);
      descreverResultado('Result:', blocos, avs);
      anotar(`Previous imbalance: ${Math.round(anteriores.desequilibrio)} min`);
      anotar(`New imbalance: ${Math.round(nota.desequilibrio)} min`);
      anotar('ACCEPTED');
    }
  }

  /* ---------------- 3. CAPACIDADE é TRAVA; casa sem endereço vai para a rota mais leve ----------------
   * A capacidade da van NUNCA é estourada para melhorar o tempo: o que não cabe sai do bloco e volta para
   * `semLugar` (o gestor decide), nunca fica em cima do motorista. Casa sem endereço cadastrado não entra
   * na conta geográfica — vai para a rota mais leve QUE AINDA CAIBA, no fim dela. */

  blocos = blocos.map((bloco) => {
    const capacidade = capacidadeDe(bloco.motorista.driverId);
    if (capacidade === null) return bloco;
    let quantidade = fixosDe(bloco.motorista.driverId).length
      + bloco.casas.reduce((soma, casa) => soma + casa.caes.length, 0);
    if (quantidade <= capacidade) return bloco;
    const casas = [...bloco.casas];
    while (casas.length > 0 && quantidade > capacidade) {
      const removida = casas.pop() as CasaBalanceavel<CaoBalanceavel>;
      quantidade -= removida.caes.length;
    }
    return { ...bloco, casas };
  });
  avs = blocos.map((bloco) => avaliar(bloco.motorista.driverId, bloco.casas));

  const cargas = blocos.map((bloco, i) => fixosDe(bloco.motorista.driverId).length + avs[i].caesLivres.length);
  for (const casa of semPonto) {
    let alvo = -1;
    let menorCarga = Infinity;
    blocos.forEach((bloco, i) => {
      const capacidade = capacidadeDe(bloco.motorista.driverId);
      if (capacidade !== null && cargas[i] + casa.caes.length > capacidade) return;
      if (cargas[i] < menorCarga) {
        menorCarga = cargas[i];
        alvo = i;
      }
    });
    if (alvo < 0) continue;   // sem vaga nesta van: o cão fica para o gestor (entra em `semLugar`)
    blocos = blocos.map((bloco, k) => (k === alvo ? { ...bloco, casas: [...bloco.casas, casa] } : bloco));
    cargas[alvo] += casa.caes.length;
  }
  /**
   * MEDIDA FINAL: aqui — e só aqui — cada bloco passa pelo refinamento completo (2-opt olhando a última
   * perna). A busca usou o medidor barato; o número que a folha mostra e o Apply grava é este.
   */
  const avsFinais = blocos.map((bloco) => avaliar(bloco.motorista.driverId, bloco.casas, true));
  const notaFinal = pontuar(blocos, avsFinais);

  const blocosFinais: BlocoBalanceado<T>[] = blocos
    .map((bloco, i) => ({
      driverId: bloco.motorista.driverId,
      driverName: bloco.motorista.driverName,
      casas: avsFinais[i].casasLivres as CasaBalanceavel<T>[],
      caes: avsFinais[i].caesLivres
        .map((cao) => porId.get(cao.dogId))
        .filter((cao): cao is T => cao !== undefined),
      km: avsFinais[i].km,
      minutos: avsFinais[i].minutos,
      caesFixos: fixosDe(bloco.motorista.driverId).length,
    }))
    .filter((bloco) => bloco.casas.length > 0);

  const dentro = new Set(blocosFinais.flatMap((bloco) => bloco.caes.map((cao) => cao.dogId)));
  return {
    blocos: blocosFinais,
    desequilibrio: notaFinal.desequilibrio,
    minutosTotal: blocosFinais.reduce((soma, bloco) => soma + bloco.minutos, 0),
    kmTotal: blocosFinais.reduce((soma, bloco) => soma + bloco.km, 0),
    iteracoes,
    avaliacoes,
    /** Cães que não entraram em bloco nenhum (sem motorista ou sem vaga na van): quem chamou decide. */
    semLugar: caesLivres.filter((cao) => !dentro.has(cao.dogId)),
    debug: log,
  };
}
