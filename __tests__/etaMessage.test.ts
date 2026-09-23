/**
 * AVISO DE ETA AO TUTOR — pedido do cliente em áudio (16/09/2026): "abre seu messenger pra
 * mandar o ETA... sem ser pelo Twilio, sem ser um disparo".
 *
 * O que estes testes travam:
 *  - a frase muda de verdade entre BUSCA e ENTREGA, e a de atraso é outra frase;
 *  - o ETA vai arredondado de 5 em 5 e como "about" (não promete precisão que não existe);
 *  - cliente sem telefone utilizável NÃO gera botão ativo;
 *  - o link do SMS e o do WhatsApp levam o texto pronto.
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

describe('texto da mensagem', () => {
  it('busca: "on my way to pick up" com o tempo aproximado', () => {
    expect(etaMessageText({ clientName: 'Maria', dogName: 'Thor', phase: 'pickup', minutes: 12 })).toBe(
      "Hi Maria! I'm on my way to pick up Thor — about 10 minutes away.",
    );
  });

  it('entrega: "on my way to drop off"', () => {
    expect(etaMessageText({ clientName: 'Maria', dogName: 'Thor', phase: 'dropoff', minutes: 8 })).toBe(
      "Hi Maria! I'm on my way to drop off Thor — about 10 minutes away.",
    );
  });

  it('atraso: a frase É outra (o tutor precisa saber que vai atrasar)', () => {
    expect(etaMessageText({ clientName: 'Maria', dogName: 'Thor', phase: 'pickup', minutes: 20, lateMinutes: 10 })).toBe(
      "Hi Maria! I'm running about 10 minutes late to pick up Thor.",
    );
    expect(etaMessageText({ clientName: 'Maria', dogName: 'Thor', phase: 'dropoff', minutes: 5, lateMinutes: 5 })).toBe(
      "Hi Maria! I'm running about 5 minutes late to drop off Thor.",
    );
  });

  it('cliente sem nome ou cão sem nome não gera frase quebrada', () => {
    expect(etaMessageText({ clientName: null, dogName: 'Thor', phase: 'pickup', minutes: 12 })).toBe(
      "Hi! I'm on my way to pick up Thor — about 10 minutes away.",
    );
    expect(etaMessageText({ clientName: 'Maria', dogName: '   ', phase: 'pickup', minutes: 12 })).toContain('your dog');
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
