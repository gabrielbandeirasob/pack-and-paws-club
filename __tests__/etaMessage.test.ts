/**
 * AVISO DE ETA AO TUTOR — pedido do cliente em áudio (16/09/2026): "abre seu messenger pra
 * mandar o ETA... sem ser pelo Twilio, sem ser um disparo".
 *
 * Ajuste da operação (áudios de 25/09/2026): o aviso passou de "about N minutes" para uma FAIXA de
 * ~30 min (5 antes / 25 depois) no texto EXATO que o cliente mandou — este bloco de texto foi
 * atualizado por isso (o resto do arquivo continua igual).
 *
 * O que estes testes travam:
 *  - a frase da BUSCA e a da ENTREGA são as do cliente, com a faixa em horário de relógio;
 *  - o ETA vai arredondado de 5 em 5 (a faixa nunca promete minuto exato);
 *  - a ENTREGA nunca anuncia antes das 14:00;
 *  - a frase do atraso continua existindo (e agora vem com a faixa);
 *  - cliente sem telefone utilizável NÃO gera botão ativo;
 *  - o link do SMS e o do WhatsApp levam o texto pronto (assinaturas preservadas).
 *
 * As horas de referência são FIXAS (new Date(...) em hora local): nada aqui lê o relógio da máquina.
 */
import {
  aboutMinutes,
  etaMessageText,
  etaNoticeError,
  messengerLink,
  notifyButtonState,
  phaseForStop,
  roundToFive,
  smsLink,
  whatsappLink,
} from '@/features/driver/etaMessage';

/** 25/09/2026 08:55 — com um ETA de 12 min a previsão arredonda para 09:05. */
const REF_BUSCA = new Date(2026, 8, 25, 8, 55, 0);
/** 25/09/2026 13:55 — previsão 14:10 (depois das 2, então a faixa não é empurrada). */
const REF_ENTREGA = new Date(2026, 8, 25, 13, 55, 0);

describe('fase da parada', () => {
  it('busca antes de embarcar; entrega depois', () => {
    expect(phaseForStop('pending')).toBe('pickup');
    expect(phaseForStop('arrived')).toBe('pickup');
    expect(phaseForStop('picked_up')).toBe('dropoff');
    expect(phaseForStop('completed')).toBe('dropoff');
  });
});

describe('arredondamento do ETA', () => {
  it('de 5 em 5, nunca abaixo de 5', () => {
    expect(roundToFive(12)).toBe(10);
    expect(roundToFive(13)).toBe(15);
    expect(roundToFive(3)).toBe(5);
    expect(roundToFive(0)).toBe(5);
    expect(roundToFive(Number.NaN)).toBe(5);
    expect(aboutMinutes(12)).toBe('about 10 minutes');
  });
});

describe('texto da mensagem (faixa de ~30 min)', () => {
  it('busca: "I\'ll be there between 9:00 and 9:30 AM to pick up"', () => {
    expect(
      etaMessageText({ clientName: 'Maria', driverName: 'Alex', dogName: 'Thor', phase: 'pickup', minutes: 12, now: REF_BUSCA }),
    ).toBe(
      "Good morning, Maria! This is Alex from Pack & Paws Club. I'll be there between 9:00 and 9:30 AM to pick up Thor. Looking forward to another great day with them! 🐶🐾",
    );
  });

  it('entrega: "I\'ll be dropping off ... between 2:05 and 2:35 PM"', () => {
    expect(
      etaMessageText({ clientName: 'Maria', driverName: 'Alex', dogName: 'Thor', phase: 'dropoff', minutes: 15, now: REF_ENTREGA }),
    ).toBe(
      "Good afternoon, Maria! This is Alex from Pack & Paws Club 😊 I'll be dropping off Thor between 2:05 and 2:35 PM. They had a great day with us! 🐶🐾",
    );
  });

  it('atraso: a frase do atraso continua E a faixa vai junto', () => {
    const atrasado = etaMessageText({ clientName: 'Maria', driverName: 'Alex', dogName: 'Thor', phase: 'pickup', minutes: 12, lateMinutes: 10, now: REF_BUSCA });
    expect(atrasado).toContain("I'm running about 10 minutes late.");
    expect(atrasado).toContain('between 9:00 and 9:30 AM');
  });

  it('cliente sem nome ou cão sem nome não gera frase quebrada', () => {
    const semNome = etaMessageText({ clientName: null, dogName: 'Thor', phase: 'pickup', minutes: 12, now: REF_BUSCA });
    expect(semNome.startsWith('Good morning! ')).toBe(true);
    expect(semNome).not.toContain(', !');
    expect(etaMessageText({ clientName: 'Maria', dogName: '   ', phase: 'pickup', minutes: 12, now: REF_BUSCA })).toContain('to pick up your dog');
  });
});

describe('botão "Notify owner"', () => {
  it('sem telefone utilizável não dá para avisar (e explica por quê)', () => {
    const semFone = notifyButtonState({ phone: null });
    expect(semFone.enabled).toBe(false);
    expect(semFone.tone).toBe('disabled');
    expect(semFone.hint).toContain('No phone number');
    expect(notifyButtonState({ phone: '1234' }).enabled).toBe(false); // ramal, não telefone
  });

  it('parada atrasada deixa o botão âmbar e com o rótulo do atraso', () => {
    const atrasado = notifyButtonState({ phone: '+1 415 555 0202', lateMinutes: 8 });
    expect(atrasado.enabled).toBe(true);
    expect(atrasado.tone).toBe('late');
    expect(atrasado.label).toContain('running late');
    expect(notifyButtonState({ phone: '+1 415 555 0202' }).tone).toBe('normal');
  });

  it('parada concluída não oferece aviso', () => {
    expect(notifyButtonState({ phone: '+1 415 555 0202', done: true }).enabled).toBe(false);
  });
});

describe('links do mensageiro', () => {
  it('SMS com o texto pronto e WhatsApp com wa.me', () => {
    expect(smsLink('+1 (415) 555-0202', 'oi')).toBe('sms:+14155550202&body=oi');
    expect(whatsappLink('+1 (415) 555-0202', 'oi')).toBe('https://wa.me/14155550202?text=oi');
    expect(messengerLink('whatsapp', '(415) 555-0202', 'a b')).toBe('https://wa.me/4155550202?text=a%20b');
    expect(messengerLink('sms', null, 'oi')).toBeNull();
  });
});

describe('erro do registro do aviso', () => {
  it('traduz rede e parada que sumiu', () => {
    expect(etaNoticeError(new Error('Network request failed'))).toContain('back online');
    expect(etaNoticeError(new Error('parada não encontrada (ou não é sua)'))).toContain('no longer available');
    expect(etaNoticeError(new Error('qualquer coisa'))).toBe('qualquer coisa');
  });
});
