-- Pack & Paws Club - Reservations and recurring schedules
-- Apply with a database owner/admin connection only.

begin;

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  service_type text not null check (service_type in ('daycare', 'boarding')),
  start_date date not null,
  end_date date not null,
  transport_required boolean not null default false,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dog_id uuid not null references public.dogs(id) on delete cascade,
  weekdays integer[] not null,
  start_date date not null default current_date,
  end_date date,
  transport_required boolean not null default false,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_length(weekdays, 1) > 0),
  check (weekdays <@ array[0,1,2,3,4,5,6]::integer[])
);

create index reservations_org_date_idx on public.reservations(organization_id, start_date, end_date);
create index reservations_org_dog_idx on public.reservations(organization_id, dog_id);
create index recurring_org_active_idx on public.recurring_schedules(organization_id, active);

alter table public.reservations enable row level security;
alter table public.recurring_schedules enable row level security;

-- Managers manage reservations for dogs inside their organization.
create policy reservations_manager_all on public.reservations
for all to authenticated
using (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.dogs d
    where d.id = dog_id and d.organization_id = organization_id
  )
)
with check (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.dogs d
    where d.id = dog_id and d.organization_id = organization_id
  )
);

create policy recurring_manager_all on public.recurring_schedules
for all to authenticated
using (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.dogs d
    where d.id = dog_id and d.organization_id = organization_id
  )
)
with check (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.dogs d
    where d.id = dog_id and d.organization_id = organization_id
  )
);

commit;
