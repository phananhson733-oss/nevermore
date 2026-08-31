-- Immutable source receipts and context-bound GEO freezes. No historical row
-- is rewritten: legacy snapshots keep a NULL context hash and the v1 payload
-- digest continues to identify the exact same bytes.
create table if not exists public.marketing_geo_enrichment_receipts (
  id uuid primary key, user_id uuid not null, kb_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 524288),
  created_at timestamptz not null default now(),
  unique(id, kb_id, user_id),
  foreign key(kb_id,user_id) references public.marketing_geo_knowledge_bases(id,user_id) on delete restrict
);
create index if not exists marketing_geo_enrichment_latest_idx
  on public.marketing_geo_enrichment_receipts(user_id,kb_id,created_at desc,id desc);

alter table public.marketing_geo_kb_snapshots add column if not exists context_hash text
  check (context_hash is null or context_hash ~ '^[a-f0-9]{64}$');
-- Same payload with a changed Profile/source receipt is a distinct snapshot.
-- NULL coalesces to a dedicated legacy identity, preserving legacy dedupe.
alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_kb_snapshots_kb_id_content_hash_key;
create unique index if not exists marketing_geo_kb_snapshot_context_identity_idx
  on public.marketing_geo_kb_snapshots(kb_id,content_hash,coalesce(context_hash,''));

create table if not exists public.marketing_geo_snapshot_contexts (
  snapshot_id uuid primary key, user_id uuid not null, kb_id uuid not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  context jsonb not null check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 262144),
  receipt_id uuid,
  created_at timestamptz not null default now(),
  unique(snapshot_id,content_hash),
  foreign key(snapshot_id,kb_id,user_id) references public.marketing_geo_kb_snapshots(id,kb_id,user_id) on delete restrict,
  foreign key(receipt_id,kb_id,user_id) references public.marketing_geo_enrichment_receipts(id,kb_id,user_id) on delete restrict
);
create index if not exists marketing_geo_snapshot_context_owner_idx
  on public.marketing_geo_snapshot_contexts(user_id,kb_id,snapshot_id);
create index if not exists marketing_geo_snapshot_context_receipt_idx
  on public.marketing_geo_snapshot_contexts(receipt_id,kb_id,user_id);
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_snapshot_context_required_fk;
alter table public.marketing_geo_kb_snapshots add constraint marketing_geo_snapshot_context_required_fk
  foreign key(id,context_hash) references public.marketing_geo_snapshot_contexts(snapshot_id,content_hash)
  deferrable initially deferred;

drop trigger if exists marketing_geo_enrichment_immutable_row on public.marketing_geo_enrichment_receipts;
create trigger marketing_geo_enrichment_immutable_row before update or delete on public.marketing_geo_enrichment_receipts
  for each row execute function public.marketing_geo_visibility_runs_immutable();
drop trigger if exists marketing_geo_enrichment_immutable_truncate on public.marketing_geo_enrichment_receipts;
create trigger marketing_geo_enrichment_immutable_truncate before truncate on public.marketing_geo_enrichment_receipts
  for each statement execute function public.marketing_geo_visibility_runs_immutable();
drop trigger if exists marketing_geo_context_immutable_row on public.marketing_geo_snapshot_contexts;
create trigger marketing_geo_context_immutable_row before update or delete on public.marketing_geo_snapshot_contexts
  for each row execute function public.marketing_geo_visibility_runs_immutable();
drop trigger if exists marketing_geo_context_immutable_truncate on public.marketing_geo_snapshot_contexts;
create trigger marketing_geo_context_immutable_truncate before truncate on public.marketing_geo_snapshot_contexts
  for each statement execute function public.marketing_geo_visibility_runs_immutable();
alter table public.marketing_geo_enrichment_receipts enable row level security;
alter table public.marketing_geo_snapshot_contexts enable row level security;
revoke all on public.marketing_geo_enrichment_receipts,public.marketing_geo_snapshot_contexts from public,anon,authenticated,service_role;
grant select on public.marketing_geo_enrichment_receipts,public.marketing_geo_snapshot_contexts to service_role;

