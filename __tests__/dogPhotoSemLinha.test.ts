/**
 * VISTORIA (02/10/2026) — A FOTO DO CÃO TEM DE FICAR LIGADA AO CÃO.
 *
 * `createDogsWithPhotos` ("Add from Contacts") inseria o cão e depois gravava `photo_url`. Esse
 * UPDATE não conferia linhas: com a policy bloqueando, o PostgREST respondia SUCESSO com 0 linhas e a
 * foto ficava SEM cão (arquivo no bucket, coluna vazia) enquanto o cadastro dizia que subiu.
 * Agora 0 linha = falha: o cão volta em `pendentes` (o cadastro continua salvo, só a foto fica pendente).
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

import { createDogsWithPhotos } from '@/features/dogs/dogPhoto';

const fileSystem = jest.requireMock('expo-file-system/legacy') as { readAsStringAsync: jest.Mock };

/** 2 KB de "foto": precisa passar do mínimo de 1 KB para não ser tratada como arquivo vazio. */
const fotoGrande = `data:image/jpeg;base64,${Buffer.alloc(2048, 7).toString('base64')}`;

/** Cliente falso: insert devolve um id; o UPDATE da foto devolve as linhas configuradas. */
function clienteFalso(updateRows: unknown[]) {
  const insert = jest.fn(() => ({
    select: () => ({ single: () => Promise.resolve({ data: { id: 'dog-id-1' }, error: null }) }),
  }));
  const update = jest.fn(() => ({
    eq: () => ({ select: () => Promise.resolve({ data: updateRows, error: null }) }),
  }));
  const upload = jest.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
  // `dogPhotoPublicUrl` usa `storage.from(bucket).getPublicUrl(path)` — o cliente falso precisa dele,
  // senão o caminho da foto estoura antes de chegar no UPDATE que este teste quer provar.
  const getPublicUrl = jest.fn((path: string) => ({ data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/dog-photos/${path}` } }));
  const storage = { from: jest.fn(() => ({ upload, getPublicUrl })) };
  const client = { storage, from: jest.fn(() => ({ insert, update })) } as never;
  return { client, insert, update };
}

beforeEach(() => jest.clearAllMocks());

const params = { organizationId: 'org-1', clientId: 'c-1', dogs: [{ name: 'Kona', photo: 'file:///var/mobile/kona.jpg' }] };

describe('createDogsWithPhotos — UPDATE da foto confere a linha', () => {
  it('0 linha = a foto NÃO ficou no cão: entra em pendentes e não derruba o cadastro', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue(fotoGrande);
    const { client } = clienteFalso([]); // policy bloqueou: 0 linhas, sem erro
    const resultado = await createDogsWithPhotos(client, params);

    expect(resultado.criados).toBe(1); // o cão ficou salvo
    expect(resultado.pendentes).toHaveLength(1);
    expect(resultado.pendentes[0]).toContain('Kona');
    expect(resultado.pendentes[0]).toContain('not linked');
  });

  it('1 linha grava a foto normalmente (nada em pendentes)', async () => {
    fileSystem.readAsStringAsync.mockResolvedValue(fotoGrande);
    const { client } = clienteFalso([{ id: 'dog-id-1' }]);
    const resultado = await createDogsWithPhotos(client, params);

    expect(resultado).toEqual({ criados: 1, pendentes: [] });
  });
});
