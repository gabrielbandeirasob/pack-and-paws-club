import type { SupabaseClient } from '@supabase/supabase-js';
import * as ImagePicker from 'expo-image-picker';

import { contentTypeFor, extensionFor, readImageBytes } from '@/features/media/imageFile';

/**
 * As regras de ARQUIVO de imagem (extensao, MIME, base64 -> bytes) moram em
 * features/media/imageFile.ts: a foto do cao no cadastro usa exatamente as mesmas.
 * Reexportadas aqui para nao quebrar quem ja importava deste modulo.
 */
export { base64ToBytes, contentTypeFor, extensionFor, isUsablePhoto } from '@/features/media/imageFile';

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

/** Foto escolhida no aparelho: o caminho local e o tipo que o seletor informou. */
export type CapturedPhoto = { uri: string; mimeType: string | null };

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

/**
 * Caminho no bucket. Primeira pasta = organização (é o que a política de storage lê).
 * O `mimeType` entra porque no navegador o caminho do arquivo e um `blob:` sem extensao.
 */
export function proofPath(
  organizationId: string,
  stopId: string,
  kind: ProofKind,
  uri: string,
  when: Date = new Date(),
  mimeType?: string | null,
): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  return `${organizationId}/${stopId}/${kind}-${stamp}.${extensionFor(uri, mimeType)}`;
}

/** Le o arquivo local e devolve os bytes da imagem (mesma regra da foto do cao). */
export async function readProofBytes(localUri: string): Promise<Uint8Array> {
  return readImageBytes(localUri);
}

/** Sobe a foto e devolve o caminho gravado. Lança em caso de falha (quem chama decide). */
export async function uploadProof(
  client: SupabaseClient,
  localUri: string,
  path: string,
  mimeType?: string | null,
): Promise<string> {
  const bytes = await readProofBytes(localUri);
  const { error } = await client.storage.from(PROOF_BUCKET).upload(path, bytes, {
    contentType: contentTypeFor(extensionFor(localUri, mimeType)),
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Foto escolhida no seletor: caminho local + tipo (o seletor do navegador devolve `blob:`). */
function fotoDoSeletor(asset: { uri?: string | null; mimeType?: string | null } | undefined): CapturedPhoto | null {
  if (!asset?.uri) return null;
  return { uri: asset.uri, mimeType: asset.mimeType ?? null };
}

/**
 * Abre a câmera ou a galeria e devolve a foto escolhida (null se o motorista desistir).
 * O upload não acontece aqui de propósito: com o motorista sem sinal, a foto precisa ficar na fila.
 */
export async function captureProofPhoto(choice: ProofChoice): Promise<CapturedPhoto | null> {
  if (choice === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera permission denied.');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: false,
    });
    return result.canceled ? null : fotoDoSeletor(result.assets?.[0]);
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Photos permission denied.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
  });
  return result.canceled ? null : fotoDoSeletor(result.assets?.[0]);
}

/** Traduz o erro de permissão/upload para uma frase que o motorista entende. */
export function proofErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/permission/i.test(message)) return 'Allow camera/photos access in Settings to attach the proof photo.';
  if (/empty/i.test(message)) return 'The photo came out empty. Please take it again.';
  if (/network|fetch|timeout|internet/i.test(message)) return 'No connection: the photo is saved on your device and will be sent automatically.';
  return message || 'Could not attach the proof photo.';
}

/** O que fazer quando a gravação do passo falha (regra pura: quem chama só executa). */
export type ProofFailureHandling = 'queue' | 'without-photo' | 'revert';

/**
 * Decide o destino de um passo que NÃO gravou:
 *  - 'queue' — falha de rede: a fila local existe para isso; o passo (com a foto) sobe depois;
 *  - 'without-photo' — falha de arquivo/permissão e a foto era OPCIONAL: vale gravar o passo sem
 *    ela, porque o motorista podia ter pulado a foto de qualquer forma;
 *  - 'revert' — qualquer outra falha (inclusive foto OBRIGATÓRIA): nada é enfileirado em silêncio
 *    e o cartão volta ao estado do banco, com o motivo na tela.
 *
 * A regra existe separada porque o erro antigo era exatamente este: a tela marcava "Completed",
 * o banco ficava com o status e SEM o carimbo da foto, e o motorista lia "sem conexão" — mesmo
 * com rede — porque qualquer falha caía no mesmo caminho da fila offline.
 */
export function proofFailureHandling(params: {
  networkError: boolean;
  hasProof: boolean;
  proofRequired: boolean;
}): ProofFailureHandling {
  if (params.networkError) return 'queue';
  if (params.hasProof && !params.proofRequired) return 'without-photo';
  return 'revert';
}
