-- Shared crawl results, keyed on the tool and the target host.
--
-- Nothing in the repo cached a crawl by target: responses were no-store and no
-- lookup existed, so a hundred people auditing the same site meant a hundred
-- full crawls of it — a hundred times the cost to us and, more importantly, a
-- hundred times the traffic at a site that never asked to be audited.
--
-- This is the other half of the per-target rate limit. Without a cache, the
-- fifth caller in an hour receives an error; with one, they receive the recent
-- result and the timestamp it was captured at.
--
-- Cached rows contain only facts about publicly reachable pages, which any
-- caller could fetch themselves. No submitter identity is stored.
--
-- OWNER STEP: run this against the marketing Supabase project. Unlike the quota
-- table, a missing cache is not fatal — lookups fail soft and the tools simply
-- crawl every time, which is today's behaviour.

create table if not exists public.public_tool_crawl_cache (
  tool        text        not null,
  target_host text        not null,
  payload     jsonb       not null,
  captured_at timestamptz not null default now(),
  primary key (tool, target_host)
);

create index if not exists public_tool_crawl_cache_captured_at_idx
  on public.public_tool_crawl_cache (captured_at);

-- Service-role only, same reasoning as the quota table.
alter table public.public_tool_crawl_cache enable row level security;

/**
 * Read a cached crawl if one is fresh enough, and sweep stale rows.
 *
 * Freshness is decided here rather than in the application so a clock skew on
 * one serverless instance cannot resurrect an expired entry.
 */
create or replace function public.read_public_tool_crawl_cache(
  p_tool        text,
  p_target_host text,
  p_max_age_seconds integer
)
returns table (payload jsonb, captured_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.public_tool_crawl_cache
  where captured_at < now() - interval '7 days';

  return query
  select c.payload, c.captured_at
  from public.public_tool_crawl_cache c
  where c.tool = p_tool
    and c.target_host = p_target_host
    and c.captured_at > now() - make_interval(secs => p_max_age_seconds);
end;
$$;

create or replace function public.write_public_tool_crawl_cache(
  p_tool        text,
  p_target_host text,
  p_payload     jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.public_tool_crawl_cache (tool, target_host, payload, captured_at)
  values (p_tool, p_target_host, p_payload, now())
  on conflict (tool, target_host) do update
    set payload = excluded.payload,
        captured_at = excluded.captured_at;
$$;

revoke all on function public.read_public_tool_crawl_cache(text, text, integer) from public, anon, authenticated;
revoke all on function public.write_public_tool_crawl_cache(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.read_public_tool_crawl_cache(text, text, integer) to service_role;
grant execute on function public.write_public_tool_crawl_cache(text, text, jsonb) to service_role;
