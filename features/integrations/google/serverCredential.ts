/**
 * CREDENCIAL DO GOOGLE NO SERVIDOR — o aparelho entrega o refresh token para a função
 * `google-calendar-token`, que **cifra** (AES-GCM) e guarda. O app nunca o lê de volta.
 *
 * Pedido do dono (áudio de 27/09/2026): "o cliente cancelou no dia, ou um dia antes, dois dias
 * antes… altera lá. Aí você vai ver no calendário vermelho". Com a credencial só no Keychain, nada
 * entra com o app fechado; autorizado em 27/09/2026 a existir no servidor CIFRADA.
 *
 * Contrato (o servidor decide, o aparelho só pergunta):
 *  * `servidorTemCredencial()` → `{ check: true }` responde só um booleano;
 *  * `enviarCredencialAoServidor()` → manda o refresh token do aparelho (TLS) para ser cifrado lá;
 *  * `revogarCredencialDoServidor()` → desconectar na tela apaga a credencial do servidor também.
 *
 * Nenhuma dessas funções explode: sem rede/sem sessão o app segue funcionando como antes (é o mesmo
 * espírito do resto da integração). O que devolvem é o suficiente para a tela avisar.
 */
import { supabase } from '@/lib/supabase';

import { loadTokens } from './tokenStore';

type RespostaDaFuncao = { ok?: boolean; has_credential?: boolean; revoked?: boolean; error?: string };

/**
 * O servidor já tem credencial desta organização?
 * `null` = não deu para saber (função fora do ar, sem rede, sem sessão) — quem chama não deve tratar
 * como "não tem" para não reenviar token em looping.
 */
export async function servidorTemCredencial(): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar-token', {
      body: { check: true },
    });
    if (error) return null;
    // 07/10/2026: a faixa exige prova negativa; payload incompleto também é indeterminado.
    const temCredencial = (data as RespostaDaFuncao | null)?.has_credential;
    return typeof temCredencial === 'boolean' ? temCredencial : null;
  } catch {
    return null;
  }
}

/** Manda o refresh token que está no aparelho. `false` = não havia token válido ou a função recusou. */
export async function enviarCredencialAoServidor(calendarId?: string | null): Promise<boolean> {
  try {
    const tokens = await loadTokens();
    const refreshToken = (tokens?.refreshToken ?? '').trim();
    // Sem refresh token no aparelho não há o que mandar (conta conectada só com access token).
    if (refreshToken.length < 20) return false;
    const { data, error } = await supabase.functions.invoke('google-calendar-token', {
      body: {
        refresh_token: refreshToken,
        email: tokens?.email ?? null,
        calendar_id: calendarId ?? null,
      },
    });
    if (error) return false;
    return Boolean((data as RespostaDaFuncao | null)?.ok);
  } catch {
    return false;
  }
}

/** Apaga a credencial guardada no servidor (chamado quando o gestor desconecta o Google). */
export async function revogarCredencialDoServidor(): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('google-calendar-token', {
      body: { revoke: true },
    });
    if (error) return false;
    return Boolean((data as RespostaDaFuncao | null)?.ok);
  } catch {
    return false;
  }
}
