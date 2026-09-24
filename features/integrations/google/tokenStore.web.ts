/**
 * Cofre dos tokens do Google no NAVEGADOR (a versao que o Metro usa no build web).
 *
 * Por que existe: no web `expo-secure-store` e um modulo VAZIO (`export default {}`) e o
 * wrapper do pacote chama `ExpoSecureStore.getValueWithKeyAsync`, que nao existe — por isso
 * `/calendar` estourava `TypeError: getValueWithKeyAsync is not a function` em toda abertura
 * (a tela que renderiza o cartao do calendario chama `loadTokens` na montagem).
 *
 * Aqui a guarda e SO EM MEMORIA (some ao recarregar a pagina): o navegador nao tem Keychain, e
 * gravar o refresh token do Google em localStorage/cookie seria rebaixar a seguranca do cofre —
 * a regra do modulo nativo vale igual aqui ("o refresh token fica SOMENTE no aparelho, nunca no
 * banco nem no bundle"). O app do cliente roda no iOS (Keychain); o build web e ambiente de
 * teste. Com o armazenamento vazio a tela mostra "not connected" em vez de quebrar.
 */
export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch em ms. */
  expiresAt: number;
  email?: string | null;
};

let guardados: StoredTokens | null = null;

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  guardados = { ...tokens };
}

export async function loadTokens(): Promise<StoredTokens | null> {
  return guardados ? { ...guardados } : null;
}

export async function clearTokens(): Promise<void> {
  guardados = null;
}

export function isExpired(tokens: StoredTokens, skewMs = 60_000): boolean {
  return Date.now() + skewMs >= tokens.expiresAt;
}
