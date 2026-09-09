-- Pack & Paws Club - Track when a route was published
-- Apply with a database owner/admin connection only.

begin;

alter table public.routes
  add column if not exists published_at timestamptz;

commit;
