/**
 * A COR do evento do Google é quem diz o SERVIÇO (regra do dono, 24/09/2026).
 *
 * Antes o serviço vinha do título ("Daycare · Bella", "Boarding - Bella") e o título livre assumia
 * daycare. O dono inverteu: o escritório escreve no título **só o nome do cão** e marca o serviço
 * pintando o evento — verde para boarding, azul para daycare, vermelho para cancelar o dia.
 *
 * DOIS ESQUEMAS DE COR (bug 56, 25/09/2026) — o Google trocou o esquema em junho/2026:
 *
 * 1. **Paleta antiga** (`colorId`, ids fixos 1..11). O mapa é por ID, nunca pelo nome da cor: é
 *    determinístico, testável e não muda com o idioma da interface.
 *
 *      1 Lavender   2 Sage (verde)     3 Grape      4 Flamingo   5 Banana    6 Tangerine
 *      7 Peacock (azul)                8 Graphite   9 Blueberry (azul)      10 Basil (verde)
 *      11 Tomato (vermelho)
 *
 * 2. **Etiquetas** (`labelProperties.eventLabels`, paleta NOVA de 24 cores + até 200 personalizadas
 *    por calendário). O evento passa a ter `eventLabelId` e a cor vem do **hex** da etiqueta, então a
 *    classificação é por **TOM (matiz)**: verde = boarding, azul = daycare, vermelho = cancelar. É o
 *    caso do "Cobalto" (#4A86E8) que o escritório pintou e o app não reconhecia (o evento chegava sem
 *    `colorId` porque a chamada não levava `eventLabelVersion=1` — ver `calendarApi`).
 *
 * A ETIQUETA MANDA quando o evento tem uma (`eventLabelId`): um evento pintado na paleta nova não
 * traz `colorId` nenhum. O mapa antigo continua valendo como **fallback** (evento sem etiqueta, ou
 * etiqueta que não está na lista do calendário — lá o `colorId` legado ainda diz o serviço).
 *
 * O que NÃO é mapeado (lavanda, uva, flamingo, banana, tangerina, grafite, e qualquer tom novo fora
 * de verde/azul/vermelho) e o evento SEM cor não viram serviço nenhum: o app não chuta — o evento
 * entra na lista "color not recognized" do cartão, que agora **mostra o que foi lido** (nome da
 * etiqueta + hex + `colorId` legado) para o escritório pintar e o suporte não adivinhar.
 */

export type BookingServiceType = 'daycare' | 'boarding';

/** O que a cor do evento significa. `null` (sem cor / cor não mapeada) = não se importa. */
export type ColorMeaning = { kind: 'service'; serviceType: BookingServiceType } | { kind: 'cancel' };

/** Ids da paleta do Google que o app reconhece. Verde = boarding, azul = daycare, vermelho = cancelar. */
export const GOOGLE_COLOR_IDS = {
  boarding: ['2', '10'],
  daycare: ['7', '9'],
  cancel: ['11'],
} as const;

/**
 * Cor com que o ESPELHO pinta o evento de cada serviço (app → Google).
 * Um id só por serviço, o mais legível na tela do calendário: Sage (verde) e Peacock (azul).
 * É também o **fallback** quando o calendário não tem etiqueta do serviço (ou não deu para lê-las).
 */
export const COLOR_OF_SERVICE: Record<BookingServiceType, string> = { boarding: '2', daycare: '7' };

/** Nome da cor de cada id da paleta antiga — é o que a tela mostra ao lado do `colorId`. */
export const LEGACY_COLOR_NAMES: Record<string, string> = {
  '1': 'Lavender',
  '2': 'Sage',
  '3': 'Grape',
  '4': 'Flamingo',
  '5': 'Banana',
  '6': 'Tangerine',
  '7': 'Peacock',
  '8': 'Graphite',
  '9': 'Blueberry',
  '10': 'Basil',
  '11': 'Tomato',
};

function ehDaPaleta(id: string, paleta: readonly string[]): boolean {
  return paleta.includes(id);
}

function limpo(valor: string | null | undefined): string | null {
  const texto = (valor ?? '').trim();
  return texto.length > 0 ? texto : null;
}

/** Nome da cor da paleta antiga (`'7'` → `'Peacock'`). `null` quando o id é desconhecido. */
export function legacyColorName(colorId?: string | null): string | null {
  return LEGACY_COLOR_NAMES[limpo(colorId) ?? ''] ?? null;
}

