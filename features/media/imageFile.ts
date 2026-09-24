/**
 * Arquivo de imagem no aparelho: extensao, tipo MIME e leitura em bytes.
 *
 * Por que existe um modulo separado: duas telas ja precisam das MESMAS regras de arquivo
 * (o comprovante de entrega do motorista e a foto do cao no cadastro). Duas copias divergem
 * com o tempo — e uma extensao errada so aparece como falha de upload em producao.
 */
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/** Tipo MIME -> extensao do arquivo. A politica do bucket so aceita imagem. */
const EXTENSAO_POR_TIPO: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
};

/**
 * Extensao normalizada a partir do caminho local (o padrao do iOS e .jpg).
 *
 * Tres origens, nesta ordem:
 *  1. o TIPO informado pelo seletor de fotos — no navegador o arquivo chega como `blob:` e nao
 *     tem extensao nenhuma no caminho; sem isso uma foto PNG seria gravada como `.jpg`;
 *  2. Data URL (`data:image/png;base64,...`) — o tipo esta dentro do proprio caminho;
 *  3. o nome do arquivo (iOS/Android), com o padrao do iOS quando nao houver nada.
 */
export function extensionFor(uri: string, mimeType?: string | null): string {
  const tipo = (mimeType ?? '').trim().toLowerCase();
  if (EXTENSAO_POR_TIPO[tipo]) return EXTENSAO_POR_TIPO[tipo];

  const tipoNoDataUrl = /^data:image\/([a-z0-9.+-]+)/i.exec(uri.trim())?.[1]?.toLowerCase();
  if (tipoNoDataUrl) {
    return EXTENSAO_POR_TIPO[`image/${tipoNoDataUrl}`] ?? (tipoNoDataUrl === 'jpeg' ? 'jpg' : tipoNoDataUrl);
  }

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

/** Bytes de um arquivo do aparelho (iOS/Android): o modulo nativo devolve base64. */
async function bytesDoArquivo(localUri: string): Promise<Uint8Array> {
  return base64ToBytes(await readAsStringAsync(localUri, { encoding: EncodingType.Base64 }));
}

/**
 * Bytes de um arquivo do NAVEGADOR.
 *
 * O `expo-file-system` nao existe no web (o modulo web e vazio, `readAsStringAsync` lanca
 * `UnavailabilityError`), mas la o caminho do seletor de fotos e um `blob:` do proprio
 * navegador — e o `fetch` le esses bytes (vale tambem para `data:`). O `fetch` entra por
 * parametro para o teste dirigir a resposta sem navegador de verdade.
 */
export async function readImageBytesWeb(localUri: string, buscar: typeof fetch = fetch): Promise<Uint8Array> {
  const resposta = await buscar(localUri);
  if (!resposta.ok) throw new Error('The photo could not be read on this device.');
  return new Uint8Array(await resposta.arrayBuffer());
}

/** Le o arquivo local e devolve os bytes da imagem (recusa arquivo vazio/truncado). */
export async function readImageBytes(localUri: string): Promise<Uint8Array> {
  const bytes = Platform.OS === 'web' ? await readImageBytesWeb(localUri) : await bytesDoArquivo(localUri);
  if (!isUsablePhoto(bytes)) throw new Error('The photo came out empty. Please take it again.');
  return bytes;
}
