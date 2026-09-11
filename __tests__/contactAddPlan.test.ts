import { planContactAdd, uniqueDogNames, type ExistingContactClient } from '@/features/clients/clientsService';

const semInstrucoes = { pickup_access_instructions: undefined as string | undefined };
const comInstrucoes = { pickup_access_instructions: 'Call box 185. Key inside lockbox.' };

describe('uniqueDogNames', () => {
  it('tira vazios e repeticoes (ignora maiusculas e acentos)', () => {
    expect(uniqueDogNames([' Mowgli ', '', 'kona', 'KONA', 'Mowgli'])).toEqual(['Mowgli', 'kona']);
    expect(uniqueDogNames(['  '])).toEqual([]);
  });
});

describe('planContactAdd — contato novo', () => {
  it('cria o cliente com todos os cachorros digitados (dois caes no mesmo dono)', () => {
    const plan = planContactAdd(null, comInstrucoes, ['Mowgli', 'kona']);
    expect(plan).toEqual({
      mode: 'create',
      clientId: null,
      dogsToAdd: ['Mowgli', 'kona'],
      instructionsToAdd: 'Call box 185. Key inside lockbox.',
    });
  });

  it('nao leva instrucoes quando nao ha nenhuma', () => {
    expect(planContactAdd(null, semInstrucoes, ['Mowgli']).instructionsToAdd).toBeNull();
  });
});

describe('planContactAdd — contato que JA e cliente', () => {
  const existente: ExistingContactClient = { id: 'client-1', name: 'Leigh Ann(Mowgli)', hasInstructions: false, dogs: ['Mowgli'] };

  it('reaproveita o cadastro e acrescenta so o cachorro novo (nao estoura o UNIQUE do contato)', () => {
    const plan = planContactAdd(existente, comInstrucoes, ['Kona']);
    expect(plan).toEqual({
      mode: 'reuse',
      clientId: 'client-1',
      dogsToAdd: ['Kona'],
      instructionsToAdd: 'Call box 185. Key inside lockbox.',
    });
  });

  it('nao repete cachorro que o cliente ja tem, mesmo com acento/maiuscula diferente', () => {
    const comAcento: ExistingContactClient = { ...existente, dogs: ['João'] };
    expect(planContactAdd(comAcento, semInstrucoes, ['joao', 'Kona']).dogsToAdd).toEqual(['Kona']);
  });

  it('nao insere cachorro nenhum quando o nome ja existe (segunda tentativa do mesmo cao)', () => {
    const plan = planContactAdd(existente, semInstrucoes, ['mowgli']);
    expect(plan.mode).toBe('reuse');
    expect(plan.dogsToAdd).toEqual([]);
  });

  it('nao sobrescreve instrucoes de acesso que o cliente ja tem', () => {
    const comInstrucoesRegistradas: ExistingContactClient = { ...existente, hasInstructions: true };
    expect(planContactAdd(comInstrucoesRegistradas, comInstrucoes, ['Kona']).instructionsToAdd).toBeNull();
  });
});
