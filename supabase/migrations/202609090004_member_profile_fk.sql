-- Pack & Paws Club - Expose driver profiles through a direct FK
-- Apply with a database owner/admin connection only.

begin;

alter table public.organization_members
  drop constraint if exists organization_members_profile_fk;

alter table public.organization_members
  add constraint organization_members_profile_fk
  foreign key (user_id) references public.profiles(id) on delete cascade;

commit;
