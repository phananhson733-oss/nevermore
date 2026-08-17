-- Credit accounts, an append-only credit ledger, and the singleton settings row
-- that is the runtime authority for every economic number.
--
-- The welfare phase only ever grants: a signup bonus, one grant per UTC day,
-- and a two-sided referral reward. Nothing is charged. But a ledger that can
-- only add is still a ledger, and the failure that matters is double-granting
-- under concurrency: two tabs loading the header badge in the same
-- millisecond, two tool runs finishing together, twenty invitees qualifying at
-- once against a twenty-reward cap. Every one of those is decided inside a
-- single statement or behind a row lock, because the application-level
-- check-then-write has exactly that race and the race is the whole problem.
--
-- Amounts live in credit_settings rather than in application config so that a
-- rolling deploy cannot have two instances granting different numbers on the
-- same day. apps/marketing/src/lib/credits/credits-config.ts records the seed
-- values and a unit test pins it to the defaults below.
--
-- OWNER STEP: run this against the marketing Supabase project before deploying
-- with MARKETING_CREDITS_ENABLED=true. The credits endpoints answer 503 while
-- these tables are missing, so deploying the code first hides the badge and the
-- account page rather than promising a grant it cannot record.

create table if not exists public.credit_accounts (
  user_id                 uuid        primary key,
  status                  text        not null default 'active'
                                      check (status in ('active', 'frozen')),
  permanent_balance       integer     not null default 0 check (permanent_balance >= 0),
  daily_balance           integer     not null default 0 check (daily_balance >= 0),
  daily_granted_on        date,
  daily_accrued_total     integer     not null default 0 check (daily_accrued_total >= 0),
  referral_code           text        not null unique
                                      check (referral_code ~ '^[a-z0-9]{8,16}$'),
  referred_by             uuid        references public.credit_accounts (user_id),
  referral_rewarded_count integer     not null default 0 check (referral_rewarded_count >= 0),
  first_tool_run_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- Self-referral is the cheapest attack there is; refuse it in the schema so
  -- no future caller can reintroduce it.
  check (referred_by is null or referred_by <> user_id)
);

create index if not exists credit_accounts_referred_by_idx
  on public.credit_accounts (referred_by);

create table if not exists public.credit_ledger (
  id                      bigint generated always as identity primary key,
  user_id                 uuid        not null
                                      references public.credit_accounts (user_id),
  entry_type              text        not null check (entry_type in (
                            'signup_bonus', 'daily_grant', 'daily_expire',
                            'consume', 'refund',
                            'referral_reward_inviter', 'referral_reward_invitee',
                            'purchase', 'adjustment')),
  amount                  integer     not null,
  daily_delta             integer     not null default 0,
  permanent_delta         integer     not null default 0,
  balance_daily_after     integer     not null check (balance_daily_after >= 0),
  balance_permanent_after integer     not null check (balance_permanent_after >= 0),
  tool_slug               text        check (char_length(tool_slug) <= 64),
  -- The single reason a replayed report, a double-clicked button and a retried
  -- background job cannot grant twice.
  idempotency_key         text        not null unique
                                      check (char_length(idempotency_key) <= 128),
  metadata                jsonb       not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  check (amount = daily_delta + permanent_delta),
  -- Sign and pool are bound to the entry type, so a miswritten function cannot
  -- record an economically impossible row.
  check (case entry_type
           when 'signup_bonus'            then amount > 0 and daily_delta = 0
           when 'daily_grant'             then amount > 0
           when 'daily_expire'            then amount < 0 and permanent_delta = 0
           when 'consume'                 then amount < 0
           when 'refund'                  then amount >= 0
           when 'referral_reward_inviter' then amount > 0 and daily_delta = 0
           when 'referral_reward_invitee' then amount > 0 and daily_delta = 0
           when 'purchase'                then amount > 0 and daily_delta = 0
           else true
         end)
);

-- Paging is (created_at desc, id desc): created_at alone repeats and drops rows
-- when two entries share a timestamp, which two grants in one transaction do.
create index if not exists credit_ledger_user_page_idx
  on public.credit_ledger (user_id, created_at desc, id desc);

