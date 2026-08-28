-- Private Marketing account websites, one mutable Product/ICP draft per site,
-- and immutable confirmed profile snapshots.
--
-- This is intentionally separate from apps/web canonical Product Profile data.
-- Browser roles receive no table privileges or policies. Server routes verify
-- the Supabase user, then use service-role SELECTs scoped by user_id and the
-- SECURITY DEFINER RPCs below for writes.

create table if not exists public.marketing_websites (
  id                            uuid        primary key default gen_random_uuid(),
  user_id                       uuid        not null,
  canonical_site_key             text        not null
                                            check (char_length(canonical_site_key) between 1 and 255),
  origin                         text        not null
                                            check (char_length(origin) between 1 and 2048),
  submitted_url                  text        not null
                                            check (char_length(submitted_url) between 1 and 2048),
  host                           text        not null
                                            check (char_length(host) between 1 and 255),
  display_name                   text
                                            check (display_name is null or char_length(display_name) between 1 and 160),
  is_primary                     boolean     not null default false,
  current_confirmed_snapshot_id  uuid,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint marketing_websites_user_site_key_unique
    unique (user_id, canonical_site_key),
  unique (id, user_id)
);

create unique index if not exists marketing_websites_one_primary_per_user_idx
  on public.marketing_websites (user_id)
  where is_primary;

create index if not exists marketing_websites_user_list_idx
  on public.marketing_websites (user_id, is_primary desc, created_at, id);

create table if not exists public.marketing_website_profile_drafts (
  website_id      uuid        primary key,
  user_id         uuid        not null,
  schema_version  text        not null
                              check (schema_version = 'marketing-website-profile.v1'),
  draft_version   integer     not null check (draft_version >= 1),
  profile         jsonb       not null
                              check (octet_length(profile::text) <= 131072),
  content_hash    text        not null
                              check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (website_id, user_id)
    references public.marketing_websites (id, user_id)
    on delete restrict
);

create index if not exists marketing_website_profile_drafts_user_idx
  on public.marketing_website_profile_drafts (user_id, website_id);

create table if not exists public.marketing_website_profile_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  website_id            uuid        not null,
  user_id               uuid        not null,
  revision              integer     not null check (revision >= 1),
  schema_version        text        not null
                                    check (schema_version = 'marketing-website-profile.v1'),
  profile               jsonb       not null
                                    check (octet_length(profile::text) <= 131072),
  content_hash          text        not null
                                    check (content_hash ~ '^[a-f0-9]{64}$'),
  source_draft_version  integer     not null check (source_draft_version >= 1),
  confirmed_at          timestamptz not null default now(),
  unique (website_id, revision),
  unique (website_id, content_hash),
  unique (id, website_id, user_id),
  foreign key (website_id, user_id)
    references public.marketing_websites (id, user_id)
    on delete restrict
);

create index if not exists marketing_website_profile_snapshots_user_idx
  on public.marketing_website_profile_snapshots
  (user_id, website_id, revision desc);

alter table public.marketing_websites
  drop constraint if exists marketing_websites_current_snapshot_fkey;
alter table public.marketing_websites
  add constraint marketing_websites_current_snapshot_fkey
  foreign key (current_confirmed_snapshot_id, id, user_id)
  references public.marketing_website_profile_snapshots (id, website_id, user_id)
  deferrable initially immediate;

create or replace function public.marketing_website_profile_snapshots_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'marketing website profile snapshots are append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists marketing_website_profile_snapshots_immutable_row
  on public.marketing_website_profile_snapshots;
create trigger marketing_website_profile_snapshots_immutable_row
  before update or delete on public.marketing_website_profile_snapshots
  for each row execute function public.marketing_website_profile_snapshots_immutable();

drop trigger if exists marketing_website_profile_snapshots_immutable_truncate
  on public.marketing_website_profile_snapshots;
create trigger marketing_website_profile_snapshots_immutable_truncate
  before truncate on public.marketing_website_profile_snapshots
  for each statement execute function public.marketing_website_profile_snapshots_immutable();

alter table public.marketing_websites enable row level security;
alter table public.marketing_website_profile_drafts enable row level security;
alter table public.marketing_website_profile_snapshots enable row level security;

revoke all on
  public.marketing_websites,
  public.marketing_website_profile_drafts,
  public.marketing_website_profile_snapshots
from anon, authenticated;

revoke insert, update, delete, truncate on
  public.marketing_websites,
  public.marketing_website_profile_drafts,
  public.marketing_website_profile_snapshots
from service_role;

