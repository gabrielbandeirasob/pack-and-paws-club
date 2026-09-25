/**
 * VETORES DO AGENTE2 — AVISO AO TUTOR EM FAIXA DE ~30 MIN + "ADD ANOTHER DOG" (áudios 25/09/2026).
 *
 * O que este arquivo prova (nenhuma hora vem do relógio: toda referência entra por parâmetro):
 *  (a) pick-up: a faixa abre 5 min antes e fecha 25 min depois da previsão, com "Good morning";
 *  (b) drop-off: "Good afternoon" e a janela NUNCA começa antes das 14:00 (ETA 13:40 → 2:00–2:05 PM);
 *  (c) o texto é assinado com o nome do CÃO, do CLIENTE e do MOTORISTA;
 *  (d) parada atrasada mantém "running ... late" E mostra a faixa de horário;
 *  (e) WhatsApp saiu da interface: a folha não oferece WhatsApp e, com um mensageiro só, o app não
 *      pede escolha — vai direto para o app de mensagens (as assinaturas de link continuam valendo);
 *  (f) "+ Add another dog" insere a vírgula no campo dos nomes, sem quebrar o formato que já funciona.
 *
 * Os textos são os que o cliente mandou por escrito; qualquer mudança de palavra aqui é mudança de
 * contrato com ele.
 */
import { createElement } from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

import {
  AVISO_ANTES_MIN,
  AVISO_DEPOIS_MIN,
  DROPOFF_INICIO_MIN,
  avisoWindow,
  etaMessageText,
  messengerLink,
  windowLabel,
} from '@/features/driver/etaMessage';
import {
  NotifyOwnerSheet,
  OFFERED_MESSENGERS,
  defaultMessenger,
  linkForChoice,
  messengerChoiceNeeded,
} from '@/features/driver/NotifyOwnerSheet';
import { seedNextDogName } from '@/features/clients/clientsService';
import { EditClientForm } from '@/features/clients/EditClientForm';
import type { EditableClient } from '@/features/clients/clientsService';

/** Datas fixas em hora LOCAL: nada aqui depende do fuso nem do relógio da máquina. */
const REF_BUSCA = new Date(2026, 8, 25, 8, 55, 0); // 25/09/2026 08:55
const REF_ENTREGA = new Date(2026, 8, 25, 13, 35, 0); // 13:35 + 5 = previsão 13:40 (o caso "não antes das 2")
const REF_ENTREGA_TARDE = new Date(2026, 8, 25, 13, 55, 0); // 13:55 → previsão 14:10

const MOTORISTA = 'Alex Rivera';
const CLIENTE = 'Maria';
const CAO = 'Thor';

/* ------------------------------------------------------------------ *
 * (a)(b) A FAIXA: 5 antes / 25 depois, e o piso das 14:00 na entrega
 * ------------------------------------------------------------------ */

describe('(a) faixa da busca — 5 min antes, 25 min depois', () => {
  it('o ETA de 12 min vira a faixa 9:00–9:30 (30 min de janela)', () => {
    const faixa = avisoWindow({ now: REF_BUSCA, minutes: 12, phase: 'pickup' });

    expect(faixa.inicioMin).toBe(9 * 60); // 08:55 + 10 (arredondado) − 5 = 09:00
    expect(faixa.fimMin).toBe(9 * 60 + 30); // + 25 = 09:30
    expect(faixa.fimMin - faixa.inicioMin).toBe(AVISO_ANTES_MIN + AVISO_DEPOIS_MIN);
    expect(windowLabel(faixa)).toBe('9:00 and 9:30 AM');
  });

  it('a saudação da manhã é "Good morning" e o texto é o do cliente, palavra por palavra', () => {
    const texto = etaMessageText({
      clientName: CLIENTE,
      driverName: MOTORISTA,
      dogName: CAO,
      phase: 'pickup',
      minutes: 12,
      now: REF_BUSCA,
    });

    expect(texto).toBe(
      `Good morning, ${CLIENTE}! This is ${MOTORISTA} from Pack & Paws Club. I'll be there between 9:00 and 9:30 AM to pick up ${CAO}. Looking forward to another great day with them! 🐶🐾`,
    );
  });
});

