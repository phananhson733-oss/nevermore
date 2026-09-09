-- Forward-only GEO knowledge base V3 (design 2026-09-07, slice S1a).
--
-- V3 turns the knowledge base into a reviewable, publishable asset: the draft
-- payload drops `profileCopy` for a `generationInput` that only *references*
-- the confirmed Profile, carries `knowledge` / `review` / `runRef`, and the
-- question set becomes an optional derived product rather than the thing that
-- gates a freeze.
--
-- Nothing here rewrites a byte of an existing draft, snapshot, context,
-- candidate or generation. Every V1/V2 path keeps its exact predicate; the V3
-- predicates are added beside them. Re-running this file is a no-op: every
-- constraint is dropped-if-exists before it is added, every function is
-- CREATE OR REPLACE with its signature unchanged, and no column is retyped.

-- ---------------------------------------------------------------------------
-- 1. Schema version allow-lists (blocker 1 and 2)
-- ---------------------------------------------------------------------------
-- Every ALTER below takes ACCESS EXCLUSIVE on a table that already exists in
-- production. The scans are cheap at this product's scale; what is not cheap is
-- queueing behind an open reader, because every query arriving after the waiter
-- queues too. Three seconds, then a clean abort ON_ERROR_STOP halts on.
set lock_timeout = '3s';

alter table public.marketing_geo_kb_drafts
  drop constraint if exists marketing_geo_kb_drafts_schema_version_check;
alter table public.marketing_geo_kb_drafts
  add constraint marketing_geo_kb_drafts_schema_version_check
  check (schema_version in ('marketing-geo-kb.v1','marketing-geo-kb.v2','marketing-geo-kb.v3'));

alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_kb_snapshots_schema_version_check;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_kb_snapshots_schema_version_check
  check (schema_version in ('marketing-geo-kb.v1','marketing-geo-kb.v2','marketing-geo-kb.v3'));

-- ---------------------------------------------------------------------------
-- 2. Draft shape (blocker 3)
--
-- `marketing_geo_draft_v2_shape` is left exactly as it was: its antecedent is
-- `schema_version <> 'marketing-geo-kb.v2'`, so it is vacuously true for V3 and
-- therefore proves nothing about a V3 draft. The V3 shape gets its own named
-- constraint so the V2 rule is never weakened by editing it.
--
-- `not (payload ? 'profileCopy')` is the load-bearing half: the whole point of
-- V3 is that the draft no longer carries a 28-field Profile copy, and a payload
-- that carries both shapes would make every "which identity is authoritative"
-- question ambiguous downstream.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_drafts
  drop constraint if exists marketing_geo_draft_v3_shape;
alter table public.marketing_geo_kb_drafts
  add constraint marketing_geo_draft_v3_shape check (
    schema_version <> 'marketing-geo-kb.v3' or (
      (payload->>'schemaVersion') is not distinct from schema_version
      and jsonb_typeof(payload->'generationInput') is not distinct from 'object'
      and jsonb_typeof(payload->'review') is not distinct from 'object'
      and jsonb_typeof(payload->'runRef') is not distinct from 'object'
      and not (payload ? 'profileCopy')
    )
  );

alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_snapshot_v3_shape;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_snapshot_v3_shape check (
    schema_version <> 'marketing-geo-kb.v3' or (
      jsonb_typeof(payload->'generationInput') is not distinct from 'object'
      and jsonb_typeof(payload->'review') is not distinct from 'object'
      and jsonb_typeof(payload->'runRef') is not distinct from 'object'
      and not (payload ? 'profileCopy')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Payload size budgets (blocker 9)
--
-- Tiered by schema version so V1/V2 keep their exact 384KiB ceiling and only V3
-- gets 1MiB, with the two large sub-objects budgeted separately. `coalesce` to
-- a JSON null keeps the branch total rather than NULL when a key is absent: a
-- NULL check constraint passes, which would silently disable the sub-budget.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_drafts
  drop constraint if exists marketing_geo_kb_drafts_payload_check;
alter table public.marketing_geo_kb_drafts
  add constraint marketing_geo_kb_drafts_payload_check check (
    case when schema_version = 'marketing-geo-kb.v3'
      then octet_length(payload::text) <= 1048576
        and octet_length(coalesce(payload->'knowledge','null'::jsonb)::text) <= 524288
        and octet_length(coalesce(payload->'review','null'::jsonb)::text) <= 131072
      else octet_length(payload::text) <= 393216
    end
  );

alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_kb_snapshots_payload_check;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_kb_snapshots_payload_check check (
    case when schema_version = 'marketing-geo-kb.v3'
      then octet_length(payload::text) <= 1048576
        and octet_length(coalesce(payload->'knowledge','null'::jsonb)::text) <= 524288
        and octet_length(coalesce(payload->'review','null'::jsonb)::text) <= 131072
      else octet_length(payload::text) <= 393216
    end
  );

-- ---------------------------------------------------------------------------
-- 4. Snapshot / prepared pairing (blocker 4)
--
-- The original predicate is a biconditional pinned to V2 alone, so a V3
-- snapshot carrying a prepared_id evaluates `false = true` and is rejected at
-- the table with 23514 rather than a structured outcome. Widen the left side to
-- "V2 or V3"; V1 still must not carry a prepared_id.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_snapshot_v2_requires_prepared;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_snapshot_v2_requires_prepared check (
    ((schema_version in ('marketing-geo-kb.v2','marketing-geo-kb.v3')) = (prepared_id is not null))
    and (payload->>'schemaVersion') is not distinct from schema_version
  );

-- ---------------------------------------------------------------------------
-- 5. Optional question set (blocker 8)
--
-- A V3 version can be published without a question set (roles missing, or a
-- non-English site). Both columns become nullable together, and a new
-- constraint keeps them paired and keeps every V1/V2 snapshot mandatory. This
-- is forward-only: every existing row has both values and a V1/V2 version, so
-- no historical row is touched or revalidated into failure.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_snapshots alter column question_set drop not null;
alter table public.marketing_geo_kb_snapshots alter column question_set_hash drop not null;

alter table public.marketing_geo_kb_snapshots
  drop constraint if exists marketing_geo_snapshot_question_set_pairing;
alter table public.marketing_geo_kb_snapshots
  add constraint marketing_geo_snapshot_question_set_pairing check (
    ((question_set is null) = (question_set_hash is null))
    and (schema_version = 'marketing-geo-kb.v3' or question_set is not null)
  );

-- ---------------------------------------------------------------------------
-- 6. Candidate identity and payload caps (blockers 5 and the candidate rework)
--
-- V1/V2 candidates are minted by the questions finish branch, so their id *is*
-- the questions generation id and `generation_id` is unique. A V3 candidate is
-- minted by the publish action instead: the same run can be published more than
-- once after Owner corrections, and the three generation ids live in the
-- candidate's own runRef. So `generation_id` becomes nullable and loses its
-- UNIQUE. The composite FK to the generations table is left in place: it is
-- MATCH SIMPLE, so a NULL generation_id simply skips the check, and every V1/V2
-- candidate keeps being verified against its generation exactly as before.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_prepared_candidates alter column generation_id drop not null;
alter table public.marketing_geo_kb_prepared_candidates
  drop constraint if exists marketing_geo_kb_prepared_candidates_generation_id_key;

alter table public.marketing_geo_kb_prepared_candidates
  drop constraint if exists marketing_geo_kb_prepared_candidates_candidate_check;
alter table public.marketing_geo_kb_prepared_candidates
  add constraint marketing_geo_kb_prepared_candidates_candidate_check
  check (jsonb_typeof(candidate)='object' and
    (((candidate->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v1' and octet_length(candidate::text)<=1572864)
     or ((candidate->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v2' and octet_length(candidate::text)<=2359296)
     or ((candidate->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v3' and octet_length(candidate::text)<=2359296)));

-- ---------------------------------------------------------------------------
-- 7. Snapshot context caps (blocker 6)
--
-- Context V3 is deliberately thin (hashes, profileRef, evidence refs, roles
-- lineage, source summary, skipped layers -- no facts), so it gets the V1
-- budget rather than the V2 one.
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_snapshot_contexts
  drop constraint if exists marketing_geo_snapshot_contexts_context_check;
alter table public.marketing_geo_snapshot_contexts
  add constraint marketing_geo_snapshot_contexts_context_check check (
    jsonb_typeof(context)='object' and
    ((context->>'schemaVersion'='marketing-geo-snapshot-context.v1' and octet_length(context::text)<=262144)
     or (context->>'schemaVersion'='marketing-geo-snapshot-context.v2' and octet_length(context::text)<=524288)
     or (context->>'schemaVersion'='marketing-geo-snapshot-context.v3' and octet_length(context::text)<=262144))
  );

-- ---------------------------------------------------------------------------
-- 8. Generation result caps (blocker 7)
--
-- Two new shapes: a questions result that carries only the question set (V3
-- never mints a candidate from a model step), and knowledge generation result
-- V2 (narrative V2 -- triple-shaped facts plus canonicalQuestion).
-- ---------------------------------------------------------------------------
alter table public.marketing_geo_kb_generations
  drop constraint if exists marketing_geo_kb_generations_result_check;
alter table public.marketing_geo_kb_generations
  add constraint marketing_geo_kb_generations_result_check
  check (result is null or (jsonb_typeof(result)='object' and
    ((kind='roles' and (result->>'schemaVersion') is not distinct from 'marketing-geo-role-proposal.v1' and octet_length(result::text)<=393216)
     or (kind='questions' and (result->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v1' and octet_length(result::text)<=1572864)
     or (kind='questions' and (result->>'schemaVersion') is not distinct from 'marketing-geo-prepared-candidate.v2' and octet_length(result::text)<=2359296)
     or (kind='questions' and (result->>'schemaVersion') is not distinct from 'marketing-geo-question-generation-result.v1' and octet_length(result::text)<=393216)
     or (kind='knowledge_pack' and (result->>'schemaVersion') is not distinct from 'marketing-geo-knowledge-generation-result.v1' and octet_length(result::text)<=2097152)
     or (kind='knowledge_pack' and (result->>'schemaVersion') is not distinct from 'marketing-geo-knowledge-generation-result.v2' and octet_length(result::text)<=2097152))));

-- ---------------------------------------------------------------------------
-- 9. marketing_geo_generation_input_current -- V3 branch
--
-- The legacy body unconditionally requires the draft to carry a valid
-- `profileCopy`: it compares `profileCopyHash` against the hash of
-- `payload->'profileCopy'` and then calls `validate_profile_copy`. For a V3
-- draft the hash comparison happens to pass (both sides hash a JSON null), but
-- `validate_profile_copy` rejects a null copy on its own, so *every* V3
-- generation would be `input_stale` forever.
--
-- The V3 branch replaces that pair with the two things V3 actually binds:
--   * the run's `generationInputHash` equals the draft's runRef hash, which is
--     what makes "generationInput is read-only during review" enforceable, and
--   * the draft's `generationInput.profileRef` still points at the website's
--     current confirmed Profile snapshot (id, revision and content hash).
-- The V1/V2 path below is byte-for-byte the previous predicate.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_generation_input_current(p_user_id uuid,p_kb_id uuid,p_input jsonb)
returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  v_kb public.marketing_geo_knowledge_bases; v_draft public.marketing_geo_kb_drafts;
  v_website public.marketing_websites; v_profile public.marketing_website_profile_snapshots; v_ref jsonb;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k where k.id=p_kb_id and k.user_id=p_user_id;
  if not found then return false; end if;
  select d.* into v_draft from public.marketing_geo_kb_drafts d where d.kb_id=p_kb_id and d.user_id=p_user_id for share;
  if not found or p_input->>'kbId' is distinct from p_kb_id::text
    or p_input->>'baseDraftVersion' is distinct from v_draft.draft_version::text
    or p_input->>'baseDraftHash' is distinct from v_draft.content_hash then return false; end if;
  if v_draft.schema_version = 'marketing-geo-kb.v3' then
    if jsonb_typeof(p_input->'generationInputHash') is distinct from 'string'
      or p_input->>'generationInputHash' is distinct from v_draft.payload#>>'{runRef,generationInputHash}' then return false; end if;
    v_ref := v_draft.payload#>'{generationInput,profileRef}';
    if jsonb_typeof(v_ref) is distinct from 'object' then return false; end if;
    -- The same SHARE lock Profile confirmation takes, so the current pointer is
    -- pinned through commit rather than re-read after the decision.
    select w.* into v_website from public.marketing_websites w
      where w.user_id=p_user_id and w.canonical_site_key=v_kb.canonical_site_key for share;
    if not found
      or v_website.id::text is distinct from v_ref->>'websiteId'
      or v_website.current_confirmed_snapshot_id is null
      or v_website.current_confirmed_snapshot_id::text is distinct from v_ref->>'snapshotId' then return false; end if;
    select s.* into v_profile from public.marketing_website_profile_snapshots s
      where s.id=v_website.current_confirmed_snapshot_id and s.website_id=v_website.id and s.user_id=p_user_id;
    -- Text comparison on revision, so a malformed reference is a refusal rather
    -- than a cast of caller-controlled text.
    if not found
      or v_profile.revision::text is distinct from v_ref->>'snapshotRevision'
      or v_profile.content_hash is distinct from v_ref->>'profileHash' then return false; end if;
    return true;
  end if;
  if p_input->>'profileCopyHash' is distinct from public.marketing_geo_json_hash(v_draft.payload->'profileCopy')
    or public.marketing_geo_validate_profile_copy(p_user_id,v_kb.canonical_site_key,v_draft.payload->'profileCopy') is not null then return false; end if;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 10. marketing_geo_save_kb_draft -- V2 to V3 upgrade, and the review lock
--
-- Two changes, both in the guard block; everything else is the previous body.
--   (a) The "a complete draft cannot lose its profileCopy" rule stays, except
--       when the incoming draft is V3. That rule exists to stop a legacy
--       compatibility caller silently dropping the self-contained Profile; a
--       declared V3 save is the intended, one-way upgrade instead.
--   (b) New V3-only guard: once any paid generation exists for this draft,
--       `generationInput` is read-only. A save that changes
--       runRef.generationInputHash is refused with `generation_input_locked`
--       rather than being merged, so a review decision can never be attributed
--       to inputs it was not made against.
--
--       Keyed on all four runRef ids, not on runRef.runId alone. `runId` is
--       null for the whole three-call flow -- the shipped contract documents it
--       as "null until the single-run route exists" -- so a runId-only test is
--       false on every draft the product actually produces, and the lock this
--       clause exists to install would never have fired once.
-- ---------------------------------------------------------------------------
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
  -- lose its self-contained Profile via the compatibility save path. A declared
  -- V3 save is the exception: dropping profileCopy for a profileRef is exactly
  -- what the upgrade is.
  if found and v_draft.payload ? 'profileCopy' and not (p_payload ? 'profileCopy')
    and p_schema_version is distinct from 'marketing-geo-kb.v3' then
    outcome := 'profile_copy_mismatch'; return next; return;
  end if;

  -- generationInput is read-only for the life of a run. Review decisions and
  -- knowledge edits save freely; a changed generationInputHash does not.
  --
  -- ...unless the same save also abandons the run it belonged to. Without that
  -- release the lock has no exit: the *second* update necessarily locks a new
  -- input (a fresh evidenceContentHash), and it would be refused forever by
  -- generation ids left over from the first. So the rule is not "the hash may
  -- never change" but "the hash and the generations it produced move together":
  -- a save may re-lock a new input only by clearing all four runRef ids in the
  -- same write.
  --
  -- That keeps what the lock is for. A generation record is claimable only when
  -- its input hash equals the draft's (marketing_geo_generation_input_current,
  -- v3 branch), so clearing the ids forfeits reuse of everything the old input
  -- paid for -- the release costs exactly what it should, and no decision can
  -- end up attributed to inputs it was not made against, because the records
  -- made under the old hash stop matching the moment the new one lands.
  if found and v_draft.schema_version = 'marketing-geo-kb.v3'
    and (coalesce(v_draft.payload#>>'{runRef,runId}', '') <> ''
      or coalesce(v_draft.payload#>>'{runRef,rolesGenerationId}', '') <> ''
      or coalesce(v_draft.payload#>>'{runRef,knowledgeGenerationId}', '') <> ''
      or coalesce(v_draft.payload#>>'{runRef,questionsGenerationId}', '') <> '')
    and not (coalesce(p_payload#>>'{runRef,runId}', '') = ''
      and coalesce(p_payload#>>'{runRef,rolesGenerationId}', '') = ''
      and coalesce(p_payload#>>'{runRef,knowledgeGenerationId}', '') = ''
      and coalesce(p_payload#>>'{runRef,questionsGenerationId}', '') = '')
    and p_payload#>>'{runRef,generationInputHash}' is distinct from v_draft.payload#>>'{runRef,generationInputHash}' then
    outcome := 'generation_input_locked';
    draft_version := v_draft.draft_version;
    content_hash := v_draft.content_hash;
    updated_at := v_draft.updated_at;
    return next;
    return;
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

-- ---------------------------------------------------------------------------
-- 11. marketing_geo_knowledge_input_valid -- input V2 branch
--
-- V2 swaps `profileCopyHash` for `generationInputHash`; the key count stays at
-- exactly 7 and both branches pin their full key set by type, so neither can be
-- satisfied by the other's shape.
--
-- The receipt-id pattern is the second change. V1 pins the RFC 4122 version
-- nibble to [1-5]. Marketing website/Profile/receipt identifiers in this
-- codebase are UUIDv8 (version nibble 8), so the V1 pattern would reject every
-- real V3 receipt reference while passing a hand-written v4 test fixture. The
-- V2 branch pins the hex shape and the dashes and nothing else.
--
-- The synthesis-input key count is pinned for V1 only. Synthesis input V2 grows
-- fields (per-item origin and decision), so counting keys here would freeze the
-- TypeScript contract at whatever it happened to be on the day this shipped;
-- the required keys are pinned by name instead.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_knowledge_input_valid(p_kb_id uuid,p_input_hash text,p_input jsonb)
returns boolean language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare
  v_synthesis jsonb; v_ref jsonb; v_previous_receipt_id text;
  v_version text; v_receipt_pattern text; v_synthesis_version text;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then return false; end if;
  v_version := p_input->>'schemaVersion';
  if v_version is null or v_version not in (
    'marketing-geo-knowledge-generation-input.v1','marketing-geo-knowledge-generation-input.v2') then return false; end if;
  v_receipt_pattern := case when v_version='marketing-geo-knowledge-generation-input.v1'
    then '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    else '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' end;
  v_synthesis_version := case when v_version='marketing-geo-knowledge-generation-input.v1'
    then 'marketing-geo-knowledge-synthesis-input.v1' else 'marketing-geo-knowledge-synthesis-input.v2' end;
  if (select count(*) from jsonb_object_keys(p_input))<>7
    or p_input->>'kbId' is distinct from p_kb_id::text
    or jsonb_typeof(p_input->'baseDraftVersion') is distinct from 'string'
    or p_input->>'baseDraftVersion' !~ '^[1-9][0-9]{0,15}$'
    or (p_input->>'baseDraftVersion')::numeric>9007199254740991
    or jsonb_typeof(p_input->'baseDraftHash') is distinct from 'string'
    or p_input->>'baseDraftHash' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_input->'sourceReceiptRefs') is distinct from 'array'
    or jsonb_array_length(p_input->'sourceReceiptRefs')>32
    or jsonb_typeof(p_input->'knowledgeSynthesisInput') is distinct from 'object'
    or public.marketing_geo_json_hash(jsonb_build_object('kind','knowledge_pack','input',p_input)) is distinct from p_input_hash
  then return false; end if;
  if v_version='marketing-geo-knowledge-generation-input.v1' then
    if jsonb_typeof(p_input->'profileCopyHash') is distinct from 'string'
      or p_input->>'profileCopyHash' !~ '^[a-f0-9]{64}$' then return false; end if;
  else
    if jsonb_typeof(p_input->'generationInputHash') is distinct from 'string'
      or p_input->>'generationInputHash' !~ '^[a-f0-9]{64}$'
      or p_input ? 'profileCopyHash' then return false; end if;
  end if;
  v_synthesis:=p_input->'knowledgeSynthesisInput';
  if jsonb_typeof(v_synthesis) is distinct from 'object' then return false; end if;
  for v_ref in select value from jsonb_array_elements(p_input->'sourceReceiptRefs') loop
    if jsonb_typeof(v_ref) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_ref))<>2
      or jsonb_typeof(v_ref->'receiptId') is distinct from 'string'
      or v_ref->>'receiptId' !~ v_receipt_pattern
      or jsonb_typeof(v_ref->'contentHash') is distinct from 'string'
      or v_ref->>'contentHash' !~ '^[a-f0-9]{64}$'
      or (v_previous_receipt_id is not null and v_previous_receipt_id>=v_ref->>'receiptId')
    then return false; end if;
    v_previous_receipt_id:=v_ref->>'receiptId';
  end loop;
  if octet_length(v_synthesis::text)>163840
    or v_synthesis->>'schemaVersion' is distinct from v_synthesis_version
    or v_synthesis->>'contentHash' is distinct from public.marketing_geo_json_hash(v_synthesis-'contentHash')
    or jsonb_typeof(v_synthesis->'sourceCatalogue') is distinct from 'array'
    or jsonb_array_length(v_synthesis->'sourceCatalogue') not between 1 and 32
    or v_synthesis->>'sourceCatalogueHash' is distinct from public.marketing_geo_json_hash(v_synthesis->'sourceCatalogue')
  then return false; end if;
  if v_version='marketing-geo-knowledge-generation-input.v1' then
    if (select count(*) from jsonb_object_keys(v_synthesis))<>12 then return false; end if;
  else
    if not (v_synthesis ?& array['schemaVersion','contentHash','sourceCatalogue','sourceCatalogueHash','evidenceContentHash']) then return false; end if;
  end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;

-- ---------------------------------------------------------------------------
-- 12. marketing_geo_knowledge_result_valid -- result V2 branch
--
-- Result V2 pairs with input V2, synthesis input V2 and narrative V2, and both
-- key counts are pinned for both versions. The V2 branch previously pinned only
-- the narrative's key *names*, on the premise that narrative V2's triple-shaped
-- facts and canonicalQuestion changed its key count. They do not: those are
-- shapes nested inside `facts[]` and `qa[]`, and narrative V2's top level is the
-- same six keys as V1 (schemaVersion, entity, facts, qa, comparisons, scope).
-- A name-only check admits extra top-level keys, which is exactly what an
-- immutable stored result must not accept. Synthesis input V2 does have a
-- different count from V1 -- it replaced `profileCopy` with `profileRef` and
-- added `generationInputHash` -- so it gets its own number rather than V1's.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_knowledge_result_valid(
  p_kb_id uuid,p_generation_id uuid,p_input_hash text,p_input jsonb,p_result jsonb
) returns boolean language plpgsql immutable set search_path='' set timezone='UTC' as $$
declare v_sources jsonb; v_version text; v_synthesis_version text; v_narrative_version text;
begin
  if not public.marketing_geo_knowledge_input_valid(p_kb_id,p_input_hash,p_input)
    or jsonb_typeof(p_result) is distinct from 'object' then return false; end if;
  if jsonb_typeof(p_result->'evidence') is distinct from 'object'
    or jsonb_typeof(p_result->'synthesisInput') is distinct from 'object'
    or jsonb_typeof(p_result->'narrative') is distinct from 'object' then return false; end if;
  v_version := p_result->>'schemaVersion';
  if v_version is null or v_version not in (
    'marketing-geo-knowledge-generation-result.v1','marketing-geo-knowledge-generation-result.v2') then return false; end if;
  -- The result version and the manifest version move together. A V2 result
  -- built on a V1 manifest would let a profileCopy-bound run masquerade as a
  -- generationInput-bound one.
  if (v_version='marketing-geo-knowledge-generation-result.v2')
    is distinct from (p_input->>'schemaVersion'='marketing-geo-knowledge-generation-input.v2') then return false; end if;
  v_synthesis_version := case when v_version='marketing-geo-knowledge-generation-result.v1'
    then 'marketing-geo-knowledge-synthesis-input.v1' else 'marketing-geo-knowledge-synthesis-input.v2' end;
  v_narrative_version := case when v_version='marketing-geo-knowledge-generation-result.v1'
    then 'marketing-geo-knowledge-narrative.v1' else 'marketing-geo-knowledge-narrative.v2' end;
  if octet_length(p_result::text)>2097152
    or (select count(*) from jsonb_object_keys(p_result))<>9
    or p_result->>'generationId' is distinct from p_generation_id::text
    or p_result->>'kbId' is distinct from p_kb_id::text
    or p_result->>'contentHash' is distinct from public.marketing_geo_json_hash(p_result-'contentHash')
    or p_result->'manifest' is distinct from p_input
    or p_result->'synthesisInput' is distinct from p_input->'knowledgeSynthesisInput'
    or p_result#>>'{synthesisInput,schemaVersion}' is distinct from v_synthesis_version
    or p_result#>>'{evidence,schemaVersion}' is distinct from 'marketing-geo-knowledge-evidence.v1'
    or p_result#>>'{narrative,schemaVersion}' is distinct from v_narrative_version
    or octet_length((p_result->'evidence')::text)>1048576
    or octet_length((p_result->'synthesisInput')::text)>163840
    or octet_length((p_result->'narrative')::text)>131072
    or (select count(*) from jsonb_object_keys(p_result->'evidence'))<>10
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
  if v_version='marketing-geo-knowledge-generation-result.v1' then
    if (select count(*) from jsonb_object_keys(p_result->'synthesisInput'))<>12
      or (select count(*) from jsonb_object_keys(p_result->'narrative'))<>6 then return false; end if;
  else
    if (select count(*) from jsonb_object_keys(p_result->'synthesisInput'))<>14
      or (select count(*) from jsonb_object_keys(p_result->'narrative'))<>6
      or not (p_result->'narrative' ?& array['schemaVersion','entity','facts','qa','comparisons','scope']) then return false; end if;
  end if;
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

-- ---------------------------------------------------------------------------
-- 13. marketing_geo_finish_generation -- three fixes
--
--   (a) The roles branch compared `p_result->>'profileCopyHash'` to
--       `v_row.input->>'profileCopyHash'` with `=`. For a V3 run both sides are
--       NULL, `NULL = NULL` is NULL, the whole conjunction collapses to NULL,
--       and `v_valid is distinct from true` fires: roles could never succeed.
--       `is not distinct from` compares them as values. It is not a loosening:
--       a NULL on one side and a hash on the other is still false.
--   (b) A new questions branch for V3. V3 question generation returns only the
--       question set -- the candidate is minted later by the publish action,
--       from reviewed content -- so this branch validates
--       `marketing-geo-question-generation-result.v1` and inserts no candidate.
--   (c) knowledge_pack is unchanged here; result V2 arrives through the widened
--       marketing_geo_knowledge_result_valid above.
-- ---------------------------------------------------------------------------
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
      -- Preserve the exact legacy role-proposal branch, with the NULL-safe
      -- profileCopyHash comparison described above.
      v_valid:=p_result->>'kbId'=p_kb_id::text
        and p_result->>'baseDraftVersion'=v_row.input->>'baseDraftVersion'
        and p_result->>'baseDraftHash'=v_row.input->>'baseDraftHash'
        and p_result->>'profileCopyHash' is not distinct from v_row.input->>'profileCopyHash'
        and p_result->'sourceReceiptRefs'=coalesce(v_row.input->'sourceReceiptRefs','[]'::jsonb)
        and p_result->>'schemaVersion'='marketing-geo-role-proposal.v1'
        and p_result->>'generationId'=p_generation_id::text
        and p_result->>'contentHash'=public.marketing_geo_json_hash(p_result-'contentHash');
      if v_valid is distinct from true then outcome:='invalid_result'; return next; return; end if;
    elsif v_row.kind='questions' and v_row.input->>'schemaVersion'='marketing-geo-question-generation-input.v3' then
      -- V3: a question set on its own. No prepared candidate is minted here;
      -- publishing does that, from the reviewed draft, later and separately.
      v_valid:=p_result->>'kbId'=p_kb_id::text
        and p_result->>'schemaVersion'='marketing-geo-question-generation-result.v1'
        and p_result->>'generationId'=p_generation_id::text
        and p_result->>'baseDraftVersion'=v_row.input->>'baseDraftVersion'
        and p_result->>'baseDraftHash'=v_row.input->>'baseDraftHash'
        and p_result->>'generationInputHash'=v_row.input->>'generationInputHash'
        and jsonb_typeof(v_row.input->'generationInputHash')='string'
        and not (v_row.input ? 'profileCopyHash')
        and p_result->'sourceReceiptRefs'=coalesce(v_row.input->'sourceReceiptRefs','[]'::jsonb)
        and p_result->>'contentHash'=public.marketing_geo_json_hash(p_result-'contentHash')
        and jsonb_typeof(p_result->'questionSet')='object'
        and p_result#>>'{questionSet,schemaVersion}'='marketing-geo-question-set.v2';
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

-- ---------------------------------------------------------------------------
-- 14. marketing_geo_freeze_kb / _with_context -- close the V3 legacy paths
--
-- `marketing_geo_freeze_kb`'s `payload ? 'profileCopy'` gate is *open* for a V3
-- draft, which has no profileCopy. Without this the call runs all the way to
-- its INSERT and dies on the snapshot schema-version or prepared-id CHECK with
-- a 23514 the caller cannot read. `marketing_geo_freeze_kb_with_context` has
-- the identical hole one layer up: it pins context V1 but reads the draft's own
-- schema version, so a V3 draft reaches the same INSERT.
--
-- Both now return `context_required`, the outcome that already means "this
-- draft needs the richer freeze path" -- for V3 that path is
-- marketing_geo_publish_kb_v3.
-- ---------------------------------------------------------------------------
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

  if v_draft.payload ? 'profileCopy'
    or v_draft.schema_version = 'marketing-geo-kb.v3'
    or p_schema_version = 'marketing-geo-kb.v3' then
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
  -- V3 drafts publish through marketing_geo_publish_kb_v3. Reaching the INSERT
  -- below would trip a table CHECK instead of returning an outcome.
  if v_draft.schema_version = 'marketing-geo-kb.v3' or p_schema_version = 'marketing-geo-kb.v3' then
    outcome:='context_required'; return next; return;
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

-- ---------------------------------------------------------------------------
-- 15. marketing_geo_publish_kb_v3 -- the V3 publish action
--
-- Deliberately NOT marketing_geo_freeze_prepared_kb. Two of that function's
-- rules are false for V3:
--   * it writes the candidate's questionSet straight into the snapshot's
--     question_set column, and V3 versions can legitimately have no question
--     set at all; and
--   * it calls marketing_geo_generation_input_current on the *candidate*, whose
--     shape is a candidate, not a generation input.
--
-- What binds a V3 publish instead:
--   * the candidate hashes itself (candidateHash over the candidate minus that
--     key, matching what the caller passed), and its payload hashes to
--     baseDraftHash, and its context hashes to contentHash;
--   * the context's payloadHash, kbId, candidateId and targetHost agree with
--     the candidate and this knowledge base; and
--   * the candidate's generationInputHash equals the current draft's
--     runRef.generationInputHash -- the same value every reused generation
--     record was pinned to, so a stale review cannot be published.
--
-- Idempotency is content identity, matching the unique index
-- marketing_geo_kb_snapshot_context_identity_idx (kb_id, content_hash,
-- coalesce(context_hash,'')). Republishing identical bytes returns the existing
-- version with reused_existing=true and mints no candidate row. Like
-- marketing_geo_freeze_prepared_kb, that replay is a read: it does not rewind
-- current_frozen_snapshot_id onto an older version.
-- ---------------------------------------------------------------------------
create or replace function public.marketing_geo_publish_kb_v3(
  p_user_id uuid, p_kb_id uuid, p_candidate jsonb, p_candidate_hash text
)
returns table(outcome text,snapshot_id uuid,revision integer,content_hash text,frozen_at timestamptz,reused_existing boolean)
language plpgsql security definer set search_path = '' set timezone = 'UTC'
as $$
declare
  v_kb public.marketing_geo_knowledge_bases;
  v_draft public.marketing_geo_kb_drafts;
  v_snapshot public.marketing_geo_kb_snapshots;
  v_existing public.marketing_geo_kb_prepared_candidates;
  v_context jsonb; v_question_set jsonb;
  v_candidate_id uuid; v_context_hash text; v_payload_hash text;
  v_question_available boolean; v_question_unavailable boolean;
  v_expected_question_hash text;
begin
  select k.* into v_kb from public.marketing_geo_knowledge_bases k
    where k.id=p_kb_id and k.user_id=p_user_id for update;
  if not found then outcome:='not_found'; return next; return; end if;
  select d.* into v_draft from public.marketing_geo_kb_drafts d
    where d.kb_id=p_kb_id and d.user_id=p_user_id for update;
  if not found then outcome:='no_draft'; return next; return; end if;

  v_context:=p_candidate->'context';
  v_question_set:=p_candidate->'questionSet';
  v_payload_hash:=public.marketing_geo_json_hash(p_candidate->'payload');
  v_context_hash:=public.marketing_geo_json_hash(v_context-'contentHash');

  -- The candidate carries the question set in a discriminated slot, not bare:
  -- `{status:"available", value:<question set V2>}` or
  -- `{status:"unavailable", reason:<enum>, failedGenerationId:<uuid|null>}`.
  -- That is the shape `kb-prepared-v3-contract.ts` produces, and it is the
  -- shape this function must read; an earlier revision of this guard read the
  -- slot as if it were the question set itself, which made the available branch
  -- unreachable and rejected every real candidate as `candidate_mismatch`.
  -- Either way "absent" must never be indistinguishable from "we did not look".
  --
  -- Every comparison here is NULL-safe on purpose. A plain `=` against a
  -- missing key yields NULL, both flags become NULL, `NULL = NULL` is NULL, and
  -- the OR-chain below evaluates to NULL -- which a plpgsql IF treats as false,
  -- so an unrecognised question set would have been *published* rather than
  -- refused. That is the same NULL-collapse this migration fixes in the roles
  -- finish branch.
  --
  -- The key sets are pinned, not merely probed. This slot is the one place
  -- where a field the RPC does not read changes what the immutable record
  -- *says*: an `unavailable` slot that also carries a `value` publishes with
  -- `question_set` NULL, so the wire carried a question set and the frozen
  -- version states it has none. `questionSetSlotSchema` is `.strict()`, so a
  -- caller going through the contract cannot build that -- but "the only
  -- writer is well-behaved" is not a property the stored record can rely on,
  -- and this is cheap.
  v_question_available:=coalesce(jsonb_typeof(v_question_set),'')='object'
    and v_question_set->>'status' is not distinct from 'available'
    and (select count(*) from jsonb_object_keys(v_question_set))=2
    and v_question_set ?& array['status','value']
    and coalesce(jsonb_typeof(v_question_set->'value'),'')='object'
    and v_question_set#>>'{value,schemaVersion}' is not distinct from 'marketing-geo-question-set.v2';
  v_question_unavailable:=coalesce(jsonb_typeof(v_question_set),'')='object'
    and v_question_set->>'status' is not distinct from 'unavailable'
    and (select count(*) from jsonb_object_keys(v_question_set))=3
    and v_question_set ?& array['status','reason','failedGenerationId']
    and coalesce(jsonb_typeof(v_question_set->'reason'),'')='string';

  -- Hoisted out of the guard below on purpose, not for readability: plpgsql
  -- reads an IF condition up to the first THEN token and has no idea that a
  -- CASE has one of its own, so an inline `case when ... then ... end` inside
  -- an IF is truncated mid-expression and fails to compile.
  v_expected_question_hash := case when v_question_available
    then public.marketing_geo_json_hash(v_question_set->'value')
    else public.marketing_geo_json_hash('null'::jsonb) end;

  if jsonb_typeof(p_candidate) is distinct from 'object'
    or octet_length(p_candidate::text)>2359296
    or p_candidate->>'schemaVersion' is distinct from 'marketing-geo-prepared-candidate.v3'
    or p_candidate->>'kbId' is distinct from p_kb_id::text
    -- coalesce, not a bare `!~`: a missing candidateId would compare to NULL,
    -- fall through this whole guard, and reach the INSERT as a NULL primary key.
    or coalesce(p_candidate->>'candidateId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_candidate->>'candidateHash' is distinct from p_candidate_hash
    or p_candidate_hash is distinct from public.marketing_geo_json_hash(p_candidate-'candidateHash')
    or p_candidate#>>'{payload,schemaVersion}' is distinct from 'marketing-geo-kb.v3'
    or p_candidate->>'baseDraftHash' is distinct from v_payload_hash
    or jsonb_typeof(p_candidate->'payload') is distinct from 'object'
    or (v_question_available = v_question_unavailable)
    or jsonb_typeof(v_context) is distinct from 'object'
    or v_context->>'schemaVersion' is distinct from 'marketing-geo-snapshot-context.v3'
    or v_context->>'kbId' is distinct from p_kb_id::text
    or v_context->>'targetHost' is distinct from v_kb.canonical_site_key
    or v_context->>'payloadHash' is distinct from v_payload_hash
    or v_context->>'contentHash' is distinct from v_context_hash
    -- Hashed over the question set itself, never over the slot that carries it,
    -- and over canonical `null` when there is none. That is the domain
    -- `buildGeoSnapshotContextV3` uses, and the two must agree exactly: a
    -- context is only a real check of a candidate if both sides hash the same
    -- bytes. `marketing_geo_json_hash('null'::jsonb)` is the same value as the
    -- contract's GEO_ABSENT_QUESTION_SET_HASH.
    --
    -- The context deliberately carries neither `candidateId` nor
    -- `generationInputHash`. It is a pure function of the payload, the question
    -- set and the kb id, which is what lets publish re-derive it and compare
    -- rather than copy it; a candidate id inside it would make it a copy for
    -- that field, and the generation input hash is already covered by the
    -- payload hash, whose preimage contains generationInput. The candidate that
    -- produced a version is recorded as a real column instead
    -- (`marketing_geo_kb_snapshots.prepared_id`).
    or v_context->>'questionSetHash' is distinct from v_expected_question_hash then
    outcome:='candidate_mismatch'; return next; return;
  end if;

  -- The reviewed draft is the authority on which generation input this version
  -- may claim, and on what was reviewed at all. A candidate built against an
  -- earlier draft is stale, not wrong.
  --
  -- `baseDraftVersion` and `baseDraftHash` are compared against the *draft*
  -- here. The guard above compares baseDraftHash with the candidate's own
  -- payload, which is a self-consistency check and proves nothing about
  -- concurrency: without this clause two tabs could each publish their own
  -- reviewed payload and the later, older one would silently become the current
  -- frozen version.
  if v_draft.schema_version is distinct from 'marketing-geo-kb.v3'
    or jsonb_typeof(p_candidate->'generationInputHash') is distinct from 'string'
    or p_candidate->>'generationInputHash' is distinct from v_draft.payload#>>'{runRef,generationInputHash}'
    or p_candidate->>'baseDraftVersion' is distinct from v_draft.draft_version::text
    or p_candidate->>'baseDraftHash' is distinct from v_draft.content_hash then
    outcome:='input_stale'; return next; return;
  end if;

  -- Content identity, evaluated before anything is written.
  --
  -- Deliberately NOT keyed on context_hash. The context also covers the
  -- evidence refs, which name the observations a run happened to read; two
  -- publishes of byte-identical knowledge read from a re-crawl would hash
  -- differently and a double-clicked publish would mint a second version. The
  -- tuple that actually defines a V3 version is the payload digest plus the
  -- question-set digest -- review decisions and the generation input both live
  -- inside the payload, so the payload digest already covers them. A third
  -- component comparing generationInputHash used to sit here; because no v3
  -- context carries that field it compared NULL with NULL on every row, which
  -- `is not distinct from` makes unconditionally true.
  select s.* into v_snapshot from public.marketing_geo_kb_snapshots s
    join public.marketing_geo_snapshot_contexts c
      on c.snapshot_id=s.id and c.kb_id=s.kb_id and c.user_id=s.user_id
    where s.kb_id=p_kb_id and s.user_id=p_user_id
      and s.content_hash=v_payload_hash
      and c.context->>'schemaVersion'='marketing-geo-snapshot-context.v3'
      and c.context->>'questionSetHash' is not distinct from v_context->>'questionSetHash'
    order by s.revision limit 1;
  if found then
    outcome:='published'; snapshot_id:=v_snapshot.id; revision:=v_snapshot.revision;
    content_hash:=v_snapshot.content_hash; frozen_at:=v_snapshot.frozen_at; reused_existing:=true;
    return next; return;
  end if;

  v_candidate_id:=(p_candidate->>'candidateId')::uuid;
  select c.* into v_existing from public.marketing_geo_kb_prepared_candidates c where c.id=v_candidate_id;
  if found and (v_existing.user_id is distinct from p_user_id or v_existing.kb_id is distinct from p_kb_id
    or v_existing.candidate_hash is distinct from p_candidate_hash) then
    outcome:='candidate_mismatch'; return next; return;
  end if;
  if not found then
    -- V3 candidates carry no single owning generation: the run's three
    -- generation ids live in the candidate's runRef instead.
    insert into public.marketing_geo_kb_prepared_candidates(id,user_id,kb_id,generation_id,candidate_hash,candidate)
      values(v_candidate_id,p_user_id,p_kb_id,null,p_candidate_hash,p_candidate);
  end if;

  select coalesce(max(s.revision),0)+1 into revision from public.marketing_geo_kb_snapshots s where s.kb_id=p_kb_id;
  -- Qualified in RETURNING: `revision`, `content_hash` and `frozen_at` are also
  -- OUT parameter names, and unqualified Postgres calls the reference ambiguous.
  insert into public.marketing_geo_kb_snapshots(
    kb_id,user_id,revision,schema_version,payload,content_hash,question_set,question_set_hash,context_hash,prepared_id
  ) values (
    p_kb_id,p_user_id,revision,'marketing-geo-kb.v3',p_candidate->'payload',v_payload_hash,
    case when v_question_available then v_question_set->'value' else null end,
    case when v_question_available then v_context->>'questionSetHash' else null end,
    v_context_hash,v_candidate_id
  )
  returning marketing_geo_kb_snapshots.id,marketing_geo_kb_snapshots.content_hash,marketing_geo_kb_snapshots.frozen_at
    into snapshot_id,content_hash,frozen_at;
  insert into public.marketing_geo_snapshot_contexts(snapshot_id,user_id,kb_id,content_hash,context,receipt_id)
    values(snapshot_id,p_user_id,p_kb_id,v_context_hash,v_context,null);
  update public.marketing_geo_knowledge_bases set current_frozen_snapshot_id=snapshot_id,updated_at=now() where id=p_kb_id;
  outcome:='published'; reused_existing:=false; return next;
exception when invalid_text_representation or numeric_value_out_of_range then
  outcome:='candidate_mismatch'; snapshot_id:=null; revision:=null; content_hash:=null;
  frozen_at:=null; reused_existing:=null; return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Privileges
--
-- RLS is on with zero policies on every table touched here, so privileges are
-- the boundary. CREATE OR REPLACE preserves an existing ACL, so these restate
-- exactly what the earlier migrations granted; the only new grant is publish.
-- The two *_valid helpers stay executable by nobody, including service_role:
-- they are defense in depth called from inside SECURITY DEFINER bodies.
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketing_geo_knowledge_input_valid(uuid,text,jsonb),
  public.marketing_geo_knowledge_result_valid(uuid,uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;

revoke all on function public.marketing_geo_generation_input_current(uuid,uuid,jsonb) from public,anon,authenticated;

revoke all on function
  public.marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer),
  public.marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text),
  public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),
  public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function
  public.marketing_geo_save_kb_draft(uuid,uuid,text,jsonb,text,integer),
  public.marketing_geo_freeze_kb(uuid,uuid,text,integer,jsonb,text),
  public.marketing_geo_freeze_kb_with_context(uuid,uuid,text,integer,jsonb,text,jsonb),
  public.marketing_geo_finish_generation(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb),
  public.marketing_geo_publish_kb_v3(uuid,uuid,jsonb,text)
  to service_role;

notify pgrst,'reload schema';
