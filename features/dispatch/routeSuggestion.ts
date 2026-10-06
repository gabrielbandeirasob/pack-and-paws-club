/**
 * PROPOSTAS DE ROTA — a conta é PURA (nenhuma tela, nenhuma rede).
 *
 * A distribuição deixou de ser um rateio de CÃES (pedido do dono, 06/10/2026: *"não quero dividir os
 * cachorros igualmente; quero dividir o TRABALHO da forma mais equilibrada possível"*). Quem decide agora
 * é o TEMPO ESTIMADO DA ROTA INTEIRA — com as pontas fixas (pick-up: VAN → cães → YARD; entrega:
 * YARD → cães → VAN) — medido por `routeBalancer.ts`, com a geografia como peso médio e a contagem de
 * cães como peso baixo. A quantidade de cães pode (e deve) sair diferente entre motoristas quando isso
 * deixar as rotas mais PRÓXIMAS EM TEMPO: 6+4+5 com tempos 52/55/50 é melhor do que 5+5+5 com 35/75/48.
 *
 * Housemates stay together (a unidade é a CASA). Cada perna tem seus próprios candidatos e atribuições.
 *
 * TRAVA DO DONO (03/10/2026), só na perna de ENTREGA: *"não faz sentido eu colocar o pick-up de um
 * cachorro com um motorista e depois o drop-off com outro"* — o cão desce com quem o buscou, sem
 * exceção. A sugestão de drop-off prende cada cão ao motorista do pick-up dele; os cães que só têm
 * drop-off (chegaram sozinhos, boarding voltando) continuam livres e entram no MESMO balanceamento por
 * tempo (com as pontas do yard e da van).
 */
import { agruparCasas, balancearRotas, ordenarEMedirRota, pontoBalanceavel, stopsDaRota,
  type CaoBalanceavel, type OpcoesDoBalanceamento, type PontoBalanceavel } from '@/features/dispatch/routeBalancer';
import { transportPoolForPhase, type DaySummary } from '@/features/calendar/dayMath';
import type { Perna } from '@/features/dispatch/orderPins';

/** Opções da sugestão: as do balanceador + a ponta final de cada perna (pick-up: yard; entrega: van). */
export type OpcoesDaSugestao = OpcoesDoBalanceamento & {
  fimPorFase?: Partial<Record<Perna, PontoBalanceavel | null>>;
};

export type CaoParaSugerir = {
  dogId: string;
  clientName: string;
  /** Identidade da casa; nome e coordenada não identificam um cliente. */
  clientId?: string | null;
  dogName: string;
  latitude: number | null;
  longitude: number | null;
};

export type MotoristaParaSugerir = {
  driverId: string;
  driverName: string;
  /** Posição atual do motorista (compartilhamento), quando o app tem. */
  latitude?: number | null;
  longitude?: number | null;
};

export type BlocoSugerido = {
  driverId: string;
  driverName: string;
  /** Cães do bloco NA ORDEM sugerida (é a ordem que a aplicação grava). */
  caes: CaoParaSugerir[];
  /** Distância da rota inteira, em km (com as pontas — van e yard — quando elas existem). */
  km: number;
  /**
   * Duração estimada da ROTA INTEIRA em minutos (deslocamento + serviço de cada parada), já contando a
   * saída da van/yard e a última perna até o yard/van. É o número que o balanceamento usa.
   */
  minutos?: number;
};

export type SugestaoDeRotas = {
  blocos: BlocoSugerido[];
  /** Cães sem coordenada no cadastro: a sugestão NÃO chuta lugar para eles. */
  semLugar: CaoParaSugerir[];
  kmTotal: number;
  /** Linhas do log "AUTO ROUTE BALANCER" (só quando as opções pedem `debug`). */
  debug?: string[];
};

type Ponto = { latitude: number; longitude: number };

/** Rotas do dia no formato mínimo que a regra precisa (a perna de pick-up é a fonte do motorista). */
export type RotaParaRegra = {
  driverId: string;
  phase?: Perna | null;
  stops: readonly { dogId: string }[];
};

/**
 * Motorista do pick-up de cada cão do dia — a FONTE da regra "o cão desce com quem o buscou".
 * Rota sem `phase` é pick-up (é o valor da DEFAULT da migração 202610020053).
 */
export function motoristaDoPickupPorCao(rotas: readonly RotaParaRegra[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const rota of rotas) {
    if ((rota.phase ?? 'pickup') !== 'pickup') continue;
    for (const stop of rota.stops) mapa.set(stop.dogId, rota.driverId);
  }
  return mapa;
}