describe('(b) faixa da entrega — "Good afternoon" e nunca antes das 14:00', () => {
  it('ETA 13:40 é EMPURRADO para 2:00–2:05 PM (a faixa não começa antes das 2)', () => {
    const faixa = avisoWindow({ now: REF_ENTREGA, minutes: 5, phase: 'dropoff' });

    expect(faixa.inicioMin).toBe(DROPOFF_INICIO_MIN); // 14:00, não 13:35
    expect(faixa.fimMin).toBe(14 * 60 + 5); // a previsão (13:40) + 25 = 14:05
    expect(windowLabel(faixa)).toBe('2:00 and 2:05 PM');
  });

  it('de manhã a faixa também é empurrada para as 14:00 (nunca 9:xx numa entrega)', () => {
    const faixa = avisoWindow({ now: new Date(2026, 8, 25, 9, 0, 0), minutes: 5, phase: 'dropoff' });

    expect(faixa.inicioMin).toBe(DROPOFF_INICIO_MIN);
    expect(windowLabel(faixa)).not.toContain('AM');
  });

  it('entrega normal da tarde: ETA 14:10 → 2:05–2:35 PM com "Good afternoon"', () => {
    const texto = etaMessageText({
      clientName: CLIENTE,
      driverName: MOTORISTA,
      dogName: CAO,
      phase: 'dropoff',
      minutes: 15,
      now: REF_ENTREGA_TARDE,
    });

    expect(texto).toBe(
      `Good afternoon, ${CLIENTE}! This is ${MOTORISTA} from Pack & Paws Club 😊 I'll be dropping off ${CAO} between 2:05 and 2:35 PM. They had a great day with us! 🐶🐾`,
    );
  });

  it('a entrega apertada das 2 continua sendo o texto do cliente (sem "about minutes")', () => {
    const texto = etaMessageText({
      clientName: CLIENTE,
      driverName: MOTORISTA,
      dogName: CAO,
      phase: 'dropoff',
      minutes: 5,
      now: REF_ENTREGA,
    });

    expect(texto).toBe(
      `Good afternoon, ${CLIENTE}! This is ${MOTORISTA} from Pack & Paws Club 😊 I'll be dropping off ${CAO} between 2:00 and 2:05 PM. They had a great day with us! 🐶🐾`,
    );
  });
});

describe('troca de AM/PM na janela (não pode virar AM/AM)', () => {
  it('faixa que cruza o meio-dia mostra os dois sufixos e a saudação da tarde', () => {
    const texto = etaMessageText({
      clientName: CLIENTE,
      driverName: MOTORISTA,
      dogName: CAO,
      phase: 'pickup',
      minutes: 10, // 11:50 + 10 = 12:00
      now: new Date(2026, 8, 25, 11, 50, 0),
    });

    expect(texto).toContain('between 11:55 AM and 12:25 PM');
    expect(texto.startsWith('Good afternoon, Maria!')).toBe(true);
    // O lado dominante é a tarde (26 dos 31 minutos da faixa), então nada de "AM" no fim.
    expect(texto).not.toContain('11:55 and 12:25 AM');
  });
});

/* ------------------------------------------------------------------ *
 * (c)(d) Nomes no texto e o caso do atraso
 * ------------------------------------------------------------------ */

describe('(c) o texto leva o nome do cliente, do cão e do motorista', () => {
  it('os três nomes aparecem no aviso de busca', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: MOTORISTA, dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });

    expect(texto).toContain(`Good morning, ${CLIENTE}!`);
    expect(texto).toContain(`This is ${MOTORISTA} from Pack & Paws Club.`);
    expect(texto).toContain(`to pick up ${CAO}`);
  });

  it('os três nomes aparecem no aviso de entrega', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: MOTORISTA, dogName: CAO, phase: 'dropoff', minutes: 15, now: REF_ENTREGA_TARDE });

    expect(texto).toContain(`Good afternoon, ${CLIENTE}!`);
    expect(texto).toContain(`This is ${MOTORISTA} from Pack & Paws Club 😊`);
    expect(texto).toContain(`I'll be dropping off ${CAO}`);
  });

  it('sem nome do motorista a frase continua correta (nunca "This is  from")', () => {
    const texto = etaMessageText({ clientName: CLIENTE, dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });

    expect(texto).toContain('This is your driver from Pack & Paws Club.');
    expect(texto).not.toContain('This is  from');
  });
});

describe('(d) parada atrasada: diz que está atrasada E mostra a faixa', () => {
  it('busca atrasada mantém "running late" e o horário', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: MOTORISTA, dogName: CAO, phase: 'pickup', minutes: 12, lateMinutes: 10, now: REF_BUSCA });

    expect(texto).toMatch(/running about 10 minutes late/);
    expect(texto).toContain('between 9:00 and 9:30 AM');
    expect(texto).toBe(
      `Good morning, ${CLIENTE}! This is ${MOTORISTA} from Pack & Paws Club. I'm running about 10 minutes late. I'll be there between 9:00 and 9:30 AM to pick up ${CAO}. Looking forward to another great day with them! 🐶🐾`,
    );
  });

  it('entrega atrasada também diz o atraso e a faixa (e continua depois das 2)', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: MOTORISTA, dogName: CAO, phase: 'dropoff', minutes: 5, lateMinutes: 15, now: REF_ENTREGA });

    expect(texto).toMatch(/running about 15 minutes late/);
    expect(texto).toContain('between 2:00 and 2:05 PM');
  });
});

