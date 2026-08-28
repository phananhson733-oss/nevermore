-- GEO knowledge base: one mutable draft per site, and immutable frozen
-- versions that carry the question set derived from them.
--
-- Same shape and the same privileges as 0005: browser roles get no table
-- privileges and no policies, service_role reads with an explicit user_id
-- predicate, and every write goes through a SECURITY DEFINER RPC below.
--
-- The question set lives on the snapshot rather than in its own table because
-- it is a pure function of the frozen payload and the template registry
-- version. Storing it beside the payload is what makes a run reproducible: a
-- later registry release cannot retroactively change what a past run asked.

create table if not exists public.marketing_geo_knowledge_bases (
  id                        uuid        primary key default gen_random_uuid(),
  user_id                   uuid        not null,
  canonical_site_key        text        not null
                                        check (char_length(canonical_site_key) between 1 and 255),
  origin                    text        not null
                                        check (char_length(origin) between 1 and 2048),
  host                      text        not null
                                        check (char_length(host) between 1 and 255),
  current_frozen_snapshot_id uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint marketing_geo_kb_user_site_key_unique
    unique (user_id, canonical_site_key),
  unique (id, user_id)
);

create index if not exists marketing_geo_kb_user_list_idx
  on public.marketing_geo_knowledge_bases (user_id, created_at, id);

create table if not exists public.marketing_geo_kb_drafts (
  kb_id          uuid        primary key,
  user_id        uuid        not null,
  schema_version text        not null
                             check (schema_version = 'marketing-geo-kb.v1'),
  draft_version  integer     not null check (draft_version >= 1),
  payload        jsonb       not null
                             check (octet_length(payload::text) <= 131072),
  content_hash   text        not null
                             check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (kb_id, user_id)
    references public.marketing_geo_knowledge_bases (id, user_id)
    on delete restrict
);

create index if not exists marketing_geo_kb_drafts_user_idx
  on public.marketing_geo_kb_drafts (user_id, kb_id);

create table if not exists public.marketing_geo_kb_snapshots (
  id                 uuid        primary key default gen_random_uuid(),
  kb_id              uuid        not null,
  user_id            uuid        not null,
  revision           integer     not null check (revision >= 1),
  schema_version     text        not null
                                 check (schema_version = 'marketing-geo-kb.v1'),
  payload            jsonb       not null
                                 check (octet_length(payload::text) <= 131072),
  content_hash       text        not null
                                 check (content_hash ~ '^[a-f0-9]{64}$'),
  -- The frozen question set, derived from `payload` plus the registry version
  -- recorded inside it. Immutable for the same reason the payload is.
  question_set       jsonb       not null
                                 check (octet_length(question_set::text) <= 262144),
  question_set_hash  text        not null
                                 check (question_set_hash ~ '^[a-f0-9]{64}$'),
  frozen_at          timestamptz not null default now(),
  unique (kb_id, revision),
  unique (kb_id, content_hash),
  unique (id, kb_id, user_id),
  foreign key (kb_id, user_id)
    references public.marketing_geo_knowledge_bases (id, user_id)
    on delete restrict
);

create index if not exists marketing_geo_kb_snapshots_user_idx
  on public.marketing_geo_kb_snapshots (user_id, kb_id, revision desc);

alter table public.marketing_geo_knowledge_bases
  drop constraint if exists marketing_geo_kb_current_snapshot_fk;
alter table public.marketing_geo_knowledge_bases
  add constraint marketing_geo_kb_current_snapshot_fk
  foreign key (current_frozen_snapshot_id, id, user_id)
  references public.marketing_geo_kb_snapshots (id, kb_id, user_id);

-- Append-only. Row-level covers update and delete; the statement-level trigger
-- covers TRUNCATE, which row triggers never see.
create or replace function public.marketing_geo_kb_snapshots_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GEO knowledge base snapshots are append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists marketing_geo_kb_snapshots_immutable_row
  on public.marketing_geo_kb_snapshots;
create trigger marketing_geo_kb_snapshots_immutable_row
  before update or delete on public.marketing_geo_kb_snapshots
  for each row execute function public.marketing_geo_kb_snapshots_immutable();

drop trigger if exists marketing_geo_kb_snapshots_immutable_truncate
  on public.marketing_geo_kb_snapshots;
create trigger marketing_geo_kb_snapshots_immutable_truncate
  before truncate on public.marketing_geo_kb_snapshots
  for each statement execute function public.marketing_geo_kb_snapshots_immutable();

alter table public.marketing_geo_knowledge_bases enable row level security;
alter table public.marketing_geo_kb_drafts enable row level security;
alter table public.marketing_geo_kb_snapshots enable row level security;

