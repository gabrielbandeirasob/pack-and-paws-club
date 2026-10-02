/**
 * ORGANIZAÇÃO DO MOTORISTA — o vínculo ativo, independente de haver rota publicada.
 *
 * 🪤 ACHADO DA VISTORIA (02/10/2026): o `organizationId` da tela do motorista só era preenchido
 * DENTRO do `if (route)`. Num dia SEM rota publicada ele ficava nulo e o clock in MANUAL
 * ("esqueci de bater o ponto") era impossível — o app respondia "Organization not found for this
 * account." e o dia de trabalho não tinha como ser registrado. A organização é uma propriedade do
 * VÍNCULO da conta (`organization_members`, status `active`), não da rota.
 *
 * Guarda também a ORDEM de preferência do NOME do motorista que assina o aviso ao tutor
 * (`pickDriverDisplayName`) — o perfil do usuário logado vence os metadados do convite (defeito do dono,
 * 02/10/2026: a mensagem continuava assinando o nome ANTIGO depois que o motorista trocava o nome).
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

/**
 * NOME DO MOTORISTA QUE ASSINA O AVISO AO TUTOR — a ORDEM de preferência (defeito do dono, 02/10/2026).
 *
 * O dono (áudio, 02/10/2026): *"o MEU tá indo como o Rafael com F do João Pedro... Tá indo JP Bueno.
 * (...) alterou o nome do driver, as coisas todas, e a mensagem continua indo como Rafael"*. O nome que
 * ia para o tutor nos EUA era o ANTIGO — gravado nos METADADOS da conta no convite (`user_metadata`),
 * que o app nunca atualizava quando o motorista corrigia o nome. A ORDEM importa:
 *
 *   1. `profiles.full_name` do usuário LOGADO — é a fonte canônica: é o que a tela Profile deixa o
 *      motorista editar (`app/(tabs)/profile.tsx`) e o que o gestor corrige em Team. Depois de trocar o
 *      nome no app, é ESTE que tem de assinar a mensagem.
 *   2. o `profile.full_name` do vínculo ativo do `auth.uid()` (`organization_members` → `profiles`) —
 *      mesma pessoa, caminho de leitura alternativo quando o perfil direto não voltou nome.
 *   3. os metadados da conta — ÚLTIMO recurso, só quando 1 e 2 vierem vazios. É o nome do convite; por
 *      isso ele NUNCA pode vencer o nome atual do perfil (era exatamente ele que continuava saindo).
 *
 * Sem nenhum nome utilizável devolve `null`: a mensagem degrada para "This is your driver from Pack &
 * Paws Club" — nada de inventar (ou repetir) um nome errado para o tutor.
 */
export function pickDriverDisplayName(
  profileName: string | null | undefined,
  memberName: string | null | undefined,
  metadataName: string | null | undefined,
): string | null {
  for (const candidato of [profileName, memberName, metadataName]) {
    if (typeof candidato === 'string' && candidato.trim().length > 0) return candidato.trim();
  }
  return null;
}
