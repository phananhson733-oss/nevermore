-- Waitlist signups for tools that are announced but have not shipped
-- (first consumer: /tools/hidden-keywords, the Keyword Opportunity Map).
--
-- The previous waitlist wrote to `waitlist_subscribers` in the retired
-- lead-capture Supabase project and was disabled rather than repointed. This
-- table lives in the same marketing project as public_tool_rate_limits, the
-- one the live crawl tools already reach through the service-role client.
--
-- OWNER STEP: run this against the marketing Supabase project before the
-- waitlist goes live. /api/waitlist fails closed with 503
-- LEAD_CAPTURE_UNAVAILABLE while the table is missing, so deploying the code
-- first degrades the form honestly instead of losing signups silently.

create table if not exists public.waitlist_signups (
  id           uuid        primary key default gen_random_uuid(),
  email        text        not null,
  locale       text        not null default 'en',
  source       text,
  landing_page text,
  name         text,
  company      text,
  role         text,
  created_at   timestamptz not null default now()
);

-- One signup per address regardless of casing; the route lowercases before
-- insert, the index enforces it against writers that do not.
create unique index if not exists waitlist_signups_email_key
  on public.waitlist_signups (lower(email));

-- Service-role only. No anon or authenticated policy is granted, so a leaked
-- publishable key cannot read the address list or forge signups.
alter table public.waitlist_signups enable row level security;
