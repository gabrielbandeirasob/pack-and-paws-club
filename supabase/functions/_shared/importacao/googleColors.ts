// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
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
 *    classificação é por **TOM (matiz)**: verde = boarding, AZUL e a **FAMÍLIA ROXA** (lavanda, uva) =
 *    daycare, vermelho = cancelar — decisão do dono (24/09/2026): *"Lavanda/Uva conta como azul ->
 *    daycare"*. É o caso do "Cobalto" (#4A86E8) que o escritório pintou e o app não reconhecia: ele
 *    chegava sem `colorId`, e o app ainda não interpretava `eventLabelId` + etiquetas do calendário.
 *
 * A ETIQUETA MANDA quando o evento tem uma (`eventLabelId`): um evento pintado na paleta nova não
 * traz `colorId` nenhum. O mapa antigo continua valendo como **fallback** (evento sem etiqueta, ou
 * etiqueta que não está na lista do calendário — lá o `colorId` legado ainda diz o serviço).
 *
 * O que NÃO é mapeado (amarelo, laranja, marrom, cinza, rosa/magenta — e qualquer tom fora de
 * verde/azul-roxo/vermelho) e o evento SEM cor não viram serviço nenhum: o app não chuta — o evento
 * entra na lista "color not recognized" do cartão, que agora **mostra o que foi lido** (nome da
 * etiqueta + hex + `colorId` legado) para o escritório pintar e o suporte não adivinhar.
 */

export type BookingServiceType = 'daycare' | 'boarding';

/** O que a cor do evento significa. `null` (sem cor / cor não mapeada) = não se importa. */
export type ColorMeaning =
  | { kind: 'service'; serviceType: BookingServiceType }
  /** Evento pintado de ROXO: alteração de cliente de dia fixo (dia extra/alterado da escala). */
  | { kind: 'schedule_change' }
  | { kind: 'cancel' };

/**
 * Ids da paleta do Google que o app reconhece. Verde = boarding, azul = daycare, **roxo = alteração de
 * dia (cliente de dia fixo)**, vermelho = cancelar.
 *
 * Os ids `1` (Lavender — lavanda, azul-claro, tom ≈ 223°) e `7`/`9` (azuis) ficam em daycare; o id `3`
 * (Grape — "uva", roxo, tom ≈ 288°) entrou em `schedule_change` na decisão do dono de 24/09/2026:
 * *"Roxo - Alteração de cliente dia fixo / cliente fora de ordem, para não ficar serviço solto"* — o
 * mesmo corte de tom (265°) que a classificação por etiqueta usa.
 */
export const GOOGLE_COLOR_IDS = {
  // 2 Sage (verde), 10 Basil (verde) e **5 Banana (amarelo)** — o dono confirmou em 27/09/2026:
  // *"a cor amarela e os tons que lembram ela é boarding"*.
  boarding: ['2', '5', '10'],
  daycare: ['1', '7', '9'],
  schedule_change: ['3'],
  // 11 Tomato e **4 Flamingo** (vermelho brando): o dono confirmou em 27/09/2026 que *"vermelho é
  // cancelamento mesmo"*, e o levantamento do calendario dele lista Flamingo entre os vermelhos de
  // cancelar. Achado pelo CALENDARIO DE TESTE (27/09/2026): Flamingo caia em "cor nao reconhecida" e
  // a cancelacao do escritorio se perdia na lista de revisao.
  cancel: ['4', '11'],
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
  if (ehDaPaleta(id, GOOGLE_COLOR_IDS.schedule_change)) return { kind: 'schedule_change' };
  if (ehDaPaleta(id, GOOGLE_COLOR_IDS.cancel)) return { kind: 'cancel' };
  return null;
}

/** Cor com que o espelho pinta o evento do serviço. */
export function colorOfService(serviceType: BookingServiceType): string {
  return COLOR_OF_SERVICE[serviceType];
}

/* ------------------------------- etiquetas (paleta nova) ------------------------------- */

/**
 * O DIA É DE CHEGADA/SAÍDA da hospedagem? (o cão anda de van — pick up na chegada, drop off na saída)
 *
 * Regra do escritório (27/09/2026, áudio): *"verde claro, que a cor aqui no calendário chama avocado,
 * indica chegada e saída"*, *"verde escuro, que a cor chama Basil"* são os dias do meio (o cão está no
 * hotel, não anda). Traduzido em tom: **amarelo/verde-claro (35°..70°) = anda; verde (70°..170°) = hotel**.
 * Devolve `null` quando o evento não é hospedagem (aí a pergunta não se aplica) — o chamador decide o
 * padrão. Na paleta antiga, o amarelo é o `colorId` 5 (Banana).
 */
export function movimentaOCao(read: EventColorRead | null | undefined): boolean | null {
  const significado = read?.meaning;
  if (!significado || significado.kind !== 'service' || significado.serviceType !== 'boarding') return null;
  if (read?.source === 'label') return tomDeMovimento(read.backgroundColor);
  if (read?.colorId) return ehDaPaleta(read.colorId, GOOGLE_COLOR_IDS_MOVIMENTO);
  return null;
}

