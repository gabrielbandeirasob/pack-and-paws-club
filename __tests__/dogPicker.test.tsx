/**
 * Seletor de cao: busca (sem acento), agrupamento por cliente e o componente de verdade
 * (abrir o painel, buscar, escolher).
 */
import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { DogPicker } from '@/features/calendar/DogPicker';
import { agruparPorCliente, filtrarCaes, resumoDaBusca, semAcento } from '@/features/calendar/dogPickerSearch';
import type { DogRef } from '@/features/calendar/dayMath';

const CAES: DogRef[] = [
  { id: '1', dogName: 'Filó', clientName: 'Amor' },
  { id: '2', dogName: 'Melanie', clientName: 'Amor' },
  { id: '3', dogName: 'Rogério Guedes', clientName: 'Dygão' },
  { id: '4', dogName: 'Soko', clientName: 'Elisha Ma (Mocha)' },
  { id: '5', dogName: 'Mocha', clientName: 'Elisha Ma (Mocha)' },
];

describe('funcoes de busca e agrupamento', () => {
  it('tira acento e maiuscula', () => {
    expect(semAcento('Filó')).toBe('filo');
    expect(semAcento('Dygão')).toBe('dygao');
    expect(semAcento('  ROGÉRIO  ')).toBe('rogerio');
    expect(semAcento('Elisha Ma (Mocha)')).toBe('elisha ma (mocha)');
  });

  it('acha pelo nome do cao sem acento', () => {
    expect(filtrarCaes(CAES, 'filo').map((c) => c.dogName)).toEqual(['Filó']);
    expect(filtrarCaes(CAES, 'ROGERIO').map((c) => c.dogName)).toEqual(['Rogério Guedes']);
  });

  it('acha tambem pelo nome do cliente (mesmo com varios caes)', () => {
    expect(filtrarCaes(CAES, 'elisha').map((c) => c.dogName)).toEqual(['Soko', 'Mocha']);
    expect(filtrarCaes(CAES, 'amor').map((c) => c.dogName)).toEqual(['Filó', 'Melanie']);
  });

  it('termo vazio ou so espaco devolve todos', () => {
    expect(filtrarCaes(CAES, '')).toHaveLength(5);
    expect(filtrarCaes(CAES, '   ')).toHaveLength(5);
  });

  it('nao achou nada devolve lista vazia (nao chuta)', () => {
    expect(filtrarCaes(CAES, 'zzz')).toEqual([]);
  });

  it('agrupa por cliente em ordem alfabetica, com os caes ordenados', () => {
    const grupos = agruparPorCliente(CAES);
    expect(grupos.map((g) => g.cliente)).toEqual(['Amor', 'Dygão', 'Elisha Ma (Mocha)']);
    expect(grupos[0].caes.map((c) => c.dogName)).toEqual(['Filó', 'Melanie']);
    expect(grupos[2].caes.map((c) => c.dogName)).toEqual(['Mocha', 'Soko']); // ordenado: Mocha antes de Soko
  });

  it('cliente sem nome nao some da lista', () => {
    const grupos = agruparPorCliente([{ id: '9', dogName: 'Toby', clientName: '' }]);
    expect(grupos[0].cliente).toBe('Sem cliente');
  });

  it('resumo mostra total e, com busca, quantos foram encontrados', () => {
    expect(resumoDaBusca(5, 5, '')).toBe('5 dogs');
    expect(resumoDaBusca(1, 1, '')).toBe('1 dog');
    expect(resumoDaBusca(5, 2, 'amor')).toBe('2 of 5 dogs');
  });
});

/** Envolve o seletor com estado, como o formulario faz. */
function Harness({ onPicked }: { onPicked?: (d: DogRef) => void }) {
  const [escolhido, setEscolhido] = useState<DogRef | null>(null);
  return (
    <>
      <Text>atual: {escolhido ? `${escolhido.clientName} · ${escolhido.dogName}` : 'nenhum'}</Text>
      <DogPicker
        dogs={CAES}
        selected={escolhido}
        onSelect={(cao) => {
          setEscolhido(cao);
          onPicked?.(cao);
        }}
      />
    </>
  );
}

describe('DogPicker na tela', () => {
  it('abre o painel e mostra os caes agrupados por cliente', async () => {
    const tela = await render(<Harness />);
    expect(tela.getByText('atual: nenhum')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Select dog'));

    expect(tela.getByText('Select dog')).toBeTruthy(); // titulo do painel
    expect(tela.getByText('5 dogs')).toBeTruthy(); // resumo no topo do painel
    expect(tela.getByText('Amor')).toBeTruthy();
    expect(tela.getByText('Elisha Ma (Mocha)')).toBeTruthy();
    expect(tela.getByText('Rogério Guedes')).toBeTruthy();
  });

  it('busca filtra sem acento e escolher fecha o painel', async () => {
    const escolhidos: DogRef[] = [];
    const tela = await render(<Harness onPicked={(d) => escolhidos.push(d)} />);

    await fireEvent.press(tela.getByLabelText('Select dog'));
    await fireEvent.changeText(tela.getByLabelText('Search dog or client'), 'dyg');

    expect(tela.getByText('Rogério Guedes')).toBeTruthy();
    expect(tela.queryByText('Melanie')).toBeNull(); // o filtro tirou os outros
    expect(tela.getByText('1 of 5 dogs')).toBeTruthy();

    await fireEvent.press(tela.getByLabelText('Select Rogério Guedes of Dygão'));

    expect(escolhidos.map((d) => d.dogName)).toEqual(['Rogério Guedes']);
    expect(tela.getByText('atual: Dygão · Rogério Guedes')).toBeTruthy();
    expect(tela.queryByText('Select dog')).toBeNull(); // painel fechou
  });

  it('avisa quando a busca nao acha nada', async () => {
    const tela = await render(<Harness />);
    await fireEvent.press(tela.getByLabelText('Select dog'));
    await fireEvent.changeText(tela.getByLabelText('Search dog or client'), 'zzz');
    expect(tela.getByText('No dogs found for “zzz”.')).toBeTruthy();
  });

  it('cancelar fecha sem escolher', async () => {
    const escolhidos: DogRef[] = [];
    const tela = await render(<Harness onPicked={(d) => escolhidos.push(d)} />);
    await fireEvent.press(tela.getByLabelText('Select dog'));
    await fireEvent.press(tela.getByLabelText('Cancel dog selection'));
    expect(escolhidos).toHaveLength(0);
    expect(tela.getByText('atual: nenhum')).toBeTruthy();
  });
});
