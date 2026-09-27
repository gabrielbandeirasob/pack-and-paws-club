/**
 * QUANDO FOI A ÚLTIMA SINCRONIZAÇÃO AUTOMÁTICA — pedido do dono (áudio de 27/09/2026): o escritório
 * cancela direto no Google (evento vermelho) e o gestor precisa ver a mudança **sem tocar em nada**.
 *
 * A marca fica no APARELHO (SecureStore, ao lado dos tokens): ela é sobre ESTE telefone ter acabado
 * de sincronizar — dois gestores abrindo o app não devem sincronizar um atrás do outro. Sem o
 * SecureStore (web e testes) a marca vive em memória e nada quebra.
 */
import * as SecureStore from 'expo-secure-store';

const CHAVE = 'packpaws.google.ultimaSincronizacao.v1';

/** Trava entre sincronizações automáticas: 10 minutos. */
export const JANELA_AUTO_MS = 10 * 60 * 1000;

let memoria: number | null = null;

export async function lerUltimaSincronizacao(): Promise<number | null> {
  try {
    const bruto = await SecureStore.getItemAsync(CHAVE);
    return bruto ? Number(bruto) : memoria;
  } catch {
    return memoria;
  }
}

export async function marcarSincronizacao(quando: number = Date.now()): Promise<void> {
  memoria = quando;
  try {
    await SecureStore.setItemAsync(CHAVE, String(quando));
  } catch {
    // Sem SecureStore (web/testes): a memória acima já cumpre o papel.
  }
}

/** Esquece a marca (usado ao desconectar a conta e nos testes). */
export async function esquecerSincronizacao(): Promise<void> {
  memoria = null;
  try {
    await SecureStore.deleteItemAsync(CHAVE);
  } catch {
    // idem
  }
}

/**
 * Vale sincronizar sozinho agora? Puro de propósito: recebe a última marca e "agora" de fora, para o
 * teste não depender de relógio nem de armazenamento.
 */
export function precisaSincronizar(
  ultima: number | null,
  janelaMs: number = JANELA_AUTO_MS,
  agora: number = Date.now(),
): boolean {
  if (ultima === null) return true;
  if (!Number.isFinite(ultima)) return true;
  return agora - ultima >= janelaMs;
}
