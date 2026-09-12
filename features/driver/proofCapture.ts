import type { SupabaseClient } from '@supabase/supabase-js';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

/**
 * Comprovante de entrega (foto no embarque e na entrega).
 *
 * Por que existe: no mercado, o comprovante é o que encerra disputa ("o cão chegou bem?").
 * Decisões que importam:
 *  - a creche escolhe se a foto é OBRIGATÓRIA (configuração na organização); obrigatório bloqueia
 *    o passo do motorista, opcional apenas oferece;
 *  - o caminho no bucket começa com o id da ORGANIZAÇÃO porque é isso que a política do storage
 *    usa para isolar uma creche da outra;
 *  - se não houver rede, o motorista não perde nada: a foto fica na fila local e sobe depois
 *    (o upload é feito pelo sincronizador, não pelo toque no botão).
 */

export const PROOF_BUCKET = 'stop-proofs';

export type ProofKind = 'pickup' | 'dropoff';

export type ProofSettings = {
  proof_pickup_required: boolean;
  proof_dropoff_required: boolean;
};

export type ProofChoice = 'camera' | 'library';

/** Qual comprovante cada ação exige. Ações que não registram prova devolvem null. */
export function proofKindForAction(action: string): ProofKind | null {
  if (action === 'picked_up') return 'pickup';
  if (action === 'completed') return 'dropoff';
  return null;
}

/** A creche exige o comprovante neste passo? Sem configuração carregada, nunca travamos o motorista. */
export function proofRequired(kind: ProofKind, settings: ProofSettings | null | undefined): boolean {
  if (!settings) return false;
  return kind === 'pickup' ? settings.proof_pickup_required : settings.proof_dropoff_required;
}

/** Coluna do banco que guarda o comprovante (pickup -> pickup_proof_path). */
export function proofColumn(kind: ProofKind, what: 'path' | 'at'): string {
  return `${kind}_proof_${what}`;
}

export function extensionFor(uri: string): string {
  const match = /\.(jpe?g|png|heic|webp)$/i.exec(uri.split('?')[0] ?? '');
  if (!match) return 'jpg';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

export function contentTypeFor(extension: string): string {
  const ext = extension.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** Caminho no bucket. Primeira pasta = organização (é o que a política de storage lê). */
export function proofPath(
  organizationId: string,
  stopId: string,
  kind: ProofKind,
  uri: string,
  when: Date = new Date(),
): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `${organizationId}/${stopId}/${kind}-${stamp}.${extensionFor(uri)}`;
}

/**
 * Decodifica base64 para bytes. Escrito à mão (não usa atob) para funcionar igual no aparelho
 * e no teste, e para o erro de foto corrompida ser tratado em vez de estourar.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const limpo = base64.replace(/^data:[^;]+;base64,/, '').replace(/[\r\n\s]/g, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of limpo) {
    if (character === '=') break;
    const value = ALPHABET.indexOf(character);
    if (value === -1) throw new Error('Invalid base64 image data.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export function isUsablePhoto(bytes: Uint8Array): boolean {
  return bytes.length > 1024; // abaixo disso é arquivo vazio/truncado
}

/** Lê o arquivo local e devolve os bytes da imagem. */
export async function readProofBytes(localUri: string): Promise<Uint8Array> {
  const base64 = await readAsStringAsync(localUri, { encoding: EncodingType.Base64 });
  const bytes = base64ToBytes(base64);
  if (!isUsablePhoto(bytes)) throw new Error('The photo came out empty. Please take it again.');
  return bytes;
}

/** Sobe a foto e devolve o caminho gravado. Lança em caso de falha (quem chama decide). */
export async function uploadProof(
  client: SupabaseClient,
  localUri: string,
  path: string,
): Promise<string> {
  const bytes = await readProofBytes(localUri);
  const { error } = await client.storage.from(PROOF_BUCKET).upload(path, bytes, {
    contentType: contentTypeFor(extensionFor(localUri)),
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Abre a câmera ou a galeria e devolve o caminho LOCAL do arquivo (null se o motorista desistir).
 * O upload não acontece aqui de propósito: com o motorista sem sinal, a foto precisa ficar na fila.
 */
export async function captureProofPhoto(choice: ProofChoice): Promise<string | null> {
  if (choice === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera permission denied.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: false,
    });
    return result.canceled ? null : (result.assets?.[0]?.uri ?? null);
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photos permission denied.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
  });
  return result.canceled ? null : (result.assets?.[0]?.uri ?? null);
}

/** Traduz o erro de permissão/upload para uma frase que o motorista entende. */
export function proofErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/permission/i.test(message)) return 'Allow camera/photos access in Settings to attach the proof photo.';
  if (/empty/i.test(message)) return 'The photo came out empty. Please take it again.';
  if (/network|fetch|timeout|internet/i.test(message)) return 'No connection: the photo is saved on your device and will be sent automatically.';
  return message || 'Could not attach the proof photo.';
}
