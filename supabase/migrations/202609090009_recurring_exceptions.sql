-- Pack & Paws Club - Recurring schedule exceptions
-- Pause/absence (skip) and per-occurrence transport overrides for weekly daycare.
-- Apply with a database owner/admin connection only.

begin;

create table public.recurring_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recurring_schedule_id uuid not null references public.recurring_schedules(id) on delete cascade,
  action text not null check (action in ('skip', 'transport_on', 'transport_off')),
  start_date date not null,
  end_date date not null,
  reason text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (
    (action = 'skip')
    or (action in ('transport_on', 'transport_off') and start_date = end_date)
  )
);

create index recurring_exceptions_schedule_idx on public.recurring_exceptions(recurring_schedule_id, start_date, end_date);
create index recurring_exceptions_org_idx on public.recurring_exceptions(organization_id);

alter table public.recurring_exceptions enable row level security;

-- Managers manage exceptions for schedules inside their organization.
create policy recurring_exceptions_manager_all on public.recurring_exceptions
for all to authenticated
using (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.recurring_schedules s
    where s.id = recurring_schedule_id and s.organization_id = organization_id
  )
)
with check (
  public.is_org_manager(organization_id)
  and exists (
    select 1 from public.recurring_schedules s
    where s.id = recurring_schedule_id and s.organization_id = organization_id
  )
);

commit;