create table if not exists public.credit_settings (
  id                   smallint    primary key check (id = 1),
  mode                 text        not null default 'welfare'
                                   check (mode in ('welfare', 'live')),
  consumption_paused   boolean     not null default false,
  daily_amount         integer     not null default 20 check (daily_amount >= 0),
  welfare_accrual_cap  integer     not null default 600 check (welfare_accrual_cap >= 0),
  referral_daily_cap   integer     not null default 200 check (referral_daily_cap >= 0),
  signup_bonus         integer     not null default 100 check (signup_bonus >= 0),
  referral_reward      integer     not null default 50 check (referral_reward >= 0),
  referral_inviter_cap integer     not null default 20 check (referral_inviter_cap >= 0),
  updated_at           timestamptz not null default now()
);

-- Every function fails closed when this row is absent rather than falling back
-- to a compiled-in default, so the seed belongs to the migration, not a runbook.
insert into public.credit_settings (id) values (1) on conflict (id) do nothing;

-- The global referral brake. A per-instance counter cannot bound a fleet, so
-- the claim is one atomic statement against this row.
create table if not exists public.credit_daily_counters (
  day                date    primary key,
  rewarded_referrals integer not null default 0 check (rewarded_referrals >= 0)
);

/**
 * The ledger is append-only, including for the service role.
 *
 * Without this, "the balance and the ledger disagree" is one stray UPDATE away,
 * and afterwards there is no way to tell which of the two lied.
 */
create or replace function public.credit_ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger is append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists credit_ledger_immutable_row on public.credit_ledger;
create trigger credit_ledger_immutable_row
  before update or delete on public.credit_ledger
  for each row execute function public.credit_ledger_immutable();

drop trigger if exists credit_ledger_immutable_truncate on public.credit_ledger;
create trigger credit_ledger_immutable_truncate
  before truncate on public.credit_ledger
  for each statement execute function public.credit_ledger_immutable();

-- Service-role only. No anon or authenticated policy is granted, so a leaked
-- publishable key cannot read a balance, forge a grant, or enumerate invites.
alter table public.credit_accounts       enable row level security;
alter table public.credit_ledger         enable row level security;
alter table public.credit_settings       enable row level security;
alter table public.credit_daily_counters enable row level security;

/**
 * RLS is not enough on its own: Supabase provisions service_role with BYPASSRLS
 * and ALL privileges on public, and that is the role every server route here
 * connects as. Without this revoke, one stray `update credit_accounts set
 * permanent_balance = ...` from any future route, repair script or SQL editor
 * session silently desynchronises the snapshot from the append-only ledger, and
 * afterwards there is no way to tell which of the two is lying. Making the
 * ledger immutable while leaving the balance writable would protect the copy
 * and not the original.
 *
 * SELECT stays granted: /api/credits/ledger reads the table directly through
 * PostgREST. Writes have exactly one door, the SECURITY DEFINER functions
 * below, which run as the owner and are unaffected by this.
 */
revoke insert, update, delete, truncate on
    public.credit_accounts,
    public.credit_ledger,
    public.credit_settings,
    public.credit_daily_counters
  from anon, authenticated, service_role;

/**
 * A referral code is an identifier, not a secret: the worst case for a guessed
 * code is that a stranger gets credited with someone's signup. random() is
 * therefore sufficient, and it keeps the migration free of a pgcrypto
 * dependency.
 *
 * The alphabet drops l, o, 0 and 1 so a code survives being read aloud.
 */
create or replace function public.credits_generate_referral_code()
returns text
language plpgsql
as $$
declare
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_code     text := '';
  v_i        integer;
begin
  for v_i in 1..8 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * 32)::integer, 1);
  end loop;
  return v_code;
end;
$$;

/**
 * Move a balance and record why, as one pair of statements that cannot be split.
 *
 * Internal: revoked from every role including service_role. SECURITY DEFINER
 * callers run as the owner, so the public functions below still reach it while
 * PostgREST cannot.
 */