/** Traduz o `colorId` do evento. `null` = cor ausente ou fora do mapa (não se chuta serviço). */
export function meaningOfColor(colorId?: string | null): ColorMeaning | null {
  const id = limpo(colorId);
  if (!id) return null;
  if (ehDaPaleta(id, GOOGLE_COLOR_IDS.boarding)) return { kind: 'service', serviceType: 'boarding' };
  if (ehDaPaleta(id, GOOGLE_COLOR_IDS.daycare)) return { kind: 'service', serviceType: 'daycare' };
  if (ehDaPaleta(id, GOOGLE_COLOR_IDS.cancel)) return { kind: 'cancel' };
  return null;
}

/** Cor com que o espelho pinta o evento do serviço. */
export function colorOfService(serviceType: BookingServiceType): string {
  return COLOR_OF_SERVICE[serviceType];
}

/* ------------------------------- etiquetas (paleta nova) ------------------------------- */

/** Etiqueta de cor de um calendário (`labelProperties.eventLabels` da API do Google). */
export type EventLabel = {
  id: string;
  /** Nome que o escritório deu à etiqueta (ex.: "Cobalto"). Opcional na API. */
  name: string | null;
  /** Hex, como a API devolve (ex.: `#4A86E8`). É a única informação de cor que a etiqueta tem. */
  backgroundColor: string;
};

/**
 * Faixas de TOM (matiz em graus, 0..360) aceitas. Documentadas porque são o contrato da
 * classificação por etiqueta:
 *  - VERDE 70..170 (Sage #33b679 ≈ 152, Basil #0b8043 ≈ 149) → boarding;
 *  - AZUL 170..265 (Peacock #039be5 ≈ 200, Blueberry #4986e7 ≈ 217, Cobalto #4A86E8 ≈ 217) → daycare;
 *  - VERMELHO 340..360 e 0..12 (Tomato #e67c73 ≈ 5) → cancelamento.
 * Fora disso o app NÃO chuta serviço (amarelo, laranja — Tangerine #f4511e ≈ 14 fica de fora —,
 * roxo, rosa/magenta, cinza). O limite do vermelho é estreito de propósito: laranja não cancela.
 */
export const TOM_VERDE = { de: 70, ate: 170 } as const;
export const TOM_AZUL = { de: 170, ate: 265 } as const;
export const TONS_VERMELHOS = [
  { de: 340, ate: 360 },
  { de: 0, ate: 12 },
] as const;

/** Saturação mínima para o hex ter TOM: abaixo disso a cor é cinza e não diz serviço nenhum. */
const SATURACAO_MINIMA = 0.08;

/**
 * Tom (matiz) em graus de um hex (`#RRGGBB` ou `#RGB`). `null` = sem tom legível (cinza, branco,
 * preto ou hex inválido) — melhor dizer "não reconhecida" do que inventar serviço.
 */
