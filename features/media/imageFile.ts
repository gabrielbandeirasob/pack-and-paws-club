/**
 * Arquivo de imagem no aparelho: extensao, tipo MIME e leitura em bytes.
 *
 * Por que existe um modulo separado: duas telas ja precisam das MESMAS regras de arquivo
 * (o comprovante de entrega do motorista e a foto do cao no cadastro). Duas copias divergem
 * com o tempo — e uma extensao errada so aparece como falha de upload em producao.
 */
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';

/** Extensao normalizada a partir do caminho local (o padrao do iOS e .jpg). */
export function extensionFor(uri: string): string {
  const match = /\.(jpe?g|png|heic|webp)$/i.exec(uri.split('?')[0] ?? '');
  if (!match) return 'jpg';
  const ext = match[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/** Tipo MIME que o bucket aceita (a politica de storage recusa o que nao for imagem). */
export function contentTypeFor(extension: string): string {
  const ext = extension.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Decodifica base64 para bytes. Escrito a mao (nao usa atob) para funcionar igual no aparelho
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

/** Le o arquivo local e devolve os bytes da imagem (recusa arquivo vazio/truncado). */
export async function readImageBytes(localUri: string): Promise<Uint8Array> {
  const base64 = await readAsStringAsync(localUri, { encoding: EncodingType.Base64 });
  const bytes = base64ToBytes(base64);
  if (!isUsablePhoto(bytes)) throw new Error('The photo came out empty. Please take it again.');
  return bytes;
}
