/**
 * STORAGE LOCAL ESCOPADO POR USUÁRIO — a base do isolamento das filas do motorista.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026). As filas locais do motorista (a JORNADA em `pendingWrites` e os
 * PASSOS DA ROTA em `offlineStore`) moravam em chaves GLOBAIS e SEM DONO (`pnp:driver:pending-writes`,
 * `pnp:driver:outbox`, `pnp:driver:route:today`). O dono alterna entre a conta de MOTORISTA e a de
 * ADMINISTRADOR no MESMO aparelho e relatou: *"eu saí da conta e agora fui voltar para dar clock-in de
 * novo… será que… você desloga e ele perde? Mesma coisa aconteceu ontem."* Como a chave não tinha dono,
 * a jornada aberta de um usuário era lida/subida pela conta seguinte — e aí o registro era recusado pela
 * RLS (e DESCARTADO, em silêncio) ou gravado com o `driver_id` errado. A jornada "sumia".
 *
 * A correção: cada chave passa a ter o sufixo `:<userId>` e a fila ANTIGA (sem dono) é ADOTADA **uma
 * única vez** pelo primeiro usuário que abrir — migração de LEITURA, sem perder o que já está no
 * aparelho. Depois de adotada ela fica MARCADA com o dono, e um 2º usuário nunca a herda nem a apaga.
 *
 * Este módulo é puro quanto à DECISÃO (derivação da chave + regra de adoção) e faz o I/O cru; quem usa
 * (jornada e outbox) só escolhe as chaves base e o marcador de dono.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Chave de UM usuário (`base:<id>`). Sem usuário (bootstrap/web), cai na chave legada (`base`). */
export function chaveDeEscopo(base: string, userId: string | null | undefined): string {
  const id = (userId ?? '').trim();
  return id.length > 0 ? `${base}:${id}` : base;
}

export type DecisaoAdocao = {
  /** true = copiar o valor legado (sem dono) para a chave do usuário AGORA. */
  adotar: boolean;
  /** true = o legado está marcado com OUTRO usuário: não adotar e não encostar nele. */
  deOutro: boolean;
};

/**
 * REGRA PURA da migração de leitura:
 *  - a chave DO usuário já existe → vale a dele (nada de re-adotar o legado);
 *  - não existe a dele e existe legado SEM dono (ou já marcado com ELE) → adota o legado;
 *  - o legado está marcado com OUTRO usuário → devolve `deOutro` e não encosta nele.
 */
export function decidirAdocao(entrada: {
  chaveDoUsuarioExiste: boolean;
  legadoExiste: boolean;
  donoDoLegado: string | null;
  userId: string;
}): DecisaoAdocao {
  if (entrada.chaveDoUsuarioExiste || !entrada.legadoExiste) return { adotar: false, deOutro: false };
  if (entrada.donoDoLegado === null || entrada.donoDoLegado === entrada.userId) return { adotar: true, deOutro: false };
  return { adotar: false, deOutro: true };
}

/** Lê o texto cru de uma chave. `null` = a chave nunca existiu (≠ string vazia). */
export async function lerCru(chave: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(chave);
  } catch {
    return null;
  }
}

/** Grava o texto cru de uma chave, best-effort (sem storage, sem fila — nada trava o motorista). */
export async function gravarCru(chave: string, valor: string): Promise<void> {
  try {
    await AsyncStorage.setItem(chave, valor);
  } catch {
    // melhor esforço
  }
}