/** Coordenada utilizável (número finito dentro das faixas do planeta). `(0,0)` é "sem cadastro". */
export function pontoUtilizavel(latitude: unknown, longitude: unknown): Ponto | null {
  // A conta é a do balanceador (uma fonte só para "endereço utilizável").
  return pontoBalanceavel(latitude as number, longitude as number);
}

/*
 * O CORTE DA TRILHA e o RATEIO "casa por casa" que moravam aqui SAÍRAM (06/10/2026) — junto com a trilha
 * por vizinho mais próximo, o `centroide` e o `kmEntre` que só existiam para servi-los. Os dois eram a
 * regra de EQUILÍBRIO POR QUANTIDADE de cães (teto `total ÷ motoristas`, mínimo obrigatório). Quem corta a
 * trilha, ordena, mede e distribui agora é `routeBalancer.ts`, com o TEMPO da rota como critério e a
 * capacidade como único teto de contagem. `pontoUtilizavel` fica: é usado pelos testes e por quem monta a
 * lista de cães.
 */

/**
 * SUGERE a distribuição e a ordem pelo TEMPO da rota (a conta mora em `routeBalancer.ts`).
 *
 * `inicio` = a van/sede de onde a saída acontece (opcional: sem sede cadastrada, cada motorista começa no
 * primeiro cão do próprio bloco). `opcoes` leva as pontas (van e yard), a matriz de tempos REAIS já
 * buscada UMA vez pelo chamador, a capacidade de cada van, os cães que cada motorista JÁ leva (rota do
 * dia / cães presos) e o pedido do log de DEBUG.
 */
export function sugerirRotas(
  caes: CaoParaSugerir[],
  motoristas: MotoristaParaSugerir[],
  inicio: Ponto | null = null,
  opcoes: OpcoesDoBalanceamento = {},
): SugestaoDeRotas {
  // A unidade da distribuição é a CASA, não o cão. Sem clientId, cada cão é uma casa de um cão só; casa
  // com cadastro torto (irmãos em pontos diferentes) não entra no rateio — vai para `semLugar`.
  const unicos = [...new Map(caes.map((cao) => [cao.dogId, cao])).values()];
  const casas = agruparCasas(unicos);
  const semLugar: CaoParaSugerir[] = casas.filter((casa) => casa.ponto === null).flatMap((casa) => casa.caes);
  const comPonto = casas.filter((casa) => casa.ponto !== null);

  const pedacos = Math.min(motoristas.length, comPonto.length);
  if (pedacos === 0) {
    return { blocos: [], semLugar: [...semLugar, ...comPonto.flatMap((casa) => casa.caes)], kmTotal: 0 };
  }

  /**
   * A distribuição das casas entre os motoristas — agora por TEMPO de rota (com as pontas), não por
   * contagem de cães. É UMA chamada pura: a matriz de tempos reais, quando o chamador já a buscou, entra
   * por `opcoes.travel` e é reaproveitada em todas as avaliações da busca local — nenhuma chamada de rede
   * acontece aqui dentro.
   */
  const balanceado = balancearRotas(comPonto.flatMap((casa) => casa.caes), motoristas, {
    ...opcoes,
    inicio: opcoes.inicio ?? inicio,
  });
  const blocos: BlocoSugerido[] = balanceado.blocos.map((bloco) => ({
    driverId: bloco.driverId,
    driverName: bloco.driverName,
    caes: bloco.caes,
    km: bloco.km,
    minutos: bloco.minutos,
  }));
  return {
    blocos,
    semLugar: [...semLugar, ...balanceado.semLugar],
    kmTotal: blocos.reduce((soma, bloco) => soma + bloco.km, 0),
    ...(balanceado.debug.length > 0 ? { debug: balanceado.debug } : {}),
  };
}

/** Model contract for the next Dispatch slice: assignments are local to one phase. */
export type AtribuicaoPorFase = { phase: Perna; dogIds: readonly string[] };

/*
 * O desempate por "cães no carro / proximidade do que ele já leva" e a ordenação por vizinho mais próximo
 * que moravam aqui SAÍRAM (06/10/2026): a ordem e a medida de cada bloco agora vêm de `routeBalancer.ts`
 * (`ordenarEMedirRota`), com a mesma conta de tempo do resto da sugestão e com a ponta final da perna.
 */

