-- Pack & Paws Club - Organization colleagues may read each other's profiles
-- Apply with a database owner/admin connection only.

begin;

create policy profiles_org_member_read on public.profiles
for select to authenticated
using (
  exists (
    select 1
    from public.organization_members colleague
    where colleague.organization_id in (
      select mine.organization_id
      from public.organization_members mine
      where mine.user_id = auth.uid() and mine.status = 'active'
    )
    and colleague.user_id = profiles.id
    and colleague.status = 'active'
  )
);

commit;
