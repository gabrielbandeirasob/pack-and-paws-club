/**
 * FOTO DO CAO (23/09/2026) — o app nao tinha como anexar foto em nenhum lugar.
 *
 * O que estes testes travam:
 *  - o caminho no bucket comeca pelo id da ORGANIZACAO (e o que a politica de storage le);
 *  - a URL publica guardada no banco volta a virar caminho (para trocar/apagar o arquivo);
 *  - "foto nova" (arquivo do aparelho) e diferente de "foto ja guardada" (URL do bucket):
 *    e essa distincao que decide o que sobe no salvamento;
 *  - erro de permissao/rede vira frase que o gestor entende, nunca o texto cru do sistema.
 */
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

import {
  DOG_PHOTO_BUCKET,
  deleteDogPhoto,
  dogPhotoError,
  dogPhotoPath,
  dogPhotoPublicUrl,
  dogPhotoStoragePath,
  dogPhotoValueAfterUpload,
  isLocalPhoto,
  isStoredPhoto,
  pickDogPhoto,
  uploadDogPhoto,
} from '@/features/dogs/dogPhoto';

const fileSystem = jest.requireMock('expo-file-system/legacy') as { readAsStringAsync: jest.Mock };
const picker = jest.requireMock('expo-image-picker') as {
  requestCameraPermissionsAsync: jest.Mock;
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchCameraAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

/** 2 KB de "foto": precisa passar do minimo de 1 KB para nao ser tratada como arquivo vazio. */
const fotoGrande = `data:image/jpeg;base64,${Buffer.alloc(2048, 7).toString('base64')}`;

const ORG = 'org-1';
const DOG = 'dog-1';
const URL_PUBLICA = `https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/${DOG_PHOTO_BUCKET}/${ORG}/${DOG}/2026-09-23T10-00-00-000Z.jpg`;

function clienteFake(overrides: Record<string, jest.Mock> = {}) {
  const upload = jest.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
  const remove = jest.fn().mockResolvedValue({ data: [{ name: 'ok' }], error: null });
  const getPublicUrl = jest.fn().mockImplementation((path: string) => ({
    data: { publicUrl: `https://bhuexxjcrjdhkmsvagdw.supabase.co/storage/v1/object/public/${DOG_PHOTO_BUCKET}/${path}` },
  }));
  const from = jest.fn().mockReturnValue({ upload, remove, getPublicUrl, ...overrides });
  return { client: { storage: { from } } as never, from, upload, remove, getPublicUrl };
}

beforeEach(() => jest.clearAllMocks());

describe('caminho do arquivo no bucket', () => {
  it('comeca pela organizacao e termina com o cao e o carimbo', () => {
    const caminho = dogPhotoPath(ORG, DOG, 'file:///var/mobile/foto.jpg');
    expect(caminho.startsWith(`${ORG}/${DOG}/`)).toBe(true);
    expect(caminho.endsWith('.jpg')).toBe(true);
  });

  it('nao deixa dois-pontos nem ponto extra no horario (quebraria o caminho)', () => {
    const caminho = dogPhotoPath(ORG, DOG, 'file:///t/foto.JPEG', new Date('2026-09-23T10:11:12.345Z'));
    expect(caminho).toBe(`${ORG}/${DOG}/2026-09-23T10-11-12-345Z.jpg`);
  });
});

describe('foto nova (aparelho) x foto guardada (bucket)', () => {
  it('reconhece o arquivo local do aparelho', () => {
    expect(isLocalPhoto('file:///var/mobile/foto.jpg')).toBe(true);
    expect(isLocalPhoto('content://media/external/images/1')).toBe(true);
    expect(isLocalPhoto('ph://ABC-123')).toBe(true);
    expect(isLocalPhoto(URL_PUBLICA)).toBe(false);
    expect(isLocalPhoto(null)).toBe(false);
    expect(isLocalPhoto('')).toBe(false);
  });

  it('extrai o caminho de dentro da URL publica (para apagar o arquivo antigo)', () => {
    expect(dogPhotoStoragePath(URL_PUBLICA)).toBe(`${ORG}/${DOG}/2026-09-23T10-00-00-000Z.jpg`);
    expect(isStoredPhoto(URL_PUBLICA)).toBe(true);
    expect(dogPhotoStoragePath('https://exemplo.com/foto.jpg')).toBeNull();
    expect(dogPhotoStoragePath(null)).toBeNull();
  });

  it('monta a URL publica a partir do caminho', () => {
    const { client, from } = clienteFake();
    const url = dogPhotoPublicUrl(client, `${ORG}/${DOG}/x.jpg`);
    expect(from).toHaveBeenCalledWith(DOG_PHOTO_BUCKET);
    expect(url).toContain(`/${DOG_PHOTO_BUCKET}/${ORG}/${DOG}/x.jpg`);
  });

  it('depois de subir, guarda o caminho novo; sem foto nova, mantem o que ja estava', () => {
    expect(dogPhotoValueAfterUpload('file:///local.jpg', `${ORG}/${DOG}/novo.jpg`)).toBe(`${ORG}/${DOG}/novo.jpg`);
    expect(dogPhotoValueAfterUpload(URL_PUBLICA, null)).toBe(URL_PUBLICA);
    expect(dogPhotoValueAfterUpload(null, null)).toBeNull();
  });
});

describe('escolher a foto', () => {
  it('sem permissao de camera, avisa em vez de abrir a camera', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickDogPhoto('camera')).rejects.toThrow(/permission/i);
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    expect(dogPhotoError(new Error('Camera permission denied.'))).toBe(
      'Allow camera/photos access in Settings to attach the dog photo.',
    );
  });

  it('desistir na galeria devolve null (nao apaga a foto que ja estava)', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    await expect(pickDogPhoto('library')).resolves.toBeNull();
  });

  it('devolve o caminho local da foto escolhida', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///var/mobile/luna.jpg' }] });
    await expect(pickDogPhoto('library')).resolves.toBe('file:///var/mobile/luna.jpg');
  });
});

