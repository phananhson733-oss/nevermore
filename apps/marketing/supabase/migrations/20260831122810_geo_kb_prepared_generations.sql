-- Versioned drafts and durable, owner-scoped semantic preparation. No legacy
-- payload/question/context bytes are rewritten.
alter table public.marketing_geo_kb_drafts drop constraint if exists marketing_geo_kb_drafts_schema_version_check;
alter table public.marketing_geo_kb_drafts add constraint marketing_geo_kb_drafts_schema_version_check
  check (schema_version in ('marketing-geo-kb.v1','marketing-geo-kb.v2'));
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_kb_snapshots_schema_version_check;
alter table public.marketing_geo_kb_snapshots add constraint marketing_geo_kb_snapshots_schema_version_check
  check (schema_version in ('marketing-geo-kb.v1','marketing-geo-kb.v2'));
alter table public.marketing_geo_kb_drafts drop constraint if exists marketing_geo_draft_v2_shape;
alter table public.marketing_geo_kb_drafts add constraint marketing_geo_draft_v2_shape check (
  schema_version <> 'marketing-geo-kb.v2' or
  ((payload->>'schemaVersion') is not distinct from schema_version and jsonb_typeof(payload->'profileCopy') is not distinct from 'object')
);

create table if not exists public.marketing_geo_kb_generations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, kb_id uuid not null,
  kind text not null check(kind in ('roles','questions')),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=196608),
  state text not null check(state in ('claimed','dispatched','succeeded','failed','uncertain')),
  claim_token uuid not null default gen_random_uuid(), lease_expires_at timestamptz not null,
  result jsonb check(result is null or octet_length(result::text)<=2097152),
  error_reason text check(error_reason in ('rate_limited','quota_unavailable','invalid_output','provider_rejected','outcome_unknown','input_stale','model_unavailable')),
  attempt jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,kb_id,user_id), unique(user_id,kb_id,kind,input_hash),
  foreign key(kb_id,user_id) references public.marketing_geo_knowledge_bases(id,user_id) on delete restrict,
  check ((state in ('claimed','dispatched') and result is null and error_reason is null and attempt is null)
    or (state='succeeded' and result is not null and error_reason is null and attempt is not null)
    or (state='failed' and result is null and error_reason is not null)
    or (state='uncertain' and result is null and error_reason='outcome_unknown' and attempt is not null))
);
create index if not exists marketing_geo_generation_latest_idx on public.marketing_geo_kb_generations(user_id,kb_id,kind,created_at desc,id desc);
create table if not exists public.marketing_geo_kb_generation_keys (
  user_id uuid not null, kb_id uuid not null, idempotency_key text not null check(idempotency_key ~ '^[a-zA-Z0-9_-]{8,128}$'),
  generation_id uuid not null, kind text not null, input_hash text not null,
  primary key(user_id,kb_id,idempotency_key),
  foreign key(generation_id,kb_id,user_id) references public.marketing_geo_kb_generations(id,kb_id,user_id) on delete restrict
);
create table if not exists public.marketing_geo_kb_prepared_candidates (
  id uuid primary key, user_id uuid not null, kb_id uuid not null, generation_id uuid not null unique,
  candidate_hash text not null check(candidate_hash ~ '^[a-f0-9]{64}$'),
  candidate jsonb not null check(jsonb_typeof(candidate)='object' and octet_length(candidate::text)<=1572864),
  created_at timestamptz not null default now(),
  unique(id,kb_id,user_id),
  foreign key(generation_id,kb_id,user_id) references public.marketing_geo_kb_generations(id,kb_id,user_id) on delete restrict
);
create index if not exists marketing_geo_prepared_latest_idx on public.marketing_geo_kb_prepared_candidates(user_id,kb_id,created_at desc,id desc);
alter table public.marketing_geo_kb_snapshots add column if not exists prepared_id uuid;
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_snapshot_prepared_fk;
alter table public.marketing_geo_kb_snapshots add constraint marketing_geo_snapshot_prepared_fk
  foreign key(prepared_id,kb_id,user_id) references public.marketing_geo_kb_prepared_candidates(id,kb_id,user_id) on delete restrict;
