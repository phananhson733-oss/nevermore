-- A GEO draft/frozen payload can carry an exact full confirmed Profile copy.
-- No existing payload, hash, question set or frozen source receipt is rewritten.
-- Only GEO storage grows; the authoritative Profile retains its 128KiB cap.
alter table public.marketing_geo_kb_drafts
  drop constraint if exists marketing_geo_kb_drafts_payload_check;
alter table public.marketing_geo_kb_drafts
  add constraint marketing_geo_kb_drafts_payload_check
  check (octet_length(payload::text) <= 393216);
alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_kb_snapshots_payload_check;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_kb_snapshots_payload_check
  check (octet_length(payload::text) <= 393216);

-- Internal service-only source validation. The caller holds the KB row lock;
-- this SHARE lock pins the current confirmed Profile pointer through commit.
-- Text comparisons intentionally reject malformed UUID/revision values without
-- casting attacker-controlled input or normalizing the immutable Profile JSON.
create or replace function public.marketing_geo_validate_profile_copy(
  p_user_id uuid, p_canonical_site_key text, p_copy jsonb
)
returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_website public.marketing_websites;
  v_profile public.marketing_website_profile_snapshots;
begin
  if jsonb_typeof(p_copy) is distinct from 'object'
    or p_copy->>'schemaVersion' is distinct from 'marketing-geo-profile-copy.v1'
    or jsonb_typeof(p_copy->'websiteId') is distinct from 'string'
    or jsonb_typeof(p_copy->'snapshotId') is distinct from 'string'
    or jsonb_typeof(p_copy->'snapshotRevision') is distinct from 'string'
    or (p_copy->>'snapshotRevision') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_copy->'profileHash') is distinct from 'string'
    or jsonb_typeof(p_copy->'profile') is distinct from 'object' then
    return 'profile_copy_mismatch';
  end if;
  if (select count(*) from jsonb_object_keys(p_copy)) <> 6 then
    return 'profile_copy_mismatch';
  end if;
  select w.* into v_website from public.marketing_websites w
    where w.user_id=p_user_id and w.canonical_site_key=p_canonical_site_key for share;
  if not found or v_website.id::text is distinct from p_copy->>'websiteId' then
    return 'profile_copy_mismatch';
  end if;
  if v_website.current_confirmed_snapshot_id is null
    or v_website.current_confirmed_snapshot_id::text is distinct from p_copy->>'snapshotId' then
    return 'profile_stale';
  end if;
  select s.* into v_profile from public.marketing_website_profile_snapshots s
    where s.id=v_website.current_confirmed_snapshot_id
      and s.website_id=v_website.id and s.user_id=p_user_id;
  if not found
    or v_profile.revision::text is distinct from p_copy->>'snapshotRevision'
    or v_profile.content_hash is distinct from p_copy->>'profileHash'
    or v_profile.schema_version is distinct from p_copy#>>'{profile,schemaVersion}'
    or v_profile.profile is distinct from p_copy->'profile' then
    return 'profile_copy_mismatch';
  end if;
  return null;
end;
$$;
revoke all on function public.marketing_geo_validate_profile_copy(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_geo_validate_profile_copy(uuid,text,jsonb) to service_role;

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
  v_copy_error text;
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

  -- The same Website SHARE lock used by freeze coordinates Profile confirmation.
  -- Omission is retained only for historical callers; a present copy is exact.
  if p_payload ? 'profileCopy' then
    v_copy_error := public.marketing_geo_validate_profile_copy(
      p_user_id, v_kb.canonical_site_key, p_payload->'profileCopy'
    );
    if v_copy_error is not null then
      outcome := v_copy_error; return next; return;
    end if;
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

  -- Historical partial drafts remain writable, but a complete draft cannot
  -- lose its self-contained Profile via the compatibility save path.
  if found and v_draft.payload ? 'profileCopy' and not (p_payload ? 'profileCopy') then
    outcome := 'profile_copy_mismatch'; return next; return;
  end if;

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
  v_copy jsonb; v_copy_error text;
  v_context_hash text; v_question_hash text; v_receipt_id uuid; v_receipt public.marketing_geo_enrichment_receipts; v_ref jsonb;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select d.* into v_draft from public.marketing_geo_kb_drafts d where d.kb_id=p_kb_id and d.user_id=p_user_id for update;
  if not found then outcome:='no_draft'; return next; return; end if;
  if p_base_version is distinct from v_draft.draft_version then
    outcome:='conflict'; revision:=v_draft.draft_version; return next; return;
  end if;
  if v_draft.payload ? 'profileCopy' then
    v_copy := v_draft.payload->'profileCopy';
    v_copy_error := public.marketing_geo_validate_profile_copy(
      p_user_id, v_kb.canonical_site_key, v_copy
    );
    if v_copy_error is not null then outcome:=v_copy_error; return next; return; end if;
    -- Complete copies use exactly the reader's source projection, including
    -- empty provenance. Historical contexts retain their optional shape below.
    if p_context->'profile' is distinct from jsonb_build_object(
      'reference',jsonb_build_object(
        'schemaVersion','website-profile-reference.v1',
        'websiteId',v_copy->>'websiteId',
        'snapshotId',v_copy->>'snapshotId',
        'snapshotRevision',(v_copy->>'snapshotRevision')::integer,
        'profileHash',v_copy->>'profileHash',
        'profileSchemaVersion',v_copy#>>'{profile,schemaVersion}'
      ),
      'productName',v_copy#>'{profile,productName}',
      'oneLinePositioning',v_copy#>'{profile,oneLinePositioning}',
      'coreFeatures',v_copy#>'{profile,coreFeatures}',
      'market',jsonb_build_object(
        'country',v_copy#>'{profile,country}',
        'language',v_copy#>'{profile,locale}'
      ),
      'fieldProvenance',(
        select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb)
        from jsonb_array_elements(v_copy#>'{profile,fieldProvenance}') with ordinality e(value,ordinality)
        where e.value->>'path' in ('/productName','/oneLinePositioning','/coreFeatures')
      )
    ) then
      outcome:='context_mismatch'; return next; return;
    end if;
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

  if v_draft.payload ? 'profileCopy' then
    outcome := 'context_required'; return next; return;
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

revoke all on function public.marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer) from public,anon,authenticated;
revoke all on function public.marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer) to service_role;
grant execute on function public.marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text) to service_role;
grant execute on function public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb) to service_role;