export function hueOfHex(hex?: string | null): number | null {
  const bruto = limpo(hex)?.replace(/^#/, '') ?? '';
  const completo = bruto.length === 3 ? bruto.split('').map((c) => c + c).join('') : bruto;
  if (!/^[0-9a-fA-F]{6}$/.test(completo)) return null;
  const r = parseInt(completo.slice(0, 2), 16) / 255;
  const g = parseInt(completo.slice(2, 4), 16) / 255;
  const b = parseInt(completo.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0 || delta / max < SATURACAO_MINIMA) return null;
  let tom: number;
  if (max === r) tom = 60 * (((g - b) / delta) % 6);
  else if (max === g) tom = 60 * ((b - r) / delta + 2);
  else tom = 60 * ((r - g) / delta + 4);
  return tom < 0 ? tom + 360 : tom;
}

/** Traduz o HEX de uma etiqueta pelo TOM. `null` = tom fora de verde/azul/vermelho (não se chuta). */
export function meaningOfLabelColor(hex?: string | null): ColorMeaning | null {
  const tom = hueOfHex(hex);
  if (tom === null) return null;
  if (tom >= TOM_VERDE.de && tom < TOM_VERDE.ate) return { kind: 'service', serviceType: 'boarding' };
  if (tom >= TOM_AZUL.de && tom < TOM_AZUL.ate) return { kind: 'service', serviceType: 'daycare' };
  if (TONS_VERMELHOS.some((faixa) => tom >= faixa.de && tom < faixa.ate)) return { kind: 'cancel' };
  return null;
}

/**
 * Etiqueta do calendário que representa o serviço (mesmo TOM de verde/azul).
 *
 * Determinística: quando o calendário tem mais de uma etiqueta do mesmo tom — o caso normal, porque a
 * paleta nova traz várias variações — vale a de menor `id`. É a etiqueta que o ESPELHO aplica no
 * evento que cria/atualiza; sem ela o espelho pinta com o `colorId` legado (`colorOfService`).
 */
export function labelForService(labels: EventLabel[] | null | undefined, serviceType: BookingServiceType): EventLabel | null {
  const encontradas = (labels ?? [])
    .filter((label) => {
      const significado = meaningOfLabelColor(label.backgroundColor);
      return significado?.kind === 'service' && significado.serviceType === serviceType;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return encontradas[0] ?? null;
}

/* --------------------------- o que foi LIDO do evento (mostrado na tela) --------------------------- */

export type EventColorRead = {
  /** De onde a cor foi lida: etiqueta (paleta nova), `colorId` legado, ou nada. */
  source: 'label' | 'colorId' | 'none';
  /** `eventLabelId` do evento, quando houver. */
  labelId: string | null;
  /** Nome da etiqueta (ex.: "Cobalto") quando ela está na lista do calendário. */
  labelName: string | null;
  /** Hex da etiqueta (ex.: `#4A86E8`). */
  backgroundColor: string | null;
  /** `colorId` legado do evento — num evento da paleta nova costuma vir NULO. */
  colorId: string | null;
  /** O que a cor diz. `null` = não reconhecida (não se chuta serviço). */
  meaning: ColorMeaning | null;
};

/**
 * Lê a cor do evento nos dois esquemas.
 *
 * Regra: **etiqueta manda**; o `colorId` legado só entra como fallback (evento sem etiqueta, evento
 * pintado na paleta velha, ou etiqueta que não está na lista deste calendário — labels não lidas,
 * apagadas depois, ou calendário trocado).
 */
export function readEventColor(
  event: { eventLabelId?: string | null; colorId?: string | null },
  labels: EventLabel[] = [],
): EventColorRead {
  const labelId = limpo(event.eventLabelId);
  const colorId = limpo(event.colorId);
  const etiqueta = labelId ? labels.find((label) => label.id === labelId) ?? null : null;
  const significado = etiqueta ? meaningOfLabelColor(etiqueta.backgroundColor) : meaningOfColor(colorId);
  return {
    source: labelId ? 'label' : colorId ? 'colorId' : 'none',
    labelId,
    labelName: etiqueta?.name ?? null,
    backgroundColor: etiqueta?.backgroundColor ?? null,
    colorId,
    meaning: significado,
  };
}

/**
 * O que a tela mostra sobre a cor lida — é o que faz o suporte parar de adivinhar:
 * `Cobalto (#4A86E8)` numa etiqueta da paleta nova; `colorId 2 (Sage)` num evento da paleta antiga;
 * `no color` quando não há nada. Tolerante a `undefined` (estado antigo na tela) de propósito.
 */
export function describeEventColor(read?: EventColorRead | null): string {
  const partes: string[] = [];
  if (read?.backgroundColor) {
    partes.push(read.labelName ? `${read.labelName} (${read.backgroundColor})` : read.backgroundColor);
  } else if (read?.labelId) {
    partes.push(`label ${read.labelId} (not in this calendar)`);
  }
  if (read?.colorId) {
    const nome = legacyColorName(read.colorId);
    partes.push(`colorId ${read.colorId}${nome ? ` (${nome})` : ''}`);
  }
  return partes.length ? partes.join(' · ') : 'no color';
}

/** Resposta de `GET /calendars/{id}` → etiquetas da tela (sem `id` não dá para usar: fica de fora). */
export function interpretarEtiquetas(payload: unknown): EventLabel[] {
  const lista = (payload as { labelProperties?: { eventLabels?: unknown } } | null)?.labelProperties?.eventLabels;
  if (!Array.isArray(lista)) return [];
  return lista
    .map((item) => {
      const bruto = item as { id?: unknown; name?: unknown; backgroundColor?: unknown } | null;
      const id = typeof bruto?.id === 'string' ? bruto.id.trim() : '';
      if (!id) return null;
      return {
        id,
        name: typeof bruto?.name === 'string' ? limpo(bruto.name) : null,
        backgroundColor: typeof bruto?.backgroundColor === 'string' ? bruto.backgroundColor.trim() : '',
      };
    })
    .filter((item): item is EventLabel => item !== null);
}
