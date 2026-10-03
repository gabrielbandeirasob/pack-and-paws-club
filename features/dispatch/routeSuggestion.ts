/** Pure route proposals: balance dog counts first, then group by proximity.
 * Housemates stay together. Each phase has its own candidates and assignments.
 */
import { haversineKm } from '@/features/dispatch/routeOptimizer';
import { transportPoolForPhase, type DaySummary } from '@/features/calendar/dayMath';
import type { Perna } from '@/features/dispatch/orderPins';

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
  /** Distância da perna, em km (só o que a sugestão consegue medir). */
  km: number;
};

export type SugestaoDeRotas = {
  blocos: BlocoSugerido[];
  /** Cães sem coordenada no cadastro: a sugestão NÃO chuta lugar para eles. */
  semLugar: CaoParaSugerir[];
  kmTotal: number;
};

type Ponto = { latitude: number; longitude: number };

/** Coordenada utilizável (número finito dentro das faixas do planeta). `(0,0)` é "sem cadastro". */
export function pontoUtilizavel(latitude: unknown, longitude: unknown): Ponto | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

const pontoDoCao = (cao: CaoParaSugerir) => pontoUtilizavel(cao.latitude, cao.longitude);
const pontoDoMotorista = (motorista: MotoristaParaSugerir) => pontoUtilizavel(motorista.latitude, motorista.longitude);

const kmEntre = (a: Ponto, b: Ponto) => haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);

function centroide(pontos: Ponto[]): Ponto {
  const soma = pontos.reduce((acc, p) => ({ latitude: acc.latitude + p.latitude, longitude: acc.longitude + p.longitude }),
    { latitude: 0, longitude: 0 });
  return { latitude: soma.latitude / pontos.length, longitude: soma.longitude / pontos.length };
}

/** Trilha por vizinho mais próximo, partindo de `inicio`: devolve ÍNDICES de `pontos`, em ordem. */
function trilhaVizinhoMaisProximo(pontos: Ponto[], inicio: Ponto): number[] {
  const restantes = pontos.map((_, i) => i);
  const trilha: number[] = [];
  let atual = inicio;
  while (restantes.length > 0) {
    let melhor = 0;
    let melhorKm = Infinity;
    for (let pos = 0; pos < restantes.length; pos += 1) {
      const km = kmEntre(atual, pontos[restantes[pos]]);
      if (km < melhorKm) {
        melhorKm = km;
        melhor = pos;
      }
    }
    const indice = restantes.splice(melhor, 1)[0];
    trilha.push(indice);
    atual = pontos[indice];
  }
  return trilha;
}

/**
 * Corta a trilha em `pedacos` blocos CONTÍGUOS minimizando a distância total.
 * Custo de um bloco = (início → 1º cão, quando há início) + as pernas internas do bloco.
 * Programação dinâmica O(n²·K): n é o número de cães do dia (dezenas), não há motivo para esperteza.
 *
 * EQUILÍBRIO (pedido do dono, 01/10/2026: *"quero que vc dê uma balanceada senão vai ficar muito pesado
 * para algum driver"*): com `pesos` (cães por casa, ao longo da trilha) e `limite`, o corte NÃO pode
 * deixar um bloco passar de `limite` cães — o menor desvio continua sendo o objetivo, mas dentro do
 * rateio. O mínimo também é obrigatório; sem corte viável, busca outra combinação de casas.
 */
