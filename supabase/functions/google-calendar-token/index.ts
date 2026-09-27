/**
 * GUARDA (e apaga) A CREDENCIAL DO GOOGLE NO SERVIDOR — chamada pelo app no momento em que o gestor
 * conecta (ou desconecta) a conta Google.
 *
 * Por que existe (áudio do dono, 27/09/2026): "o cliente cancelou no dia, ou um dia antes, dois dias
 * antes… altera lá. Aí você vai ver no calendário vermelho". Com a credencial só no aparelho, a
 * importação morre quando o app fecha. Autorizado em 27/09/2026 a guardar no servidor, CIFRADO.
 *
 * Regras:
 *  * só um MANAGER ativo da organização manda credencial (o app manda o JWT do próprio gestor; a
 *    organização sai do vínculo dele, NUNCA do corpo da requisição — senão um gestor de outra
 *    organização gravaria credencial no tenant alheio);
 *  * o token chega em claro por TLS e é cifrado AQUI (AES-GCM); o app nunca mais o lê de volta;
 *  * `{ "revoke": true }` apaga a linha: desconectar na tela tira o acesso do servidor também;
 *  * a resposta nunca devolve token — nem cifrado, nem o e-mail mais do que o necessário.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { cifrarTextoClaro } from '../_shared/tokenCrypto.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Organização do gestor que está chamando (do VÍNCULO ativo, não do corpo). */
async function organizacaoDoGestor(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .eq('role', 'manager')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data?.organization_id ?? null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: usuario, error: erroUsuario } = await admin.auth.getUser(
    authorization.replace(/^Bearer\s+/i, ''),
  );
  if (erroUsuario || !usuario?.user) return json({ error: 'unauthorized' }, 401);

  const organizationId = await organizacaoDoGestor(admin, usuario.user.id);
  if (!organizationId) return json({ error: 'forbidden' }, 403);

  const corpo = (await request.json().catch(() => ({}))) as {
    refresh_token?: string;
    email?: string;
    calendar_id?: string;
    revoke?: boolean;
    check?: boolean;
  };

  /**
   * O aparelho pergunta se o servidor JÁ tem a credencial (o app não consegue ler a tabela — é o
   * desenho): só assim ele sabe se precisa mandar o token que está no Keychain. Não devolve nada
   * além de um booleano.
   */
  if (corpo.check) {
    const { data } = await admin
      .from('google_calendar_credentials')
      .select('organization_id')
      .eq('organization_id', organizationId)
      .maybeSingle();
    return json({ ok: true, has_credential: Boolean(data) });
  }

  if (corpo.revoke) {
    const { error } = await admin
      .from('google_calendar_credentials')
      .delete()
      .eq('organization_id', organizationId);
    if (error) return json({ error: 'nao foi possivel remover a credencial' }, 500);
    return json({ ok: true, revoked: true });
  }

  const refreshToken = (corpo.refresh_token ?? '').trim();
  if (refreshToken.length < 20) return json({ error: 'refresh_token obrigatorio' }, 400);

  let cifrado: string;
  try {
    cifrado = await cifrarTextoClaro(refreshToken);
  } catch (erro) {
    return json({ error: erro instanceof Error ? erro.message : 'falha ao cifrar' }, 500);
  }

  const { error } = await admin
    .from('google_calendar_credentials')
    .upsert(
      {
        organization_id: organizationId,
        refresh_token_encrypted: cifrado,
        connected_email: corpo.email ?? null,
        calendar_id: corpo.calendar_id ?? null,
        updated_at: new Date().toISOString(),
        updated_by: usuario.user.id,
      },
      { onConflict: 'organization_id' },
    );
  if (error) return json({ error: 'nao foi possivel guardar a credencial' }, 500);

  return json({ ok: true });
});
