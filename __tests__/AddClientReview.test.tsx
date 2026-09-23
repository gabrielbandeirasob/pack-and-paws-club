import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

import { AddClientReview } from '@/features/clients/AddClientReview';
import type { ExistingContactClient } from '@/features/clients/clientsService';
import type { NewClientInput } from '@/features/clients/types';

const picker = jest.requireMock('expo-image-picker') as {
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

type Botao = { text?: string; onPress?: () => void };

function capturarAlertas() {
  const alertas: { title?: string; buttons?: Botao[] }[] = [];
  jest.spyOn(Alert, 'alert').mockImplementation(((title: string, _message?: string, buttons?: Botao[]) => {
    alertas.push({ title, buttons });
  }) as never);
  return alertas;
}

const input: NewClientInput = {
  name: 'Maria Silva',
  phone: '+55 62 99999-0000',
  address_line_1: '123 Main St',
  address_line_2: null,
  city: 'Goiania',
  state: 'GO',
  postal_code: '74000-000',
  source_contact_identifier: 'contact-1',
  pickup_access_instructions: 'Call box 185. Key inside lockbox.',
};

describe('AddClientReview', () => {
  it('shows imported contact data and access instructions', async () => {
    const screen = await render(<AddClientReview initial={input} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Maria Silva')).toBeTruthy();
    expect(screen.getByText('+55 62 99999-0000')).toBeTruthy();
    expect(screen.getByText('123 Main St · Goiania')).toBeTruthy();
    expect(screen.getByText('Call box 185. Key inside lockbox.')).toBeTruthy();
  });

  it('saves the client with no dog (the dog can be added later in the client card)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: [] }));
  });

  it('ja vem com o nome de cachorro lido do contato, e da para editar', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <AddClientReview initial={input} initialDogNames="Mowgli, Kona" onSave={onSave} onCancel={jest.fn()} />,
    );
    expect(screen.getByLabelText('Dog name').props.value).toBe('Mowgli, Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
  });

  it('saves client payload together with the dog', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Bob');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      client: expect.objectContaining({ name: 'Maria Silva' }),
      dogs: ['Bob'],
    }));
  });

  it('accepts two dogs in one field, separated by comma', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli, Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
  });

  it('warns when the contact is already a client and sends the new dog to that record', async () => {
    const existingClient: ExistingContactClient = { id: 'client-1', name: 'Leigh Ann(Mowgli)', hasInstructions: false, dogs: ['Mowgli'] };
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <AddClientReview initial={input} existingClient={existingClient} onSave={onSave} onCancel={jest.fn()} />,
    );
    expect(screen.getByText('ALREADY A CLIENT')).toBeTruthy();
    expect(screen.getByText(/already registered \(dogs: Mowgli\)/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to existing client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Kona'] }));
  });
});

/**
 * FOTO DO CAO no "Add from Contacts" (23/09/2026).
 *
 * Aqui o cao ainda NAO existe no banco quando o gestor escolhe a foto: o nome e digitado num
 * campo so. Por isso a foto viaja num mapa nome -> arquivo local (chave sem caixa/acento) e a
 * tela de clientes sobe o arquivo depois do insert. Estes testes travam justamente isso.
 */
describe('foto do cao no cadastro por contato', () => {
  beforeEach(() => jest.clearAllMocks());

  it('aparece um cartao de foto por nome digitado', async () => {
    const screen = await render(<AddClientReview initial={input} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByLabelText('Add photo for Bob')).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli, Kona');
    expect(screen.getByLabelText('Add photo for Mowgli')).toBeTruthy();
    expect(screen.getByLabelText('Add photo for Kona')).toBeTruthy();
  });

  it('escolher da galeria leva a foto no payload, ligada ao nome do cao', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/kona.jpg' }] });

    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli, Kona');

    await fireEvent.press(screen.getByLabelText('Add photo for Kona'));
    expect(alertas[0].title).toBe("Add Kona's photo");
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();

    await screen.findByLabelText('Photo of Kona');
    expect(screen.getByLabelText('Remove photo of Kona')).toBeTruthy();
    // Mowgli continua sem foto (nao herda a foto do outro)
    expect(screen.getByLabelText('Add photo for Mowgli')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dogs: ['Mowgli', 'Kona'], dogPhotos: { kona: 'file:///var/mobile/kona.jpg' } }),
    );
  });

  it('a foto segue o nome mesmo com caixa diferente digitada depois', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/filo.jpg' }] });

    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Filó');
    await fireEvent.press(screen.getByLabelText('Add photo for Filó'));
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();
    await screen.findByLabelText('Photo of Filó');

    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'FILO');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dogs: ['FILO'], dogPhotos: { filo: 'file:///var/mobile/filo.jpg' } }),
    );
  });

  it('tirar a foto antes de salvar tira o arquivo do payload', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/bob.jpg' }] });

    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Bob');
    await fireEvent.press(screen.getByLabelText('Add photo for Bob'));
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();
    await screen.findByLabelText('Photo of Bob');

    await fireEvent.press(screen.getByLabelText('Remove photo of Bob'));
    expect(screen.queryByLabelText('Photo of Bob')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Bob'], dogPhotos: {} }));
  });
});