grant select on
  public.marketing_websites,
  public.marketing_website_profile_drafts,
  public.marketing_website_profile_snapshots
to service_role;

-- Match the client contract's canonical JSON domain: object keys are sorted,
-- array order is retained, and no presentation whitespace participates.
create or replace function public.marketing_canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_kind text;
  v_result text;
begin
  v_kind := pg_catalog.jsonb_typeof(p_value);
  if v_kind = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(entry.key)::text || ':' ||
        public.marketing_canonical_jsonb_text(entry.value),
        ',' order by entry.key
      ),
      ''
    ) || '}'
      into v_result
      from pg_catalog.jsonb_each(p_value) as entry(key, value);
    return v_result;
  end if;
  if v_kind = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(
        public.marketing_canonical_jsonb_text(entry.value),
        ',' order by entry.ordinality
      ),
      ''
    ) || ']'
      into v_result
      from pg_catalog.jsonb_array_elements(p_value)
        with ordinality as entry(value, ordinality);
    return v_result;
  end if;
  return p_value::text;
end;
$$;

create or replace function public.marketing_canonical_website_profile_text(
  p_profile jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_provenance jsonb;
  v_normalized jsonb;
begin
  if pg_catalog.jsonb_typeof(p_profile) <> 'object' or
     pg_catalog.jsonb_typeof(p_profile -> 'fieldProvenance') <> 'array' then
    raise exception 'website profile is not a versioned object';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(entry.value order by entry.value ->> 'path'),
    '[]'::jsonb
  )
    into v_provenance
    from pg_catalog.jsonb_array_elements(
      p_profile -> 'fieldProvenance'
    ) as entry(value);
  v_normalized := pg_catalog.jsonb_set(
    p_profile,
    '{fieldProvenance}',
    v_provenance,
    false
  );
  return public.marketing_canonical_jsonb_text(v_normalized);
end;
$$;