/**
 * ENTREGA COM MOTORISTA PRESO — trava do dono (03/10/2026): *"não faz sentido eu colocar o pick-up de
 * um cachorro com um motorista e depois o drop-off com outro"*. O cão que tem motorista no pick-up do
 * dia é entregue por ELE; sem exceção.
 *
 * 1. cada cão preso vai para o bloco do seu motorista; se esse motorista não está disponível (folga,
 *    rota travada), o cão NÃO é oferecido a outro: cai em `semLugar` e o gestor resolve o pick-up dele;
 * 2. irmão de casa sem motorista próprio acompanha o irmão preso — a casa não se reparte;
 * 3. cães sem motorista no pick-up entram no MESMO balanceamento por TEMPO da busca (yard → cães → van),
 *    com os cães presos contando na carga de quem já os leva; casa sem endereço continua indo para o
 *    carro mais leve (sem ponto não há tempo a medir);
 * 4. a ordem e a medida de cada bloco saem de `ordenarEMedirRota` — vizinho mais próximo saindo do yard,
 *    2-opt olhando a última perna, cão sem coordenada no fim.
 */
export function sugerirEntregas(
  caes: CaoParaSugerir[],
  motoristas: MotoristaParaSugerir[],
  inicio: Ponto | null = null,
  motoristaDoCao: ReadonlyMap<string, string> = new Map(),
  opcoes: OpcoesDoBalanceamento = {},
): SugestaoDeRotas {
  const semLugar: CaoParaSugerir[] = [];
  const blocos: BlocoSugerido[] = motoristas.map((motorista) => ({
    driverId: motorista.driverId, driverName: motorista.driverName, caes: [], km: 0,
  }));
  const blocoDe = (driverId: string) => blocos.find((bloco) => bloco.driverId === driverId);

  // 1. Quem tem motorista no pick-up fica com ele. Motorista indisponível na perna: o cão vai para
  //    revisão e NÃO entra no rateio dos livres (é o ponto da trava: ninguém mais entrega).
  const presos = new Map<string, string>();
  for (const cao of caes) {
    const dono = motoristaDoCao.get(cao.dogId);
    if (!dono) continue;
    presos.set(cao.dogId, dono);
    if (!blocoDe(dono)) semLugar.push(cao);
  }
  // 2. Irmão de casa sem motorista próprio acompanha o irmão preso.
  const casaPresa = new Map<string, string>();
  for (const cao of caes) if (cao.clientId && presos.has(cao.dogId)) casaPresa.set(cao.clientId, presos.get(cao.dogId)!);
  for (const cao of caes) {
    if (presos.has(cao.dogId) || !cao.clientId) continue;
    const dono = casaPresa.get(cao.clientId);
    if (!dono) continue;
    presos.set(cao.dogId, dono);
    if (!blocoDe(dono)) semLugar.push(cao);
  }

  for (const cao of caes) {
    const dono = presos.get(cao.dogId);
    if (!dono) continue;
    const bloco = blocoDe(dono);
    if (!bloco) continue;                       // dono fora da perna: já está em `semLugar`
    bloco.caes.push(cao);
  }

  // 3. Cães sem motorista no pick-up: o MESMO balanceamento por TEMPO (YARD → cães → VAN), com os cães
  //    presos contando na carga de quem já os leva — o rateio por número de cães saiu de cena. Casa sem
  //    endereço cadastrado fica fora da conta geográfica e vai para o carro mais leve (sem ponto, não há
  //    tempo a medir).
  const fixosPorMotorista = new Map(motoristas.map((motorista) => [
    motorista.driverId, [...(blocoDe(motorista.driverId)?.caes ?? [])],
  ]));
  const casasLivres = agruparCasas(caes.filter((cao) => !presos.has(cao.dogId)));
  const comPonto = casasLivres.filter((casa) => casa.ponto !== null);
  const semPonto = casasLivres.filter((casa) => casa.ponto === null).flatMap((casa) => casa.caes);
  const balanceado = comPonto.length > 0
    ? balancearRotas(comPonto.flatMap((casa) => casa.caes), motoristas, {
      ...opcoes, inicio: opcoes.inicio ?? inicio, fixosPorMotorista,
    })
    : null;
  for (const bloco of balanceado?.blocos ?? []) blocoDe(bloco.driverId)?.caes.push(...bloco.caes);
  semLugar.push(...(balanceado?.semLugar ?? []));
  for (const cao of semPonto) {
    const destino = [...blocos].sort((a, b) => a.caes.length - b.caes.length)[0];
    destino.caes.push(cao);
  }

  // 4. Ordem e medida de cada bloco — a MESMA conta de tempo do balanceador, com a ponta final da entrega.
  const comCao = blocos.filter((bloco) => bloco.caes.length > 0).map((bloco) => {
    const ordem = ordenarEMedirRota(bloco.caes, {
      ...opcoes, inicio: opcoes.inicio ?? inicio, motoristaId: bloco.driverId,
    });
    return { ...bloco, caes: ordem.caes, km: ordem.km, minutos: ordem.minutos };
  });
  return {
    blocos: comCao,
    semLugar,
    kmTotal: comCao.reduce((soma, bloco) => soma + bloco.km, 0),
    ...(balanceado && balanceado.debug.length > 0 ? { debug: balanceado.debug } : {}),
  };
}

