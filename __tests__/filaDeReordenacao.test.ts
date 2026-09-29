import { criarFilaDeEscrita, trocarNaOrdem } from '@/features/dispatch/reorderQueue';

const paradas = [{ dogId: 'Luna', sequence: 3 }, { dogId: 'Max', sequence: 7 }, { dogId: 'Filó', sequence: 9 }];

it('troca e renumera sem alterar as paradas originais', () => {
  expect(trocarNaOrdem(paradas, 'Max', -1)).toEqual([
    { dogId: 'Max', sequence: 1 }, { dogId: 'Luna', sequence: 2 }, { dogId: 'Filó', sequence: 3 },
  ]);
  expect(paradas[0].sequence).toBe(3);
  expect(trocarNaOrdem(paradas, 'Max', 1)?.map((p) => p.dogId)).toEqual(['Luna', 'Filó', 'Max']);
});

it('recusa as pontas e cães inexistentes', () => {
  expect(trocarNaOrdem(paradas, 'Luna', -1)).toBeNull();
  expect(trocarNaOrdem(paradas, 'Filó', 1)).toBeNull();
  expect(trocarNaOrdem(paradas, 'Zara', 1)).toBeNull();
});

it('junta toques e nunca escreve simultaneamente na mesma rota', async () => {
  const confirmar: (() => void)[] = [];
  const escrever = jest.fn(() => new Promise<void>((resolve) => confirmar.push(resolve)));
  const fila = criarFilaDeEscrita<string[]>({ escrever });
  const fim = fila.enfileirar('rota', ['Max', 'Luna', 'Filó']);
  await Promise.resolve();
  fila.enfileirar('rota', ['Max', 'Filó', 'Luna']);
  fila.enfileirar('rota', ['Filó', 'Max', 'Luna']);
  expect(escrever).toHaveBeenCalledTimes(1);
  expect(fila.pendente('rota')).toBe(true);
  confirmar[0]();
  await Promise.resolve();
  expect(escrever).toHaveBeenCalledTimes(2);
  expect(escrever).toHaveBeenLastCalledWith('rota', ['Filó', 'Max', 'Luna']);
  confirmar[1]();
  await fim;
  expect(fila.pendente('rota')).toBe(false);
});

it('rotas independentes avançam e uma falha libera a fila sem enviar intenção velha', async () => {
  let rejeitar!: (erro: Error) => void;
  const escrever = jest.fn((rota: string) => rota === 'rota'
    ? new Promise<void>((_, reject) => { rejeitar = reject; }) : Promise.resolve());
  const fila = criarFilaDeEscrita<string[]>({ escrever });
  const fim = fila.enfileirar('rota', ['Luna']);
  await Promise.resolve();
  fila.enfileirar('rota', ['Max']);
  await fila.enfileirar('outra', ['Mowgli']);
  rejeitar(new Error('stale_route'));
  await expect(fim).rejects.toThrow('stale_route');
  expect(escrever).toHaveBeenCalledTimes(2);
  expect(fila.pendente('rota')).toBe(false);
});
