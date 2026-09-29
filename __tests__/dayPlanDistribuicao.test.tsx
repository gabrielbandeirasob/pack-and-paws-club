/**
 * CARTÃO "DAY PLAN" DA HOME — a distribuição do pack (pedido do dono, 29/09/2026).
 *
 * Vetor de TELA: o dono pediu *"no day plans o administrador consiga ver a lista do total pack, por
 * exemplo, motorista gabriel ficou com tais cachorros, motorista rafael ficou com tal"*. Aqui se prova
 * que a leitura aparece no cartão da Home, agrupada por pessoa, e que os campos de digitação
 * (local da caminhada + ideia da foto) continuam no lugar.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { DayPlanCard } from '@/features/dashboard/DayPlanCard';
import type { PackRow } from '@/features/dashboard/dayOperation';

const linhas: PackRow[] = [
  { dogId: 'filo', dogName: 'Filó', clientName: 'Amor', serviceType: 'daycare', inPack: true, walkerId: 'gabriel' },
  { dogId: 'luna', dogName: 'Luna', clientName: 'John', serviceType: 'daycare', inPack: true, walkerId: 'gabriel' },
  { dogId: 'mowgli', dogName: 'Mowgli', clientName: 'Leigh Ann', serviceType: 'boarding', inPack: true, walkerId: 'rafael' },
  { dogId: 'kona', dogName: 'Kona', clientName: 'Leigh Ann', serviceType: 'daycare', inPack: true, walkerId: null },
  { dogId: 'cocoa', dogName: 'Cocoa', clientName: 'Sylvie', serviceType: 'daycare', inPack: false, walkerId: null },
];

const membros = [
  { id: 'gabriel', name: 'Gabriel' },
  { id: 'rafael', name: 'Rafael' },
  { id: 'jordan', name: 'Jordan' },
];

const semAcao = { walkLocation: null, photoIdea: null, onSave: jest.fn() };

it('mostra quem ficou com quais cães, agrupado por pessoa, e o que ainda não foi distribuído', async () => {
  const tela = await render(<DayPlanCard {...semAcao} packRows={linhas} members={membros} />);

  expect(tela.getByText('Pack distribution')).toBeTruthy();
  expect(tela.getByText('4 of 5 dogs on the walk')).toBeTruthy();

  expect(tela.getByText('Gabriel · 2')).toBeTruthy();
  expect(tela.getByText('Filó, Luna')).toBeTruthy();
  expect(tela.getByText('Rafael · 1')).toBeTruthy();
  expect(tela.getByText('Mowgli')).toBeTruthy();

  // Quem não ficou com cão nenhum não aparece; o que ninguém pegou aparece no fim, com a dica.
  expect(tela.queryByText('Jordan · 0')).toBeNull();
  expect(tela.getByText('Unassigned · 1')).toBeTruthy();
  expect(tela.getByText('Kona')).toBeTruthy();
  expect(tela.getByText('Assign them in the Total Pack sheet.')).toBeTruthy();

  // O cão tirado do pack (X do gestor) não entra na distribuição.
  expect(tela.queryByText('Cocoa')).toBeNull();
});

it('continua sendo o cartão de digitar o dia (campos e botão no lugar)', async () => {
  const onSave = jest.fn();
  const tela = await render(<DayPlanCard {...semAcao} onSave={onSave} packRows={linhas} members={membros} saved="Saved" />);

  expect(tela.getByText('Day plan')).toBeTruthy();
  expect(tela.getByText('Photo and walk location — decided the day before.')).toBeTruthy();

  await fireEvent.changeText(tela.getByLabelText('Walk location of the day'), 'Golden Gate Park');
  await fireEvent.press(tela.getByLabelText('Save the day plan'));
  expect(onSave).toHaveBeenCalledWith({ walkLocation: 'Golden Gate Park', photoIdea: '' });
  expect(tela.getByText('Saved')).toBeTruthy();
});

it('sem cão no pack (ou cartão montado sem o dia), diz que não há caminhada em vez de lista vazia', async () => {
  const tela = await render(<DayPlanCard {...semAcao} />);
  expect(tela.getByText('No dogs going to the walk on this day.')).toBeTruthy();
  expect(tela.queryByText('Assign them in the Total Pack sheet.')).toBeNull();
});
