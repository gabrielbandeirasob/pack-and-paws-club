/**
 * DIA DA OPERAÇÃO — regras PURAS dos 5 indicadores, do pack (caminhada) e do fechamento do dia.
 *
 * Pedido da operação, ditado em áudio (26/09/2026):
 *   * "os indicadores diários, na dashboard vão ter 5 quadradinhos: um vai ser o Daycare, o outro
 *      Boarding, depois o Total Pack (…) depois o quarto (…) Total de cães (…) e uma quinta vai ser
 *      Faturamento, esse faturamento vai ser editável (…)";
 *   * "o Total Pack vai ser um botão clicável: você clica, ele puxa todos os cachorros que estão no
 *      calendário (…) e o administrador vai ter como clicar num X para deletar aquele cachorro no
 *      dia — porque o pack na verdade é a quantidade de cães e quais cães vão para a CAMINHADA, que
 *      vão para o yard".
 *
 * DECISÕES (o dono autorizou a melhor solução; ficam registradas aqui):
 *  - "Total de cães" = TODOS os cães do dia (daycare + boarding), sem repetir o mesmo cão duas vezes;
 *  - "Total Pack" = os cães do dia que VÃO À CAMINHADA: o padrão é todos, e o X tira o cão do pack
 *    daquele dia (nunca apaga reserva, evento ou rota);
 *  - DINHEIRO em centavos inteiros (nunca float); `null` = o gestor ainda não digitou, que é
 *    diferente de zero.
 *
 * Aqui só entra cálculo: nada de banco, nada de tela.
 */

export type DayDog = {
  dogId: string;
  dogName: string;
  clientName: string;
  serviceType: 'daycare' | 'boarding';
  /**
   * O cão passa pelo daycare hoje (entra no Total Pack). Omitido = `true`. Falso só na **chegada fora
   * do horário** (Cocoa no pick-up), quando ele não vai ao daycare — contrato do cliente, 28/09/2026.
   */
  goesToDaycare?: boolean;
};

/** Linha de `pack_entries`: só existe quando o escritório mexeu naquele cão naquele dia. */
export type PackEntry = {
  dogId: string;
  inPack: boolean;
  /** Membro da organização que CAMINHA com o cão (pode ser diferente de quem pega na rota). */
  walkerId: string | null;
};

export type DayIndicators = {
  daycare: number;
  boarding: number;
  /** Todos os cães do dia (um por cão, mesmo que ele apareça em daycare e boarding). */
  totalDogs: number;
  /** Cães que vão para a caminhada hoje (Total Pack). */
  pack: number;
  /** Faturamento digitado no fechamento do dia, em centavos. `null` = não digitado. */
  revenueCents: number | null;
};

/** Um cão do dia com o que o pack/gestor decidiu. */
export type PackRow = DayDog & {
  inPack: boolean;
  walkerId: string | null;
};

/**
 * Todos os cães do dia sem repetir (o mesmo cão pode estar em boarding E daycare no mesmo dia) —
 * quando isso acontece vale o serviço mais forte (boarding).
 */
export function dogsOfDay(daycare: DayDog[], boarding: DayDog[]): DayDog[] {
  const porCao = new Map<string, DayDog>();
  for (const cao of [...daycare, ...boarding]) {
    const atual = porCao.get(cao.dogId);
    if (!atual) {
      porCao.set(cao.dogId, cao);
      continue;
    }
    // Vale o serviço mais forte (boarding) — mas o "vai pro daycare" é do DIA: só sai do pack se
    // TODAS as linhas do cão naquele dia disserem que ele não passa pelo daycare.
    const escolhido = atual.serviceType === 'daycare' && cao.serviceType === 'boarding' ? cao : atual;
    porCao.set(cao.dogId, { ...escolhido, goesToDaycare: (atual.goesToDaycare ?? true) || (cao.goesToDaycare ?? true) });
  }
  return [...porCao.values()].sort((a, b) => a.dogName.localeCompare(b.dogName));
}

/** O dia inteiro com o pack: quem entra na caminhada, quem foi tirado e quem caminha com quem. */
export function packRows(dogs: DayDog[], entries: PackEntry[]): PackRow[] {
  const porCao = new Map(entries.map((entrada) => [entrada.dogId, entrada]));
  return dogs.map((cao) => {
    const entrada = porCao.get(cao.dogId);
    // Padrão = o cão VAI PRO DAYCARE hoje (contrato do cliente, 28/09/2026): o X do gestor continua
    // mandando, e a chegada fora do horário (Cocoa no pick-up) entra fora do pack por padrão.
    const padrao = cao.goesToDaycare ?? true;
    return { ...cao, inPack: entrada?.inPack ?? padrao, walkerId: entrada?.walkerId ?? null };
  });
}

