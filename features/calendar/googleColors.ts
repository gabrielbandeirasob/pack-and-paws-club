/**
 * A COR do evento do Google é quem diz o SERVIÇO (regra do dono, 24/09/2026).
 *
 * Antes o serviço vinha do título ("Daycare · Bella", "Boarding - Bella") e o título livre assumia
 * daycare. O dono inverteu: o escritório escreve no título **só o nome do cão** e marca o serviço
 * pintando o evento — verde para boarding, azul para daycare, vermelho para cancelar o dia.
 *
 * O `colorId` da API do Google é um id FIXO da paleta da conta (1 a 11). O mapa é por ID, nunca pelo
 * nome da cor: é determinístico, testável e não muda com o idioma da interface.
 *
 *   1 Lavender   2 Sage (verde)     3 Grape      4 Flamingo   5 Banana    6 Tangerine
 *   7 Peacock (azul)                8 Graphite   9 Blueberry (azul)      10 Basil (verde)
 *   11 Tomato (vermelho)
 *
 * O que NÃO é mapeado (lavanda, uva, flamingo, banana, tangerina, grafite) e o evento SEM cor não
 * viram serviço nenhum: o app não chuta — o evento entra na lista "color not recognized" do cartão
 * para o escritório pintar e sincronizar de novo. (O dono citou amarelo e corrigiu para azul: amarelo
 * — Banana, id 5 — fica de fora de propósito.)
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
 */
export const COLOR_OF_SERVICE: Record<BookingServiceType, string> = { boarding: '2', daycare: '7' };

function ehDaPaleta(id: string, paleta: readonly string[]): boolean {
  return paleta.includes(id);
}

/** Traduz o `colorId` do evento. `null` = cor ausente ou fora do mapa (não se chuta serviço). */
export function meaningOfColor(colorId?: string | null): ColorMeaning | null {
  const id = (colorId ?? '').trim();
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
