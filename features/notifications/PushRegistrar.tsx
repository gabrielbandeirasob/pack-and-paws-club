/**
 * Registra este aparelho para push quando ha usuario logado e desregistra ao sair.
 * Tambem manda o usuario para a tela certa quando ele toca na notificacao.
 * Nao desenha nada.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { routeForNotificationData } from '@/features/notifications/pushPayload';
import {
  configureForegroundNotifications,
  initialNotificationData,
  onNotificationTap,
  registerDeviceForPush,
  unregisterDeviceForPush,
} from '@/features/notifications/pushRegistration';
import { supabase } from '@/lib/supabase';

export function PushRegistrar() {
  const { session } = useAuth();
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    configureForegroundNotifications();
  }, []);

  useEffect(() => {
    let cancelado = false;
    const executar = async () => {
      if (!userId) {
        if (tokenRef.current) {
          await unregisterDeviceForPush(tokenRef.current);
          tokenRef.current = null;
        }
        return;
      }
      const { data } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      const organizationId = data?.organization_id as string | undefined;
      if (!organizationId) return;

      const resultado = await registerDeviceForPush({ userId, organizationId });
      if (cancelado) return;
      if (resultado.token) {
        tokenRef.current = resultado.token;
        return;
      }
      /**
       * ACHADO DA AUDITORIA DE INTEGRACOES (02/10/2026): o `reason` era DESCARTADO aqui — o aparelho
       * ficava sem push (permissao negada, por exemplo) e nem o usuario nem o suporte sabiam por que.
       * Agora o motivo vai para o registro do app.
       */
      if (resultado.reason) {
        console.warn(`[push] this device is not registered for notifications: ${resultado.reason}`);
      }
    };
    executar();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  useEffect(() => {
    const tratados = new Set<string>();
    const irPara = (data: unknown) => {
      // O listener e a resposta inicial podem entregar o MESMO toque (app aberto pela notificacao):
      // sem esta trava o app navegaria duas vezes.
      const chave = JSON.stringify(data ?? null);
      if (tratados.has(chave)) return;
      tratados.add(chave);
      const rota = routeForNotificationData(data);
      if (rota) router.push(rota as never);
    };
    const cancelar = onNotificationTap(irPara);
    // COLD START (achado da auditoria, 02/10/2026): com o app FECHADO, o listener nao ve o toque que
    // abriu o app — a resposta fica em `getLastNotificationResponseAsync` e o usuario caia na Home em
    // vez da tela da rota.
    void (async () => {
      const data = await initialNotificationData();
      if (data) irPara(data);
    })();
    return () => cancelar();
  }, [router]);

  return null;
}