create unique index if not exists marketing_geo_snapshot_prepared_unique on public.marketing_geo_kb_snapshots(prepared_id) where prepared_id is not null;
alter table public.marketing_geo_kb_snapshots drop constraint if exists marketing_geo_snapshot_v2_requires_prepared;
alter table public.marketing_geo_kb_snapshots add constraint marketing_geo_snapshot_v2_requires_prepared check (
  ((schema_version='marketing-geo-kb.v2') = (prepared_id is not null))
  and (payload->>'schemaVersion') is not distinct from schema_version
);
alter table public.marketing_geo_snapshot_contexts drop constraint if exists marketing_geo_snapshot_contexts_context_check;
alter table public.marketing_geo_snapshot_contexts add constraint marketing_geo_snapshot_contexts_context_check check (
  jsonb_typeof(context)='object' and
  ((context->>'schemaVersion'='marketing-geo-snapshot-context.v1' and octet_length(context::text)<=262144)
   or (context->>'schemaVersion'='marketing-geo-snapshot-context.v2' and octet_length(context::text)<=524288))
);
alter table public.marketing_geo_enrichment_receipts drop constraint if exists marketing_geo_enrichment_receipts_report_check;
alter table public.marketing_geo_enrichment_receipts add constraint marketing_geo_enrichment_receipts_report_check check (
  jsonb_typeof(report)='object' and
  ((report->>'schemaVersion'='marketing-geo-kb-enrichment.v1' and octet_length(report::text)<=524288)
   or (report->>'schemaVersion'='marketing-geo-kb-enrichment.v2' and octet_length(report::text)<=2097152))
);

create or replace function public.marketing_geo_generation_record(p_row public.marketing_geo_kb_generations)
returns jsonb language sql stable set search_path='' set timezone='UTC' as $$
  select jsonb_build_object('generationId',p_row.id,'userId',p_row.user_id,'kbId',p_row.kb_id,'kind',p_row.kind,
    'inputHash',p_row.input_hash,'state',p_row.state,'result',p_row.result,'errorReason',p_row.error_reason,'attempt',p_row.attempt)
$$;
create or replace function public.marketing_geo_json_hash(p_value jsonb)
returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(public.marketing_canonical_jsonb_text(p_value),'UTF8')),'hex')
$$;
create or replace function public.marketing_geo_generation_attempt_valid(p_attempt jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_key text;
begin
  if p_attempt is null then return true; end if;
  if jsonb_typeof(p_attempt) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_attempt))<>6
    or jsonb_typeof(p_attempt->'attemptedCalls') is distinct from 'number'
    or p_attempt->>'attemptedCalls' not in ('0','1')
    or p_attempt->>'delivery' not in ('not_attempted','response_received','outcome_unknown')
    or ((p_attempt->>'attemptedCalls'='0') is distinct from (p_attempt->>'delivery'='not_attempted'))
    or not (p_attempt ?& array['modelRequested','inputTokens','outputTokens','requestCount']) then return false; end if;
  if p_attempt->'modelRequested' <> 'null'::jsonb and
    (jsonb_typeof(p_attempt->'modelRequested')<>'string' or char_length(p_attempt->>'modelRequested') not between 1 and 200) then return false; end if;
  foreach v_key in array array['inputTokens','outputTokens','requestCount'] loop
    if p_attempt->v_key <> 'null'::jsonb then
      if jsonb_typeof(p_attempt->v_key)<>'number' or (p_attempt->>v_key)!~'^(0|[1-9][0-9]*)$' then return false; end if;
      if (p_attempt->>v_key)::numeric>9007199254740991 then return false; end if;
    end if;
  end loop;
  return true;
end $$;
alter table public.marketing_geo_kb_generations drop constraint if exists marketing_geo_generation_attempt_check;
alter table public.marketing_geo_kb_generations add constraint marketing_geo_generation_attempt_check
  check(public.marketing_geo_generation_attempt_valid(attempt));

