-- 020: PROVA DE ENTREGA (foto no embarque e na entrega) + configurações da organização
--
-- Por que existe: a pesquisa de mercado (Onfleet como padrão de logística) mostrou que
-- "comprovante de entrega" é o que encerra disputa e dá registro. No nosso caso a parada tem
-- DOIS momentos com prova: o embarque do cão (`picked_up`) e a entrega (`completed`).
--
-- A creche decide se a foto é obrigatória (por isso as configurações na organização), e o
-- caminho do arquivo começa com o id da organização para a política de storage isolar por
-- organização sem precisar consultar o banco de novo.

begin;

-- 1) Configurações da organização
alter table public.organizations
  add column if not exists proof_pickup_required boolean not null default true,
  add column if not exists proof_dropoff_required boolean not null default true,
  add column if not exists eta_notice_enabled boolean not null default true,
  add column if not exists eta_notice_minutes integer not null default 10;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_eta_minutes_ok') then
    alter table public.organizations
      add constraint organizations_eta_minutes_ok check (eta_notice_minutes between 1 and 120);
  end if;
end $$;

-- 2) Os comprovantes moram no próprio registro da parada (não em tabela paralela: a parada já
--    tem o ciclo de vida, o histórico e o RLS prontos)
alter table public.route_stops
  add column if not exists pickup_proof_path text,
  add column if not exists pickup_proof_at timestamptz,
  add column if not exists dropoff_proof_path text,
  add column if not exists dropoff_proof_at timestamptz,
  add column if not exists proof_note text;

-- 3) Aviso de ETA ao tutor precisa de canal. Telefone já existia; e-mail entra agora.
alter table public.clients
  add column if not exists email text,
  add column if not exists eta_notice_enabled boolean not null default true;

-- 4) Bucket privado das fotos (8 MB por arquivo; só imagem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stop-proofs', 'stop-proofs', false, 8388608,
        array['image/jpeg','image/png','image/heic','image/webp'])
on conflict (id) do nothing;

-- 5) Helper do caminho: compara TEXTO com texto (se alguém mandar caminho malformado, a política
--    apenas nega - nunca estoura erro de cast como aconteceria com ::uuid direto na policy)
create or replace function public.path_belongs_to_my_org(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id::text = split_part(p_path, '/', 1)
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$function$;

-- 6) Políticas do bucket: membro da organização envia e lê. Não existe DELETE de propósito:
--    comprovante é registro, não arquivo de trabalho.
drop policy if exists stop_proofs_insert on storage.objects;
create policy stop_proofs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stop-proofs' and public.path_belongs_to_my_org(name));

drop policy if exists stop_proofs_read on storage.objects;
create policy stop_proofs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'stop-proofs' and public.path_belongs_to_my_org(name));

commit;
