import { createClient } from 'npm:@supabase/supabase-js@2';

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

function makeTemporaryPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = '';
  const random = new Uint32Array(16);
  crypto.getRandomValues(random);
  for (const value of random) password += alphabet[value % alphabet.length];
  return `${password}Aa1!`;
}

async function findOrganizationForManager(admin: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
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
  const token = authorization.replace(/^Bearer\s+/i, '');

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  const organizationId = await findOrganizationForManager(admin, user.id);
  if (!organizationId) return json({ error: 'Only a manager can invite drivers' }, 403);

  let body: { name?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Name and a valid email are required' }, 400);

  const temporaryPassword = makeTemporaryPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: name, must_change_password: true },
  });
  if (createError) {
    if (createError.message.toLowerCase().includes('already been registered')) {
      return json({ error: 'A user with this email already exists' }, 409);
    }
    return json({ error: createError.message }, 500);
  }

  const { error: memberError } = await admin
    .from('organization_members')
    .insert({ organization_id: organizationId, user_id: created.user.id, role: 'driver', status: 'active', created_by: user.id });
  if (memberError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: memberError.message }, 500);
  }

  return json({ ok: true, email, temporary_password: temporaryPassword, driver_id: created.user.id });
});