create or replace function public.marketing_geo_generation_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'UPDATE' then raise exception 'GEO generation is append-only'; end if;
  if row(new.id,new.user_id,new.kb_id,new.kind,new.input_hash,new.input,new.created_at)
    is distinct from row(old.id,old.user_id,old.kb_id,old.kind,old.input_hash,old.input,old.created_at) then
    raise exception 'GEO generation input is immutable';
  end if;
  if old.state in ('succeeded','failed','uncertain') and not (
    old.state='failed' and old.attempt is null and old.error_reason in ('rate_limited','quota_unavailable')
    and new.state='claimed' and old.lease_expires_at<=now()
  ) then raise exception 'GEO terminal generation is immutable'; end if;
  if old.state='claimed' and new.state not in ('claimed','dispatched','failed') then raise exception 'Invalid generation transition'; end if;
  if old.state='dispatched' and new.state not in ('dispatched','succeeded','failed','uncertain') then raise exception 'Dispatched generation cannot be reclaimed'; end if;
  if old.state='dispatched' and new.state in ('succeeded','failed','uncertain') and new.attempt is null then raise exception 'Attempt metadata required'; end if;
  return new;
end $$;
drop trigger if exists marketing_geo_generation_guard_row on public.marketing_geo_kb_generations;
create trigger marketing_geo_generation_guard_row before update or delete on public.marketing_geo_kb_generations for each row execute function public.marketing_geo_generation_guard();
drop trigger if exists marketing_geo_generation_guard_truncate on public.marketing_geo_kb_generations;
create trigger marketing_geo_generation_guard_truncate before truncate on public.marketing_geo_kb_generations for each statement execute function public.marketing_geo_generation_guard();
drop trigger if exists marketing_geo_generation_keys_immutable on public.marketing_geo_kb_generation_keys;
create trigger marketing_geo_generation_keys_immutable before update or delete on public.marketing_geo_kb_generation_keys for each row execute function public.marketing_geo_kb_snapshots_immutable();
drop trigger if exists marketing_geo_generation_keys_truncate on public.marketing_geo_kb_generation_keys;
create trigger marketing_geo_generation_keys_truncate before truncate on public.marketing_geo_kb_generation_keys for each statement execute function public.marketing_geo_kb_snapshots_immutable();
drop trigger if exists marketing_geo_prepared_immutable on public.marketing_geo_kb_prepared_candidates;
create trigger marketing_geo_prepared_immutable before update or delete on public.marketing_geo_kb_prepared_candidates for each row execute function public.marketing_geo_kb_snapshots_immutable();
drop trigger if exists marketing_geo_prepared_truncate on public.marketing_geo_kb_prepared_candidates;
create trigger marketing_geo_prepared_truncate before truncate on public.marketing_geo_kb_prepared_candidates for each statement execute function public.marketing_geo_kb_snapshots_immutable();

