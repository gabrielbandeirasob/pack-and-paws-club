/**
 * NOME DO MOTORISTA NA MENSAGEM DO "NOTIFY OWNER" + MODELO EXATO DO DONO (02/10/2026).
 *
 * DEFEITO REAL (áudio do dono, 02/10/2026): a mensagem pronta que abre no "Notify owner" saía assinada
 * com o nome ANTIGO — *"o MEU tá indo como o Rafael com F do João Pedro... Tá indo JP Bueno"* — e
 * continuava assim MESMO depois de o motorista trocar o nome no app: *"alterou o nome do driver, as
 * coisas todas, e a mensagem continua indo como Rafael com F, desgraça!"*. O cliente americano mandava
 * a mensagem para os tutores com o nome errado.
 *
 * A causa era a ORDEM de preferência em `app/(tabs)/driver.tsx`: `user_metadata.full_name` (nome do
 * convite, nunca atualizado pelo app) vinha PRIMEIRO e dava `return` cedo; o `profiles.full_name` — a
 * fonte que a tela Profile edita — só era lido quando os metadados faltavam. A ordem certa mora em
 * `pickDriverDisplayName` e é o que os testes daqui travam (falham se alguém voltar a preferir os
 * metadados).
 *
 * MODELO EXATO DO DONO — copiado literalmente (a saudação numa linha, o resto na linha de baixo; a
 * janela com "–"). Qualquer mudança de palavra aqui é mudança de contrato com o cliente.
 *
 * As horas de referência são FIXAS (new Date(...) em hora LOCAL): nada aqui lê o relógio da máquina.
 */
import { pickDriverDisplayName } from '@/features/driver/driverOrganization';
import { etaMessageText } from '@/features/driver/etaMessage';

/** 25/09/2026 08:55 — com um ETA de 12 min a previsão arredonda para 09:05 (faixa 9:00 –9:30 AM). */
const REF_BUSCA = new Date(2026, 8, 25, 8, 55, 0);
/** 25/09/2026 13:55 — previsão 14:10 (depois das 2, a faixa não é empurrada), faixa 2:05 –2:35 PM. */
const REF_ENTREGA = new Date(2026, 8, 25, 13, 55, 0);

const CLIENTE = 'Maria';
const CAO = 'Thor';

/** O modelo do dono, pick-up, com os campos preenchidos (o "[DRIVER]" é o que está sob teste). */
const MODELO_PICKUP = (motorista: string) =>
  `Good morning, ${CLIENTE}! This is ${motorista} from Pack & Paws Club.\n` +
  `I'll be there between 9:00 –9:30 AM to pick up ${CAO}. Looking forward to another great day with them! 🐶🐾`;

/** O modelo do dono, drop-off, com os campos preenchidos. */
const MODELO_DROPOFF = (motorista: string) =>
  `Good afternoon, ${CLIENTE}! This is ${motorista} from Pack & Paws Club 😊\n` +
  `I'll be dropping off ${CAO} between 2:05 –2:35 PM. They had a great day with us! 🐶🐾`;

/* ------------------------------------------------------------------ *
 * (a) A mensagem assina com o nome do motorista PASSADO (troca o nome → a mensagem muda)
 * ------------------------------------------------------------------ */

describe('(a) a mensagem assina com o nome do motorista que foi passado', () => {
  it('troca o nome do motorista e a mensagem muda junto (busca e entrega)', () => {
    const buscaAlex = etaMessageText({ clientName: CLIENTE, driverName: 'Alex', dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });
    const buscaJordan = etaMessageText({ clientName: CLIENTE, driverName: 'Jordan', dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });

    expect(buscaAlex).toContain('This is Alex from Pack & Paws Club.');
    expect(buscaJordan).toContain('This is Jordan from Pack & Paws Club.');
    expect(buscaAlex).not.toBe(buscaJordan);
    expect(buscaAlex).not.toContain('Jordan');
    expect(buscaJordan).not.toContain('Alex');

    const entrega = etaMessageText({ clientName: CLIENTE, driverName: 'Jordan', dogName: CAO, phase: 'dropoff', minutes: 15, now: REF_ENTREGA });
    expect(entrega).toContain('This is Jordan from Pack & Paws Club 😊');
  });
});

/* ------------------------------------------------------------------ *
 * (b) PICK-UP: comparação LITERAL com o modelo do dono (emojis + janela)
 * ------------------------------------------------------------------ */