create or replace function public.marketing_geo_record_enrichment(p_user_id uuid,p_kb_id uuid,p_receipt_id uuid,p_report jsonb)
returns table(outcome text)
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare v_kb public.marketing_geo_knowledge_bases; v_hash text; v_existing public.marketing_geo_enrichment_receipts;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id;
  if not found then outcome:='not_found'; return next; return; end if;
  v_hash:=encode(sha256(convert_to(public.marketing_canonical_jsonb_text(p_report-'contentHash'),'UTF8')),'hex');
  if p_receipt_id is null or jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>524288
    or p_report->>'schemaVersion' is distinct from 'marketing-geo-kb-enrichment.v1'
    or p_report->>'receiptId' is distinct from p_receipt_id::text or p_report->>'kbId' is distinct from p_kb_id::text
    or p_report->>'targetHost' is distinct from v_kb.canonical_site_key
    or p_report->>'contentHash' is distinct from v_hash then
    outcome:='receipt_mismatch'; return next; return;
  end if;
  insert into public.marketing_geo_enrichment_receipts(id,user_id,kb_id,content_hash,report)
    values(p_receipt_id,p_user_id,p_kb_id,v_hash,p_report) on conflict(id) do nothing;
  if found then outcome:='recorded'; return next; return; end if;
  select r.* into v_existing from public.marketing_geo_enrichment_receipts r where r.id=p_receipt_id;
  if v_existing.user_id=p_user_id and v_existing.kb_id=p_kb_id and v_existing.report=p_report then outcome:='recorded';
  else outcome:='receipt_conflict'; end if;
  return next;
end;
$$;

