/**
 * DIA DA OPERAÇÃO — vetores das regras puras (26/09/2026).
 *
 * O que estes testes travam, item por item do áudio:
 *  - 5 indicadores: daycare, boarding, total de cães (sem repetir), pack (caminhada) e faturamento;
 *  - o X do pack tira o cão da CAMINHADA do dia e não mexe em nada mais;
 *  - quem caminha pode ser diferente de quem pega na rota (lista por caminhante);
 *  - dinheiro digitado à mão: aceita os dois separadores, guarda centavos inteiros, vazio é `null`.
 */
import {
  dogsOfDay,
  dogsWalkingWith,
  dayIndicators,
  formatCents,
  limparTexto,
  nextTodoPosition,
  packRows,
  parseMoneyToCents,
  pendingTodos,
  sortTodos,
  type DailyTodo,
  type DayDog,
  type PackEntry,
} from '../features/dashboard/dayOperation';

const THOR: DayDog = { dogId: 'thor', dogName: 'Thor', clientName: 'Ana', serviceType: 'daycare' };
const NINA: DayDog = { dogId: 'nina', dogName: 'Nina', clientName: 'Juliana', serviceType: 'daycare' };
const MOWGLI: DayDog = { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'boarding' };

describe('cães do dia e pack (caminhada)', () => {
  it('o mesmo cão em boarding e daycare conta UMA vez, e vale boarding', () => {
    const todos = dogsOfDay([THOR], [{ ...THOR, serviceType: 'boarding' }]);
    expect(todos).toHaveLength(1);
    expect(todos[0].serviceType).toBe('boarding');
  });

  it('sem nenhuma linha de pack, TODO cão do dia vai para a caminhada', () => {
    const linhas = packRows([THOR, NINA], []);
    expect(linhas.every((linha) => linha.inPack)).toBe(true);
    expect(linhas.every((linha) => linha.walkerId === null)).toBe(true);
  });

  it('o X tira o cão do pack do dia sem tocar nos outros', () => {
    const entries: PackEntry[] = [{ dogId: 'nina', inPack: false, walkerId: null }];
    const linhas = packRows([THOR, NINA], entries);
    expect(linhas.find((linha) => linha.dogId === 'nina')?.inPack).toBe(false);
    expect(linhas.find((linha) => linha.dogId === 'thor')?.inPack).toBe(true);
  });

  it('lista a caminhada de CADA membro (quem pega na rota pode não ser quem caminha)', () => {
    const entries: PackEntry[] = [
      { dogId: 'thor', inPack: true, walkerId: 'driver-b' },
      { dogId: 'nina', inPack: false, walkerId: 'driver-b' },
      { dogId: 'mowgli', inPack: true, walkerId: 'driver-a' },
    ];
    const linhas = packRows([THOR, NINA, MOWGLI], entries);
    expect(dogsWalkingWith(linhas, 'driver-b').map((linha) => linha.dogId)).toEqual(['thor']);
    expect(dogsWalkingWith(linhas, 'driver-a').map((linha) => linha.dogId)).toEqual(['mowgli']);
  });
});

describe('os 5 indicadores do dia', () => {
  it('conta daycare, boarding, total de cães e pack (o que sobra depois dos X)', () => {
    const entries: PackEntry[] = [{ dogId: 'mowgli', inPack: false, walkerId: null }];
    const numeros = dayIndicators([THOR, NINA], [MOWGLI], entries, 123456);
    expect(numeros).toEqual({ daycare: 2, boarding: 1, totalDogs: 3, pack: 2, revenueCents: 123456 });
  });

  it('faturamento não digitado é null (≠ zero)', () => {
    expect(dayIndicators([THOR], [], [], null).revenueCents).toBeNull();
  });
});

describe('faturamento digitado à mão', () => {
  it('aceita os dois formatos e centavos parciais', () => {
    expect(parseMoneyToCents('1,234.56')).toBe(123456);
    expect(parseMoneyToCents('1.234,56')).toBe(123456);
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
    expect(parseMoneyToCents('1234')).toBe(123400);
    expect(parseMoneyToCents('1234.5')).toBe(123450);
    expect(parseMoneyToCents('0.99')).toBe(99);
  });

  it('vazio ou sem número é null; zero digitado é zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('   ')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('0')).toBe(0);
  });

  it('volta para o campo no formato do app', () => {
    expect(formatCents(123456)).toBe('1,234.56');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(99)).toBe('0.99');
    expect(formatCents(null)).toBe('');
  });
});

describe('to-do list do dia', () => {
  const itens: DailyTodo[] = [
    { id: 'b', text: 'Protocolar prong', done: false, position: 1 },
    { id: 'a', text: 'Pagar Wisiwash', done: true, position: 0 },
    { id: 'c', text: 'Projeto QuinzaL', done: false, position: 2 },
  ];

  it('ordena pela posição e conta os abertos (bolinha do menu)', () => {
    expect(sortTodos(itens).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(pendingTodos(itens)).toBe(2);
  });

  it('a próxima posição é sempre o fim da lista', () => {
    expect(nextTodoPosition(itens)).toBe(3);
    expect(nextTodoPosition([])).toBe(0);
  });
});

describe('texto guardado', () => {
  it('junta espaços, corta no limite e vazio vira null', () => {
    expect(limparTexto('  Yard   de Goiânia \n')).toBe('Yard de Goiânia');
    expect(limparTexto('   ')).toBeNull();
    expect(limparTexto('x'.repeat(600), 200)?.length).toBe(200);
  });
});