create or replace function public.marketing_add_website(
  p_user_id uuid,
  p_submitted_url text,
  p_origin text,
  p_host text,
  p_canonical_site_key text,
  p_display_name text default null
)
returns table (
  outcome text,
  website_id uuid,
  canonical_site_key text,
  is_primary boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_row public.marketing_websites;
  v_created boolean := false;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  insert into public.marketing_websites as w (
    user_id, submitted_url, origin, host, canonical_site_key, display_name,
    is_primary
  )
  values (
    p_user_id,
    p_submitted_url,
    p_origin,
    p_host,
    p_canonical_site_key,
    nullif(pg_catalog.btrim(p_display_name), ''),
    not exists (
      select 1
        from public.marketing_websites as existing
       where existing.user_id = p_user_id
         and existing.is_primary
    )
  )
  on conflict on constraint marketing_websites_user_site_key_unique do nothing
  returning w.* into v_row;

  if found then
    v_created := true;
  else
    select w.* into strict v_row
      from public.marketing_websites as w
     where w.user_id = p_user_id
       and w.canonical_site_key = p_canonical_site_key;
  end if;

  outcome := case when v_created then 'created' else 'duplicate' end;
  website_id := v_row.id;
  canonical_site_key := v_row.canonical_site_key;
  is_primary := v_row.is_primary;
  return next;
end;
$$;

create or replace function public.marketing_set_primary_website(
  p_user_id uuid,
  p_website_id uuid
)
returns table (
  outcome text,
  website_id uuid,
  canonical_site_key text,
  is_primary boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_row public.marketing_websites;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  select w.* into v_row
    from public.marketing_websites as w
   where w.id = p_website_id
     and w.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    website_id := null;
    canonical_site_key := null;
    is_primary := null;
    return next;
    return;
  end if;

  update public.marketing_websites as w
     set is_primary = (w.id = p_website_id),
         updated_at = case
           when w.is_primary is distinct from (w.id = p_website_id)
             then pg_catalog.now()
           else w.updated_at
         end
   where w.user_id = p_user_id;

  select w.* into strict v_row
    from public.marketing_websites as w
   where w.id = p_website_id
     and w.user_id = p_user_id;
  outcome := 'ok';
  website_id := v_row.id;
  canonical_site_key := v_row.canonical_site_key;
  is_primary := v_row.is_primary;
  return next;
end;
$$;

create or replace function public.marketing_save_website_profile_draft(
  p_user_id uuid,
  p_website_id uuid,
  p_base_version integer,
  p_schema_version text,
  p_profile jsonb,
  p_canonical_profile text,
  p_content_hash text
)
returns table (
  outcome text,
  draft_version integer,
  profile jsonb,
  content_hash text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_website_id uuid;
  v_draft public.marketing_website_profile_drafts;
  v_hash_valid boolean := false;
  v_expected_canonical text;
begin
  select w.id into v_website_id
    from public.marketing_websites as w
   where w.id = p_website_id
     and w.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    draft_version := null;
    profile := null;
    content_hash := null;
    updated_at := null;
    return next;
    return;
  end if;

  select d.* into v_draft
    from public.marketing_website_profile_drafts as d
   where d.website_id = p_website_id
     and d.user_id = p_user_id
   for update;

  if not found then
    if p_base_version is distinct from 0 then
      outcome := 'conflict';
      draft_version := null;
      profile := null;
      content_hash := null;
      updated_at := null;
      return next;
      return;
    end if;
  elsif p_base_version is distinct from v_draft.draft_version then
    outcome := 'conflict';
    draft_version := v_draft.draft_version;
    profile := v_draft.profile;
    content_hash := v_draft.content_hash;
    updated_at := v_draft.updated_at;
    return next;
    return;
  end if;

  begin
    v_expected_canonical :=
      public.marketing_canonical_website_profile_text(p_profile);
    v_hash_valid :=
      p_canonical_profile is not null and
      p_canonical_profile = v_expected_canonical and
      pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(v_expected_canonical, 'UTF8')),
        'hex'
      ) = p_content_hash;
  exception when others then
    v_hash_valid := false;
  end;
  if not v_hash_valid then
    outcome := 'invalid_hash';
    draft_version := null;
    profile := null;
    content_hash := null;
    updated_at := null;
    return next;
    return;
  end if;

  if v_draft.website_id is null then
    insert into public.marketing_website_profile_drafts as d (
      website_id, user_id, schema_version, draft_version, profile, content_hash
    ) values (
      p_website_id, p_user_id, p_schema_version, 1, p_profile, p_content_hash
    )
    returning d.* into v_draft;
  elsif p_content_hash is distinct from v_draft.content_hash then
    update public.marketing_website_profile_drafts as d
       set schema_version = p_schema_version,
           draft_version = d.draft_version + 1,
           profile = p_profile,
           content_hash = p_content_hash,
           updated_at = pg_catalog.now()
     where d.website_id = p_website_id
       and d.user_id = p_user_id
    returning d.* into v_draft;
  end if;

  outcome := 'ok';
  draft_version := v_draft.draft_version;
  profile := v_draft.profile;
  content_hash := v_draft.content_hash;
  updated_at := v_draft.updated_at;
  return next;
end;
$$;

create or replace function public.marketing_save_website_profile_draft_from_snapshot(
  p_user_id uuid,
  p_website_id uuid,
  p_base_version integer,
  p_schema_version text,
  p_profile jsonb,
  p_canonical_profile text,
  p_content_hash text,
  p_expected_snapshot_id uuid,
  p_expected_snapshot_hash text
)
returns table (
  outcome text,
  draft_version integer,
  profile jsonb,
  content_hash text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_website public.marketing_websites;
  v_snapshot public.marketing_website_profile_snapshots;
  v_draft public.marketing_website_profile_drafts;
begin
  select w.* into v_website
    from public.marketing_websites as w
   where w.id = p_website_id
     and w.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    draft_version := null;
    profile := null;
    content_hash := null;
    updated_at := null;
    return next;
    return;
  end if;

  select d.* into v_draft
    from public.marketing_website_profile_drafts as d
   where d.website_id = p_website_id
     and d.user_id = p_user_id;

  if v_website.current_confirmed_snapshot_id is distinct from
       p_expected_snapshot_id then
    outcome := 'snapshot_conflict';
    draft_version := v_draft.draft_version;
    profile := v_draft.profile;
    content_hash := v_draft.content_hash;
    updated_at := v_draft.updated_at;
    return next;
    return;
  end if;

  select s.* into v_snapshot
    from public.marketing_website_profile_snapshots as s
   where s.id = p_expected_snapshot_id
     and s.website_id = p_website_id
     and s.user_id = p_user_id;
  if not found or
     v_snapshot.content_hash is distinct from p_expected_snapshot_hash then
    outcome := 'snapshot_conflict';
    draft_version := v_draft.draft_version;
    profile := v_draft.profile;
    content_hash := v_draft.content_hash;
    updated_at := v_draft.updated_at;
    return next;
    return;
  end if;

  return query
    select saved.outcome,
           saved.draft_version,
           saved.profile,
           saved.content_hash,
           saved.updated_at
      from public.marketing_save_website_profile_draft(
        p_user_id,
        p_website_id,
        p_base_version,
        p_schema_version,
        p_profile,
        p_canonical_profile,
        p_content_hash
      ) as saved;
end;
$$;

create or replace function public.marketing_confirm_website_profile(
  p_user_id uuid,
  p_website_id uuid,
  p_base_version integer
)
returns table (
  outcome text,
  snapshot_id uuid,
  snapshot_revision integer,
  profile jsonb,
  content_hash text,
  source_draft_version integer,
  confirmed_at timestamptz,
  reused_existing boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_website_id uuid;
  v_draft public.marketing_website_profile_drafts;
  v_snapshot public.marketing_website_profile_snapshots;
  v_revision integer;
begin
  select w.id into v_website_id
    from public.marketing_websites as w
   where w.id = p_website_id
     and w.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    snapshot_id := null;
    snapshot_revision := null;
    profile := null;
    content_hash := null;
    source_draft_version := null;
    confirmed_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  select d.* into v_draft
    from public.marketing_website_profile_drafts as d
   where d.website_id = p_website_id
     and d.user_id = p_user_id
   for update;
  if not found then
    outcome := 'no_draft';
    snapshot_id := null;
    snapshot_revision := null;
    profile := null;
    content_hash := null;
    source_draft_version := null;
    confirmed_at := null;
    reused_existing := null;
    return next;
    return;
  end if;
  if p_base_version is distinct from v_draft.draft_version then
    outcome := 'conflict';
    snapshot_id := null;
    snapshot_revision := null;
    profile := v_draft.profile;
    content_hash := v_draft.content_hash;
    source_draft_version := v_draft.draft_version;
    confirmed_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  select s.* into v_snapshot
    from public.marketing_website_profile_snapshots as s
   where s.website_id = p_website_id
     and s.user_id = p_user_id
     and s.content_hash = v_draft.content_hash
   order by s.revision desc
   limit 1;

  if found then
    update public.marketing_websites as w
       set current_confirmed_snapshot_id = v_snapshot.id,
           updated_at = pg_catalog.now()
     where w.id = p_website_id
       and w.user_id = p_user_id;
    outcome := 'ok';
    snapshot_id := v_snapshot.id;
    snapshot_revision := v_snapshot.revision;
    profile := v_snapshot.profile;
    content_hash := v_snapshot.content_hash;
    source_draft_version := v_snapshot.source_draft_version;
    confirmed_at := v_snapshot.confirmed_at;
    reused_existing := true;
    return next;
    return;
  end if;

  select coalesce(pg_catalog.max(s.revision), 0) + 1
    into v_revision
    from public.marketing_website_profile_snapshots as s
   where s.website_id = p_website_id;

  insert into public.marketing_website_profile_snapshots as s (
    website_id, user_id, revision, schema_version, profile, content_hash,
    source_draft_version
  ) values (
    p_website_id, p_user_id, v_revision, v_draft.schema_version,
    v_draft.profile, v_draft.content_hash, v_draft.draft_version
  )
  returning s.* into v_snapshot;

  update public.marketing_websites as w
     set current_confirmed_snapshot_id = v_snapshot.id,
         updated_at = pg_catalog.now()
   where w.id = p_website_id
     and w.user_id = p_user_id;

  outcome := 'ok';
  snapshot_id := v_snapshot.id;
  snapshot_revision := v_snapshot.revision;
  profile := v_snapshot.profile;
  content_hash := v_snapshot.content_hash;
  source_draft_version := v_snapshot.source_draft_version;
  confirmed_at := v_snapshot.confirmed_at;
  reused_existing := false;
  return next;
end;
$$;

revoke all on function public.marketing_website_profile_snapshots_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.marketing_canonical_jsonb_text(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.marketing_canonical_website_profile_text(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.marketing_add_website(uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.marketing_set_primary_website(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.marketing_save_website_profile_draft(uuid, uuid, integer, text, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.marketing_save_website_profile_draft_from_snapshot(uuid, uuid, integer, text, jsonb, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.marketing_confirm_website_profile(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.marketing_add_website(uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.marketing_set_primary_website(uuid, uuid)
  to service_role;
grant execute on function public.marketing_save_website_profile_draft(uuid, uuid, integer, text, jsonb, text, text)
  to service_role;
grant execute on function public.marketing_save_website_profile_draft_from_snapshot(uuid, uuid, integer, text, jsonb, text, text, uuid, text)
  to service_role;
grant execute on function public.marketing_confirm_website_profile(uuid, uuid, integer)
  to service_role;
