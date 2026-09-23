/**
 * FOTO DO CAO na tela de edicao do cliente (23/09/2026).
 *
 * Bug relatado pelo Gabriel: "nao vi opcao de adicionar fotos dos cachorros" — de fato o
 * app nao tinha foto em lugar nenhum. Estes testes travam a opcao que passou a existir:
 *  - cada cao mostra a foto (ou o espaco para adicionar) e o botao certo;
 *  - escolher uma foto nova marca "novo upload" e sai no payload;
 *  - tirar a foto nao apaga o cao;
 *  - "Add dogs" cria CARTAO por nome (antes o nome ia direto para o banco e a foto so seria
 *    possivel abrindo o cliente de novo), com foto/raca/notas antes de salvar.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

import { EditClientForm, type ClientSavePayload, type EditableDog } from '@/features/clients/EditClientForm';
import type { EditableClient } from '@/features/clients/clientsService';

const picker = jest.requireMock('expo-image-picker') as {
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

const FOTO_GUARDADA = 'https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/dog-photos/org-1/dog-1/mowgli.jpg';

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

const caes: EditableDog[] = [
  { id: 'dog-1', name: 'Mowgli', breed: 'Poodle', behavior_notes: '', medical_notes: '', photo_url: FOTO_GUARDADA },
  { id: 'dog-2', name: 'Luna', breed: '', behavior_notes: '', medical_notes: '', photo_url: null },
];

type Botao = { text?: string; onPress?: () => void };

function capturarAlertas() {
  const alertas: { title?: string; message?: string; buttons?: Botao[] }[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    alertas.push({ title: title as string, message: message as string | undefined, buttons: buttons as Botao[] });
  });
  return alertas;
}

function montarTela(onSave: (payload: ClientSavePayload) => void = () => {}) {
  return render(
    <EditClientForm
      current={cliente}
      dogs={caes}
      instructions={null}
      active
      saving={false}
      error={null}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('foto de cada cao no cadastro', () => {
  it('mostra a foto que ja esta no bucket e o espaco para quem ainda nao tem', async () => {
    const tela = await montarTela();
    expect(tela.getByLabelText('Photo of Mowgli')).toBeTruthy();
    expect(tela.getByLabelText('Change photo for Mowgli')).toBeTruthy();
    expect(tela.queryByLabelText('Photo of Luna')).toBeNull();
    expect(tela.getByLabelText('Add photo for Luna')).toBeTruthy();
  });

  it('escolher da galeria marca a foto nova (e avisa que sobe ao salvar)', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/luna-nova.jpg' }] });

    const tela = await montarTela();
    await fireEvent.press(tela.getByLabelText('Add photo for Luna'));
    expect(alertas[0].title).toBe("Add Luna's photo");

    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();

    await waitFor(() => expect(tela.getByLabelText('Photo of Luna')).toBeTruthy());
    await waitFor(() => expect(tela.getByText('New photo — uploaded when you save the client.')).toBeTruthy());
    expect(tela.getByLabelText('Remove photo of Luna')).toBeTruthy();
  });

  it('tirar a foto deixa o cao no cadastro (so a foto sai)', async () => {
    const tela = await montarTela();
    await fireEvent.press(tela.getByLabelText('Remove photo of Mowgli'));

    await waitFor(() => expect(tela.queryByLabelText('Photo of Mowgli')).toBeNull());
    expect(tela.getByLabelText('Add photo for Mowgli')).toBeTruthy();
    // o cao continua na tela, com os campos dele
    expect(tela.getAllByDisplayValue('Mowgli').length).toBeGreaterThan(0);
  });
});

describe('caes novos: cartao antes de salvar', () => {
  it('"Add dogs" cria um cartao por nome digitado (com foto, raca e notas)', async () => {
    const salvo: ClientSavePayload[] = [];
    const tela = await montarTela((payload) => salvo.push(payload));

    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'Kona, Thor');
    await fireEvent.press(tela.getByLabelText('Add dogs to the list'));

    await waitFor(() => expect(tela.getAllByDisplayValue('Kona').length).toBeGreaterThan(0));
    expect(tela.getAllByDisplayValue('Thor').length).toBeGreaterThan(0);
    expect(tela.getAllByText(/NEW/).length).toBe(2);

    await fireEvent.press(tela.getByLabelText('Save client'));
    await waitFor(() => expect(salvo.length).toBe(1));
    expect(salvo[0].newDogs.map((dog) => dog.name)).toEqual(['Kona', 'Thor']);
  });

  it('nao cria cartao para cao que o cliente ja tem', async () => {
    const salvo: ClientSavePayload[] = [];
    const tela = await montarTela((payload) => salvo.push(payload));

    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'luna');
    await fireEvent.press(tela.getByLabelText('Add dogs to the list'));

    await fireEvent.press(tela.getByLabelText('Save client'));
    await waitFor(() => expect(salvo.length).toBe(1));
    expect(salvo[0].newDogs).toEqual([]);
  });

  it('cartao novo com foto escolhida leva o arquivo local no payload', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/kona.jpg' }] });

    const salvo: ClientSavePayload[] = [];
    const tela = await montarTela((payload) => salvo.push(payload));

    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'Kona');
    await fireEvent.press(tela.getByLabelText('Add dogs to the list'));
    await waitFor(() => expect(tela.getByLabelText('Add photo for Kona')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Add photo for Kona'));
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();
    await waitFor(() => expect(tela.getByLabelText('Photo of Kona')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Save client'));
    await waitFor(() => expect(salvo.length).toBe(1));
    expect(salvo[0].newDogs[0]).toMatchObject({ name: 'Kona', photo_url: 'file:///var/mobile/kona.jpg' });
  });

  it('desistir do cartao novo nao leva nada para o banco', async () => {
    const salvo: ClientSavePayload[] = [];
    const tela = await montarTela((payload) => salvo.push(payload));

    await fireEvent.changeText(tela.getByLabelText('Add dogs (comma separated)'), 'Kona');
    await fireEvent.press(tela.getByLabelText('Add dogs to the list'));
    await waitFor(() => expect(tela.getByLabelText('Remove Kona')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Remove Kona'));
    await waitFor(() => expect(tela.queryByDisplayValue('Kona')).toBeNull());

    await fireEvent.press(tela.getByLabelText('Save client'));
    await waitFor(() => expect(salvo.length).toBe(1));
    expect(salvo[0].newDogs).toEqual([]);
  });
});