describe('subir e apagar o arquivo', () => {
  it('sobe os bytes no bucket certo, com o tipo da imagem', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue(fotoGrande);
    const { client, upload } = clienteFake();
    const caminho = `${ORG}/${DOG}/x.jpg`;
    await expect(uploadDogPhoto(client, 'file:///local.jpg', caminho)).resolves.toBe(caminho);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(caminho);
    expect((upload.mock.calls[0][1] as Uint8Array).length).toBeGreaterThan(1024);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg', upsert: true });
  });

  it('foto vazia nao sobe (e o erro chega em portugues para o gestor)', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue('data:image/jpeg;base64,AAAA');
    const { client, upload } = clienteFake();
    await expect(uploadDogPhoto(client, 'file:///local.jpg', 'org/dog/x.jpg')).rejects.toThrow(/empty/i);
    expect(upload).not.toHaveBeenCalled();
    expect(dogPhotoError(new Error('The photo came out empty. Please take it again.'))).toBe(
      'The photo came out empty. Please take it again.',
    );
  });

  it('apaga pelo caminho tirado da URL publica', async () => {
    const { client, remove } = clienteFake();
    await expect(deleteDogPhoto(client, URL_PUBLICA)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith([`${ORG}/${DOG}/2026-09-23T10-00-00-000Z.jpg`]);
  });

  it('URL que nao e do bucket nem toca no storage (nao inventa caminho)', async () => {
    const { client, from } = clienteFake();
    await expect(deleteDogPhoto(client, 'https://outro.com/foto.jpg')).resolves.toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('falha ao apagar nao estoura: arquivo orfao nao pode travar o salvamento', async () => {
    const { client, remove } = clienteFake();
    remove.mockRejectedValue(new Error('network'));
    await expect(deleteDogPhoto(client, URL_PUBLICA)).resolves.toBe(false);
  });

  it('erro de rede explica que a foto nao subiu e o que fazer', () => {
    expect(dogPhotoError(new Error('Network request failed'))).toBe(
      'No connection: the dog photo was not uploaded. Try saving again when you have signal.',
    );
    expect(dogPhotoError(new Error('algo estranho'))).toBe('algo estranho');
    expect(dogPhotoError(undefined)).toBe('Could not attach the dog photo.');
  });
});
