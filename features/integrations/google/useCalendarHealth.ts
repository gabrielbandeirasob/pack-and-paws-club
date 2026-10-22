import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * SAÚDE DA AGENDA DO GOOGLE (cliente, 21/10/2026).
 *
 * Por que existe: a conexão do cliente morreu em 15/10 (`unauthorized_client` no refresh do token) e
 * ninguém viu — a Home continuou contando 9 cães num dia que tinha 21 no calendário, porque o que
 * está no banco é só o que a importação conseguiu trazer. O gestor só descobria abrindo Integrações.
 *
 * Aqui a Home pergunta ao banco (função `google_calendar_situacao`, que lê a credencial da própria
 * organização) se a última sincronização está velha. O app NUNCA lê a tabela de credenciais direto:
 * ela é fechada para o cliente e o token nunca sai do servidor.
 */

export type CalendarHealth = {
  /** A organização tem uma agenda conectada. */
  conectado: boolean;
  /** Última sincronização passou de 48h (ou nunca houve) — números da Home podem estar incompletos. */
  atrasada: boolean;
  /** Horas desde a última sincronização; null quando nunca sincronizou. */
  horasSemSync: number | null;
  /** Conta do Google conectada (para o texto do aviso). */
  email: string | null;
};

const SAUDAVEL: CalendarHealth = { conectado: false, atrasada: false, horasSemSync: null, email: null };

export function useCalendarHealth(): CalendarHealth {
  const [estado, setEstado] = useState<CalendarHealth>(SAUDAVEL);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('google_calendar_situacao');
        if (!vivo || error || !data) return;
        const bruto = data as {
          conectado?: boolean;
          atrasada?: boolean;
          horas_sem_sync?: number | null;
          email?: string | null;
        };
        setEstado({
          conectado: Boolean(bruto.conectado),
          atrasada: Boolean(bruto.conectado && bruto.atrasada),
          horasSemSync: bruto.horas_sem_sync ?? null,
          email: bruto.email ?? null,
        });
      } catch {
        /* uma Home sem o aviso é melhor do que uma Home quebrada */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}

/** "3 days ago" a partir das horas — texto curto para caber no aviso da Home. */
export function idadeDaSincronizacao(horas: number | null): string {
  if (horas === null) return 'never synced';
  if (horas < 24) return `${Math.max(1, Math.round(horas))}h ago`;
  const dias = Math.floor(horas / 24);
  return `${dias} day${dias === 1 ? '' : 's'} ago`;
}