/** Tom (hex da etiqueta) no amarelo/verde-claro = dia de chegada ou saída. */
export function tomDeMovimento(hex?: string | null): boolean {
  const tom = hueOfHex(hex);
  if (tom === null) return false;
  return tom >= TOM_AMARELO.de && tom < TOM_AMARELO.ate;
}

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
 *  - AZUL 170..265 (Peacock #039be5 ≈ 200, Blueberry #4986e7 ≈ 217, Cobalto #4A86E8 ≈ 217,
 *    Lavanda #a4bdfc ≈ 223, Glicínia #b39ddb ≈ 261) → daycare;
 *  - ROXO 265..300 (Ametista #9e69af ≈ 285, Uva/Grape #8e24aa ≈ 288) → **alteração de dia**
 *    (`schedule_change`): cliente de dia fixo que mudou o dia / veio fora da ordem — decisão do dono
 *    (24/09/2026): *"Roxo - Alteração de cliente dia fixo/cliente fora de ordem, para não ficar
 *    serviço solto"*;
 *  - VERMELHO 340..360 e 0..12 (Tomato #e67c73 ≈ 5) → cancelamento.
 *  - **AMARELO 35..70 (Banana #f6bf26 ≈ 44, Citron #e4c441 ≈ 48, Mango #f09300 ≈ 37, Avocado #c0ca33
 *    ≈ 64) → boarding**, confirmado pelo dono em 27/09/2026: *"a cor amarela e os tons que lembram ela
 *    é boarding"*. É a cor que o escritório mais usa (marcador do dia, Scarlet, Maui, Penny) e antes
 *    caía em "cor não reconhecida".
 * O teto em 300° é de propósito: daí para cima já é rosa/magenta (o magenta puro #ff00ff dá exatamente
 * 300° e fica FORA), que o dono não citou.
 * Fora disso o app NÃO chuta serviço: **laranja/marrom entre 12° e 35°** (Tangerine #f4511e ≈ 14,
 * Pumpkin #ef6c00 ≈ 27, Cocoa #795548 ≈ 16, Birch #a79b8e ≈ 31 — este é bege), rosa/magenta e cinza.
 * O limite do vermelho é estreito de propósito: laranja não cancela. O do amarelo também: quem está
 * entre 12° e 35° é laranja, não amarelo — se o escritório disser que laranja também é boarding, é só
 * baixar `TOM_AMARELO.de`.
 */
export const TOM_VERDE = { de: 70, ate: 170 } as const;
/**
 * Amarelo/âmbar = boarding **e dia de CHEGADA/SAÍDA** da hospedagem (dono, 27/09/2026):
 * *"é verde claro, que a cor aqui no calendário chama avocado — indica chegada e saída"*. Verde (tom
 * acima de 70) é o dia do MEIO: o cão está no hotel. Quem decide van/transporte é `movimentaOCao`.
 */
export const TOM_AMARELO = { de: 35, ate: 70 } as const;
/** Ids da paleta ANTIGA que significam dia de chegada/saída (5 = Banana, amarelo). */
export const GOOGLE_COLOR_IDS_MOVIMENTO = ['5'] as const;
export const TOM_AZUL = { de: 170, ate: 265 } as const;
export const TOM_ROXO = { de: 265, ate: 300 } as const;
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

/** Traduz o HEX de uma etiqueta pelo TOM. `null` = tom fora de verde/azul/roxo/vermelho (não se chuta). */
export function meaningOfLabelColor(hex?: string | null): ColorMeaning | null {
  const tom = hueOfHex(hex);
  if (tom === null) return null;
  if (tom >= TOM_AMARELO.de && tom < TOM_AMARELO.ate) return { kind: 'service', serviceType: 'boarding' };
  if (tom >= TOM_VERDE.de && tom < TOM_VERDE.ate) return { kind: 'service', serviceType: 'boarding' };
  if (tom >= TOM_AZUL.de && tom < TOM_AZUL.ate) return { kind: 'service', serviceType: 'daycare' };
  if (tom >= TOM_ROXO.de && tom < TOM_ROXO.ate) return { kind: 'schedule_change' };
  if (TONS_VERMELHOS.some((faixa) => tom >= faixa.de && tom < faixa.ate)) return { kind: 'cancel' };
  return null;
}

/**
 * Etiqueta do calendário que representa o serviço (mesmo TOM de verde, amarelo ou azul).
 *
 * Determinística: quando o calendário tem mais de uma etiqueta do mesmo tom — o caso normal, porque a
 * paleta nova traz várias variações — vale a de menor `id`. É a etiqueta que o ESPELHO aplica no
 * evento que cria/atualiza; sem ela o espelho pinta com o `colorId` legado (`colorOfService`).
 *
 * Obs.: agora que a FAMÍLIA ROXA também é daycare, a etiqueta de menor id pode ser uma roxa — o dono
 * decidiu que roxo conta como azul, então é o esperado. O espelho continua mandando junto o `colorId` 7
 * (`colorOfService`), que é o que um cliente antigo do calendário entende.
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
