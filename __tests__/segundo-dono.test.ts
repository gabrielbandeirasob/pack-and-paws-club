/**
 * SEGUNDO DONO (áudio do dono, 27/09/2026):
 *
 * "cada cachorro tem um dono só, mas existe cachorro que tem pai e mãe… os pais têm a exigência de
 * receber mensagem nos dois números… na hora que o driver clicar em enviar ETA, vai já abrir o grupo
 * ou a mensagem para os dois, não de forma separada, mas num grupo".
 *
 * Aqui se prova a metade pura: quem recebe, como o link do mensageiro fica com dois números (UMA
 * conversa em grupo no iOS) e a saudação com os dois nomes. A parte de tela entra pelos testes do
 * cartão do motorista.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  etaMessageText,
  messengerLink,
  nomesDoAviso,
  recipientsFor,
  smsLink,
} from '@/features/driver/etaMessage';

const PAI = '+1 (415) 555-0100';
const MAE = '+1 (415) 555-0199';

describe('recipientsFor', () => {
  it('junta os dois tutores na ordem do cadastro', () => {
    expect(recipientsFor(PAI, MAE)).toEqual(['+14155550100', '+14155550199']);
  });

  it('descarta vazio/inválido — o cadastro pode ter só um dos dois', () => {
    expect(recipientsFor(null, MAE)).toEqual(['+14155550199']);
    expect(recipientsFor(PAI, null)).toEqual(['+14155550100']);
    expect(recipientsFor('', undefined)).toEqual([]);
  });

  it('não repete o mesmo número duas vezes', () => {
    expect(recipientsFor(PAI, PAI)).toEqual(['+14155550100']);
  });
});

describe('smsLink com dois números', () => {
  it('abre UMA conversa com os dois (números separados por vírgula)', () => {
    const link = smsLink([PAI, MAE], 'oi');
    expect(link).toBe('sms:+14155550100,+14155550199&body=oi');
  });

  it('com um número só, o link é o de sempre', () => {
    expect(smsLink([PAI, null], 'oi')).toBe('sms:+14155550100&body=oi');
    expect(smsLink(PAI, 'oi')).toBe('sms:+14155550100&body=oi');
  });

  it('sem nenhum número utilizável devolve null (nada de mensagem no vácuo)', () => {
    expect(smsLink([null, ''], 'oi')).toBeNull();
    expect(smsLink([], 'oi')).toBeNull();
  });


  it('o SMS pelo messengerLink também sai em grupo', () => {
    expect(messengerLink([PAI, MAE], 'oi')).toBe('sms:+14155550100,+14155550199&body=oi');
  });
});

describe('nomesDoAviso', () => {
  it('com dois tutores, cumprimenta os dois', () => {
    expect(nomesDoAviso('Sarah', 'Mike')).toBe('Sarah and Mike');
  });

  it('com um só, usa o que existe (nunca "and")', () => {
    expect(nomesDoAviso('Sarah', null)).toBe('Sarah');
    expect(nomesDoAviso(null, 'Mike')).toBe('Mike');
    expect(nomesDoAviso('Sarah', '   ')).toBe('Sarah');
  });

  it('sem nenhum, não inventa nome', () => {
    expect(nomesDoAviso(null, null)).toBe('');
  });
});

describe('etaMessageText com o segundo dono', () => {
  const base = {
    driverName: 'Alex',
    dogName: 'Thor',
    minutes: 65,
    now: new Date('2026-09-27T09:00:00'),
  } as const;

  it('a saudação sai com os dois nomes (a mensagem vai numa conversa só)', () => {
    const texto = etaMessageText({ ...base, clientName: 'Sarah', secondOwnerName: 'Mike', phase: 'pickup' });
    expect(texto.startsWith('Good morning, Sarah and Mike!')).toBe(true);
    expect(texto).toContain('between');
    expect(texto).toContain('to pick up Thor');
  });

  it('sem segundo dono, o texto é o de antes', () => {
    const texto = etaMessageText({ ...base, clientName: 'Sarah', phase: 'pickup' });
    expect(texto.startsWith('Good morning, Sarah!')).toBe(true);
  });
});

/**
 * A OUTRA METADE — A CONSULTA (medido em 16/10/2026).
 *
 * O aviso de dois números estava certo e mesmo assim chegava UM destinatário só: a consulta da rota
 * (`app/(tabs)/driver.tsx`) não pedia `second_owner_name`/`second_owner_phone` ao PostgREST, então
 * `rowToStop` recebia `null` nos dois campos e o link do SMS saía com um número. Peça pura verde,
 * dado ausente: o defeito morava no SELECT. Este bloco trava os dois lados do fio.
 */
describe('a consulta da rota entrega os DOIS tutores ao aviso', () => {
  const ler = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  it('a rota do motorista pede os dois campos do cadastro', () => {
    expect(ler('app/(tabs)/driver.tsx')).toContain('second_owner_name, second_owner_phone');
  });

  it('a linha da parada lê os dois campos do cliente', () => {
    const linhas = ler('features/driver/rows.ts');
    expect(linhas).toContain('clientPhone2: client?.second_owner_phone');
    expect(linhas).toContain('secondOwnerName: client?.second_owner_name');
  });
});
