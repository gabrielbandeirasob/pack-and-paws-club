/**
 * VETORES DO AGENTE2 — frescor da posição do motorista no Dispatch (melhoria 3, 25/09/2026).
 *
 * Problema que estes vetores travam: o Dispatch escrevia sempre "📍 N min ago". Com 4 horas de silêncio
 * aparecia "240 min ago" (ilegível) e o ETA continuava sendo calculado e exibido como se a posição fosse
 * de agora — o escritório tomaria decisão com número velho. Agora: idade legível, aviso de que está velha e
 * o ETA sai de cena quando a posição é antiga demais.
 */
import { frescorDaPosicao, POSICAO_MUITO_VELHA_MINUTOS, POSICAO_VELHA_MINUTOS } from '@/features/driver/eta';

const agora = new Date('2026-09-25T12:00:00Z');
const atras = (minutos: number) => new Date(agora.getTime() - minutos * 60_000).toISOString();

it('posicao de agora: just now e sem aviso', () => {
  const lido = frescorDaPosicao(atras(0), agora);
  expect(lido.texto).toBe('just now');
  expect(lido.velha).toBe(false);
  expect(lido.muitoVelha).toBe(false);
});

it('posicao recente em minutos continua em minutos', () => {
  const lido = frescorDaPosicao(atras(8), agora);
  expect(lido.texto).toBe('8 min ago');
  expect(lido.velha).toBe(false);
});

it('passou de 15 min: avisa que esta ficando velha, mas ainda mostra ETA', () => {
  const lido = frescorDaPosicao(atras(POSICAO_VELHA_MINUTOS + 5), agora);
  expect(lido.texto).toBe('20 min ago');
  expect(lido.velha).toBe(true);
  expect(lido.muitoVelha).toBe(false);
});

it('passou de 45 min: idade em horas e ETA fora (nada de numero velho)', () => {
  const lido = frescorDaPosicao(atras(POSICAO_MUITO_VELHA_MINUTOS + 30), agora);
  expect(lido.texto).toBe('1 h 15 min ago');
  expect(lido.velha).toBe(true);
  expect(lido.muitoVelha).toBe(true);
});

it('horas cheias nao viram "0 min"', () => {
  expect(frescorDaPosicao(atras(120), agora).texto).toBe('2 h 0 min ago');
});

it('data invalida nao vira "just now": diz que nao sabe e trata como velha', () => {
  const lido = frescorDaPosicao('nao-e-data', agora);
  expect(lido.texto).toBe('time unknown');
  expect(lido.velha).toBe(true);
  expect(lido.muitoVelha).toBe(true);
});

it('os limites sao os documentados (15 e 45 minutos)', () => {
  expect(POSICAO_VELHA_MINUTOS).toBe(15);
  expect(POSICAO_MUITO_VELHA_MINUTOS).toBe(45);
  expect(frescorDaPosicao(atras(15), agora).velha).toBe(false);       // 15 min exatos ainda passa
  expect(frescorDaPosicao(atras(16), agora).velha).toBe(true);
  expect(frescorDaPosicao(atras(45), agora).muitoVelha).toBe(false);  // 45 min exatos ainda mostra ETA
  expect(frescorDaPosicao(atras(46), agora).muitoVelha).toBe(true);
});
