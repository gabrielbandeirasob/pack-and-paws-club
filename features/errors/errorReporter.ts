/**
 * Envio dos erros do app para o banco. Sempre "melhor esforco": se o envio falhar, o app
 * segue normalmente (monitoramento nunca pode derrubar a operacao).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { buildErrorReport } from '@/features/errors/errorPayload';
import { supabase } from '@/lib/supabase';

export async function reportError(error: unknown, context?: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const sessao = data?.session;
    let organizationId: string | null = null;

    if (sessao?.user?.id) {
      const { data: vinculo } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', sessao.user.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      organizationId = (vinculo?.organization_id as string | undefined) ?? null;
    }

    const relatorio = buildErrorReport({
      error,
      context,
      userId: sessao?.user?.id ?? null,
      organizationId,
      appVersion: (Constants?.expoConfig?.version as string | undefined) ?? null,
      platform: Platform.OS,
    });

    const { error: falha } = await supabase.from('client_errors').insert(relatorio);
    return !falha;
  } catch {
    return false;
  }
}

type ErrorUtilsLike = {
  getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
};

let instalado = false;

/** Captura qualquer erro nao tratado do app (fora das telas) e registra. */
export function installGlobalErrorHandler(): void {
  if (instalado) return;
  instalado = true;

  const utils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;

  const anterior = utils.getGlobalHandler?.();
  utils.setGlobalHandler((erro, fatal) => {
    void reportError(erro, { origem: 'global', fatal: Boolean(fatal) });
    if (anterior) anterior(erro, fatal);
  });
}
