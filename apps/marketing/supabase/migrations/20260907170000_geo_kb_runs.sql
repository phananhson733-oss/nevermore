-- The durable GEO knowledge base run ledger (design 2026-09-07, slice S4).
--
-- One update of a knowledge base is one run, and every operation inside it that
-- costs money or spends a shared crawl allowance -- each SERP query, each page
-- fetch, each Search Console window, each model step -- gets its own durable
-- row, addressed by the content-derived key `geoRunOperationKey()` produces.
--
-- Resuming therefore means reading these rows, not replaying the run. The rule
-- the whole file is built around, and the one that shapes the trigger below:
--
--   a request we dispatched but whose outcome we never saw is NOT evidence
--   that nothing was charged.
--
-- Such an operation is `outcome_unknown`. It may be probed -- read the outcome
-- from wherever it would have landed -- and it may be given up on, but it can
-- never become eligible to be sent again. The transition guard enforces that
-- at the table, so it holds for callers that do not know the rule.
--
-- The decision logic is pure and lives in
-- apps/marketing/src/lib/geo-tools/kb-run-plan.ts. Nothing here re-implements
-- it; this file stores the states that function reads and refuses the
-- transitions it must never see.
-- ---------------------------------------------------------------------------

create table if not exists public.marketing_geo_kb_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kb_id uuid not null,
  -- Same shape as the generation idempotency key: one gesture, one run.
  idempotency_key text not null check (idempotency_key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  -- `complete` means the plan reported nothing left to do -- including runs
  -- whose operations all failed permanently, because "we finished deciding" is
  -- what closes a run. `abandoned` is an explicit owner-side give-up.
  state text not null check (state in ('running','complete','abandoned')),
  -- Locked once, at the roles step, and never re-bound: every generation this
  -- run reuses is pinned to this value, and re-binding it would let a review
  -- built on one input be published against another.
  generation_input_hash text check (generation_input_hash ~ '^[a-f0-9]{64}$'),
  -- A run has one executor at a time. A second concurrent invocation may only
  -- poll; it must never start work the first one is already paying for.
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, kb_id, user_id),
  unique (user_id, kb_id, idempotency_key),
  foreign key (kb_id, user_id)
    references public.marketing_geo_knowledge_bases(id, user_id) on delete restrict
);

-- One open run per knowledge base. Two concurrent runs would each build their
-- own operation ledger over the same site and pay twice for the same fetches
-- and model steps; the ledger only prevents double spending inside one run.
-- The escape hatch for a run whose executor is gone is
-- marketing_geo_abandon_kb_run, not a second run.
create unique index if not exists marketing_geo_kb_run_single_active_idx
  on public.marketing_geo_kb_runs (kb_id) where state = 'running';
create index if not exists marketing_geo_kb_run_latest_idx
  on public.marketing_geo_kb_runs (user_id, kb_id, created_at desc, id desc);

