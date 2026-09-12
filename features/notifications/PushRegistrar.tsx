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
      if (!cancelado && resultado.token) tokenRef.current = resultado.token;
    };
    executar();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  useEffect(() => {
    return onNotificationTap((data) => {
      const rota = routeForNotificationData(data);
      if (rota) router.push(rota as never);
    });
  }, [router]);

  return null;
}