describe('(b) pick-up casa o modelo do dono, palavra por palavra', () => {
  it('a string inteira é igual ao modelo (com a quebra de linha, os emojis e a janela)', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: 'Alex', dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });

    expect(texto).toBe(
      "Good morning, Maria! This is Alex from Pack & Paws Club.\nI'll be there between 9:00 –9:30 AM to pick up Thor. Looking forward to another great day with them! 🐶🐾",
    );
    expect(texto).toBe(MODELO_PICKUP('Alex'));
    // A saudação é uma linha; "I'll be there" começa a outra.
    expect(texto.split('\n')).toHaveLength(2);
    expect(texto.split('\n')[1].startsWith("I'll be there between")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * (c) DROP-OFF: comparação LITERAL ("PM", 😊, "They had a great day with us!")
 * ------------------------------------------------------------------ */

describe('(c) drop-off casa o modelo do dono, palavra por palavra', () => {
  it('a string inteira é igual ao modelo (😊, PM e a frase do dia)', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: 'Alex', dogName: CAO, phase: 'dropoff', minutes: 15, now: REF_ENTREGA });

    expect(texto).toBe(
      "Good afternoon, Maria! This is Alex from Pack & Paws Club 😊\nI'll be dropping off Thor between 2:05 –2:35 PM. They had a great day with us! 🐶🐾",
    );
    expect(texto).toBe(MODELO_DROPOFF('Alex'));
    expect(texto).toContain('😊');
    expect(texto).toContain('PM');
    expect(texto).toContain('They had a great day with us!');
    expect(texto.split('\n')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * (d) Sem nome cadastrado: NÃO inventa nome (degrada honestamente)
 * ------------------------------------------------------------------ */

describe('(d) sem nome do motorista não inventa nome', () => {
  it('sem driverName a assinatura vira "your driver" (nunca "This is  from")', () => {
    const busca = etaMessageText({ clientName: CLIENTE, dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });
    expect(busca).toContain('This is your driver from Pack & Paws Club.');
    expect(busca).not.toContain('This is  from');

    const entrega = etaMessageText({ clientName: CLIENTE, dogName: CAO, phase: 'dropoff', minutes: 15, now: REF_ENTREGA });
    expect(entrega).toContain('This is your driver from Pack & Paws Club 😊');
    expect(entrega).not.toContain('This is  from');
  });

  it('nome só com espaços também degrada para "your driver"', () => {
    const texto = etaMessageText({ clientName: CLIENTE, driverName: '   ', dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });
    expect(texto).toContain('This is your driver from Pack & Paws Club.');
  });
});

/* ------------------------------------------------------------------ *
 * A RAIZ DO DEFEITO: a ORDEM de preferência do nome (perfil > vínculo > metadados)
 * ------------------------------------------------------------------ */

describe('pickDriverDisplayName — o nome ATUAL do motorista vence o nome antigo do convite', () => {
  it('o perfil (nome atual, que o motorista edita no app) vence os metadados do convite', () => {
    // Este é o defeito do dono: trocou o nome no app e a mensagem continuava "Rafael"/"JP Bueno".
    expect(pickDriverDisplayName('John Pedro', null, 'Rafael')).toBe('John Pedro');
    expect(pickDriverDisplayName('JP Bueno', null, 'Rafael')).toBe('JP Bueno');
  });

  it('sem nome no perfil, cai no perfil do vínculo ativo (membro do auth.uid())', () => {
    expect(pickDriverDisplayName(null, 'JP Bueno', 'Rafael')).toBe('JP Bueno');
    expect(pickDriverDisplayName('', 'JP Bueno', 'Rafael')).toBe('JP Bueno');
  });

  it('os metadados são o ÚLTIMO recurso (só quando perfil e vínculo vêm vazios)', () => {
    expect(pickDriverDisplayName(null, null, 'Rafael')).toBe('Rafael');
    expect(pickDriverDisplayName('   ', undefined, 'Rafael')).toBe('Rafael');
  });

  it('sem nome nenhum devolve null — a mensagem degrada para "your driver", não inventa', () => {
    expect(pickDriverDisplayName(null, undefined, null)).toBeNull();
    expect(pickDriverDisplayName('', '   ', '')).toBeNull();
    expect(pickDriverDisplayName(undefined, undefined, undefined)).toBeNull();
  });

  it('o nome resolvido é o que assina a mensagem (perfil atual, não o convite)', () => {
    const nome = pickDriverDisplayName('John Pedro', null, 'Rafael')!;
    const texto = etaMessageText({ clientName: CLIENTE, driverName: nome, dogName: CAO, phase: 'pickup', minutes: 12, now: REF_BUSCA });
    expect(texto).toContain('This is John Pedro from Pack & Paws Club.');
    expect(texto).not.toContain('Rafael');
  });
});
