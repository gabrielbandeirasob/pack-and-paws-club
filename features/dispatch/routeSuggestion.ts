/**
 * SUGESTÃO DE ROTA — o app propõe QUEM leva QUAIS cães e em QUE ORDEM, e o gestor confirma.
 *
 * Pedido do cliente em áudio (01/10/2026, encaminhado pelo dono): *"sugestão de rota automática ali
 * mano… leva um tempinho aí de clicar e mandar pro driver certo"* — hoje a distribuição é 100% manual
 * (cão por cão no Dispatch) e pesa mais quando o próprio gestor vai fazer a rota.
 *
 * Decisões do dono (mesmo dia, perguntas de múltipla escolha):
 *  1. a sugestão cobre as DUAS coisas: a distribuição entre os motoristas e a ordem dentro de cada rota;
 *  2. a base é GEOGRAFIA — juntar os cães por proximidade para o menor desvio total;
 *  3. ela só PROPÕE: o gestor confirma num toque antes de qualquer escrita.
 *
 * Como decide (heurística explicável, sem dependência nova):
 *  a) monta UMA trilha passando por todos os cães, sempre pelo vizinho mais próximo (partindo da van,
 *     quando ela existe — é de lá que a rota sai de manhã);
 *  b) corta a trilha em K pedaços CONTÍGUOS minimizando a distância total (programação dinâmica) — é o
 *     clássico "dividir um tour gigante": pedaços contíguos são justamente os que ficam grudados no
 *     mapa, e é isso que evita um motorista atravessar a cidade para pegar um cão;
 *  c) entrega cada pedaço ao motorista mais próximo do primeiro cão do pedaço (posição atual dele, se
 *     o app tem; senão, na ordem em que os motoristas aparecem no Dispatch).
 *
 * ⚠️ Quem identifica um cão é o **índice dele na lista** — NUNCA a coordenada: dois cães da mesma casa
 * (mesmo cliente) têm exatamente o mesmo endereço e a mesma coordenada, e trocar cães entre motoristas
 * por causa disso seria um defeito silencioso.
 *
 * Módulo puro: nada de rede, nada de UI — a tela só mostra o que sai daqui e aplica depois do ok.
 */
import { haversineKm } from '@/features/dispatch/routeOptimizer';

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
 * rateio. Sem corte possível com o limite, devolve null e quem chamou decide (o corte sem limite).
 */
function dividirEmBlocos(
  trilha: number[],
  pontos: Ponto[],
  pedacos: number,
  inicio: Ponto | null,
  pesos?: number[],
  limite?: number,
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
  const cabe = (i: number, j: number) => limite === undefined || caesEntre(i, j) <= limite;

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

  /*
   * EQUILÍBRIO DO PESO (pedido do dono, 01/10/2026: *"está funcionando porém quero que vc dê uma
   * balanceada senão vai ficar muito pesado para algum driver"*).
   *
   * A geografia continua mandando, mas com TETO de cães por motorista: o teto nasce do rateio justo
   * (total ÷ número de motoristas, arredondado para cima) e nunca fica menor que a maior casa — se
   * ficasse, não existiria corte com os irmãos juntos, e separar irmãos é pior do que desequilibrar.
   * Com 7 cães e 2 motoristas, por exemplo, sai 4 + 3 (antes podia sair 6 + 1).
   */
  const caesPorCasa = comPonto.map((item) => item.caes.length);
  const totalCaes = caesPorCasa.reduce((soma, n) => soma + n, 0);
  const maiorCasa = caesPorCasa.reduce((maior, n) => Math.max(maior, n), 1);
  const limite = Math.max(Math.ceil(totalCaes / pedacos), maiorCasa);
  const equilibrados = dividirEmBlocos(trilha, pontos, pedacos, inicio, caesPorCasa, limite);
  // Rede de segurança: sem corte que caiba no teto, vale o corte por geografia pura (nunca ficar sem
  // sugestão por causa da conta de equilíbrio).
  const blocos = equilibrados ?? dividirEmBlocos(trilha, pontos, pedacos, inicio) ?? [trilha];

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