-- Callers hold the KB lock; this pins the exact draft and owned current Profile.
create or replace function public.marketing_geo_generation_input_current(p_user_id uuid,p_kb_id uuid,p_input jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_kb public.marketing_geo_knowledge_bases; v_draft public.marketing_geo_kb_drafts;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id;
  if not found then return false; end if;
  select d.* into v_draft from public.marketing_geo_kb_drafts d where d.kb_id=p_kb_id and d.user_id=p_user_id for share;
  if not found or p_input->>'kbId' is distinct from p_kb_id::text
    or p_input->>'baseDraftVersion' is distinct from v_draft.draft_version::text
    or p_input->>'baseDraftHash' is distinct from v_draft.content_hash
    or p_input->>'profileCopyHash' is distinct from public.marketing_geo_json_hash(v_draft.payload->'profileCopy')
    or public.marketing_geo_validate_profile_copy(p_user_id,v_kb.canonical_site_key,v_draft.payload->'profileCopy') is not null then return false; end if;
  return true;
end $$;

create or replace function public.marketing_geo_claim_generation(
  p_user_id uuid,p_kb_id uuid,p_kind text,p_idempotency_key text,p_input_hash text,p_input jsonb
) returns table(outcome text,generation jsonb,claim_token uuid)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_row public.marketing_geo_kb_generations; v_key public.marketing_geo_kb_generation_keys;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  if p_kind not in ('roles','questions') or p_idempotency_key is null or p_idempotency_key !~ '^[a-zA-Z0-9_-]{8,128}$'
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>196608
    or public.marketing_geo_json_hash(jsonb_build_object('kind',p_kind,'input',p_input)) is distinct from p_input_hash then
    outcome:='conflict'; return next; return;
  end if;
  select k.* into v_key from public.marketing_geo_kb_generation_keys k where k.user_id=p_user_id and k.kb_id=p_kb_id and k.idempotency_key=p_idempotency_key;
  if found then
    if v_key.kind is distinct from p_kind or v_key.input_hash is distinct from p_input_hash then outcome:='conflict'; return next; return; end if;
    select g.* into v_row from public.marketing_geo_kb_generations g where g.id=v_key.generation_id for update;
  else
    select g.* into v_row from public.marketing_geo_kb_generations g where g.user_id=p_user_id and g.kb_id=p_kb_id and g.kind=p_kind and g.input_hash=p_input_hash for update;
    if not found then
      if not public.marketing_geo_generation_input_current(p_user_id,p_kb_id,p_input) then outcome:='input_stale'; return next; return; end if;
      insert into public.marketing_geo_kb_generations(user_id,kb_id,kind,input_hash,input,state,lease_expires_at)
        values(p_user_id,p_kb_id,p_kind,p_input_hash,p_input,'claimed',now()+interval '2 minutes') returning * into v_row;
      outcome:='claimed'; claim_token:=v_row.claim_token;
    end if;
    insert into public.marketing_geo_kb_generation_keys(user_id,kb_id,idempotency_key,generation_id,kind,input_hash)
      values(p_user_id,p_kb_id,p_idempotency_key,v_row.id,p_kind,p_input_hash);
  end if;
  if outcome is distinct from 'claimed' then
    outcome:='existing';
    if v_row.state='dispatched' and v_row.lease_expires_at<=now() then
      update public.marketing_geo_kb_generations set state='uncertain',error_reason='outcome_unknown',
        attempt=jsonb_build_object('attemptedCalls',1,'delivery','outcome_unknown','modelRequested',null,'inputTokens',null,'outputTokens',null,'requestCount',null),updated_at=now()
        where id=v_row.id returning * into v_row;
    elsif (v_row.state='claimed' or (v_row.state='failed' and v_row.attempt is null and v_row.error_reason in ('rate_limited','quota_unavailable'))) and v_row.lease_expires_at<=now() then
      if not public.marketing_geo_generation_input_current(p_user_id,p_kb_id,p_input) then outcome:='input_stale'; return next; return; end if;
      update public.marketing_geo_kb_generations set state='claimed',claim_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',
        result=null,error_reason=null,attempt=null,updated_at=now() where id=v_row.id returning * into v_row;
      outcome:='claimed'; claim_token:=v_row.claim_token;
    end if;
  end if;
  generation:=public.marketing_geo_generation_record(v_row); return next;
end $$;

create or replace function public.marketing_geo_dispatch_generation(p_user_id uuid,p_kb_id uuid,p_generation_id uuid,p_claim_token uuid)
returns table(outcome text,generation jsonb)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_row public.marketing_geo_kb_generations;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select g.* into v_row from public.marketing_geo_kb_generations g where g.id=p_generation_id and g.kb_id=p_kb_id and g.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  outcome:='existing';
  if v_row.state='claimed' and v_row.claim_token=p_claim_token and v_row.lease_expires_at>now() then
    if not public.marketing_geo_generation_input_current(p_user_id,p_kb_id,v_row.input) then
      update public.marketing_geo_kb_generations set state='failed',error_reason='input_stale',updated_at=now() where id=v_row.id returning * into v_row;
    else
      update public.marketing_geo_kb_generations set state='dispatched',lease_expires_at=now()+interval '5 minutes',updated_at=now() where id=v_row.id returning * into v_row;
      outcome:='dispatched';
    end if;
  end if;
  generation:=public.marketing_geo_generation_record(v_row); return next;
end $$;

create or replace function public.marketing_geo_candidate_valid(p_user_id uuid,p_kb_id uuid,p_candidate jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_ref jsonb; v_receipt public.marketing_geo_enrichment_receipts; v_copy jsonb; v_context jsonb; v_competitor_evidence jsonb;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' or octet_length(p_candidate::text)>1572864
    or p_candidate->>'schemaVersion' is distinct from 'marketing-geo-prepared-candidate.v1'
    or p_candidate->>'kbId' is distinct from p_kb_id::text
    or p_candidate->>'candidateHash' is distinct from public.marketing_geo_json_hash(p_candidate-'candidateHash')
    or p_candidate#>>'{payload,schemaVersion}' is distinct from 'marketing-geo-kb.v2'
    or p_candidate#>>'{questionSet,schemaVersion}' is distinct from 'marketing-geo-question-set.v2'
    or p_candidate->>'baseDraftHash' is distinct from public.marketing_geo_json_hash(p_candidate->'payload')
    or p_candidate->>'profileCopyHash' is distinct from public.marketing_geo_json_hash(p_candidate#>'{payload,profileCopy}')
    or p_candidate->>'generatorVersion' is distinct from p_candidate#>>'{questionSet,methodVersion}'
    or jsonb_typeof(p_candidate->'sourceReceiptRefs') is distinct from 'array' then return false; end if;
  v_context:=p_candidate->'context'; v_copy:=p_candidate#>'{payload,profileCopy}';
  if v_context->>'schemaVersion' is distinct from 'marketing-geo-snapshot-context.v2'
    or v_context->>'candidateId' is distinct from p_candidate->>'candidateId'
    or v_context->>'kbId' is distinct from p_kb_id::text
    or v_context->>'payloadHash' is distinct from p_candidate->>'baseDraftHash'
    or v_context->>'questionSetHash' is distinct from public.marketing_geo_json_hash(p_candidate->'questionSet')
    or v_context->>'contentHash' is distinct from public.marketing_geo_json_hash(v_context-'contentHash')
    or v_context->'sourceReceiptRefs' is distinct from p_candidate->'sourceReceiptRefs'
    or v_context->'profile' is distinct from jsonb_build_object(
      'reference',jsonb_build_object('schemaVersion','website-profile-reference.v1','websiteId',v_copy->>'websiteId','snapshotId',v_copy->>'snapshotId',
        'snapshotRevision',(v_copy->>'snapshotRevision')::integer,'profileHash',v_copy->>'profileHash','profileSchemaVersion',v_copy#>>'{profile,schemaVersion}'),
      'productName',v_copy#>'{profile,productName}','oneLinePositioning',v_copy#>'{profile,oneLinePositioning}',
      'coreFeatures',v_copy#>'{profile,coreFeatures}','market',jsonb_build_object('country',v_copy#>'{profile,country}','language',v_copy#>'{profile,locale}'),
      'fieldProvenance',(select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb)
        from jsonb_array_elements(v_copy#>'{profile,fieldProvenance}') with ordinality e(value,ordinality)
        where e.value->>'path' in ('/productName','/oneLinePositioning','/coreFeatures'))
    ) then return false; end if;
  for v_ref in select value from jsonb_array_elements(p_candidate->'sourceReceiptRefs') loop
    select r.* into v_receipt from public.marketing_geo_enrichment_receipts r
      where r.id::text=v_ref->>'receiptId' and r.kb_id=p_kb_id and r.user_id=p_user_id;
    if not found or v_receipt.content_hash is distinct from v_ref->>'contentHash'
      or v_receipt.report->>'targetHost' is distinct from v_context->>'targetHost'
      or v_receipt.report->'profileReference' is distinct from v_context#>'{profile,reference}' then return false; end if;
  end loop;
  -- Freeze the latest *selected* extraction for each saved domain, not an
  -- inferred provenance link from the current manual brand/alias mapping.
  -- Derive this from exact owned immutable receipts; never consult latest data.
  select coalesce(jsonb_agg(jsonb_build_object(
    'receiptId',selected.receipt_id,'contentHash',selected.content_hash,
    'receiptCreatedAt',selected.receipt_created_at,'capture',selected.capture
  ) order by competitor.ordinality),'[]'::jsonb) into v_competitor_evidence
  from jsonb_array_elements(p_candidate#>'{payload,competitors}') with ordinality competitor(value,ordinality)
  cross join lateral (
    select r.id::text as receipt_id,r.content_hash,r.report->'createdAt' as receipt_created_at,capture.value as capture
    from public.marketing_geo_enrichment_receipts r
    join jsonb_array_elements(p_candidate->'sourceReceiptRefs') ref on ref.value->>'receiptId'=r.id::text and ref.value->>'contentHash'=r.content_hash
    cross join lateral jsonb_array_elements(r.report->'competitors') capture(value)
    where r.user_id=p_user_id and r.kb_id=p_kb_id and r.report->>'schemaVersion'='marketing-geo-kb-enrichment.v2'
      and competitor.value->>'domain'<>'' and capture.value->>'domain'=competitor.value->>'domain'
    order by r.report->>'createdAt' desc,r.id desc limit 1
  ) selected;
  if v_context->'competitorEvidence' is distinct from v_competitor_evidence then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

create or replace function public.marketing_geo_finish_generation(
  p_user_id uuid,p_kb_id uuid,p_generation_id uuid,p_claim_token uuid,p_state text,p_result jsonb,p_error_reason text,p_attempt jsonb
) returns table(outcome text,generation jsonb)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_row public.marketing_geo_kb_generations; v_valid boolean; v_candidate_id uuid;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select g.* into v_row from public.marketing_geo_kb_generations g where g.id=p_generation_id and g.kb_id=p_kb_id and g.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  if v_row.state in ('succeeded','failed','uncertain') or v_row.claim_token is distinct from p_claim_token then
    outcome:='existing'; generation:=public.marketing_geo_generation_record(v_row); return next; return;
  end if;
  if not public.marketing_geo_generation_attempt_valid(p_attempt) or p_state not in ('succeeded','failed','uncertain')
    or (v_row.state='claimed' and (p_state<>'failed' or p_error_reason not in ('rate_limited','quota_unavailable') or p_attempt is not null))
    or (v_row.state='dispatched' and p_attempt is null)
    or (p_state='succeeded' and (p_result is null or p_error_reason is not null or p_attempt->>'delivery' is distinct from 'response_received'))
    or (p_state<>'succeeded' and p_result is not null)
    or (p_state='uncertain' and (p_error_reason is distinct from 'outcome_unknown' or p_attempt->>'delivery' is distinct from 'outcome_unknown')) then
    outcome:='invalid_result'; return next; return;
  end if;
  if p_state='succeeded' then
    if not public.marketing_geo_generation_input_current(p_user_id,p_kb_id,v_row.input) then
      p_state:='failed'; p_result:=null; p_error_reason:='input_stale';
    else
      v_valid:=p_result->>'kbId'=p_kb_id::text
        and p_result->>'baseDraftVersion'=v_row.input->>'baseDraftVersion'
        and p_result->>'baseDraftHash'=v_row.input->>'baseDraftHash'
        and p_result->>'profileCopyHash'=v_row.input->>'profileCopyHash'
        and p_result->'sourceReceiptRefs'=coalesce(v_row.input->'sourceReceiptRefs','[]'::jsonb);
      if v_row.kind='questions' then
        v_valid:=v_valid and public.marketing_geo_candidate_valid(p_user_id,p_kb_id,p_result);
      else
        v_valid:=v_valid and p_result->>'schemaVersion'='marketing-geo-role-proposal.v1'
          and p_result->>'generationId'=p_generation_id::text
          and p_result->>'contentHash'=public.marketing_geo_json_hash(p_result-'contentHash');
      end if;
      if v_valid is distinct from true then outcome:='invalid_result'; return next; return; end if;
      if v_row.kind='questions' then
        v_candidate_id:=(p_result->>'candidateId')::uuid;
        insert into public.marketing_geo_kb_prepared_candidates(id,user_id,kb_id,generation_id,candidate_hash,candidate)
          values(v_candidate_id,p_user_id,p_kb_id,p_generation_id,p_result->>'candidateHash',p_result);
      end if;
    end if;
  end if;
  update public.marketing_geo_kb_generations set state=p_state,result=p_result,error_reason=p_error_reason,attempt=p_attempt,
    lease_expires_at=case when p_state='failed' and p_attempt is null and p_error_reason in ('rate_limited','quota_unavailable') then now()+interval '1 minute' else lease_expires_at end,
    updated_at=now() where id=v_row.id returning * into v_row;
  outcome:='finished'; generation:=public.marketing_geo_generation_record(v_row); return next;
end $$;

create or replace function public.marketing_geo_freeze_prepared_kb(p_user_id uuid,p_kb_id uuid,p_candidate_id uuid,p_candidate_hash text)
returns table(outcome text,snapshot_id uuid,revision integer,content_hash text,frozen_at timestamptz,reused_existing boolean)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_prepared public.marketing_geo_kb_prepared_candidates; v_snapshot public.marketing_geo_kb_snapshots; v_candidate jsonb; v_context jsonb; v_host text;
begin
  select k.canonical_site_key into v_host from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select p.* into v_prepared from public.marketing_geo_kb_prepared_candidates p where p.id=p_candidate_id and p.kb_id=p_kb_id and p.user_id=p_user_id;
  if not found then outcome:='not_found'; return next; return; end if;
  if v_prepared.candidate_hash is distinct from p_candidate_hash or not public.marketing_geo_candidate_valid(p_user_id,p_kb_id,v_prepared.candidate) then outcome:='candidate_mismatch'; return next; return; end if;
  -- Idempotent replay is a read. It must not rewind a subsequently newer pointer.
  select s.* into v_snapshot from public.marketing_geo_kb_snapshots s where s.prepared_id=p_candidate_id and s.kb_id=p_kb_id and s.user_id=p_user_id;
  if found then
    outcome:='frozen'; snapshot_id:=v_snapshot.id; revision:=v_snapshot.revision; content_hash:=v_snapshot.content_hash; frozen_at:=v_snapshot.frozen_at; reused_existing:=true; return next; return;
  end if;
  v_candidate:=v_prepared.candidate; v_context:=v_candidate->'context';
  if v_context->>'targetHost' is distinct from v_host or not public.marketing_geo_generation_input_current(p_user_id,p_kb_id,v_candidate) then outcome:='input_stale'; return next; return; end if;
  select coalesce(max(s.revision),0)+1 into revision from public.marketing_geo_kb_snapshots s where s.kb_id=p_kb_id;
  insert into public.marketing_geo_kb_snapshots(kb_id,user_id,revision,schema_version,payload,content_hash,question_set,question_set_hash,context_hash,prepared_id)
    values(p_kb_id,p_user_id,revision,'marketing-geo-kb.v2',v_candidate->'payload',v_candidate->>'baseDraftHash',v_candidate->'questionSet',v_context->>'questionSetHash',v_context->>'contentHash',p_candidate_id)
    returning marketing_geo_kb_snapshots.id,marketing_geo_kb_snapshots.content_hash,marketing_geo_kb_snapshots.frozen_at into snapshot_id,content_hash,frozen_at;
  insert into public.marketing_geo_snapshot_contexts(snapshot_id,user_id,kb_id,content_hash,context,receipt_id)
    values(snapshot_id,p_user_id,p_kb_id,v_context->>'contentHash',v_context,null);
  update public.marketing_geo_knowledge_bases set current_frozen_snapshot_id=snapshot_id,updated_at=now() where id=p_kb_id;
  outcome:='frozen'; reused_existing:=false; return next;
end $$;

create or replace function public.marketing_geo_record_enrichment(p_user_id uuid,p_kb_id uuid,p_receipt_id uuid,p_report jsonb)
returns table(outcome text) language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_host text; v_hash text; v_existing public.marketing_geo_enrichment_receipts; v_cap integer;
begin
  select k.canonical_site_key into v_host from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id;
  if not found then outcome:='not_found'; return next; return; end if;
  v_cap:=case p_report->>'schemaVersion' when 'marketing-geo-kb-enrichment.v1' then 524288 when 'marketing-geo-kb-enrichment.v2' then 2097152 else 0 end;
  v_hash:=public.marketing_geo_json_hash(p_report-'contentHash');
  if v_cap=0 or jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>v_cap
    or p_report->>'receiptId' is distinct from p_receipt_id::text or p_report->>'kbId' is distinct from p_kb_id::text
    or p_report->>'targetHost' is distinct from v_host or p_report->>'contentHash' is distinct from v_hash then outcome:='receipt_mismatch'; return next; return; end if;
  insert into public.marketing_geo_enrichment_receipts(id,user_id,kb_id,content_hash,report) values(p_receipt_id,p_user_id,p_kb_id,v_hash,p_report) on conflict(id) do nothing;
  if found then outcome:='recorded'; return next; return; end if;
  select r.* into v_existing from public.marketing_geo_enrichment_receipts r where r.id=p_receipt_id;
  outcome:=case when v_existing.user_id=p_user_id and v_existing.kb_id=p_kb_id and v_existing.report=p_report then 'recorded' else 'receipt_conflict' end; return next;
end $$;

create or replace function public.marketing_geo_read_generation(p_user_id uuid,p_kb_id uuid,p_generation_id uuid,p_kind text)
returns table(outcome text,generation jsonb)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_row public.marketing_geo_kb_generations;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select g.* into v_row from public.marketing_geo_kb_generations g
    where g.user_id=p_user_id and g.kb_id=p_kb_id
      and (case when p_generation_id is not null then g.id=p_generation_id else g.kind=p_kind end)
    order by g.created_at desc,g.id desc limit 1 for update;
  if not found then outcome:='not_found'; return next; return; end if;
  if v_row.state='dispatched' and v_row.lease_expires_at<=now() then
    update public.marketing_geo_kb_generations set state='uncertain',error_reason='outcome_unknown',
      attempt=jsonb_build_object('attemptedCalls',1,'delivery','outcome_unknown','modelRequested',null,'inputTokens',null,'outputTokens',null,'requestCount',null),
      updated_at=now() where id=v_row.id returning * into v_row;
  end if;
  outcome:='found'; generation:=public.marketing_geo_generation_record(v_row); return next;
end $$;

-- Exact response recovery. This can only settle an expired dispatched lease
-- to uncertain through the shared reader; it never claims or dispatches work.
create or replace function public.marketing_geo_read_generation_by_key(p_user_id uuid,p_kb_id uuid,p_kind text,p_idempotency_key text)
returns table(outcome text,generation jsonb)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_id uuid;
begin
  select k.generation_id into v_id from public.marketing_geo_kb_generation_keys k
    where k.user_id=p_user_id and k.kb_id=p_kb_id and k.kind=p_kind and k.idempotency_key=p_idempotency_key;
  if not found then outcome:='not_found'; return next; return; end if;
  return query select r.outcome,r.generation from public.marketing_geo_read_generation(p_user_id,p_kb_id,v_id,p_kind) r;
end $$;

alter table public.marketing_geo_kb_generations enable row level security;
alter table public.marketing_geo_kb_generation_keys enable row level security;
alter table public.marketing_geo_kb_prepared_candidates enable row level security;
revoke all on public.marketing_geo_kb_generations,public.marketing_geo_kb_generation_keys,public.marketing_geo_kb_prepared_candidates from public,anon,authenticated,service_role;
grant select on public.marketing_geo_kb_generations,public.marketing_geo_kb_prepared_candidates to service_role;
revoke all on function public.marketing_geo_generation_record(public.marketing_geo_kb_generations),public.marketing_geo_json_hash(jsonb),public.marketing_geo_generation_attempt_valid(jsonb),
  public.marketing_geo_generation_guard(),public.marketing_geo_generation_input_current(uuid,uuid,jsonb),public.marketing_geo_candidate_valid(uuid,uuid,jsonb),
  public.marketing_geo_claim_generation(uuid,uuid,text,text,text,jsonb),public.marketing_geo_dispatch_generation(uuid,uuid,uuid,uuid),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),public.marketing_geo_freeze_prepared_kb(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.marketing_geo_claim_generation(uuid,uuid,text,text,text,jsonb),public.marketing_geo_dispatch_generation(uuid,uuid,uuid,uuid),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),public.marketing_geo_freeze_prepared_kb(uuid,uuid,uuid,text)
  to service_role;
revoke all on function public.marketing_geo_read_generation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.marketing_geo_read_generation(uuid,uuid,uuid,text) to service_role;
revoke all on function public.marketing_geo_read_generation_by_key(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.marketing_geo_read_generation_by_key(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