create table if not exists public.marketing_geo_kb_run_operations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  user_id uuid not null,
  kb_id uuid not null,
  -- Content-addressed: `fetch:own:<url>`, `serp:<query>`, `gsc:<property>:<days>`,
  -- `model:<step>`. Never positional -- a positional key shifts when the plan
  -- changes, and a shifted key is a second authorisation to spend.
  operation_key text not null
    check (char_length(operation_key) between 3 and 2048 and octet_length(operation_key) <= 2048),
  kind text not null check (kind in ('fetch','serp','gsc','model')),
  state text not null check (state in
    ('not_started','claimed','dispatched','succeeded','failed_retryable','failed_permanent','outcome_unknown')),
  -- Where the stored result lives once there is one: a generation id, a
  -- receipt id, an observation id. The ledger holds the pointer, never a copy.
  result_ref text check (char_length(result_ref) between 1 and 200),
  reason text check (reason in
    ('outcome_unknown','lease_expired','rate_limited','quota_unavailable','gate_closed',
     'provider_rejected','invalid_output','model_unavailable','fetch_failed','blocked',
     'timeout','not_found','unsupported','store_unavailable')),
  -- How many times we have asked "what happened to this?" without an answer.
  -- Clamped rather than unbounded so a probe loop cannot grow without limit;
  -- the operative give-up bound is the executor's, in kb-run-advance.ts.
  probe_count integer not null default 0 check (probe_count between 0 and 8),
  -- Explicit position in the run, because the order IS the plan.
  --
  -- `created_at` cannot carry it: `now()` is fixed for a transaction, so every
  -- operation seeded by one statement shares a timestamp and the tie is broken
  -- by a random uuid -- which would make "which operation runs next" depend on
  -- nothing at all.
  seq integer not null check (seq >= 0),
  -- Only a claim is leased. A dispatched request is deliberately NOT leased:
  -- an expiring lease on it would read as "free to take", and taking it means
  -- sending it again.
  lease_expires_at timestamptz,
  -- When the request actually went out, not when the row was claimed.
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, operation_key),
  foreign key (run_id, kb_id, user_id)
    references public.marketing_geo_kb_runs(id, kb_id, user_id) on delete restrict,

  -- The kind is inside the key, so the two can never disagree.
  constraint marketing_geo_kb_run_operation_kind_prefix
    check (starts_with(operation_key, kind || ':')),

  constraint marketing_geo_kb_run_operation_state_shape check (
    (state in ('not_started','claimed','dispatched') and result_ref is null and reason is null)
    or (state = 'succeeded' and result_ref is not null and reason is null)
    or (state in ('failed_retryable','failed_permanent') and result_ref is null and reason is not null)
    -- An unknown outcome names itself. Anything else here would let a specific
    -- reason imply we know more about the charge than we do.
    or (state = 'outcome_unknown' and result_ref is null and reason = 'outcome_unknown')
  ),
  constraint marketing_geo_kb_run_operation_lease_shape
    check ((state = 'claimed') = (lease_expires_at is not null)),
  -- Anything that was, or may have been, sent has a dispatch time. A
  -- failed_retryable row may not: an expired claim that never dispatched ends
  -- there too.
  constraint marketing_geo_kb_run_operation_started_shape
    check (state not in ('dispatched','succeeded','outcome_unknown') or started_at is not null),
  constraint marketing_geo_kb_run_operation_finished_shape
    check ((state in ('succeeded','failed_retryable','failed_permanent','outcome_unknown'))
           = (finished_at is not null))
);
create index if not exists marketing_geo_kb_run_operation_run_idx
  on public.marketing_geo_kb_run_operations (run_id, seq, id);

-- ---------------------------------------------------------------------------
-- Transition guards
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_kb_run_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'GEO knowledge base runs are append-only'; end if;
  if row(new.id, new.user_id, new.kb_id, new.idempotency_key, new.created_at)
     is distinct from row(old.id, old.user_id, old.kb_id, old.idempotency_key, old.created_at) then
    raise exception 'GEO run identity is immutable';
  end if;
  -- Bound once. `is distinct from` on purpose: with `<>` a NULL on either side
  -- makes the condition NULL, the IF takes the false branch, and a rebind slips
  -- through exactly when one of the two values is missing.
  if old.generation_input_hash is not null
     and new.generation_input_hash is distinct from old.generation_input_hash then
    raise exception 'GEO run generation input is bound once';
  end if;
  if old.state <> 'running' and new.state is distinct from old.state then
    raise exception 'GEO run is finished';
  end if;
  if new.state not in ('running','complete','abandoned') then
    raise exception 'Invalid GEO run state';
  end if;
  return new;
end $$;
drop trigger if exists marketing_geo_kb_run_guard_row on public.marketing_geo_kb_runs;
create trigger marketing_geo_kb_run_guard_row before update or delete
  on public.marketing_geo_kb_runs for each row execute function public.marketing_geo_kb_run_guard();
drop trigger if exists marketing_geo_kb_run_guard_truncate on public.marketing_geo_kb_runs;
create trigger marketing_geo_kb_run_guard_truncate before truncate
  on public.marketing_geo_kb_runs for each statement execute function public.marketing_geo_kb_run_guard();

/*
 * The whole point of the ledger, in one function.
 *
 * `dispatched` and `outcome_unknown` are the two states where money may
 * already have been spent without us seeing the result. From either of them
 * the only ways out are: we learned it succeeded, or we gave up permanently.
 * Neither leads back to a state that authorises sending the request again.
 *
 * `claimed` is different, and the difference is a write ordering, not a
 * belief: the executor writes `dispatched` BEFORE the request leaves. A row
 * still reading `claimed` therefore never sent anything, which is why an
 * expired claim may fall back to `failed_retryable` and be started again.
 */
