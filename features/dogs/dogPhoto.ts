/**
 * FOTO DO CAO no cadastro do cliente.
 *
 * Por que existe: quem trabalha na creche identifica o cao PELA FOTO — na porta do cliente
 * ("é esse mesmo?"), no embarque e na devolucao. O campo `dogs.photo_url` existe desde o
 * schema inicial e nenhuma tela escrevia nele; a unica captura de imagem do app era o
 * comprovante de entrega do motorista.
 *
 * Decisoes que importam:
 *  - bucket proprio e PUBLICO ('dog-photos', migration 023): a foto aparece em miniatura na
 *    ficha do cliente e na parada do motorista, entao a URL precisa ser direta. O caminho
 *    carrega dois uuids (organizacao + cao) — nao é enumeravel, e foto de cachorro nao tem
 *    dado pessoal. O comprovante de entrega continua em bucket privado com link assinado,
 *    porque aquele e registro de prova.
 *  - o app guarda a URL publica em `dogs.photo_url` (e o nome da coluna) e deriva o caminho
 *    de volta com dogPhotoStoragePath() para apagar o arquivo antigo.
 *  - o primeiro diretorio do caminho e o id da ORGANIZACAO: e o que a politica de storage le
 *    para isolar uma creche da outra.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';

import { contentTypeFor, extensionFor, readImageBytes } from '@/features/media/imageFile';

export const DOG_PHOTO_BUCKET = 'dog-photos';

export type DogPhotoChoice = 'camera' | 'library';

/** Marcador da URL publica de um objeto dentro do bucket. */
const PUBLIC_MARKER = `/object/public/${DOG_PHOTO_BUCKET}/`;

/** Foto quadrada e leve: é miniatura de lista, nao é impressao. */
const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
};

/** Caminho no bucket: <organizacao>/<cao>/<carimbo>.<ext>. */
export function dogPhotoPath(organizationId: string, dogId: string, uri: string, when: Date = new Date()): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `${organizationId}/${dogId}/${stamp}.${extensionFor(uri)}`;
}