function dividirEmBlocos(
  trilha: number[],
  pontos: Ponto[],
  pedacos: number,
  inicio: Ponto | null,
  pesos?: number[],
  limite?: number,
  minimo = 0,
): number[][] | null {
  const n = trilha.length;
  // prefixo[t] = distância de trilha[0] até trilha[t] seguindo a trilha.
  const prefixo = [0];
  for (let t = 1; t < n; t += 1) prefixo.push(prefixo[t - 1] + kmEntre(pontos[trilha[t - 1]], pontos[trilha[t]]));
  const custo = (i: number, j: number) => (prefixo[j] - prefixo[i]) + (inicio ? kmEntre(inicio, pontos[trilha[i]]) : 0);
  // prefixo de CÃES: quantos cães existem da posição i até j (inclusive).
  const prefC = [0];
  for (let t = 0; t < n; t += 1) prefC.push(prefC[t] + (pesos?.[t] ?? 1));
  const caesEntre = (i: number, j: number) => prefC[j + 1] - prefC[i];
  const cabe = (i: number, j: number) => limite === undefined || (caesEntre(i, j) <= limite && caesEntre(i, j) >= minimo);

  const dp: number[][] = Array.from({ length: pedacos + 1 }, () => new Array(n).fill(Infinity));
  const corte: number[][] = Array.from({ length: pedacos + 1 }, () => new Array(n).fill(-1));
  // Um pedaço só também respeita o teto (senão a conta de equilíbrio furava por aqui: o caso de 4 cães
  // com 2 motoristas virava 3 + 1 em vez de 2 + 2).
  for (let j = 0; j < n; j += 1) dp[1][j] = cabe(0, j) ? custo(0, j) : Infinity;
  for (let k = 2; k <= pedacos; k += 1) {
    for (let j = k - 1; j < n; j += 1) {
      for (let i = k - 1; i <= j; i += 1) {
        if (!cabe(i, j)) continue;
        const valor = dp[k - 1][i - 1] + custo(i, j);
        if (valor < dp[k][j]) {
          dp[k][j] = valor;
          corte[k][j] = i;
        }
      }
    }
  }
  // Com limite pode não existir corte (dado torto). Nada de corte inválido: quem chamou decide.
  if (limite !== undefined) {
    if (!Number.isFinite(dp[pedacos][n - 1])) return null;
    if (caesEntre(0, n - 1) > limite * pedacos) return null;
  }

  const blocos: number[][] = [];
  let fim = n - 1;
  for (let k = pedacos; k >= 1; k -= 1) {
    const ini = k === 1 ? 0 : corte[k][fim];
    blocos.unshift(trilha.slice(ini, fim + 1));
    fim = ini - 1;
  }
  return blocos;
}

/** Exact count feasibility with indivisible households; symmetric states are memoized.
 * Larger households first prune impossible allocations early. Geographic order breaks ties.
 * When no floor/ceil partition exists, use least-loaded allocation, preserving households.
 */
function distribuirCasas(trilha: number[], pesos: number[], quantidade: number): number[][] {
  const total = pesos.reduce((sum, n) => sum + n, 0);
  const targets = Array.from({ length: quantidade }, (_, i) =>
    Math.floor(total / quantidade) + (i < total % quantidade ? 1 : 0));
  const ordem = [...trilha].sort((a, b) => pesos[b] - pesos[a]);
  const blocos: number[][] = targets.map(() => []);
  const cargas = targets.map(() => 0);
  const falhas = new Set<string>();
  function alocar(pos: number): boolean {
    if (pos === ordem.length) return true;
    const key = `${pos}:${targets.map((t, i) => t - cargas[i]).sort((a, b) => a - b).join(',')}`;
    if (falhas.has(key)) return false;
    const vistos = new Set<number>();
    const casa = ordem[pos];
    for (let i = 0; i < quantidade; i += 1) {
      const livre = targets[i] - cargas[i];
      if (vistos.has(livre) || pesos[casa] > livre) continue;
      vistos.add(livre);
      cargas[i] += pesos[casa];
      blocos[i].push(casa);
      if (alocar(pos + 1)) return true;
      blocos[i].pop();
      cargas[i] -= pesos[casa];
    }
    falhas.add(key);
    return false;
  }
  if (!alocar(0)) {
    for (const casa of ordem) {
      const i = cargas.indexOf(Math.min(...cargas));
      blocos[i].push(casa);
      cargas[i] += pesos[casa];
    }
  }
  const posicao = new Map(trilha.map((casa, i) => [casa, i]));
  return blocos.filter(b => b.length).map(b => b.sort((a, c) => posicao.get(a)! - posicao.get(c)!));
}

/**
 * Sugere a distribuição e a ordem. `inicio` = a van/sede de onde a rota sai (opcional: sem sede
 * cadastrada, cada motorista começa no primeiro cão do próprio bloco).
 */