create or replace function public.marketing_geo_kb_run_operation_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then raise exception 'GEO run operations are append-only'; end if;
  if row(new.id, new.run_id, new.user_id, new.kb_id, new.operation_key, new.kind, new.seq, new.created_at)
     is distinct from row(old.id, old.run_id, old.user_id, old.kb_id, old.operation_key, old.kind, old.seq, old.created_at) then
    raise exception 'GEO run operation identity is immutable';
  end if;
  if new.probe_count < old.probe_count then raise exception 'GEO run probe count cannot decrease'; end if;
  if old.state in ('succeeded','failed_permanent') then
    raise exception 'GEO run operation is terminal';
  end if;
  if old.state = 'not_started' and new.state not in ('not_started','claimed') then
    raise exception 'Invalid GEO run operation transition';
  end if;
  if old.state = 'claimed' and new.state not in
     ('claimed','dispatched','failed_retryable','failed_permanent','outcome_unknown') then
    raise exception 'Invalid GEO run operation transition';
  end if;
  if old.state = 'dispatched' and new.state not in
     ('dispatched','succeeded','failed_retryable','failed_permanent','outcome_unknown') then
    raise exception 'A dispatched GEO run operation cannot be reclaimed';
  end if;
  if old.state = 'failed_retryable' and new.state not in
     ('failed_retryable','claimed','failed_permanent') then
    raise exception 'Invalid GEO run operation transition';
  end if;
  if old.state = 'outcome_unknown' and new.state not in
     ('outcome_unknown','succeeded','failed_permanent') then
    raise exception 'An unresolved GEO run operation cannot be retried';
  end if;
  return new;
end $$;
drop trigger if exists marketing_geo_kb_run_operation_guard_row on public.marketing_geo_kb_run_operations;
create trigger marketing_geo_kb_run_operation_guard_row before update or delete
  on public.marketing_geo_kb_run_operations for each row
  execute function public.marketing_geo_kb_run_operation_guard();
drop trigger if exists marketing_geo_kb_run_operation_guard_truncate on public.marketing_geo_kb_run_operations;
create trigger marketing_geo_kb_run_operation_guard_truncate before truncate
  on public.marketing_geo_kb_run_operations for each statement
  execute function public.marketing_geo_kb_run_operation_guard();

