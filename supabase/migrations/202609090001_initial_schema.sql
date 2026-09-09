-- Pack & Paws Club - Initial secure schema
-- Apply with a database owner/admin connection only.

begin;

create extension if not exists pgcrypto;

create type public.organization_role as enum ('manager', 'driver');
create type public.member_status as enum ('invited', 'active', 'disabled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null,
  status public.member_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  source_contact_identifier text,
  special_scheduling_instructions text,
  notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_contact_identifier)
);

create table public.dogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  breed text,
  photo_url text,
  behavior_notes text,
  medical_notes text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_instructions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null unique references public.clients(id) on delete cascade,
  pickup_access_instructions text,
  contains_access_code boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_user_idx on public.organization_members(user_id, status);
create index clients_org_name_idx on public.clients(organization_id, name);
create index dogs_org_client_idx on public.dogs(organization_id, client_id);
create index audit_logs_org_created_idx on public.audit_logs(organization_id, created_at desc);

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_org_manager(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org
      and m.user_id = auth.uid()
      and m.role = 'manager'
      and m.status = 'active'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_manager(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_manager(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.dogs enable row level security;
alter table public.client_instructions enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_member_read on public.organizations
for select to authenticated using (public.is_org_member(id));

create policy profiles_self_read on public.profiles
for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy members_org_read on public.organization_members
for select to authenticated using (public.is_org_member(organization_id));
create policy members_manager_insert on public.organization_members
for insert to authenticated with check (public.is_org_manager(organization_id));
create policy members_manager_update on public.organization_members
for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
create policy members_manager_delete on public.organization_members
for delete to authenticated using (public.is_org_manager(organization_id) and user_id <> auth.uid());

create policy clients_manager_all on public.clients
for all to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));

create policy dogs_manager_all on public.dogs
for all to authenticated using (public.is_org_manager(organization_id)) with check (
  public.is_org_manager(organization_id)
  and exists (select 1 from public.clients c where c.id = client_id and c.organization_id = organization_id)
);

create policy instructions_manager_all on public.client_instructions
for all to authenticated using (public.is_org_manager(organization_id)) with check (
  public.is_org_manager(organization_id)
  and exists (select 1 from public.clients c where c.id = client_id and c.organization_id = organization_id)
);

create policy audit_manager_read on public.audit_logs
for select to authenticated using (public.is_org_manager(organization_id));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Bootstrap is intentionally owner-only: call from SQL editor after the
-- first Auth user exists. Do not grant it to anon/authenticated.
create or replace function public.bootstrap_pack_and_paws_manager(manager_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  org_id uuid;
  manager_id uuid;
begin
  select id into manager_id from auth.users where lower(email) = lower(manager_email);
  if manager_id is null then
    raise exception 'Manager auth user not found';
  end if;

  insert into public.organizations(name, slug)
  values ('Pack & Paws Club', 'pack-and-paws-club')
  on conflict (slug) do update set name = excluded.name
  returning id into org_id;

  insert into public.organization_members(organization_id, user_id, role, status, created_by)
  values (org_id, manager_id, 'manager', 'active', manager_id)
  on conflict (organization_id, user_id)
  do update set role = 'manager', status = 'active';

  return org_id;
end;
$$;

revoke all on function public.bootstrap_pack_and_paws_manager(text) from public, anon, authenticated;

commit;

-- Run only after creating the first Auth user in the Supabase dashboard:
-- select public.bootstrap_pack_and_paws_manager('raphael@autonestmobile.com');
