-- Marketing-only immutable short links. Does not alter the product app schema.
-- Execute on the current production project after verifying table absence.
begin;
set local lock_timeout = '5s';
create table if not exists public.link_redirects (
  code text primary key check (code ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  destination_url text not null check (
    destination_url ~ '^https://(www\.)?gengrowth\.ai([/?#]|$)'
  ),
  redirect_status smallint not null default 302 check (redirect_status = 302),
  created_at timestamptz not null default now()
);
alter table public.link_redirects enable row level security;
revoke all on public.link_redirects from public, anon, authenticated, service_role;
grant select, insert on public.link_redirects to service_role;
notify pgrst, 'reload schema';
commit;
