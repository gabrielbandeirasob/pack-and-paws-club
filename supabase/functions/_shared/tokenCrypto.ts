/**
 * CIFRA E DECIFRA O REFRESH TOKEN DO GOOGLE — AES-GCM 256 com a chave em `GOOGLE_TOKEN_KEY`.
 *
 * Pedido do dono (áudio de 27/09/2026) + autorização de 27/09/2026: a credencial passa a existir no
 * servidor para a importação rodar com o app fechado. O que o banco guarda é **texto cifrado**; a
 * chave vive só no segredo do projeto (nunca na tabela, nunca no app, nunca no bundle).
 *
 * Formato do que vai para a coluna: `base64(iv(12 bytes) || ciphertext+tag)`. O IV é novo a cada
 * gravação — cifrar o mesmo token duas vezes dá resultados diferentes (não dá para comparar linhas
 * para descobrir se o token mudou).
 *
 * Sem a chave, o conteúdo não serve para nada: quem levar um dump do banco não leva o acesso ao
 * calendário do cliente.
 */

const SEGREDO = 'GOOGLE_TOKEN_KEY';
const BYTES_DA_CHAVE = 32;

function chave(): Uint8Array {
  const bruto = Deno.env.get(SEGREDO) ?? '';
  if (!bruto) throw new Error(`segredo ${SEGREDO} ausente`);
  const bytes = Uint8Array.from(atob(bruto), (c) => c.charCodeAt(0));
  if (bytes.length !== BYTES_DA_CHAVE) {
    throw new Error(`${SEGREDO} precisa de ${BYTES_DA_CHAVE} bytes em base64 (tem ${bytes.length})`);
  }
  return bytes;
}

async function chaveDeCripto(uso: KeyUsage): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', chave(), { name: 'AES-GCM' }, false, [uso]);
}

export async function cifrarTextoClaro(texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chaveDeCripto('encrypt'), new TextEncoder().encode(texto)),
  );
  const juntos = new Uint8Array(iv.length + cifrado.length);
  juntos.set(iv, 0);
  juntos.set(cifrado, iv.length);
  return btoa(String.fromCharCode(...juntos));
}

export async function decifrarTexto(cifrado: string): Promise<string> {
  const bytes = Uint8Array.from(atob(cifrado), (c) => c.charCodeAt(0));
  if (bytes.length <= 12) throw new Error('conteudo cifrado invalido');
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    await chaveDeCripto('decrypt'),
    bytes.slice(12),
  );
  return new TextDecoder().decode(claro);
}
