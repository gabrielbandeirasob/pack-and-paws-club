/**
 * FLAMINGO CANCELA (achado do calendario de teste, 27/09/2026).
 *
 * O levantamento do calendario do escritorio lista Flamingo entre os vermelhos, e o dono confirmou
 * *"vermelho e cancelamento mesmo"* (27/09/2026). Mesmo assim, so o Tomato (id 11) cancelava: um cao
 * pintado de Flamingo (id 4, o vermelho brando que o escritorio usa) caia em "cor nao reconhecida" e
 * ficava na lista de revisao — a cancelacao se perdia.
 */
import { meaningOfColor, meaningOfLabelColor, GOOGLE_COLOR_IDS } from '@/features/calendar/googleColors';

it('colorId 4 (Flamingo) cancela — o vermelho brando que o escritorio usa', () => {
  expect(meaningOfColor('4')).toEqual({ kind: 'cancel' });
});

it('colorId 11 (Tomato) continua cancelando', () => {
  expect(meaningOfColor('11')).toEqual({ kind: 'cancel' });
});

it('etiqueta Flamingo (#E67C73) cancela pelo tom', () => {
  expect(meaningOfLabelColor('#e67c73')).toEqual({ kind: 'cancel' });
});

it('a paleta de cancelar tem os dois vermelhos', () => {
  expect([...GOOGLE_COLOR_IDS.cancel].sort()).toEqual(['11', '4']);
});

it('amarelo continua boarding (a regra de 27/09/2026 nao mudou)', () => {
  expect(meaningOfColor('5')).toEqual({ kind: 'service', serviceType: 'boarding' });
});