/** Os 5 números do dia a partir das listas do calendário (daycare e boarding podem repetir o cão). */
export function dayIndicators(
  daycare: DayDog[],
  boarding: DayDog[],
  entries: PackEntry[],
  revenueCents: number | null,
): DayIndicators {
  return dayIndicatorsFrom({
    daycareCount: daycare.length,
    boardingCount: boarding.length,
    dogs: dogsOfDay(daycare, boarding),
    entries,
    revenueCents,
  });
}

/**
 * Mesma conta, mas recebendo os números do calendário já contados (a Home conta daycare/boarding do
 * `buildDay`, que é a fonte que o calendário usa) e a lista de cães SEM repetir (para o pack).
 */
export function dayIndicatorsFrom(input: {
  daycareCount: number;
  boardingCount: number;
  dogs: DayDog[];
  entries: PackEntry[];
  revenueCents: number | null;
}): DayIndicators {
  const noPack = packRows(input.dogs, input.entries).filter((linha) => linha.inPack).length;
  return {
    daycare: input.daycareCount,
    boarding: input.boardingCount,
    totalDogs: input.dogs.length,
    pack: noPack,
    revenueCents: input.revenueCents,
  };
}

/** Cães da caminhada de um membro (a tela do motorista mostra a lista de caminhada dele). */
export function dogsWalkingWith(rows: PackRow[], walkerId: string): PackRow[] {
  return rows.filter((linha) => linha.inPack && linha.walkerId === walkerId);
}

/* --------------------------------- dinheiro --------------------------------- */

/**
 * Texto digitado pelo gestor -> centavos. Aceita "$1,234.56", "1.234,56", "1234", "1234.5".
 *
 * Regra: o ÚLTIMO separador (`.` ou `,`) que tiver 1 ou 2 dígitos depois é o decimal; os outros são
 * milhar e saem. Texto sem número nenhum devolve `null` (é o mesmo `null` de "não digitado").
 */
export function parseMoneyToCents(texto: string | null | undefined): number | null {
  const bruto = (texto ?? '').replace(/[^\d.,]/g, '').trim();
  if (!bruto) return null;
  const ultimoPonto = bruto.lastIndexOf('.');
  const ultimaVirgula = bruto.lastIndexOf(',');
  const decimalEm = Math.max(ultimoPonto, ultimaVirgula);
  let inteiro = bruto;
  let decimal = '';
  if (decimalEm >= 0) {
    const depois = bruto.slice(decimalEm + 1);
    if (depois.length > 0 && depois.length <= 2) {
      inteiro = bruto.slice(0, decimalEm);
      decimal = depois;
    }
  }
  const digitos = inteiro.replace(/[^\d]/g, '');
  if (!digitos && !decimal) return null;
  const centavos = Number(`${digitos || '0'}.${decimal || '0'}`);
  if (!Number.isFinite(centavos)) return null;
  return Math.round(centavos * 100);
}

/** Centavos -> texto do campo (`123456` -> `"1,234.56"`); `null` -> string vazia. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  const negativo = cents < 0;
  const absoluto = Math.abs(Math.round(cents));
  const reais = Math.floor(absoluto / 100);
  const resto = String(absoluto % 100).padStart(2, '0');
  const comMilhar = reais.toLocaleString('en-US');
  return `${negativo ? '-' : ''}${comMilhar}.${resto}`;
}

/* --------------------------------- to-do list --------------------------------- */

export type DailyTodo = { id: string; text: string; done: boolean; position: number };

/** Ordem da lista: por `position` e, no empate, pelo texto (determinístico em teste). */
export function sortTodos(todos: DailyTodo[]): DailyTodo[] {
  return [...todos].sort((a, b) => a.position - b.position || a.text.localeCompare(b.text));
}

/** Quantos itens ainda estão abertos — é o número da bolinha do menu. */
export function pendingTodos(todos: DailyTodo[]): number {
  return todos.filter((item) => !item.done).length;
}

/** Próxima posição ao adicionar no fim da lista. */
export function nextTodoPosition(todos: DailyTodo[]): number {
  return todos.reduce((maior, item) => Math.max(maior, item.position), -1) + 1;
}

/** Limite do texto de um item (mesmo limite do banco: 200). */
export const TODO_TEXTO_MAX = 200;
export const PLANO_TEXTO_MAX = 500;

/** Texto limpo para gravar; vazio vira `null` (não grava linha com espaço em branco). */
export function limparTexto(valor: string | null | undefined, max = PLANO_TEXTO_MAX): string | null {
  const texto = (valor ?? '').replace(/\s+/g, ' ').trim();
  if (!texto) return null;
  return texto.slice(0, max);
}