/** URL publica do arquivo (o bucket e publico: vale na hora, sem link assinado). */
export function dogPhotoPublicUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(DOG_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Caminho do arquivo a partir da URL publica guardada no banco (null = nao é do bucket). */
export function dogPhotoStoragePath(publicUrl: string | null | undefined): string | null {
  const url = (publicUrl ?? '').trim();
  const at = url.indexOf(PUBLIC_MARKER);
  if (at === -1) return null;
  const path = url.slice(at + PUBLIC_MARKER.length).split('?')[0].trim();
  return path.length > 0 ? path : null;
}

/** Foto escolhida no aparelho e ainda NAO enviada (file://, content://, ph://, data:). */
export function isLocalPhoto(value: string | null | undefined): boolean {
  return /^(file|content|ph|assets-library|blob|data):/i.test((value ?? '').trim());
}

/** Foto que ja esta no bucket (URL publica do dog-photos). */
export function isStoredPhoto(value: string | null | undefined): boolean {
  return dogPhotoStoragePath(value) !== null;
}

/**
 * O que gravar em `dogs.photo_url` depois do salvamento:
 * - foto escolhida agora (local) -> caminho no bucket, ja enviada;
 * - foto que ja estava la -> a mesma URL (nada a fazer);
 * - sem foto -> null (o arquivo antigo e apagado por quem chama, com deleteDogPhoto).
 */
export function dogPhotoValueAfterUpload(current: string | null | undefined, uploaded: string | null): string | null {
  return uploaded ?? current ?? null;
}

/** Abre a camera ou a galeria e devolve o caminho LOCAL do arquivo (null se desistir). */
export async function pickDogPhoto(choice: DogPhotoChoice): Promise<string | null> {
  if (choice === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera permission denied.');
    const result = await ImagePicker.launchCameraAsync(PHOTO_OPTIONS);
    return result.canceled ? null : (result.assets?.[0]?.uri ?? null);
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photos permission denied.');
  const result = await ImagePicker.launchImageLibraryAsync(PHOTO_OPTIONS);
  return result.canceled ? null : (result.assets?.[0]?.uri ?? null);
}

/** Sobe a foto para o caminho informado e devolve o caminho gravado. */
export async function uploadDogPhoto(client: SupabaseClient, localUri: string, path: string): Promise<string> {
  const bytes = await readImageBytes(localUri);
  const { error } = await client.storage.from(DOG_PHOTO_BUCKET).upload(path, bytes, {
    contentType: contentTypeFor(extensionFor(localUri)),
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Sobe a foto quando o valor e um arquivo do APARELHO e devolve o que gravar em
 * `dogs.photo_url` (URL publica do bucket). Foto que ja esta no bucket passa direto e `null`
 * continua `null` — quem apaga o arquivo antigo e quem chama (deleteDogPhoto).
 *
 * Usado pelas duas telas que cadastram cao: a ficha do cliente e o "Add from Contacts".
 */
export async function storeDogPhoto(
  client: SupabaseClient,
  organizationId: string,
  dogId: string,
  valor: string | null | undefined,
): Promise<string | null> {
  if (!isLocalPhoto(valor)) return valor ?? null;
  const local = valor as string;
  try {
    const caminho = dogPhotoPath(organizationId, dogId, local);
    await uploadDogPhoto(client, local, caminho);
    return dogPhotoPublicUrl(client, caminho);
  } catch (reason) {
    throw new Error(dogPhotoError(reason));
  }
}

/**
 * Cria os caes de um cliente e sobe a foto de cada um.
 *
 * Usado pelo "Add from Contacts" (o cao nasce ali, junto com o cliente). O cao e inserido
 * PRIMEIRO porque o caminho da foto no bucket carrega o id dele; depois o arquivo sobe e a linha
 * e atualizada com a URL publica.
 *
 * Falha de FOTO nao derruba o cadastro: ela volta em `pendentes` (com a frase que o gestor
 * entende) e o cliente/cao continuam salvos — perder o cadastro inteiro por causa de uma foto
 * seria pior. Falha de INSERT, sim, estoura (nao ha cadastro nenhum para salvar).
 */
export async function createDogsWithPhotos(
  client: SupabaseClient,
  params: { organizationId: string; clientId: string; dogs: { name: string; photo: string | null }[] },
): Promise<{ criados: number; pendentes: string[] }> {
  const pendentes: string[] = [];
  let criados = 0;
  for (const dog of params.dogs) {
    const { data, error } = await client
      .from('dogs')
      .insert({ organization_id: params.organizationId, client_id: params.clientId, name: dog.name })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    criados += 1;
    const dogId = (data as { id: string } | null)?.id;
    if (!dogId || !dog.photo) continue;
    try {
      const foto = await storeDogPhoto(client, params.organizationId, dogId, dog.photo);
      if (!foto) continue;
      const { error: fotoError } = await client.from('dogs').update({ photo_url: foto }).eq('id', dogId);
      if (fotoError) throw new Error(fotoError.message);
    } catch (reason) {
      pendentes.push(`${dog.name} (${reason instanceof Error ? reason.message : 'photo failed'})`);
    }
  }
  return { criados, pendentes };
}

/**
 * Apaga o arquivo da foto (troca de foto ou cao removido do cadastro).
 * Best-effort de proposito: arquivo orfao no bucket nao pode impedir o usuario de salvar.
 */
export async function deleteDogPhoto(client: SupabaseClient, publicUrl: string | null | undefined): Promise<boolean> {
  const path = dogPhotoStoragePath(publicUrl);
  if (!path) return false;
  try {
    const { error } = await client.storage.from(DOG_PHOTO_BUCKET).remove([path]);
    return !error;
  } catch {
    return false;
  }
}

/** Traduz o erro de permissao/arquivo/upload para uma frase que o gestor entende. */
export function dogPhotoError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/permission/i.test(message)) return 'Allow camera/photos access in Settings to attach the dog photo.';
  if (/empty/i.test(message)) return 'The photo came out empty. Please take it again.';
  if (/network|fetch|timeout|internet|failed to fetch/i.test(message)) {
    return 'No connection: the dog photo was not uploaded. Try saving again when you have signal.';
  }
  return message || 'Could not attach the dog photo.';
}
