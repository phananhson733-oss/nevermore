-- Durable quota buckets for the anonymous public tools.
--
-- The in-memory limiter in src/lib/rate-limit.ts says so itself: "on Vercel
-- each isolate keeps its own store, so the real limit is ~N_isolates x max".
-- For a counter that exists to stop an anonymous caller from driving a
-- 240-second crawl in a loop, that is not a limit at all — K concurrent
-- requests scale out to K instances, each with an empty store.
--
-- OWNER STEP: run this against the marketing Supabase project before deploying
-- the handlers that call consume_public_tool_quota(). The crawl endpoints fail
-- closed when the function is missing, so deploying the code first takes the
-- tools offline rather than leaving them unbounded.

create table if not exists public.public_tool_rate_limits (
  bucket_key   text        primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);

-- Supports the sweep below. Buckets are short-lived; the table should stay small.
create index if not exists public_tool_rate_limits_window_start_idx
  on public.public_tool_rate_limits (window_start);

-- Service-role only. No anon or authenticated policy is granted, so a leaked
-- publishable key cannot read or forge quota state.
alter table public.public_tool_rate_limits enable row level security;

/**
 * Atomically consume one unit from a fixed window and report whether it fit.
 *
 * The increment happens inside INSERT ... ON CONFLICT DO UPDATE, which takes a
 * row lock, so two concurrent callers cannot both read "9 of 10" and both
 * proceed. A read-then-write from the application would have exactly that race,
 * and the race is the whole attack.
 */
create or replace function public.consume_public_tool_quota(
  p_bucket_key     text,
  p_max            integer,
  p_window_seconds integer
)
returns table (allowed boolean, hits integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window interval := make_interval(secs => p_window_seconds);
  v_hits   integer;
  v_start  timestamptz;
begin
  if p_max < 1 or p_window_seconds < 1 then
    raise exception 'p_max and p_window_seconds must be positive';
  end if;

  insert into public.public_tool_rate_limits as t (bucket_key, window_start, hits)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
    set
      -- In DO UPDATE, `t` is the existing row, so this reads the stored window.
      window_start = case
        when t.window_start + v_window <= now() then now()
        else t.window_start
      end,
      hits = case
        when t.window_start + v_window <= now() then 1
        else t.hits + 1
      end
  returning t.hits, t.window_start into v_hits, v_start;

  -- Bounded opportunistic sweep. Capped so no single request pays for a large
  -- backlog; anything missed is collected by a later call.
  delete from public.public_tool_rate_limits
  where bucket_key in (
    select bucket_key
    from public.public_tool_rate_limits
    where window_start < now() - interval '1 day'
    limit 100
  );

  return query select (v_hits <= p_max), v_hits, (v_start + v_window);
end;
$$;

revoke all on function public.consume_public_tool_quota(text, integer, integer) from public;
revoke all on function public.consume_public_tool_quota(text, integer, integer) from anon;
revoke all on function public.consume_public_tool_quota(text, integer, integer) from authenticated;
grant execute on function public.consume_public_tool_quota(text, integer, integer) to service_role;