-- ---------------------------------------------------------------------------
-- Projections
--
-- No JSON numbers anywhere: `probeCount` is a decimal string, the same rule the
-- V3 payload domain enforces, so these records can be embedded or hashed
-- alongside it without a second canonicalisation story.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_kb_run_record(p_row public.marketing_geo_kb_runs)
returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object(
    'schemaVersion','marketing-geo-kb-run.v1',
    'runId', p_row.id,
    'userId', p_row.user_id,
    'kbId', p_row.kb_id,
    'idempotencyKey', p_row.idempotency_key,
    'state', p_row.state,
    'generationInputHash', p_row.generation_input_hash,
    'leaseExpiresAt', to_char(p_row.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

create or replace function public.marketing_geo_kb_run_operation_record(
  p_row public.marketing_geo_kb_run_operations
) returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object(
    'schemaVersion','marketing-geo-kb-run-operation.v1',
    'key', p_row.operation_key,
    'kind', p_row.kind,
    'state', p_row.state,
    'resultRef', p_row.result_ref,
    'reason', p_row.reason,
    'probeCount', p_row.probe_count::text,
    'startedAt', to_char(p_row.started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'finishedAt', to_char(p_row.finished_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'leaseExpiresAt', to_char(p_row.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

/*
 * Operations in the order the executor appended them.
 *
 * The order is load-bearing: `planGeoRun` acts on the FIRST actionable
 * operation it sees, so an unstable order would make "which one runs next"
 * depend on the physical row order. Collect-stage keys are appended before the
 * model steps, which is how the phases stay in sequence without a phase column.
 */
create or replace function public.marketing_geo_kb_run_operations_json(p_run_id uuid)
returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select coalesce(jsonb_agg(public.marketing_geo_kb_run_operation_record(o)
           order by o.seq, o.id), '[]'::jsonb)
    from public.marketing_geo_kb_run_operations o where o.run_id = p_run_id
$$;

-- ---------------------------------------------------------------------------
-- Seeding and appending operations
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_kb_run_operations_valid(p_operations jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_operations) = 'array'
    and jsonb_array_length(p_operations) <= 400
    and not exists (
      select 1 from jsonb_array_elements(p_operations) entry
      where jsonb_typeof(entry.value) <> 'object'
        or (select count(*) from jsonb_object_keys(entry.value)) <> 2
        or entry.value->>'kind' not in ('fetch','serp','gsc','model')
        or jsonb_typeof(entry.value->'key') <> 'string'
        or char_length(entry.value->>'key') not between 3 and 2048
        or octet_length(entry.value->>'key') > 2048
        or not starts_with(entry.value->>'key', (entry.value->>'kind') || ':')
    )
$$;

create or replace function public.marketing_geo_kb_run_insert_operations(
  p_run public.marketing_geo_kb_runs, p_operations jsonb
) returns void language plpgsql set search_path = '' set timezone = 'UTC' as $$
declare v_base integer;
begin
  -- The caller's array order becomes the run order, and a later append lands
  -- after everything already there. Computed from the stored maximum rather
  -- than taken from a sequence, so the position does not depend on the order
  -- the executor happened to assign serial values in.
  select coalesce(max(o.seq), 0) into v_base
    from public.marketing_geo_kb_run_operations o where o.run_id = p_run.id;
  -- `do nothing` and not `do update`: an operation that already exists carries
  -- a state that describes real work, and re-seeding must never reset it.
  -- Skipped duplicates leave gaps in `seq`; only the order matters.
  insert into public.marketing_geo_kb_run_operations(run_id, user_id, kb_id, operation_key, kind, state, seq)
    select p_run.id, p_run.user_id, p_run.kb_id, entry.value->>'key', entry.value->>'kind', 'not_started',
           v_base + entry.position::integer
      from jsonb_array_elements(p_operations) with ordinality as entry(value, position)
    on conflict (run_id, operation_key) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Claim the run
--
-- Two lookup modes: by idempotency key (a fresh gesture) or by run id (the
-- auto-continue loop and the "continue update" button, which know the run but
-- not the key that made it). Exactly one must be given.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_claim_kb_run(
  p_user_id uuid, p_kb_id uuid, p_run_id uuid, p_idempotency_key text, p_operations jsonb
) returns table(outcome text, run jsonb, operations jsonb, lease_token uuid)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_active public.marketing_geo_kb_runs;
begin
  perform 1 from public.marketing_geo_knowledge_bases k
    where k.id = p_kb_id and k.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if (p_run_id is null) = (p_idempotency_key is null)
     or (p_idempotency_key is not null and p_idempotency_key !~ '^[a-zA-Z0-9_-]{8,128}$')
     or not public.marketing_geo_kb_run_operations_valid(coalesce(p_operations, '[]'::jsonb)) then
    outcome := 'invalid'; return next; return;
  end if;

  if p_run_id is not null then
    select r.* into v_run from public.marketing_geo_kb_runs r
      where r.id = p_run_id and r.kb_id = p_kb_id and r.user_id = p_user_id for update;
    if not found then outcome := 'not_found'; return next; return; end if;
  else
    select r.* into v_run from public.marketing_geo_kb_runs r
      where r.user_id = p_user_id and r.kb_id = p_kb_id and r.idempotency_key = p_idempotency_key
      for update;
    if not found then
      -- A different open run means a different update of the same site is
      -- already paying for these fetches. Report it instead of starting a
      -- second ledger; the caller resumes that run or abandons it.
      select r.* into v_active from public.marketing_geo_kb_runs r
        where r.kb_id = p_kb_id and r.state = 'running' for update;
      if found then
        outcome := 'run_active'; run := public.marketing_geo_kb_run_record(v_active);
        operations := public.marketing_geo_kb_run_operations_json(v_active.id);
        return next; return;
      end if;
      insert into public.marketing_geo_kb_runs(user_id, kb_id, idempotency_key, state, lease_expires_at)
        values (p_user_id, p_kb_id, p_idempotency_key, 'running', now() + interval '6 minutes')
        returning * into v_run;
      perform public.marketing_geo_kb_run_insert_operations(v_run, coalesce(p_operations, '[]'::jsonb));
      outcome := 'claimed'; run := public.marketing_geo_kb_run_record(v_run);
      operations := public.marketing_geo_kb_run_operations_json(v_run.id);
      lease_token := v_run.lease_token;
      return next; return;
    end if;
  end if;

  if v_run.state <> 'running' then
    outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id);
    return next; return;
  end if;
  -- A live lease is held by an executor that may be mid-request right now.
  if v_run.lease_expires_at > now() then
    outcome := 'busy'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id);
    return next; return;
  end if;
  update public.marketing_geo_kb_runs
    set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '6 minutes', updated_at = now()
    where id = v_run.id returning * into v_run;
  -- Seeding is idempotent, so a resumed run may extend its own plan; existing
  -- rows keep their states.
  perform public.marketing_geo_kb_run_insert_operations(v_run, coalesce(p_operations, '[]'::jsonb));
  outcome := 'claimed'; run := public.marketing_geo_kb_run_record(v_run);
  operations := public.marketing_geo_kb_run_operations_json(v_run.id);
  lease_token := v_run.lease_token;
  return next;
exception when invalid_text_representation or check_violation or unique_violation then
  outcome := 'invalid'; run := null; operations := null; lease_token := null; return next;
end $$;

create or replace function public.marketing_geo_read_kb_run(
  p_user_id uuid, p_kb_id uuid, p_run_id uuid
) returns table(outcome text, run jsonb, operations jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id = p_kb_id and k.user_id = p_user_id;
  if not found then outcome := 'not_found'; return next; return; end if;
  if p_run_id is null then
    -- The "continue update" entry point: which run is still open on this site?
    select r.* into v_run from public.marketing_geo_kb_runs r
      where r.user_id = p_user_id and r.kb_id = p_kb_id and r.state = 'running'
      order by r.created_at desc, r.id desc limit 1;
  else
    select r.* into v_run from public.marketing_geo_kb_runs r
      where r.id = p_run_id and r.kb_id = p_kb_id and r.user_id = p_user_id;
  end if;
  if not found then outcome := 'none'; return next; return; end if;
  outcome := 'found';
  run := public.marketing_geo_kb_run_record(v_run);
  operations := public.marketing_geo_kb_run_operations_json(v_run.id);
  return next;
end $$;

create or replace function public.marketing_geo_append_kb_run_operations(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_operations jsonb
) returns table(outcome text, run jsonb, operations jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_count integer;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_run.state <> 'running' then outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return; end if;
  -- Both halves matter: the wrong token is a stale executor, and an expired
  -- lease means another invocation may already have taken over.
  if v_run.lease_token is distinct from p_lease_token or v_run.lease_expires_at <= now() then
    outcome := 'stale_lease'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return;
  end if;
  if not public.marketing_geo_kb_run_operations_valid(coalesce(p_operations, '[]'::jsonb)) then
    outcome := 'invalid'; return next; return;
  end if;
  perform public.marketing_geo_kb_run_insert_operations(v_run, coalesce(p_operations, '[]'::jsonb));
  select count(*) into v_count from public.marketing_geo_kb_run_operations o where o.run_id = v_run.id;
  if v_count > 400 then raise exception 'GEO run operation ledger is full'; end if;
  outcome := 'appended'; run := public.marketing_geo_kb_run_record(v_run);
  operations := public.marketing_geo_kb_run_operations_json(v_run.id);
  return next;
exception when invalid_text_representation or check_violation then
  outcome := 'invalid'; run := null; operations := null; return next;
end $$;

-- ---------------------------------------------------------------------------
-- One operation's life: claim -> dispatch -> finish, or probe
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_kb_run_lease_valid(
  p_run public.marketing_geo_kb_runs, p_lease_token uuid
) returns boolean language sql immutable set search_path = '' as $$
  select p_run.state = 'running' and p_run.lease_token is not distinct from p_lease_token
     and p_run.lease_expires_at > now()
$$;

create or replace function public.marketing_geo_claim_kb_run_operation(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_operation_key text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_op public.marketing_geo_kb_run_operations;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  select o.* into v_op from public.marketing_geo_kb_run_operations o
    where o.run_id = p_run_id and o.operation_key = p_operation_key for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  -- Only these two states authorise spending. Everything else means the plan
  -- this caller acted on was computed from a stale read.
  if v_op.state not in ('not_started','failed_retryable') then
    outcome := 'conflict'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  update public.marketing_geo_kb_run_operations
    set state = 'claimed', lease_expires_at = now() + interval '2 minutes',
        started_at = null, finished_at = null, result_ref = null, reason = null, updated_at = now()
    where id = v_op.id returning * into v_op;
  outcome := 'claimed'; operation := public.marketing_geo_kb_run_operation_record(v_op);
  return next;
end $$;

/*
 * Written BEFORE the request leaves, never after.
 *
 * That ordering is the only reason a `claimed` row can be treated as "nothing
 * was sent". Moving this call after the request would make every crash between
 * the two indistinguishable from a crash before it -- and the ledger would
 * then authorise a second charge.
 */
create or replace function public.marketing_geo_dispatch_kb_run_operation(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_operation_key text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_op public.marketing_geo_kb_run_operations;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  select o.* into v_op from public.marketing_geo_kb_run_operations o
    where o.run_id = p_run_id and o.operation_key = p_operation_key for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_op.state = 'dispatched' then
    outcome := 'existing'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  if v_op.state <> 'claimed' then
    outcome := 'conflict'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  update public.marketing_geo_kb_run_operations
    set state = 'dispatched', lease_expires_at = null, started_at = now(), updated_at = now()
    where id = v_op.id returning * into v_op;
  outcome := 'dispatched'; operation := public.marketing_geo_kb_run_operation_record(v_op);
  return next;
end $$;

/*
 * The executor saw this operation's own response.
 *
 * Only reachable from `dispatched`, and it is the only path that may write
 * `failed_retryable` after a request went out -- because "we saw a rate-limit
 * response" is knowledge, and knowledge is what makes a retry safe.
 */
create or replace function public.marketing_geo_finish_kb_run_operation(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_operation_key text,
  p_state text, p_result_ref text, p_reason text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_op public.marketing_geo_kb_run_operations;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  if p_state is null or p_state not in ('succeeded','failed_retryable','failed_permanent','outcome_unknown')
     or (p_state = 'succeeded') <> (p_result_ref is not null)
     or (p_state = 'succeeded') = (p_reason is not null)
     or (p_state = 'outcome_unknown' and p_reason is distinct from 'outcome_unknown') then
    outcome := 'invalid'; return next; return;
  end if;
  select o.* into v_op from public.marketing_geo_kb_run_operations o
    where o.run_id = p_run_id and o.operation_key = p_operation_key for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_op.state <> 'dispatched' then
    outcome := 'conflict'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  update public.marketing_geo_kb_run_operations
    set state = p_state, result_ref = p_result_ref, reason = p_reason,
        lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = v_op.id returning * into v_op;
  outcome := 'finished'; operation := public.marketing_geo_kb_run_operation_record(v_op);
  return next;
exception when check_violation then
  outcome := 'invalid'; operation := null; return next;
end $$;

/*
 * We did NOT see this operation's response; we went looking for its result.
 *
 * From `dispatched` or `outcome_unknown` the answer can only be "it landed"
 * (succeeded) or "we are giving up" (failed_permanent) or "still unknown".
 * `failed_retryable` is refused there on purpose: it is the one value that
 * would make a possibly-billed request eligible to be sent again, and a probe
 * -- by definition -- is the case where we do not know whether it was billed.
 *
 * From an expired `claimed` the request provably never left (dispatch is
 * written first), so `failed_retryable` is allowed and is how a run recovers
 * from an executor that died holding a claim.
 */
create or replace function public.marketing_geo_probe_kb_run_operation(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_operation_key text,
  p_state text, p_result_ref text, p_reason text
) returns table(outcome text, operation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_op public.marketing_geo_kb_run_operations; v_unclaimed boolean;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  if p_state is null or p_state not in ('succeeded','failed_retryable','failed_permanent','outcome_unknown')
     or (p_state = 'succeeded') <> (p_result_ref is not null)
     or (p_state = 'succeeded') = (p_reason is not null)
     or (p_state = 'outcome_unknown' and p_reason is distinct from 'outcome_unknown') then
    outcome := 'invalid'; return next; return;
  end if;
  select o.* into v_op from public.marketing_geo_kb_run_operations o
    where o.run_id = p_run_id and o.operation_key = p_operation_key for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  -- `coalesce`, not a bare comparison: a NULL lease_expires_at compares to
  -- NULL, the IF takes the false branch, and a live claim would be treated as
  -- an abandoned one.
  v_unclaimed := v_op.state = 'claimed'
    and coalesce(v_op.lease_expires_at, '-infinity'::timestamptz) <= now();
  if v_op.state not in ('dispatched','outcome_unknown') and not v_unclaimed then
    outcome := 'conflict'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  if p_state = 'failed_retryable' and not v_unclaimed then
    outcome := 'invalid'; operation := public.marketing_geo_kb_run_operation_record(v_op);
    return next; return;
  end if;
  update public.marketing_geo_kb_run_operations
    set state = p_state, result_ref = p_result_ref, reason = p_reason,
        -- Clamped: the executor gives up long before this, and a probe that
        -- hits the ceiling must not fail the write it is trying to record.
        probe_count = least(probe_count + 1, 8),
        lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = v_op.id returning * into v_op;
  outcome := 'probed'; operation := public.marketing_geo_kb_run_operation_record(v_op);
  return next;
exception when check_violation then
  outcome := 'invalid'; operation := null; return next;
end $$;

-- ---------------------------------------------------------------------------
-- Run-level writes
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_bind_kb_run_input(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid, p_generation_input_hash text
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  if p_generation_input_hash is null or p_generation_input_hash !~ '^[a-f0-9]{64}$' then
    outcome := 'invalid'; return next; return; end if;
  -- Re-binding the same value is the resume case and must succeed; re-binding a
  -- different one is a run trying to change what its paid generations were
  -- pinned to.
  if v_run.generation_input_hash is not null
     and v_run.generation_input_hash is distinct from p_generation_input_hash then
    outcome := 'conflict'; run := public.marketing_geo_kb_run_record(v_run);
    return next; return;
  end if;
  update public.marketing_geo_kb_runs
    set generation_input_hash = p_generation_input_hash, updated_at = now()
    where id = v_run.id returning * into v_run;
  outcome := 'bound'; run := public.marketing_geo_kb_run_record(v_run);
  return next;
end $$;

-- Hand the run back at the end of every invocation. Without this the next
-- auto-continue call would see its own six-minute lease and report `busy`;
-- with it, a killed executor still holds the lease until it expires, which is
-- exactly the protection the lease exists for.
create or replace function public.marketing_geo_release_kb_run(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid
) returns table(outcome text, run jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_run.state <> 'running' then
    outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run); return next; return; end if;
  if v_run.lease_token is distinct from p_lease_token then
    outcome := 'stale_lease'; run := public.marketing_geo_kb_run_record(v_run); return next; return; end if;
  update public.marketing_geo_kb_runs set lease_expires_at = now(), updated_at = now()
    where id = v_run.id returning * into v_run;
  outcome := 'released'; run := public.marketing_geo_kb_run_record(v_run);
  return next;
end $$;

create or replace function public.marketing_geo_finish_kb_run(
  p_user_id uuid, p_run_id uuid, p_lease_token uuid
) returns table(outcome text, run jsonb, operations jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs; v_outstanding integer;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_run.state <> 'running' then
    outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return; end if;
  if not public.marketing_geo_kb_run_lease_valid(v_run, p_lease_token) then
    outcome := 'stale_lease'; return next; return; end if;
  -- Closing a run with work still open would strand paid operations nobody
  -- looks at again. `succeeded` and `failed_permanent` are the only states the
  -- plan treats as settled, so they are the only ones that may remain.
  select count(*) into v_outstanding from public.marketing_geo_kb_run_operations o
    where o.run_id = v_run.id and o.state not in ('succeeded','failed_permanent');
  if v_outstanding > 0 then
    outcome := 'incomplete'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return;
  end if;
  update public.marketing_geo_kb_runs set state = 'complete', lease_expires_at = now(), updated_at = now()
    where id = v_run.id returning * into v_run;
  outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run);
  operations := public.marketing_geo_kb_run_operations_json(v_run.id);
  return next;
end $$;

/*
 * Give up on a run whose executor is gone.
 *
 * Deliberately takes no lease token -- the case it exists for is precisely
 * "nobody holds the lease any more" -- and refuses while a lease is live, so it
 * cannot be used to shove a working executor aside. Nothing is retried and no
 * operation state is rewritten: an abandoned run's charges stay recorded.
 */
create or replace function public.marketing_geo_abandon_kb_run(
  p_user_id uuid, p_run_id uuid
) returns table(outcome text, run jsonb, operations jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_run public.marketing_geo_kb_runs;
begin
  select r.* into v_run from public.marketing_geo_kb_runs r
    where r.id = p_run_id and r.user_id = p_user_id for update;
  if not found then outcome := 'not_found'; return next; return; end if;
  if v_run.state <> 'running' then
    outcome := 'finished'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return; end if;
  if v_run.lease_expires_at > now() then
    outcome := 'busy'; run := public.marketing_geo_kb_run_record(v_run);
    operations := public.marketing_geo_kb_run_operations_json(v_run.id); return next; return; end if;
  update public.marketing_geo_kb_runs set state = 'abandoned', lease_expires_at = now(), updated_at = now()
    where id = v_run.id returning * into v_run;
  outcome := 'abandoned'; run := public.marketing_geo_kb_run_record(v_run);
  operations := public.marketing_geo_kb_run_operations_json(v_run.id);
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS on with zero policies; privileges are the boundary. No table-level write
-- for service_role, so every state change goes through the RPCs above and the
-- transition guard cannot be walked around by a future writer.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_runs enable row level security;
alter table public.marketing_geo_kb_run_operations enable row level security;
revoke all on public.marketing_geo_kb_runs, public.marketing_geo_kb_run_operations
  from public, anon, authenticated, service_role;
grant select on public.marketing_geo_kb_runs, public.marketing_geo_kb_run_operations to service_role;

revoke all on function
  public.marketing_geo_kb_run_guard(),
  public.marketing_geo_kb_run_operation_guard(),
  public.marketing_geo_kb_run_record(public.marketing_geo_kb_runs),
  public.marketing_geo_kb_run_operation_record(public.marketing_geo_kb_run_operations),
  public.marketing_geo_kb_run_operations_json(uuid),
  public.marketing_geo_kb_run_operations_valid(jsonb),
  public.marketing_geo_kb_run_insert_operations(public.marketing_geo_kb_runs, jsonb),
  public.marketing_geo_kb_run_lease_valid(public.marketing_geo_kb_runs, uuid),
  public.marketing_geo_claim_kb_run(uuid, uuid, uuid, text, jsonb),
  public.marketing_geo_read_kb_run(uuid, uuid, uuid),
  public.marketing_geo_append_kb_run_operations(uuid, uuid, uuid, jsonb),
  public.marketing_geo_claim_kb_run_operation(uuid, uuid, uuid, text),
  public.marketing_geo_dispatch_kb_run_operation(uuid, uuid, uuid, text),
  public.marketing_geo_finish_kb_run_operation(uuid, uuid, uuid, text, text, text, text),
  public.marketing_geo_probe_kb_run_operation(uuid, uuid, uuid, text, text, text, text),
  public.marketing_geo_bind_kb_run_input(uuid, uuid, uuid, text),
  public.marketing_geo_release_kb_run(uuid, uuid, uuid),
  public.marketing_geo_finish_kb_run(uuid, uuid, uuid),
  public.marketing_geo_abandon_kb_run(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketing_geo_claim_kb_run(uuid, uuid, uuid, text, jsonb),
  public.marketing_geo_read_kb_run(uuid, uuid, uuid),
  public.marketing_geo_append_kb_run_operations(uuid, uuid, uuid, jsonb),
  public.marketing_geo_claim_kb_run_operation(uuid, uuid, uuid, text),
  public.marketing_geo_dispatch_kb_run_operation(uuid, uuid, uuid, text),
  public.marketing_geo_finish_kb_run_operation(uuid, uuid, uuid, text, text, text, text),
  public.marketing_geo_probe_kb_run_operation(uuid, uuid, uuid, text, text, text, text),
  public.marketing_geo_bind_kb_run_input(uuid, uuid, uuid, text),
  public.marketing_geo_release_kb_run(uuid, uuid, uuid),
  public.marketing_geo_finish_kb_run(uuid, uuid, uuid),
  public.marketing_geo_abandon_kb_run(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