create or replace function public.credits__append_entry(
  p_user_id         uuid,
  p_entry_type      text,
  p_daily_delta     integer,
  p_permanent_delta integer,
  p_tool_slug       text,
  p_idempotency_key text,
  p_metadata        jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_daily     integer;
  v_permanent integer;
begin
  -- Enforced here rather than in a CHECK, because CHECK rejects the
  -- non-immutable size functions and these functions are the only writer.
  if octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 4096 then
    raise exception 'credit_ledger metadata exceeds 4096 bytes';
  end if;

  update public.credit_accounts as a
     set daily_balance     = a.daily_balance + p_daily_delta,
         permanent_balance = a.permanent_balance + p_permanent_delta,
         updated_at        = now()
   where a.user_id = p_user_id
  returning a.daily_balance, a.permanent_balance
       into v_daily, v_permanent;

  if not found then
    raise exception 'credit account % does not exist', p_user_id;
  end if;

  insert into public.credit_ledger (
    user_id, entry_type, amount, daily_delta, permanent_delta,
    balance_daily_after, balance_permanent_after,
    tool_slug, idempotency_key, metadata
  ) values (
    p_user_id, p_entry_type, p_daily_delta + p_permanent_delta,
    p_daily_delta, p_permanent_delta, v_daily, v_permanent,
    p_tool_slug, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

/**
 * Create the account on first sight, pay the signup bonus once, and attribute a
 * referral if the visitor arrived through someone's link.
 *
 * Attribution is one-shot: an account that already has a referrer, or that has
 * already qualified a run, cannot be rebound. Otherwise a user could enter
 * through a friend's link the day before their first run and move the reward.
 */
create or replace function public.credits_ensure_account(
  p_user_id       uuid,
  p_referral_code text default null
)
returns table (
  user_id                 uuid,
  status                  text,
  daily_balance           integer,
  permanent_balance       integer,
  daily_granted_on        date,
  daily_accrued_total     integer,
  referral_code           text,
  referred_by             uuid,
  referral_rewarded_count integer,
  first_tool_run_at       timestamptz,
  created                 boolean,
  attributed              boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_created boolean := false;
  v_code    text;
  v_attempt integer;
  v_inviter uuid;
  v_signup  integer;
  v_attributed boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if not exists (
    select 1 from public.credit_accounts as a where a.user_id = p_user_id
  ) then
    -- The retry loop is for referral_code collisions only. A collision that
    -- escaped would cost this visitor their signup bonus.
    for v_attempt in 1..8 loop
      v_code := public.credits_generate_referral_code();
      begin
        insert into public.credit_accounts (user_id, referral_code)
        values (p_user_id, v_code);
        v_created := true;
        exit;
      exception when unique_violation then
        -- Another transaction created THIS account first: not our race to win.
        if exists (
          select 1 from public.credit_accounts as a where a.user_id = p_user_id
        ) then
          exit;
        end if;
      end;
    end loop;

    if v_created then
      select s.signup_bonus into v_signup
        from public.credit_settings as s
       where s.id = 1;
      if v_signup is null then
        raise exception 'credit_settings row is missing';
      end if;
      if v_signup > 0 then
        perform public.credits__append_entry(
          p_user_id, 'signup_bonus', 0, v_signup, null,
          'signup:' || p_user_id::text, '{}'::jsonb);
      end if;
    end if;
  end if;

  if p_referral_code is not null then
    select a.user_id into v_inviter
      from public.credit_accounts as a
     where a.referral_code = lower(p_referral_code)
       and a.user_id <> p_user_id;

    if v_inviter is not null then
      update public.credit_accounts as a
         set referred_by = v_inviter,
             updated_at  = now()
       where a.user_id = p_user_id
         and a.referred_by is null
         and a.first_tool_run_at is null;
      -- Reported separately from referred_by so the caller can tell "this code
      -- stuck" from "some earlier code stuck". Only the first clears the
      -- visitor's cookie; a code that lost the race is still theirs to use on
      -- another account.
      v_attributed := found;
    end if;
  end if;

  return query
    select a.user_id, a.status, a.daily_balance, a.permanent_balance,
           a.daily_granted_on, a.daily_accrued_total, a.referral_code,
           a.referred_by, a.referral_rewarded_count, a.first_tool_run_at,
           v_created, v_attributed
      from public.credit_accounts as a
     where a.user_id = p_user_id;
end;
$$;

/**
 * Grant today's credits if today has not been granted yet. Lazy, so there is no
 * cron job and no clock skew between a scheduler and a request.
 *
 * welfare: the grant accrues into the permanent pool up to a lifetime cap.
 * live:    yesterday's unspent daily balance expires and is replaced, and both
 *          halves are written to the ledger so the account still replays.
 *
 * Zero rows returned means the account does not exist yet.
 */
create or replace function public.credits_touch_daily(p_user_id uuid)
returns table (
  mode                text,
  granted             integer,
  daily_balance       integer,
  permanent_balance   integer,
  daily_accrued_total integer,
  daily_amount        integer,
  welfare_accrual_cap integer,
  daily_granted_on    date,
  referral_inviter_cap integer
)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_today   date := current_date;
  v_mode    text;
  v_amount  integer;
  v_cap     integer;
  v_inviter_cap integer;
  v_account public.credit_accounts%rowtype;
  v_grant   integer := 0;
  v_expire  integer := 0;
  v_key     text := to_char(current_date, 'YYYY-MM-DD');
begin
  select s.mode, s.daily_amount, s.welfare_accrual_cap, s.referral_inviter_cap
    into v_mode, v_amount, v_cap, v_inviter_cap
    from public.credit_settings as s
   where s.id = 1;
  if v_mode is null then
    raise exception 'credit_settings row is missing';
  end if;

  -- The lock is what makes "granted today?" a decision rather than a guess.
  select * into v_account
    from public.credit_accounts as a
   where a.user_id = p_user_id
     for update;
  if not found then
    return;
  end if;

  if v_account.status = 'active'
     and v_account.daily_granted_on is distinct from v_today then
    if v_mode = 'welfare' then
      v_grant := least(v_amount, greatest(v_cap - v_account.daily_accrued_total, 0));
      if v_grant > 0 then
        update public.credit_accounts as a
           set daily_accrued_total = a.daily_accrued_total + v_grant
         where a.user_id = p_user_id;
        perform public.credits__append_entry(
          p_user_id, 'daily_grant', 0, v_grant, null,
          'daily:' || p_user_id::text || ':' || v_key,
          jsonb_build_object('mode', 'welfare'));
      end if;
    else
      v_expire := v_account.daily_balance;
      if v_expire > 0 then
        perform public.credits__append_entry(
          p_user_id, 'daily_expire', -v_expire, 0, null,
          'daily-expire:' || p_user_id::text || ':' || v_key, '{}'::jsonb);
      end if;
      v_grant := v_amount;
      if v_grant > 0 then
        perform public.credits__append_entry(
          p_user_id, 'daily_grant', v_grant, 0, null,
          'daily:' || p_user_id::text || ':' || v_key,
          jsonb_build_object('mode', 'live'));
      end if;
    end if;

    -- Stamped even when the cap left nothing to grant, so a capped account
    -- stops re-deciding on every badge poll.
    update public.credit_accounts as a
       set daily_granted_on = v_today,
           updated_at       = now()
     where a.user_id = p_user_id;
  end if;

  return query
    select v_mode, v_grant, a.daily_balance, a.permanent_balance,
           a.daily_accrued_total, v_amount, v_cap, a.daily_granted_on,
           v_inviter_cap
      from public.credit_accounts as a
     where a.user_id = p_user_id;
end;
$$;

/**
 * Pay the two-sided referral reward the first time an invitee finishes a
 * qualifying tool run.
 *
 * The order is load-bearing. The global brake is claimed BEFORE
 * first_tool_run_at is stamped, so a refused claim leaves the account able to
 * qualify tomorrow. Stamping first would silently and permanently void a
 * legitimate invitee's reward on a busy day.
 *
 * Any referral chain qualifying at the same instant can deadlock, not only
 * reciprocal pairs: with A referred by B and B referred by C, A's transaction
 * holds A and wants B while B's holds B and wants the same counter row. That is
 * acceptable rather than fixed, because the failure is self-healing: Postgres
 * aborts one side, the whole transaction rolls back INCLUDING the first-run
 * stamp, and the invitee's next successful run claims the reward. Ordering the
 * locks would mean reading referred_by before locking the invitee, which
 * reintroduces the check-then-write race this function exists to remove.
 */
create or replace function public.credits_reward_referral(
  p_invitee_id uuid,
  p_tool_slug  text default null
)
returns table (rewarded boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  v_today        date := current_date;
  v_reward       integer;
  v_daily_cap    integer;
  v_inviter_cap  integer;
  v_account      public.credit_accounts%rowtype;
  v_claimed      integer;
  v_inviter      uuid;
  v_inviter_rows integer;
begin
  select s.referral_reward, s.referral_daily_cap, s.referral_inviter_cap
    into v_reward, v_daily_cap, v_inviter_cap
    from public.credit_settings as s
   where s.id = 1;
  if v_reward is null then
    raise exception 'credit_settings row is missing';
  end if;

  select * into v_account
    from public.credit_accounts as a
   where a.user_id = p_invitee_id
     for update;
  if not found then
    return query select false, 'no_account'::text;
    return;
  end if;
  if v_account.first_tool_run_at is not null then
    return query select false, 'already_marked'::text;
    return;
  end if;
  if v_account.status <> 'active' then
    return query select false, 'frozen'::text;
    return;
  end if;

  if v_account.referred_by is null then
    -- No referrer: stamp anyway. It closes attribution so a later link cannot
    -- rebind the account, and there is no reward at stake to lose.
    update public.credit_accounts as a
       set first_tool_run_at = now(),
           updated_at        = now()
     where a.user_id = p_invitee_id;
    return query select false, 'no_referrer'::text;
    return;
  end if;
  v_inviter := v_account.referred_by;

  if v_daily_cap < 1 then
    return query select false, 'global_cap'::text;
    return;
  end if;

  insert into public.credit_daily_counters as c (day, rewarded_referrals)
  values (v_today, 1)
      on conflict (day) do update
     set rewarded_referrals = c.rewarded_referrals + 1
   where c.rewarded_referrals < v_daily_cap
  returning c.rewarded_referrals into v_claimed;

  if v_claimed is null then
    return query select false, 'global_cap'::text;
    return;
  end if;

  update public.credit_accounts as a
     set first_tool_run_at = now(),
         updated_at        = now()
   where a.user_id = p_invitee_id;

  -- Guarded like the signup and daily grants above. The settings table permits
  -- a reward of zero, and an operator reaching for it to stop payouts would
  -- otherwise hit the ledger's amount > 0 check, roll the whole transaction
  -- back, and make every later qualifying run raise the same error forever.
  if v_reward > 0 then
    perform public.credits__append_entry(
      p_invitee_id, 'referral_reward_invitee', 0, v_reward, p_tool_slug,
      'referral-invitee:' || p_invitee_id::text,
      jsonb_build_object('inviter', v_inviter));
  end if;

  -- Atomic claim against the inviter's lifetime cap: a plain read-then-write
  -- lets twenty concurrent invitees push a cap of twenty to twenty-one.
  update public.credit_accounts as a
     set referral_rewarded_count = a.referral_rewarded_count + 1,
         updated_at              = now()
   where a.user_id = v_inviter
     and a.status = 'active'
     and a.referral_rewarded_count < v_inviter_cap;
  get diagnostics v_inviter_rows = row_count;

  if v_inviter_rows > 0 and v_reward > 0 then
    perform public.credits__append_entry(
      v_inviter, 'referral_reward_inviter', 0, v_reward, p_tool_slug,
      'referral-inviter:' || p_invitee_id::text,
      jsonb_build_object('invitee', p_invitee_id));
  end if;

  return query select true,
    (case when v_inviter_rows > 0 then 'rewarded_both'
          else 'rewarded_invitee_only' end)::text;
end;
$$;

revoke all on function public.credits_generate_referral_code()
  from public, anon, authenticated, service_role;
revoke all on function public.credits__append_entry(uuid, text, integer, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.credits_ensure_account(uuid, text) from public, anon, authenticated;
grant execute on function public.credits_ensure_account(uuid, text) to service_role;

revoke all on function public.credits_touch_daily(uuid) from public, anon, authenticated;
grant execute on function public.credits_touch_daily(uuid) to service_role;

revoke all on function public.credits_reward_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.credits_reward_referral(uuid, text) to service_role;
