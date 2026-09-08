-- The website evidence observation ledger (design 2026-09-07, slice S2).
--
-- One real fetch is one row. A row is never updated and never deleted, and
-- reuse is decided on TIME alone: "how old is the newest observation of this
-- exact thing", never "did the bytes change".
--
-- Why that matters enough to be a table rule rather than a caller convention:
-- the tempting shortcut is to re-fetch, compare `body_hash`, and -- when it
-- matches -- move the stored row's `observed_at` forward instead of appending.
-- That rewrites the past. A snapshot published two months ago points at the
-- observations that supported it; touching the timestamp would date that
-- evidence today on the version card, in the export and in the Brief, and
-- nothing would say otherwise. So the write RPC only ever appends, and the
-- triggers below make "only ever appends" true for every future writer as
-- well, not just for the one that exists today.
--
-- The shipped repository this must satisfy is
-- apps/marketing/src/lib/geo-tools/kb-evidence-observations.ts; its tests are
-- the arbiter wherever this file and the proposal doc disagree.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Excerpt validity
--
-- A CHECK cannot contain a subquery, so the per-element rules live in an
-- IMMUTABLE helper. They exist because the reader enforces them: `rowSchema`
-- caps the array at 8 and every element at 1..1200 characters, and a row that
-- violates either is stored fine and then refused on the way out -- which the
-- caller sees as `unavailable`, i.e. "fetch it again", forever. A ledger that
-- can hold rows its only reader rejects is worse than one that refuses them.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_website_evidence_excerpts_valid(p_excerpts jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_excerpts) = 'array'
    and jsonb_array_length(p_excerpts) <= 8
    and octet_length(p_excerpts::text) <= 65536
    and not exists (
      select 1 from jsonb_array_elements(p_excerpts) entry
      where jsonb_typeof(entry.value) <> 'string'
        or char_length(entry.value #>> '{}') not between 1 and 1200
    )
$$;

create table if not exists public.marketing_website_evidence_observations (
  id            uuid        primary key default gen_random_uuid(),
  website_id    uuid        not null,
  user_id       uuid        not null,
  kind          text        not null
                            check (kind in ('own_page','competitor_page','robots','sitemap','llms','gsc','third_party')),
  -- For kind='gsc' this holds `property + window`, not a URL. See the
  -- marketing_website_evidence_gsc_url constraint below.
  --
  -- Bounded in BYTES as well as characters, and not only for storage: this
  -- column is the third key column of the natural-key index, and a btree tuple
  -- over a 2048-character multibyte URL can exceed the 2704-byte index row
  -- limit. That failure arrives as 54000 from deep inside the insert rather
  -- than as a check violation, so the byte bound converts it into an ordinary
  -- refusal the caller can read.
  url           text        not null
                            check (char_length(url) between 1 and 2048 and octet_length(url) <= 2048),
  observed_at   timestamptz not null,
  status        text        not null check (status in ('ok','unavailable')),
  -- `rate_limited` is deliberately absent. A gate refusal is an observation of
  -- OUR quota, not of the target; recording it would put a row in the evidence
  -- ledger that says nothing about the site, and -- because freshness is
  -- time-only -- one busy minute would suppress the real fetch for a whole TTL.
  status_reason text        check (status_reason in
                              ('not_found','not_published','fetch_failed','blocked','timeout',
                               'invalid_response','partial_body','insufficient_evidence')),
  body_hash     text        check (body_hash ~ '^[a-f0-9]{64}$'),
  excerpts      jsonb       not null default '[]'::jsonb
                            check (public.marketing_website_evidence_excerpts_valid(excerpts)),
  structured    jsonb       not null default '{}'::jsonb
                            check (jsonb_typeof(structured)='object' and octet_length(structured::text) <= 65536),
  independence  text        check (independence in ('independent','self_submitted','syndicated','undetermined')),
  created_at    timestamptz not null default now(),

  -- Re-running an update inside one second cannot produce two rows for the same
  -- observation, and an append that repeats one is idempotent rather than an
  -- error.
  constraint marketing_website_evidence_natural_key
    unique (website_id, kind, url, observed_at),

  -- An unavailable observation carries no body and no content. Without this a
  -- failed fetch could be stored with the previous run's excerpts and would
  -- read downstream as a successful observation.
  constraint marketing_website_evidence_status_shape check (
    (status = 'ok' and status_reason is null and body_hash is not null)
    or (status = 'unavailable' and status_reason is not null and body_hash is null
        and excerpts = '[]'::jsonb and structured = '{}'::jsonb)
  ),

  -- Independence is a third-party judgement only (design R6 / L2). Setting it
  -- on an own_page row would let self-published material claim independence;
  -- leaving it off a third_party row would make "we did not judge" and
  -- "undetermined" indistinguishable, and `undetermined` is a verdict.
  constraint marketing_website_evidence_independence_scope check (
    (kind = 'third_party') = (independence is not null)
  ),

  -- GSC has no URL. Its identity is the property plus the exact window, so a
  -- different window is a different observation rather than a refresh of the
  -- old one. Shape: `<property>#YYYY-MM-DD..YYYY-MM-DD` (geoEvidenceGscKey()).
  --
  -- The property bound is NOT written as `{1,1024}`: PostgreSQL caps a bounded
  -- repetition at 255 and raises "invalid repetition count(s)" when the regex
  -- is EVALUATED, not when the constraint is created -- so a larger count
  -- installs cleanly and then fails every single GSC insert. `strpos` carries
  -- the same bound with no ceiling of its own.
  constraint marketing_website_evidence_gsc_url check (
    kind <> 'gsc'
    or (url ~ '^[^#]+#[0-9]{4}-[0-9]{2}-[0-9]{2}\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and strpos(url, '#') <= 1025)
  ),

  foreign key (website_id, user_id)
    references public.marketing_websites (id, user_id) on delete restrict
);

-- The only hot read: newest observation for one (website, kind, url).
create index if not exists marketing_website_evidence_latest_idx
  on public.marketing_website_evidence_observations (website_id, kind, url, observed_at desc, id desc);

-- Owner-scoped listing for the version card and the export.
create index if not exists marketing_website_evidence_owner_idx
  on public.marketing_website_evidence_observations (user_id, website_id, observed_at desc, id desc);

-- No sweep index on observed_at: this table has no TTL sweep. The TTL decides
-- whether to re-fetch, not whether a row still exists; deleting old rows would
-- delete the evidence a published snapshot cites.

-- ---------------------------------------------------------------------------
-- 2. Append-only, enforced at the table
--
-- Two triggers. The row-level one blocks UPDATE and DELETE; the statement-level
-- one blocks TRUNCATE, which does not fire row triggers at all -- a lone row
-- trigger is a locked door beside an open one.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_website_evidence_observations_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Website evidence observations are append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists marketing_website_evidence_immutable_row
  on public.marketing_website_evidence_observations;
create trigger marketing_website_evidence_immutable_row
  before update or delete on public.marketing_website_evidence_observations
  for each row execute function public.marketing_website_evidence_observations_immutable();

drop trigger if exists marketing_website_evidence_immutable_truncate
  on public.marketing_website_evidence_observations;
create trigger marketing_website_evidence_immutable_truncate
  before truncate on public.marketing_website_evidence_observations
  for each statement execute function public.marketing_website_evidence_observations_immutable();

-- ---------------------------------------------------------------------------
-- 3. Projection
--
-- One place builds the JSON both RPCs return, so the read and the write cannot
-- drift into describing the same row differently.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_website_evidence_observation_record(
  p_row public.marketing_website_evidence_observations
) returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object(
    'schemaVersion','marketing-website-evidence-observation.v1',
    'observationId', p_row.id,
    'websiteId',     p_row.website_id,
    'kind',          p_row.kind,
    'url',           p_row.url,
    -- Rendered in exactly the spelling JS `toISOString()` produces.
    -- PostgreSQL's own timestamptz text is microsecond precision with a numeric
    -- offset (`2026-09-07T06:50:55.033741+00:00`); a reader comparing against
    -- `new Date(v).toISOString()` rejects that spelling, and this repo has
    -- already lost a whole cache to exactly that seam.
    'observedAt',    to_char(p_row.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status',        p_row.status,
    'statusReason',  p_row.status_reason,
    'bodyHash',      p_row.body_hash,
    'excerpts',      p_row.excerpts,
    'structured',    p_row.structured,
    'independence',  p_row.independence
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Read: the newest observation of one exact (kind, url)
--
-- Freshness is deliberately NOT decided here. This answers "what is the newest
-- one"; `isObservationFresh()` answers "does it still stand in for a fetch",
-- because one update judges many targets against a single clock and because
-- the TTL is a product decision that must not be buried in DDL.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_website_read_latest_evidence_observation(
  p_user_id uuid, p_website_id uuid, p_kind text, p_url text
) returns table (outcome text, observation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_row public.marketing_website_evidence_observations;
begin
  -- Ownership is proved here, not assumed from the website id. service_role
  -- bypasses RLS, so without this a handler bug that passes the wrong id reads
  -- another account's observations.
  perform 1 from public.marketing_websites w where w.id = p_website_id and w.user_id = p_user_id;
  if not found then outcome := 'not_found'; return next; return; end if;
  select o.* into v_row from public.marketing_website_evidence_observations o
    where o.website_id = p_website_id and o.user_id = p_user_id
      and o.kind = p_kind and o.url = p_url
    order by o.observed_at desc, o.id desc limit 1;
  if not found then outcome := 'none'; return next; return; end if;
  outcome := 'found';
  observation := public.marketing_website_evidence_observation_record(v_row);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Write: append exactly one observation
--
-- Every guard below is explicit about NULL. `p_observed_at > now() + ...` is
-- NULL when the parameter is missing, an IF on NULL takes the false branch,
-- and the row would fall through this guard into the insert; the same collapse
-- has already shipped twice in this schema. So the null test is written out.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_website_record_evidence_observation(
  p_user_id uuid, p_website_id uuid, p_kind text, p_url text, p_observed_at timestamptz,
  p_status text, p_status_reason text, p_body_hash text,
  p_excerpts jsonb, p_structured jsonb, p_independence text
) returns table (outcome text, observation jsonb)
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_row public.marketing_website_evidence_observations;
begin
  perform 1 from public.marketing_websites w where w.id = p_website_id and w.user_id = p_user_id;
  if not found then outcome := 'not_found'; return next; return; end if;

  -- An observation time is when we looked. A future timestamp would suppress
  -- every re-fetch until that time arrives; one from the distant past would be
  -- appended below rows that already exist and never be read again.
  if p_observed_at is null
     or p_observed_at > now() + interval '2 minutes'
     or p_observed_at < now() - interval '30 days' then
    outcome := 'invalid'; return next; return;
  end if;

  insert into public.marketing_website_evidence_observations (
      website_id, user_id, kind, url, observed_at, status, status_reason,
      body_hash, excerpts, structured, independence)
    values (p_website_id, p_user_id, p_kind, p_url, p_observed_at, p_status, p_status_reason,
      p_body_hash, coalesce(p_excerpts,'[]'::jsonb), coalesce(p_structured,'{}'::jsonb), p_independence)
    on conflict (website_id, kind, url, observed_at) do nothing
    returning * into v_row;
  if found then
    outcome := 'recorded';
    observation := public.marketing_website_evidence_observation_record(v_row);
    return next; return;
  end if;

  -- Same natural key already present: the append is idempotent, and the caller
  -- gets the row that is actually stored rather than the one it tried to write.
  select o.* into v_row from public.marketing_website_evidence_observations o
    where o.website_id = p_website_id and o.user_id = p_user_id and o.kind = p_kind
      and o.url = p_url and o.observed_at = p_observed_at;
  -- Unreachable through the unique index, but a projection of a NULL row would
  -- return an object of nulls that the reader would have to reject; say
  -- "invalid" instead of handing back something shaped like an observation.
  if not found then outcome := 'invalid'; return next; return; end if;
  outcome := 'duplicate';
  observation := public.marketing_website_evidence_observation_record(v_row);
  return next;
exception
  -- 54000 comes from the natural-key index when a tuple is too wide; the byte
  -- bound on `url` should prevent it, and this keeps it a refusal either way.
  when check_violation or invalid_text_representation or not_null_violation
    or foreign_key_violation or program_limit_exceeded then
  outcome := 'invalid'; return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Privileges
--
-- RLS on with zero policies, and privileges as the actual boundary: no browser
-- role reaches the table, and service_role gets no table-level INSERT. Every
-- write goes through the RPC above, so "a writer must first prove this website
-- belongs to this user" is structural rather than a rule writers remember.
-- ---------------------------------------------------------------------------
alter table public.marketing_website_evidence_observations enable row level security;
revoke all on public.marketing_website_evidence_observations
  from public, anon, authenticated, service_role;
grant select on public.marketing_website_evidence_observations to service_role;

revoke all on function
  public.marketing_website_evidence_excerpts_valid(jsonb),
  public.marketing_website_evidence_observations_immutable(),
  public.marketing_website_evidence_observation_record(public.marketing_website_evidence_observations),
  public.marketing_website_read_latest_evidence_observation(uuid, uuid, text, text),
  public.marketing_website_record_evidence_observation(uuid, uuid, text, text, timestamptz, text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketing_website_read_latest_evidence_observation(uuid, uuid, text, text),
  public.marketing_website_record_evidence_observation(uuid, uuid, text, text, timestamptz, text, text, text, jsonb, jsonb, text)
  to service_role;

notify pgrst, 'reload schema';