revoke all on
  public.marketing_geo_knowledge_bases,
  public.marketing_geo_kb_drafts,
  public.marketing_geo_kb_snapshots
from anon, authenticated;

-- service_role carries BYPASSRLS, so the write ban has to be a privilege ban.
revoke insert, update, delete, truncate on
  public.marketing_geo_knowledge_bases,
  public.marketing_geo_kb_drafts,
  public.marketing_geo_kb_snapshots
from service_role;

grant select on
  public.marketing_geo_knowledge_bases,
  public.marketing_geo_kb_drafts,
  public.marketing_geo_kb_snapshots
to service_role;

-- Register the site. Idempotent: a second call for the same user and site key
-- returns the existing row rather than failing on the unique constraint.
create or replace function public.marketing_geo_upsert_kb(
  p_user_id uuid,
  p_origin text,
  p_host text,
  p_canonical_site_key text
)
returns table (
  kb_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_existing public.marketing_geo_knowledge_bases;
begin
  select k.* into v_existing
    from public.marketing_geo_knowledge_bases as k
   where k.user_id = p_user_id
     and k.canonical_site_key = p_canonical_site_key
   for update;
  if found then
    kb_id := v_existing.id;
    created := false;
    return next;
    return;
  end if;

  insert into public.marketing_geo_knowledge_bases (
    user_id, canonical_site_key, origin, host
  ) values (
    p_user_id, p_canonical_site_key, p_origin, p_host
  )
  returning id into kb_id;
  created := true;
  return next;
end;
$$;

-- Save the working copy. `p_base_version` is the version the caller read, so
-- two tabs editing the same knowledge base collide instead of overwriting.
create or replace function public.marketing_geo_save_kb_draft(
  p_user_id uuid,
  p_kb_id uuid,
  p_schema_version text,
  p_payload jsonb,
  p_content_hash text,
  p_base_version integer
)
returns table (
  outcome text,
  draft_version integer,
  content_hash text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_kb public.marketing_geo_knowledge_bases;
  v_draft public.marketing_geo_kb_drafts;
  v_expected_hash text;
begin
  select k.* into v_kb
    from public.marketing_geo_knowledge_bases as k
   where k.id = p_kb_id
     and k.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    draft_version := null;
    content_hash := null;
    updated_at := null;
    return next;
    return;
  end if;

  -- The caller computes the hash; the database recomputes it from its own
  -- canonical form and refuses a mismatch. Neither side is trusted to define
  -- identity alone, which is what keeps a payload edited in transit from
  -- inheriting an earlier hash.
  v_expected_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        public.marketing_canonical_jsonb_text(p_payload), 'UTF8'
      )
    ),
    'hex'
  );
  if v_expected_hash is distinct from p_content_hash then
    outcome := 'hash_mismatch';
    draft_version := null;
    content_hash := v_expected_hash;
    updated_at := null;
    return next;
    return;
  end if;

  select d.* into v_draft
    from public.marketing_geo_kb_drafts as d
   where d.kb_id = p_kb_id
     and d.user_id = p_user_id
   for update;

  if not found then
    if p_base_version is not null and p_base_version <> 0 then
      outcome := 'conflict';
      draft_version := null;
      content_hash := null;
      updated_at := null;
      return next;
      return;
    end if;
    insert into public.marketing_geo_kb_drafts (
      kb_id, user_id, schema_version, draft_version, payload, content_hash
    ) values (
      p_kb_id, p_user_id, p_schema_version, 1, p_payload, p_content_hash
    );
    update public.marketing_geo_knowledge_bases
       set updated_at = pg_catalog.now()
     where id = p_kb_id;
    outcome := 'saved';
    draft_version := 1;
    content_hash := p_content_hash;
    updated_at := pg_catalog.now();
    return next;
    return;
  end if;

  if p_base_version is distinct from v_draft.draft_version then
    outcome := 'conflict';
    draft_version := v_draft.draft_version;
    content_hash := v_draft.content_hash;
    updated_at := v_draft.updated_at;
    return next;
    return;
  end if;

  update public.marketing_geo_kb_drafts as d
     set payload = p_payload,
         content_hash = p_content_hash,
         schema_version = p_schema_version,
         draft_version = d.draft_version + 1,
         updated_at = pg_catalog.now()
   where d.kb_id = p_kb_id
     and d.user_id = p_user_id
  returning d.draft_version, d.content_hash, d.updated_at
    into draft_version, content_hash, updated_at;

  update public.marketing_geo_knowledge_bases
     set updated_at = pg_catalog.now()
   where id = p_kb_id;

  outcome := 'saved';
  return next;
end;
$$;

