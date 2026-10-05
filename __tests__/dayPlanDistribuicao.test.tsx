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
  // Contagem COMPACTA e COERENTE com o alerta (dono, 05/10/2026): antes era "4 of 5 dogs on the walk"
  // e depois "4/4 assigned" ao lado de "⚠ 1 unassigned" — agora conta quem tem caminhante: 3 de 4.
  expect(tela.getByText('3/4 assigned')).toBeTruthy();

  expect(tela.getByText('Gabriel · 2')).toBeTruthy();
  expect(tela.getByText('Filó, Luna')).toBeTruthy();
  expect(tela.getByText('Rafael · 1')).toBeTruthy();
  expect(tela.getByText('Mowgli')).toBeTruthy();

  // Quem não ficou com cão nenhum não aparece; o que ninguém pegou vira a LINHA DE ALERTA no topo
  // (antes era um grupo "Unassigned · 1" no fim, com a instrução em vez de ação).
  expect(tela.queryByText('Jordan · 0')).toBeNull();
  expect(tela.queryByText('Unassigned · 1')).toBeNull();
  expect(tela.getByText('⚠ 1 unassigned · Kona')).toBeTruthy();
  // A instrução "Assign them in the Total Pack sheet." virou o BOTÃO que abre a folha.
  expect(tela.queryByText('Assign them in the Total Pack sheet.')).toBeNull();
  const onOpenPack = jest.fn();
  const comAcao = await render(<DayPlanCard {...semAcao} packRows={linhas} members={membros} onOpenPack={onOpenPack} />);
  await fireEvent.press(comAcao.getByLabelText('Assign dogs'));
  expect(onOpenPack).toHaveBeenCalledTimes(1);

  // O cão tirado do pack (X do gestor) não entra na distribuição.
  expect(tela.queryByText('Cocoa')).toBeNull();
});

it('continua sendo o cartão de digitar o dia (campos e botão no lugar)', async () => {
  const onSave = jest.fn();
  const tela = await render(<DayPlanCard {...semAcao} onSave={onSave} packRows={linhas} members={membros} saved="Saved" />);

  expect(tela.getByText('Day plan')).toBeTruthy();
  expect(tela.getByText('Photo and walk location — decided the day before.')).toBeTruthy();

  // REVELAÇÃO PROGRESSIVA (dono, 05/10/2026): o cartão abre em LEITURA e o "Edit" revela os campos.
  expect(tela.queryByLabelText('Walk location of the day')).toBeNull();
  await fireEvent.press(tela.getByLabelText('Edit the day plan'));
  await fireEvent.changeText(tela.getByLabelText('Walk location of the day'), 'Golden Gate Park');
  await fireEvent.press(tela.getByLabelText('Save the day plan'));
  expect(onSave).toHaveBeenCalledWith({ walkLocation: 'Golden Gate Park', photoIdea: '' });
  expect(tela.getByText('Saved')).toBeTruthy();
});

it('sem cão no pack (ou cartão montado sem o dia), diz que não há caminhada em vez de lista vazia', async () => {
  const tela = await render(<DayPlanCard {...semAcao} />);
  expect(tela.getByText('No dogs going to the walk on this day.')).toBeTruthy();
  expect(tela.queryByLabelText('Assign dogs')).toBeNull();
});
