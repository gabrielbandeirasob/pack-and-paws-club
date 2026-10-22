-- SAÚDE DA AGENDA DO GOOGLE (cliente, 21/10/2026)
--
-- Por que: a conexão do cliente morreu em 15/10 (`unauthorized_client` no refresh do token) e
-- ninguém soube. A Home continuou mostrando 9 cães num dia que tinha 21 no calendário, porque o
-- banco só tem o que a importação conseguiu trazer.
--
-- O app NÃO lê `google_calendar_credentials` (a tabela é fechada para o cliente e o token nunca sai
-- do servidor). Ele pergunta por esta função, que responde só o essencial da PRÓPRIA organização:
-- existe conexão? quando foi a última sincronização? está atrasada (>48h)?

create or replace function public.google_calendar_situacao()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row record;
begin
  select organization_id into v_org
    from public.organization_members
   where user_id = auth.uid() and status = 'active'
   limit 1;
  if v_org is null then
    return jsonb_build_object('conectado', false);
  end if;

  select connected_email, last_sync_at, last_sync_result
    into v_row
    from public.google_calendar_credentials
   where organization_id = v_org;
  if not found then
    return jsonb_build_object('conectado', false);
  end if;

  return jsonb_build_object(
    'conectado', true,
    'email', v_row.connected_email,
    'ultima_sync', v_row.last_sync_at,
    'horas_sem_sync', case when v_row.last_sync_at is null then null
                           else floor(extract(epoch from (now() - v_row.last_sync_at)) / 3600)::int end,
    'resultado', left(coalesce(v_row.last_sync_result, ''), 300),
    'atrasada', (v_row.last_sync_at is null or v_row.last_sync_at < now() - interval '48 hours')
  );
end $$;

revoke all on function public.google_calendar_situacao() from public, anon;
grant execute on function public.google_calendar_situacao() to authenticated;