-- Freeze the working copy into an immutable version with its question set.
--
-- Idempotent by content: freezing the same payload twice returns the existing
-- revision rather than minting a second identical one, so a double-clicked
-- button cannot fork the history a run points at.
create or replace function public.marketing_geo_freeze_kb(
  p_user_id uuid,
  p_kb_id uuid,
  p_schema_version text,
  p_base_version integer,
  p_question_set jsonb,
  p_question_set_hash text
)
returns table (
  outcome text,
  snapshot_id uuid,
  revision integer,
  content_hash text,
  frozen_at timestamptz,
  reused_existing boolean
)
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_kb public.marketing_geo_knowledge_bases;
  v_draft public.marketing_geo_kb_drafts;
  v_snapshot public.marketing_geo_kb_snapshots;
  v_expected_question_hash text;
  v_revision integer;
begin
  select k.* into v_kb
    from public.marketing_geo_knowledge_bases as k
   where k.id = p_kb_id
     and k.user_id = p_user_id
   for update;
  if not found then
    outcome := 'not_found';
    snapshot_id := null;
    revision := null;
    content_hash := null;
    frozen_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  select d.* into v_draft
    from public.marketing_geo_kb_drafts as d
   where d.kb_id = p_kb_id
     and d.user_id = p_user_id
   for update;
  if not found then
    outcome := 'no_draft';
    snapshot_id := null;
    revision := null;
    content_hash := null;
    frozen_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  if p_base_version is distinct from v_draft.draft_version then
    outcome := 'conflict';
    snapshot_id := null;
    revision := v_draft.draft_version;
    content_hash := v_draft.content_hash;
    frozen_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  v_expected_question_hash := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        public.marketing_canonical_jsonb_text(p_question_set), 'UTF8'
      )
    ),
    'hex'
  );
  if v_expected_question_hash is distinct from p_question_set_hash then
    outcome := 'hash_mismatch';
    snapshot_id := null;
    revision := null;
    content_hash := v_expected_question_hash;
    frozen_at := null;
    reused_existing := null;
    return next;
    return;
  end if;

  select s.* into v_snapshot
    from public.marketing_geo_kb_snapshots as s
   where s.kb_id = p_kb_id
     and s.user_id = p_user_id
     and s.content_hash = v_draft.content_hash
   order by s.revision desc
   limit 1;
  if found then
    update public.marketing_geo_knowledge_bases
       set current_frozen_snapshot_id = v_snapshot.id,
           updated_at = pg_catalog.now()
     where id = p_kb_id;
    outcome := 'frozen';
    snapshot_id := v_snapshot.id;
    revision := v_snapshot.revision;
    content_hash := v_snapshot.content_hash;
    frozen_at := v_snapshot.frozen_at;
    reused_existing := true;
    return next;
    return;
  end if;

  select coalesce(pg_catalog.max(s.revision), 0) + 1 into v_revision
    from public.marketing_geo_kb_snapshots as s
   where s.kb_id = p_kb_id;

  insert into public.marketing_geo_kb_snapshots (
    kb_id, user_id, revision, schema_version, payload, content_hash,
    question_set, question_set_hash
  ) values (
    p_kb_id, p_user_id, v_revision, p_schema_version, v_draft.payload,
    v_draft.content_hash, p_question_set, p_question_set_hash
  )
  -- Qualified, because the OUT parameters of this function are named
  -- `revision`, `content_hash` and `frozen_at` too: unqualified, Postgres
  -- cannot tell the column from the parameter and raises "column reference
  -- revision is ambiguous", which would make every freeze fail.
  returning
    marketing_geo_kb_snapshots.id,
    marketing_geo_kb_snapshots.revision,
    marketing_geo_kb_snapshots.content_hash,
    marketing_geo_kb_snapshots.frozen_at
    into snapshot_id, revision, content_hash, frozen_at;

  update public.marketing_geo_knowledge_bases
     set current_frozen_snapshot_id = snapshot_id,
         updated_at = pg_catalog.now()
   where id = p_kb_id;

  outcome := 'frozen';
  reused_existing := false;
  return next;
end;
$$;

revoke all on function public.marketing_geo_upsert_kb(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.marketing_geo_save_kb_draft(
  uuid, uuid, text, jsonb, text, integer
) from public, anon, authenticated;
revoke all on function public.marketing_geo_freeze_kb(
  uuid, uuid, text, integer, jsonb, text
) from public, anon, authenticated;

grant execute on function public.marketing_geo_upsert_kb(uuid, text, text, text)
  to service_role;
grant execute on function public.marketing_geo_save_kb_draft(
  uuid, uuid, text, jsonb, text, integer
) to service_role;
grant execute on function public.marketing_geo_freeze_kb(
  uuid, uuid, text, integer, jsonb, text
) to service_role;