/* ------------------------------------------------------------------ *
 * (e) WhatsApp fora da interface e escolha que deixou de existir
 * ------------------------------------------------------------------ */

describe('(e) sem WhatsApp: um mensageiro só é envio direto', () => {
  const telefone = '+1 415 555 0134';
  const mensagem = `Good morning, ${CLIENTE}! This is ${MOTORISTA} from Pack & Paws Club. I'll be there between 9:00 and 9:30 AM to pick up ${CAO}. Looking forward to another great day with us! 🐶🐾`;

  it('a lista da interface tem um mensageiro e não é o WhatsApp', () => {
    expect(OFFERED_MESSENGERS).toEqual(['sms']);
    expect(OFFERED_MESSENGERS).not.toContain('whatsapp');
  });

  it('com um mensageiro não há escolha: envio direto no SMS', () => {
    expect(messengerChoiceNeeded()).toBe(false);
    expect(defaultMessenger()).toBe('sms');
    // O dia em que a lista tiver dois volta a perguntar (a folha não foi apagada).
    expect(messengerChoiceNeeded(['sms', 'whatsapp'])).toBe(true);
  });

  it('a folha, se aberta, não oferece WhatsApp (só o SMS)', async () => {
    const tela = await render(
      createElement(NotifyOwnerSheet, { visible: true, phone: telefone, message: mensagem, onChoose: () => {}, onClose: () => {} }),
    );

    expect(tela.queryByLabelText('WhatsApp')).toBeNull();
    expect(tela.getByLabelText('Messages (SMS)')).toBeTruthy();
    expect(tela.getByText(mensagem)).toBeTruthy();
  });

  it('o link do mensageiro escolhido continua sendo montado (assinaturas preservadas)', () => {
    expect(linkForChoice('sms', telefone, 'oi')).toBe('sms:+14155550134&body=oi');
    expect(linkForChoice('whatsapp', telefone, 'oi')).toBe('https://wa.me/14155550134?text=oi');
    expect(messengerLink('sms', null, 'oi')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * (f) "+ Add another dog" no cadastro do cliente
 * ------------------------------------------------------------------ */

describe('(f) "+ Add another dog" na edição do cliente', () => {
  const cliente: EditableClient = {
    name: 'Leigh Ann',
    phone: '4155551234',
    address_line_1: '580 California St',
    address_line_2: '',
    city: 'San Francisco',
    state: 'CA',
    postal_code: '94104',
    notes: '',
    special_scheduling_instructions: '',
    latitude: null,
    longitude: null,
  };

  it('o ajudante põe a vírgula que separa os nomes (e não inventa vírgula em campo vazio)', () => {
    expect(seedNextDogName('Luna')).toBe('Luna, ');
    expect(seedNextDogName('Luna,')).toBe('Luna, ');
    expect(seedNextDogName('Luna ,')).toBe('Luna, ');
    expect(seedNextDogName('  Luna  ')).toBe('Luna, ');
    expect(seedNextDogName('')).toBe('');
    expect(seedNextDogName('   ')).toBe('');
  });

  it('o botão existe, é visível na tela e deixa o campo pronto para o próximo cão', async () => {
    const tela = await render(
      createElement(EditClientForm, {
        current: cliente,
        dogs: [],
        instructions: null,
        active: true,
        onSave: () => {},
        onCancel: () => {},
      }),
    );

    const campo = tela.getByLabelText('Add dogs (comma separated)');
    await fireEvent.changeText(campo, 'Kona');
    await fireEvent.press(tela.getByLabelText('+ Add another dog'));

    // O campo fica "Kona, " — o gestor só digita o próximo nome (o formato antigo continua valendo).
    expect(tela.getByLabelText('Add dogs (comma separated)').props.value).toBe('Kona, ');
  });

  it('depois do atalho o formato antigo continua criando um cartão por nome', async () => {
    const tela = await render(
      createElement(EditClientForm, {
        current: cliente,
        dogs: [],
        instructions: null,
        active: true,
        onSave: () => {},
        onCancel: () => {},
      }),
    );

    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'Kona');
    await fireEvent.press(tela.getByLabelText('+ Add another dog'));
    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'Kona, Thor');
    await fireEvent.press(tela.getByLabelText('Add dogs to the list'));

    expect(tela.getAllByDisplayValue('Kona').length).toBeGreaterThan(0);
    expect(tela.getAllByDisplayValue('Thor').length).toBeGreaterThan(0);
  });
});