export type CaoDoDiaParaSugerir = CaoParaSugerir & {
  pickupRequired: boolean;
  dropoffRequired: boolean;
  boarding?: boolean;
  inVan?: boolean;
};
export type SugestaoPorFase = SugestaoDeRotas & { phase: Perna };
export type SugestoesDoDia = Record<Perna, SugestaoPorFase>;

export function sugerirRotasPorFase(
  caes: CaoDoDiaParaSugerir[],
  motoristas: MotoristaParaSugerir[],
  atribuicoes: readonly AtribuicaoPorFase[] = [],
  inicios: Partial<Record<Perna, Ponto | null>> = {},
  /** cão -> motorista do pick-up do dia: a trava da entrega (dono, 03/10/2026). */
  motoristaDoCao: ReadonlyMap<string, string> = new Map(),
  /** Pontas (van/yard), matriz de tempos reais, capacidade e DEBUG — ver `routeBalancer.ts`. */
  opcoes: OpcoesDaSugestao = {},
): SugestoesDoDia {
  function sugerir(phase: Perna): SugestaoPorFase {
    const atribuidos = new Set(atribuicoes.filter(a => a.phase === phase).flatMap(a => [...a.dogIds]));
    const candidatos = caes.filter(c => !atribuidos.has(c.dogId) && (phase === 'pickup'
      ? c.pickupRequired && !c.inVan
      : c.dropoffRequired && !c.boarding));
    const daPerna: OpcoesDoBalanceamento = {
      ...opcoes, inicio: inicios[phase] ?? null, fim: opcoes.fimPorFase?.[phase] ?? null,
    };
    // A entrega nunca oferece o cão a outro motorista: quem buscou, entrega.
    if (phase === 'dropoff')
      return { phase, ...sugerirEntregas(candidatos, motoristas, inicios.dropoff ?? null, motoristaDoCao, daPerna) };
    return { phase, ...sugerirRotas(candidatos, motoristas, inicios[phase] ?? null, daPerna) };
  }
  return { pickup: sugerir('pickup'), dropoff: sugerir('dropoff') };
}

/** Adapter for the calendar data consumed by Dispatch, without any screen/network dependency. */
export function sugerirRotasDoDia(
  day: DaySummary,
  coordenadas: ReadonlyMap<string, { latitude: number | null; longitude: number | null }>,
  motoristas: MotoristaParaSugerir[],
  atribuicoes: readonly AtribuicaoPorFase[] = [],
  inicios: Partial<Record<Perna, Ponto | null>> = {},
  /** cão -> motorista do pick-up do dia: a trava da entrega (dono, 03/10/2026). */
  motoristaDoCao: ReadonlyMap<string, string> = new Map(),
  opcoes: OpcoesDaSugestao = {},
): SugestoesDoDia {
  const pickup = new Set(transportPoolForPhase(day, 'pickup').map(c => c.dogId));
  const dropoff = new Set(transportPoolForPhase(day, 'dropoff').map(c => c.dogId));
  const boarding = new Set(day.boarding.map(c => c.dogId));
  const caes = [...new Map([...day.daycare, ...day.boarding].map(c => [c.dogId, c])).values()];
  return sugerirRotasPorFase(caes.map(c => ({
    dogId: c.dogId, dogName: c.dogName, clientName: c.clientName, clientId: c.clientId,
    latitude: coordenadas.get(c.dogId)?.latitude ?? null,
    longitude: coordenadas.get(c.dogId)?.longitude ?? null,
    pickupRequired: pickup.has(c.dogId), dropoffRequired: dropoff.has(c.dogId),
    boarding: boarding.has(c.dogId),
  })), motoristas, atribuicoes, inicios, motoristaDoCao, opcoes);
}