create or replace function public.marketing_geo_freeze_kb_with_context(
  p_user_id uuid,p_kb_id uuid,p_schema_version text,p_base_version integer,
  p_question_set jsonb,p_question_set_hash text,p_context jsonb
)
returns table(outcome text,snapshot_id uuid,revision integer,content_hash text,frozen_at timestamptz,reused_existing boolean)
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_kb public.marketing_geo_knowledge_bases; v_draft public.marketing_geo_kb_drafts;
  v_snapshot public.marketing_geo_kb_snapshots; v_profile public.marketing_website_profile_snapshots;
  v_website public.marketing_websites;
  v_context_hash text; v_question_hash text; v_receipt_id uuid; v_receipt public.marketing_geo_enrichment_receipts; v_ref jsonb;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select d.* into v_draft from public.marketing_geo_kb_drafts d where d.kb_id=p_kb_id and d.user_id=p_user_id for update;
  if not found then outcome:='no_draft'; return next; return; end if;
  if p_base_version is distinct from v_draft.draft_version then
    outcome:='conflict'; revision:=v_draft.draft_version; return next; return;
  end if;
  v_context_hash:=encode(sha256(convert_to(public.marketing_canonical_jsonb_text(p_context-'contentHash'),'UTF8')),'hex');
  v_question_hash:=encode(sha256(convert_to(public.marketing_canonical_jsonb_text(p_question_set),'UTF8')),'hex');
  if p_schema_version is distinct from v_draft.schema_version
    or jsonb_typeof(p_context) is distinct from 'object' or octet_length(p_context::text)>262144
    or p_context->>'schemaVersion' is distinct from 'marketing-geo-snapshot-context.v1'
    or p_context->>'kbId' is distinct from p_kb_id::text
    or p_context->>'targetHost' is distinct from v_kb.canonical_site_key
    or p_context->>'payloadHash' is distinct from v_draft.content_hash
    or p_context->>'contentHash' is distinct from v_context_hash
    or p_context->>'questionSetHash' is distinct from p_question_set_hash
    or v_question_hash is distinct from p_question_set_hash then
    outcome:='context_mismatch'; return next; return;
  end if;
  -- Confirmation takes the same Website row lock. Pin the current pointer
  -- through commit, including the no-Profile case, after UI context CAS.
  select w.* into v_website from public.marketing_websites w
    where w.user_id=p_user_id and w.canonical_site_key=v_kb.canonical_site_key for share;
  if not found then outcome:='website_required'; return next; return; end if;
  if (p_context->'profile' = 'null'::jsonb and v_website.current_confirmed_snapshot_id is not null)
    or (p_context->'profile' is distinct from 'null'::jsonb and
      (v_website.id is null or v_website.current_confirmed_snapshot_id::text is distinct from p_context#>>'{profile,reference,snapshotId}')) then
    outcome:='profile_stale'; return next; return;
  end if;
  if p_context->'profile' is distinct from 'null'::jsonb then
    v_ref:=p_context#>'{profile,reference}';
    select s.* into v_profile from public.marketing_website_profile_snapshots s
      join public.marketing_websites w on w.id=s.website_id and w.user_id=s.user_id
      where s.id=(v_ref->>'snapshotId')::uuid and s.website_id=(v_ref->>'websiteId')::uuid
        and s.user_id=p_user_id and w.canonical_site_key=v_kb.canonical_site_key;
    if not found or v_ref->>'profileHash' is distinct from v_profile.content_hash
      or v_ref->>'snapshotRevision' is distinct from v_profile.revision::text
      or v_ref->>'profileSchemaVersion' is distinct from v_profile.schema_version
      or p_context#>'{profile,productName}' is distinct from v_profile.profile->'productName'
      or p_context#>'{profile,oneLinePositioning}' is distinct from v_profile.profile->'oneLinePositioning'
      or p_context#>'{profile,coreFeatures}' is distinct from v_profile.profile->'coreFeatures'
      or p_context#>'{profile,market,country}' is distinct from v_profile.profile->'country'
      or p_context#>'{profile,market,language}' is distinct from v_profile.profile->'locale'
      or ((p_context->'profile') ? 'fieldProvenance' and p_context#>'{profile,fieldProvenance}' is distinct from (
        select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb)
        from jsonb_array_elements(v_profile.profile->'fieldProvenance') with ordinality e(value,ordinality)
        where e.value->>'path' in ('/productName','/oneLinePositioning','/coreFeatures')
      )) then
      outcome:='context_mismatch'; return next; return;
    end if;
  end if;
  if p_context->'enrichment' is distinct from 'null'::jsonb then
    v_receipt_id:=(p_context#>>'{enrichment,receiptId}')::uuid;
    select r.* into v_receipt from public.marketing_geo_enrichment_receipts r
      where r.id=v_receipt_id and r.user_id=p_user_id and r.kb_id=p_kb_id;
    if not found or v_receipt.content_hash is distinct from p_context#>>'{enrichment,contentHash}'
      or v_receipt.report->'profileReference' is distinct from coalesce(p_context#>'{profile,reference}','null'::jsonb) then
      outcome:='context_mismatch'; return next; return;
    end if;
  end if;
  select s.* into v_snapshot from public.marketing_geo_kb_snapshots s
    where s.kb_id=p_kb_id and s.user_id=p_user_id and s.content_hash=v_draft.content_hash and s.context_hash=v_context_hash;
  if found then
    snapshot_id:=v_snapshot.id; revision:=v_snapshot.revision; content_hash:=v_snapshot.content_hash;
    frozen_at:=v_snapshot.frozen_at; reused_existing:=true;
  else
    select coalesce(max(s.revision),0)+1 into revision from public.marketing_geo_kb_snapshots s where s.kb_id=p_kb_id;
    insert into public.marketing_geo_kb_snapshots(kb_id,user_id,revision,schema_version,payload,content_hash,question_set,question_set_hash,context_hash)
      values(p_kb_id,p_user_id,revision,p_schema_version,v_draft.payload,v_draft.content_hash,p_question_set,p_question_set_hash,v_context_hash)
      returning marketing_geo_kb_snapshots.id,marketing_geo_kb_snapshots.content_hash,marketing_geo_kb_snapshots.frozen_at
      into snapshot_id,content_hash,frozen_at;
    insert into public.marketing_geo_snapshot_contexts(snapshot_id,user_id,kb_id,content_hash,context,receipt_id)
      values(snapshot_id,p_user_id,p_kb_id,v_context_hash,p_context,v_receipt_id);
    reused_existing:=false;
  end if;
  update public.marketing_geo_knowledge_bases k set current_frozen_snapshot_id=snapshot_id,updated_at=now() where k.id=p_kb_id;
  outcome:='frozen'; return next;
end;
$$;
revoke all on function public.marketing_geo_record_enrichment(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_geo_record_enrichment(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb) to service_role;

-- Legacy callers may reuse only legacy snapshots, not a context-conditioned
-- question set that happens to share the same payload hash.
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
     and s.context_hash is null
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
