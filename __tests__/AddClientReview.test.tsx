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
 * MAIS DE UM CÃO NO CADASTRO POR CONTATO (reclamação do cliente, 01/10/2026: *"na hora de adicionar o
 * cliente não consegue adicionar mais de um cachorro, e não tem um botão para adicionar cachorro"*).
 *
 * Antes havia UM campo de texto e a única pista de dois cães era uma frase miúda embaixo ("separe com
 * vírgula"): quem não lesse ficava com um cão só. Agora é um campo por cão, com o botão explícito.
 */
describe('mais de um cachorro ao adicionar o cliente', () => {
  it('tem o botão de adicionar cachorro e um campo por cão', async () => {
    const screen = await render(<AddClientReview initial={input} onSave={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByRole('button', { name: '+ Add another dog' })).toBeTruthy();
    expect(screen.getByLabelText('Dog name')).toBeTruthy();
    // Só um cão: não há o que remover.
    expect(screen.queryByLabelText('Remove dog 1')).toBeNull();
  });

  it('o botão abre o segundo campo, e os dois cães vão no cadastro', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli');
    await fireEvent.press(screen.getByRole('button', { name: '+ Add another dog' }));

    expect(screen.getByLabelText('Dog name 2')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Dog name 2'), 'Kona');

    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
  });

  it('a foto acompanha cada campo (o segundo cão não herda a foto do primeiro)', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/kona.jpg' }] });

    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli');
    await fireEvent.press(screen.getByRole('button', { name: '+ Add another dog' }));
    await fireEvent.changeText(screen.getByLabelText('Dog name 2'), 'Kona');

    await fireEvent.press(screen.getByLabelText('Add photo for Kona'));
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();
    await screen.findByLabelText('Photo of Kona');
    expect(screen.getByLabelText('Add photo for Mowgli')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dogs: ['Mowgli', 'Kona'], dogPhotos: { kona: 'file:///var/mobile/kona.jpg' } }),
    );
  });

  it('remover o campo tira o cão do cadastro', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli');
    await fireEvent.press(screen.getByRole('button', { name: '+ Add another dog' }));
    await fireEvent.changeText(screen.getByLabelText('Dog name 2'), 'Kona');
    await fireEvent.press(screen.getByLabelText('Remove dog 2'));

    expect(screen.queryByLabelText('Dog name 2')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli'] }));
  });

  it('a vírgula dentro de um campo continua valendo (quem já digitava assim não perde nada)', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Mowgli, Kona');
    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dogs: ['Mowgli', 'Kona'] }));
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

/**
 * B2 DA AUDITORIA (02/10/2026): a foto era indexada pelo NOME do cão. Renomear o cão depois de escolher
 * a foto deixava a chave velha no mapa e a miniatura sumia — o cadastro salvava SEM foto. A correção
 * migra a chave junto com o nome digitado.
 */
describe('renomear o cão depois da foto não perde a foto', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a miniatura segue o nome novo e o payload leva a foto', async () => {
    const alertas = capturarAlertas();
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/bob.jpg' }] });

    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(<AddClientReview initial={input} onSave={onSave} onCancel={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Bob');
    await fireEvent.press(screen.getByLabelText('Add photo for Bob'));
    alertas[0].buttons?.find((b) => b.text === 'Choose from library')?.onPress?.();
    await screen.findByLabelText('Photo of Bob');

    // Renomeia para OUTRO nome (não só caixa/acento): a miniatura tem de seguir.
    await fireEvent.changeText(screen.getByLabelText('Dog name'), 'Rex');
    expect(screen.getByLabelText('Photo of Rex')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Add as client' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dogs: ['Rex'], dogPhotos: { rex: 'file:///var/mobile/bob.jpg' } }),
    );
  });
});
