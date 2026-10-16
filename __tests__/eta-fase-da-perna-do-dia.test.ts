/**
 * A FASE DO AVISO É A PERNA DO DIA — não o status da parada (medido 16/10/2026).
 *
 * O que estava errado: `avisoDe`/`enviarAviso` deduziam a fase de `phaseForStop(stop.status)`. A
 * entrega de um cão NASCE `pending` (o cão só é embarcado de manhã), então a tela que o motorista via
 * rotulada "Drop-offs" gerava mensagem de BUSCA ("I'll be there between 1:53 –2:23 PM to pick up") e
 * marcava `eta_notice_kind='pickup'` no banco — e, pior, escapava do piso das 14h, que é a regra do
 * dono ("drop-off nunca anuncia antes das duas").
 *
 * A prova tem duas pontas, porque o defeito era de FIÇÃO (a peça pura estava certa):
 *  1) a peça pura mostra que a fase MUDA a frase e o horário — logo a escolha da fase importa;
 *  2) a leitura do arquivo da tela prova de onde a fase vem (a perna), sem depender de render.
 */
import fs from 'node:fs';
import path from 'node:path';

import { avisoWindow, etaMessageText } from '@/features/driver/etaMessage';

/** 16/10/2026 13:00 — uma hora antes das duas da tarde. */
const UMA_DA_TARDE = new Date(2026, 9, 16, 13, 0, 0);

describe('a perna decide a frase e o piso das 14h', () => {
  it('entrega com previsão antes das 2 é empurrada para as 14:00', () => {
    const janela = avisoWindow({ now: UMA_DA_TARDE, minutes: 15, phase: 'dropoff' });
    expect(janela.inicioMin).toBe(14 * 60);
    expect(janela.fimMin).toBe(14 * 60 + 5);
  });

  it('a MESMA previsão anunciada como busca não tem piso (13:10 –13:40)', () => {
    const janela = avisoWindow({ now: UMA_DA_TARDE, minutes: 15, phase: 'pickup' });
    expect(janela.inicioMin).toBe(13 * 60 + 10);
    expect(janela.fimMin).toBe(13 * 60 + 40);
  });

  it('a frase muda com a perna (busca pega, entrega devolve)', () => {
    const busca = etaMessageText({ clientName: 'Maria', driverName: 'Alex', dogName: 'Thor', phase: 'pickup', minutes: 15, now: UMA_DA_TARDE });
    const entrega = etaMessageText({ clientName: 'Maria', driverName: 'Alex', dogName: 'Thor', phase: 'dropoff', minutes: 15, now: UMA_DA_TARDE });
    expect(busca).toContain('to pick up Thor');
    expect(busca).toContain('1:10 –1:40 PM');
    expect(entrega).toContain("I'll be dropping off Thor");
    expect(entrega).toContain('2:00 –2:05 PM');
  });
});

describe('a tela do motorista tira a fase da PERNA que ele está rodando', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'driver.tsx'), 'utf8');

  it('o aviso e o registro usam a perna da tela', () => {
    expect(fonte).toContain('phase: fase');
    expect(fonte).toContain('const phase = fase;');
  });

  it('nada na tela volta a deduzir a fase do status da parada', () => {
    expect(fonte).not.toContain('phaseForStop(');
  });
});