export function sugerirRotas(
  caes: CaoParaSugerir[],
  motoristas: MotoristaParaSugerir[],
  inicio: Ponto | null = null,
): SugestaoDeRotas {
  // A unidade da distribuição é a CASA, não o cão. Sem clientId, cada cão é independente.
  const casas = new Map<string, CaoParaSugerir[]>();
  for (const cao of new Map(caes.map(c => [c.dogId, c])).values()) {
    const chave = cao.clientId ? `c:${cao.clientId}` : `d:${cao.dogId}`;
    casas.set(chave, [...(casas.get(chave) ?? []), cao]);
  }
  const comPonto: { caes: CaoParaSugerir[]; ponto: Ponto }[] = [];
  const semLugar: CaoParaSugerir[] = [];
  for (const casa of casas.values()) {
    const ponto = pontoDoCao(casa[0]);
    // Cadastro inconsistente: não separar nem inventar posição para parte da casa.
    if (ponto && casa.every(c => c.latitude === ponto.latitude && c.longitude === ponto.longitude)) {
      comPonto.push({ caes: casa, ponto });
    } else semLugar.push(...casa);
  }

  const pedacos = Math.min(motoristas.length, comPonto.length);
  if (pedacos === 0) {
    return { blocos: [], semLugar: [...semLugar, ...comPonto.flatMap((item) => item.caes)], kmTotal: 0 };
  }

  const pontos = comPonto.map((item) => item.ponto);
  const trilha = trilhaVizinhoMaisProximo(pontos, inicio ?? centroide(pontos));

  const pesos = trilha.map(indice => comPonto[indice].caes.length);
  const total = pesos.reduce((sum, weight) => sum + weight, 0);
  const minimo = Math.floor(total / pedacos);
  const limite = Math.ceil(total / pedacos);
  // First prefer geographic contiguous blocks with fair counts. If house sizes prevent that
  // cut, search non-contiguous allocations before declaring exact balance impossible.
  const blocos = dividirEmBlocos(trilha, pontos, pedacos, inicio, pesos, limite, minimo)
    ?? distribuirCasas(trilha, comPonto.map(item => item.caes.length), pedacos);

  // Motorista de cada bloco: o mais perto do primeiro cão do bloco. Se nenhum motorista tem posição
  // conhecida, vale a ordem da lista (a mesma que o gestor vê na tela do Dispatch).
  const algumMotoristaComPosicao = motoristas.some((motorista) => pontoDoMotorista(motorista) !== null);
  const restantes = [...motoristas];
  const resultado: BlocoSugerido[] = [];
  let kmTotal = 0;

  for (const bloco of blocos) {
    const primeiro = pontos[bloco[0]];
    let escolhido = restantes[0];
    if (algumMotoristaComPosicao && restantes.length > 1) {
      let melhorKm = Infinity;
      for (const motorista of restantes) {
        const ponto = pontoDoMotorista(motorista);
        const km = ponto ? kmEntre(ponto, primeiro) : Infinity;
        if (km < melhorKm) {
          melhorKm = km;
          escolhido = motorista;
        }
      }
    }
    restantes.splice(restantes.indexOf(escolhido), 1);

    let km = 0;
    for (let t = 1; t < bloco.length; t += 1) km += kmEntre(pontos[bloco[t - 1]], pontos[bloco[t]]);
    if (inicio) km += kmEntre(inicio, pontos[bloco[0]]);
    kmTotal += km;
    resultado.push({
      driverId: escolhido.driverId,
      driverName: escolhido.driverName,
      caes: bloco.flatMap((indice) => comPonto[indice].caes),
      km,
    });
  }

  return { blocos: resultado, semLugar, kmTotal };
}

/** Model contract for the next Dispatch slice: assignments are local to one phase. */
export type AtribuicaoPorFase = { phase: Perna; dogIds: readonly string[] };
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
): SugestoesDoDia {
  function sugerir(phase: Perna): SugestaoPorFase {
    const atribuidos = new Set(atribuicoes.filter(a => a.phase === phase).flatMap(a => [...a.dogIds]));
    const candidatos = caes.filter(c => !atribuidos.has(c.dogId) && (phase === 'pickup'
      ? c.pickupRequired && !c.inVan
      : c.dropoffRequired && !c.boarding));
    return { phase, ...sugerirRotas(candidatos, motoristas, inicios[phase] ?? null) };
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
  })), motoristas, atribuicoes, inicios);
}
