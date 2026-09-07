-- Forward-only GEO knowledge-pack companion. Existing generation, candidate,
-- snapshot and context bytes are never rewritten.
alter table public.marketing_geo_kb_generations
  drop constraint if exists marketing_geo_kb_generations_kind_check;
alter table public.marketing_geo_kb_generations
  add constraint marketing_geo_kb_generations_kind_check
  check (kind in ('roles','questions','knowledge_pack'));

alter table public.marketing_geo_kb_generation_keys
  drop constraint if exists marketing_geo_kb_generation_keys_kind_check;
alter table public.marketing_geo_kb_generation_keys
  add constraint marketing_geo_kb_generation_keys_kind_check
  check (kind in ('roles','questions','knowledge_pack'));

alter table public.marketing_geo_kb_generations
  drop constraint if exists marketing_geo_kb_generations_result_check;
alter table public.marketing_geo_kb_generations
  add constraint marketing_geo_kb_generations_result_check
  check (result is null or (jsonb_typeof(result)='object' and
    ((kind='roles' and (result->>'schemaVersion') is not distinct from 'marketing-geo-role-proposal.v1' and octet_length(result::text)<=393216)
     or (kind='questions' and (result->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v1' and octet_length(result::text)<=1572864)
     or (kind='questions' and (result->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v2' and octet_length(result::text)<=2359296)
     or (kind='knowledge_pack' and (result->>'schemaVersion') is not distinct from 'marketing-geo-knowledge-generation-result.v1' and octet_length(result::text)<=2097152))));

alter table public.marketing_geo_kb_prepared_candidates
  drop constraint if exists marketing_geo_kb_prepared_candidates_candidate_check;
alter table public.marketing_geo_kb_prepared_candidates
  add constraint marketing_geo_kb_prepared_candidates_candidate_check
  check (jsonb_typeof(candidate)='object' and
    (((candidate->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v1' and octet_length(candidate::text)<=1572864)
     or ((candidate->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v2' and octet_length(candidate::text)<=2359296)));

create or replace function public.marketing_geo_knowledge_input_valid(p_kb_id uuid,p_input_hash text,p_input jsonb)
returns boolean language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare v_synthesis jsonb; v_ref jsonb; v_previous_receipt_id text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then return false; end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_input))<>7
    or p_input->>'schemaVersion' is distinct from 'marketing-geo-knowledge-generation-input.v1'
    or p_input->>'kbId' is distinct from p_kb_id::text
    or jsonb_typeof(p_input->'baseDraftVersion') is distinct from 'string'
    or p_input->>'baseDraftVersion' !~ '^[1-9][0-9]{0,15}$'
    or (p_input->>'baseDraftVersion')::numeric>9007199254740991
    or jsonb_typeof(p_input->'baseDraftHash') is distinct from 'string'
    or p_input->>'baseDraftHash' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_input->'profileCopyHash') is distinct from 'string'
    or p_input->>'profileCopyHash' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_input->'sourceReceiptRefs') is distinct from 'array'
    or jsonb_array_length(p_input->'sourceReceiptRefs')>32
    or jsonb_typeof(p_input->'knowledgeSynthesisInput') is distinct from 'object'
    or public.marketing_geo_json_hash(jsonb_build_object('kind','knowledge_pack','input',p_input)) is distinct from p_input_hash
  then return false; end if;
  v_synthesis:=p_input->'knowledgeSynthesisInput';
  if jsonb_typeof(v_synthesis) is distinct from 'object' then return false; end if;
  for v_ref in select value from jsonb_array_elements(p_input->'sourceReceiptRefs') loop
    if jsonb_typeof(v_ref) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_ref))<>2
      or jsonb_typeof(v_ref->'receiptId') is distinct from 'string'
      or v_ref->>'receiptId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      or jsonb_typeof(v_ref->'contentHash') is distinct from 'string'
      or v_ref->>'contentHash' !~ '^[a-f0-9]{64}$'
      or (v_previous_receipt_id is not null and v_previous_receipt_id>=v_ref->>'receiptId')
    then return false; end if;
    v_previous_receipt_id:=v_ref->>'receiptId';
  end loop;
  if octet_length(v_synthesis::text)>163840
    or (select count(*) from jsonb_object_keys(v_synthesis))<>12
    or v_synthesis->>'schemaVersion' is distinct from 'marketing-geo-knowledge-synthesis-input.v1'
    or v_synthesis->>'contentHash' is distinct from public.marketing_geo_json_hash(v_synthesis-'contentHash')
    or jsonb_typeof(v_synthesis->'sourceCatalogue') is distinct from 'array'
    or jsonb_array_length(v_synthesis->'sourceCatalogue') not between 1 and 32
    or v_synthesis->>'sourceCatalogueHash' is distinct from public.marketing_geo_json_hash(v_synthesis->'sourceCatalogue')
  then return false; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

-- Pure defense-in-depth for the exact TypeScript knowledge generation result.
-- It owns no table access; callers separately lock and validate current state.
create or replace function public.marketing_geo_knowledge_result_valid(
  p_kb_id uuid,p_generation_id uuid,p_input_hash text,p_input jsonb,p_result jsonb
) returns boolean language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare v_sources jsonb;
begin
  if not public.marketing_geo_knowledge_input_valid(p_kb_id,p_input_hash,p_input)
    or jsonb_typeof(p_result) is distinct from 'object' then return false; end if;
  if jsonb_typeof(p_result->'evidence') is distinct from 'object'
    or jsonb_typeof(p_result->'synthesisInput') is distinct from 'object'
    or jsonb_typeof(p_result->'narrative') is distinct from 'object' then return false; end if;
  if not public.marketing_geo_knowledge_input_valid(p_kb_id,p_input_hash,p_input)
    or jsonb_typeof(p_result) is distinct from 'object'
    or octet_length(p_result::text)>2097152
    or (select count(*) from jsonb_object_keys(p_result))<>9
    or p_result->>'schemaVersion' is distinct from 'marketing-geo-knowledge-generation-result.v1'
    or p_result->>'generationId' is distinct from p_generation_id::text
    or p_result->>'kbId' is distinct from p_kb_id::text
    or p_result->>'contentHash' is distinct from public.marketing_geo_json_hash(p_result-'contentHash')
    or p_result->'manifest' is distinct from p_input
    or p_result->'synthesisInput' is distinct from p_input->'knowledgeSynthesisInput'
    or p_result#>>'{synthesisInput,schemaVersion}' is distinct from 'marketing-geo-knowledge-synthesis-input.v1'
    or p_result#>>'{evidence,schemaVersion}' is distinct from 'marketing-geo-knowledge-evidence.v1'
    or p_result#>>'{narrative,schemaVersion}' is distinct from 'marketing-geo-knowledge-narrative.v1'
    or octet_length((p_result->'evidence')::text)>1048576
    or octet_length((p_result->'synthesisInput')::text)>163840
    or octet_length((p_result->'narrative')::text)>131072
    or (select count(*) from jsonb_object_keys(p_result->'evidence'))<>10
    or (select count(*) from jsonb_object_keys(p_result->'synthesisInput'))<>12
    or (select count(*) from jsonb_object_keys(p_result->'narrative'))<>6
    or p_result#>>'{evidence,contentHash}' is distinct from public.marketing_geo_json_hash((p_result->'evidence')-'contentHash')
    or p_result#>>'{synthesisInput,contentHash}' is distinct from public.marketing_geo_json_hash((p_result->'synthesisInput')-'contentHash')
    or p_result#>>'{synthesisInput,evidenceContentHash}' is distinct from p_result#>>'{evidence,contentHash}'
    or p_result#>>'{synthesisInput,targetUrl}' is distinct from p_result#>>'{evidence,targetUrl}'
    or p_result#>'{synthesisInput,confirmedCompetitors}' is distinct from p_result#>'{evidence,confirmedCompetitors}'
    or jsonb_typeof(p_result#>'{evidence,sourceCatalogue}') is distinct from 'array'
    or jsonb_typeof(p_result#>'{synthesisInput,sourceCatalogue}') is distinct from 'array'
    or jsonb_array_length(p_result#>'{evidence,sourceCatalogue}') not between 1 and 32
    or jsonb_array_length(p_result#>'{synthesisInput,sourceCatalogue}') not between 1 and 32
    or p_result#>>'{synthesisInput,sourceCatalogueHash}' is distinct from public.marketing_geo_json_hash(p_result#>'{synthesisInput,sourceCatalogue}')
    or jsonb_typeof(p_result->'generatedAt') is distinct from 'string'
    or jsonb_typeof(p_result#>'{evidence,collectedAt}') is distinct from 'string'
    or p_result->>'generatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or p_result#>>'{evidence,collectedAt}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or (p_result->>'generatedAt')::timestamptz < (p_result#>>'{evidence,collectedAt}')::timestamptz
  then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_result#>'{evidence,sourceCatalogue}') source(value)
    where jsonb_typeof(source.value) is distinct from 'object' or source.value->>'availability' is null
      or source.value->>'availability' not in ('available','partial','unavailable')) then return false; end if;
  select coalesce(jsonb_agg(source.value order by source.ordinality),'[]'::jsonb) into v_sources
    from jsonb_array_elements(p_result#>'{evidence,sourceCatalogue}') with ordinality source(value,ordinality)
    where source.value->>'availability' in ('available','partial');
  return p_result#>'{synthesisInput,sourceCatalogue}' is not distinct from v_sources;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return false;
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
    elsif v_row.kind='roles' then
      -- Preserve the exact legacy role-proposal branch.
      v_valid:=p_result->>'kbId'=p_kb_id::text
        and p_result->>'baseDraftVersion'=v_row.input->>'baseDraftVersion'
        and p_result->>'baseDraftHash'=v_row.input->>'baseDraftHash'
        and p_result->>'profileCopyHash'=v_row.input->>'profileCopyHash'
        and p_result->'sourceReceiptRefs'=coalesce(v_row.input->'sourceReceiptRefs','[]'::jsonb)
        and p_result->>'schemaVersion'='marketing-geo-role-proposal.v1'
        and p_result->>'generationId'=p_generation_id::text
        and p_result->>'contentHash'=public.marketing_geo_json_hash(p_result-'contentHash');
      if v_valid is distinct from true then outcome:='invalid_result'; return next; return; end if;
    elsif v_row.kind='questions' then
      v_valid:=p_result->>'kbId'=p_kb_id::text
        and p_result->>'candidateId'=p_generation_id::text
        and p_result->>'baseDraftVersion'=v_row.input->>'baseDraftVersion'
        and p_result->>'baseDraftHash'=v_row.input->>'baseDraftHash'
        and p_result->>'profileCopyHash'=v_row.input->>'profileCopyHash'
        and p_result->'sourceReceiptRefs'=coalesce(v_row.input->'sourceReceiptRefs','[]'::jsonb)
        and public.marketing_geo_candidate_valid(p_user_id,p_kb_id,p_result);
      if p_result->>'schemaVersion'='marketing-geo-prepared-candidate.v1' then
        v_valid:=v_valid and not (v_row.input ? 'knowledgeGeneration');
      elsif p_result->>'schemaVersion'='marketing-geo-prepared-candidate.v2' then
        v_valid:=v_valid and jsonb_typeof(v_row.input->'knowledgeGeneration')='object'
          and p_result#>>'{knowledgeGeneration,generationId}'=v_row.input#>>'{knowledgeGeneration,generationId}'
          and p_result#>>'{knowledgeGeneration,inputHash}'=v_row.input#>>'{knowledgeGeneration,inputHash}'
          and exists (select 1 from public.marketing_geo_kb_generations kg
            where kg.id=(v_row.input#>>'{knowledgeGeneration,generationId}')::uuid and kg.user_id=p_user_id and kg.kb_id=p_kb_id
              and kg.kind='knowledge_pack' and kg.state='succeeded' and kg.input_hash=v_row.input#>>'{knowledgeGeneration,inputHash}'
              and kg.result->>'contentHash'=v_row.input#>>'{knowledgeGeneration,resultHash}');
      else v_valid:=false; end if;
      if v_valid is distinct from true then outcome:='invalid_result'; return next; return; end if;
      v_candidate_id:=(p_result->>'candidateId')::uuid;
      insert into public.marketing_geo_kb_prepared_candidates(id,user_id,kb_id,generation_id,candidate_hash,candidate)
        values(v_candidate_id,p_user_id,p_kb_id,p_generation_id,p_result->>'candidateHash',p_result);
    elsif v_row.kind='knowledge_pack' then
      v_valid:=public.marketing_geo_knowledge_result_valid(p_kb_id,p_generation_id,v_row.input_hash,v_row.input,p_result);
      if v_valid is distinct from true then outcome:='invalid_result'; return next; return; end if;
    else
      outcome:='invalid_result'; return next; return;
    end if;
  end if;
  update public.marketing_geo_kb_generations set state=p_state,result=p_result,error_reason=p_error_reason,attempt=p_attempt,
    lease_expires_at=case when p_state='failed' and p_attempt is null and p_error_reason in ('rate_limited','quota_unavailable') then now()+interval '1 minute' else lease_expires_at end,
    updated_at=now() where id=v_row.id returning * into v_row;
  outcome:='finished'; generation:=public.marketing_geo_generation_record(v_row); return next;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  outcome:='invalid_result'; generation:=null; return next;
end $$;

create or replace function public.marketing_geo_candidate_valid(p_user_id uuid,p_kb_id uuid,p_candidate jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  v_ref jsonb; v_receipt public.marketing_geo_enrichment_receipts; v_copy jsonb; v_context jsonb; v_competitor_evidence jsonb;
  v_schema text; v_pack jsonb; v_synthesis jsonb; v_knowledge jsonb; v_manifest jsonb; v_sources jsonb; v_confirmed jsonb;
  v_generation public.marketing_geo_kb_generations; v_question_generation public.marketing_geo_kb_generations;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' then return false; end if;
  v_schema:=p_candidate->>'schemaVersion';
  if v_schema is null or v_schema not in ('marketing-geo-prepared-candidate.v1','marketing-geo-prepared-candidate.v2')
    or (v_schema='marketing-geo-prepared-candidate.v1' and octet_length(p_candidate::text)>1572864)
    or (v_schema='marketing-geo-prepared-candidate.v2' and octet_length(p_candidate::text)>2359296)
    or (v_schema='marketing-geo-prepared-candidate.v1' and (select count(*) from jsonb_object_keys(p_candidate))<>12)
    or (v_schema='marketing-geo-prepared-candidate.v2' and (select count(*) from jsonb_object_keys(p_candidate))<>15)
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

  select g.* into v_question_generation from public.marketing_geo_kb_generations g
    where g.id=(p_candidate->>'candidateId')::uuid and g.user_id=p_user_id and g.kb_id=p_kb_id and g.kind='questions'
      and g.state in ('dispatched','succeeded');
  if not found or v_question_generation.input_hash is distinct from public.marketing_geo_json_hash(jsonb_build_object('kind','questions','input',v_question_generation.input))
    or p_candidate->>'baseDraftVersion' is distinct from v_question_generation.input->>'baseDraftVersion'
    or p_candidate->>'baseDraftHash' is distinct from v_question_generation.input->>'baseDraftHash'
    or p_candidate->>'profileCopyHash' is distinct from v_question_generation.input->>'profileCopyHash'
    or p_candidate->'sourceReceiptRefs' is distinct from coalesce(v_question_generation.input->'sourceReceiptRefs','[]'::jsonb)
    or (v_question_generation.state='succeeded' and v_question_generation.result is distinct from p_candidate)
    then return false; end if;

  for v_ref in select value from jsonb_array_elements(p_candidate->'sourceReceiptRefs') loop
    select r.* into v_receipt from public.marketing_geo_enrichment_receipts r
      where r.id::text=v_ref->>'receiptId' and r.kb_id=p_kb_id and r.user_id=p_user_id;
    if not found or v_receipt.content_hash is distinct from v_ref->>'contentHash'
      or v_receipt.report->>'targetHost' is distinct from v_context->>'targetHost'
      or v_receipt.report->'profileReference' is distinct from v_context#>'{profile,reference}' then return false; end if;
  end loop;

  -- Preserve the exact selected-receipt competitor evidence derivation used by
  -- the V1 validator. No latest/unselected receipt is consulted.
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
  if v_schema='marketing-geo-prepared-candidate.v1' then return true; end if;

  v_pack:=p_candidate->'knowledgePack'; v_synthesis:=p_candidate->'knowledgeSynthesisInput'; v_knowledge:=p_candidate->'knowledgeGeneration';
  if jsonb_typeof(v_pack) is distinct from 'object' or jsonb_typeof(v_synthesis) is distinct from 'object'
    or jsonb_typeof(v_knowledge) is distinct from 'object' then return false; end if;
  if jsonb_typeof(v_pack) is distinct from 'object' or jsonb_typeof(v_synthesis) is distinct from 'object' or jsonb_typeof(v_knowledge) is distinct from 'object'
    or octet_length(v_pack::text)>524288 or octet_length(v_synthesis::text)>163840
    or (select count(*) from jsonb_object_keys(v_pack))<>12
    or (select count(*) from jsonb_object_keys(v_synthesis))<>12
    or v_pack->>'schemaVersion' is distinct from 'marketing-geo-knowledge-pack.v1'
    or v_synthesis->>'schemaVersion' is distinct from 'marketing-geo-knowledge-synthesis-input.v1'
    or v_pack->>'contentHash' is distinct from public.marketing_geo_json_hash(v_pack-'contentHash')
    or v_synthesis->>'contentHash' is distinct from public.marketing_geo_json_hash(v_synthesis-'contentHash')
    or v_pack#>>'{meta,market}' is distinct from p_candidate#>>'{payload,market,country}'
    or v_pack#>>'{meta,language}' is distinct from p_candidate#>>'{payload,market,language}'
    or v_synthesis->>'targetUrl' is distinct from (case
      when p_candidate#>>'{payload,targetUrl}' ~ '^https://[^/?#]+$' then (p_candidate#>>'{payload,targetUrl}')||'/'
      else p_candidate#>>'{payload,targetUrl}' end)
    or v_synthesis->>'officialName' is distinct from p_candidate#>>'{payload,officialName}'
    or v_synthesis->'aliases' is distinct from p_candidate#>'{payload,aliases}'
    or v_synthesis->'categoryTerms' is distinct from p_candidate#>'{payload,categoryTerms}'
    or v_synthesis->>'market' is distinct from p_candidate#>>'{payload,market,country}'
    or v_synthesis->>'language' is distinct from p_candidate#>>'{payload,market,language}'
    or jsonb_typeof(v_pack->'sourceCatalogue') is distinct from 'array'
    or jsonb_typeof(v_synthesis->'sourceCatalogue') is distinct from 'array'
    or jsonb_array_length(v_pack->'sourceCatalogue') not between 1 and 32
    or jsonb_array_length(v_synthesis->'sourceCatalogue') not between 1 and 32
    or v_knowledge->>'synthesisInputHash' is distinct from v_synthesis->>'contentHash'
    or v_knowledge->>'evidenceContentHash' is distinct from v_synthesis->>'evidenceContentHash'
    or v_knowledge->>'payloadHash' is distinct from p_candidate->>'baseDraftHash'
    or v_knowledge->>'questionSetHash' is distinct from v_context->>'questionSetHash'
    or v_knowledge->>'packHash' is distinct from v_pack->>'contentHash'
    or v_knowledge->>'sourceCatalogueHash' is distinct from public.marketing_geo_json_hash(v_pack->'sourceCatalogue')
    or v_knowledge->>'promptVersion' is distinct from 'geo-kb-knowledge-pack.v1'
    or (select count(*) from jsonb_object_keys(v_knowledge))<>9 then return false; end if;
  if exists (select 1 from jsonb_array_elements(v_pack->'sourceCatalogue') source(value)
    where jsonb_typeof(source.value) is distinct from 'object' or source.value->>'availability' is null
      or source.value->>'availability' not in ('available','partial','unavailable')) then return false; end if;
  select coalesce(jsonb_agg(source.value order by source.ordinality),'[]'::jsonb) into v_sources
    from jsonb_array_elements(v_pack->'sourceCatalogue') with ordinality source(value,ordinality)
    where source.value->>'availability' in ('available','partial');
  if v_synthesis->'sourceCatalogue' is distinct from v_sources then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',competitor.value->>'domain','name',competitor.value->>'brandName','confirmed',true)
    order by competitor.ordinality),'[]'::jsonb) into v_confirmed
    from jsonb_array_elements(p_candidate#>'{payload,competitors}') with ordinality competitor(value,ordinality)
    where (competitor.value->>'confirmed')::boolean;
  if v_synthesis->'confirmedCompetitors' is distinct from v_confirmed then return false; end if;
  v_manifest:=jsonb_build_object('schemaVersion','marketing-geo-knowledge-generation-input.v1','kbId',p_kb_id::text,
    'baseDraftVersion',p_candidate->>'baseDraftVersion','baseDraftHash',p_candidate->>'baseDraftHash',
    'profileCopyHash',p_candidate->>'profileCopyHash','sourceReceiptRefs',p_candidate->'sourceReceiptRefs','knowledgeSynthesisInput',v_synthesis);
  if v_knowledge->>'inputHash' is distinct from public.marketing_geo_json_hash(jsonb_build_object('kind','knowledge_pack','input',v_manifest)) then return false; end if;
  select g.* into v_generation from public.marketing_geo_kb_generations g
    where g.id=(v_knowledge->>'generationId')::uuid and g.user_id=p_user_id and g.kb_id=p_kb_id and g.kind='knowledge_pack' and g.state='succeeded'
      and g.error_reason is null and g.attempt->>'attemptedCalls'='1' and g.attempt->>'delivery'='response_received';
  if not found or v_generation.input is distinct from v_manifest or v_generation.input_hash is distinct from v_knowledge->>'inputHash'
    or not public.marketing_geo_knowledge_result_valid(p_kb_id,v_generation.id,v_generation.input_hash,v_generation.input,v_generation.result)
    or v_generation.result->'synthesisInput' is distinct from v_synthesis
    or v_pack->'sourceCatalogue' is distinct from v_generation.result#>'{evidence,sourceCatalogue}'
    or v_pack#>>'{meta,generatedAt}' is distinct from v_generation.result->>'generatedAt'
    or v_pack#>>'{meta,lastScanAt}' is distinct from v_generation.result#>>'{evidence,collectedAt}'
    or v_question_generation.input->'knowledgeGeneration' is distinct from jsonb_build_object(
      'generationId',v_generation.id::text,'inputHash',v_generation.input_hash,'resultHash',v_generation.result->>'contentHash')
    then return false; end if;
  return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return false;
end $$;

create or replace function public.marketing_geo_claim_generation(
  p_user_id uuid,p_kb_id uuid,p_kind text,p_idempotency_key text,p_input_hash text,p_input jsonb
) returns table(outcome text,generation jsonb,claim_token uuid)
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_row public.marketing_geo_kb_generations; v_key public.marketing_geo_kb_generation_keys;
begin
  perform 1 from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  if p_kind not in ('roles','questions','knowledge_pack') or p_idempotency_key is null or p_idempotency_key !~ '^[a-zA-Z0-9_-]{8,128}$'
    or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>196608
    or public.marketing_geo_json_hash(jsonb_build_object('kind',p_kind,'input',p_input)) is distinct from p_input_hash
    or (p_kind='knowledge_pack' and not public.marketing_geo_knowledge_input_valid(p_kb_id,p_input_hash,p_input)) then
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

alter table public.marketing_geo_kb_generations enable row level security;
alter table public.marketing_geo_kb_generation_keys enable row level security;
alter table public.marketing_geo_kb_prepared_candidates enable row level security;
revoke all on public.marketing_geo_kb_generations,public.marketing_geo_kb_generation_keys,public.marketing_geo_kb_prepared_candidates
  from public,anon,authenticated,service_role;
grant select on public.marketing_geo_kb_generations,public.marketing_geo_kb_prepared_candidates to service_role;

revoke all on function public.marketing_geo_knowledge_input_valid(uuid,text,jsonb),
  public.marketing_geo_knowledge_result_valid(uuid,uuid,text,jsonb,jsonb),
  public.marketing_geo_candidate_valid(uuid,uuid,jsonb),
  public.marketing_geo_claim_generation(uuid,uuid,text,text,text,jsonb),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),
  public.marketing_geo_freeze_prepared_kb(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.marketing_geo_claim_generation(uuid,uuid,text,text,text,jsonb),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),
  public.marketing_geo_freeze_prepared_kb(uuid,uuid,uuid,text)
  to service_role;

notify pgrst,'reload schema';
