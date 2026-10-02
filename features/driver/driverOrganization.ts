/**
 * ORGANIZAÇÃO DO MOTORISTA — o vínculo ativo, independente de haver rota publicada.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): o `organizationId` da tela do motorista só era preenchido
 * DENTRO do `if (route)`. Num dia SEM rota publicada ele ficava nulo e o clock in MANUAL
 * ("esqueci de bater o ponto") era impossível — o app respondia "Organization not found for this
 * account." e o dia de trabalho não tinha como ser registrado. A organização é uma propriedade do
 * VÍNCULO da conta (`organization_members`, status `active`), não da rota.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Id da organização do vínculo ATIVO do motorista, ou null quando não há vínculo/erro. */
export async function resolveDriverOrganizationId(
  client: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await client
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const organizationId = (data as { organization_id?: string | null } | null)?.organization_id ?? null;
  return typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : null;
}
