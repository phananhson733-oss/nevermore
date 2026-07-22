BEGIN;

-- Competitors are stable project/domain identities. A domain is deliberately
-- narrower than a URL: lowercase ASCII hostname, no scheme, credentials, port,
-- path or wildcard. IDNs must arrive in canonical punycode form.
CREATE OR REPLACE FUNCTION app.is_normalized_competitor_domain(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT length(candidate) BETWEEN 1 AND 253
    AND candidate = btrim(candidate)
    AND candidate = lower(candidate)
    AND candidate ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$';
$$;

CREATE OR REPLACE FUNCTION app.is_competitor_analysis_scope(candidate text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  scope text;
BEGIN
  IF cardinality(candidate) NOT BETWEEN 0 AND 5 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(candidate) value
    WHERE value IS NULL
       OR value NOT IN (
         'positioning',
         'product_capability',
         'keyword_gap',
         'content',
         'serp_visibility'
       )
  ) THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM unnest(candidate) value)
     IS DISTINCT FROM
     (SELECT count(DISTINCT value) FROM unnest(candidate) value) THEN
    RETURN false;
  END IF;
  FOREACH scope IN ARRAY candidate LOOP
    IF scope IS DISTINCT FROM btrim(scope) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Product Profile evidence references remain typed JSON objects. A UUID list
-- would lose whether an anchor was a Snapshot, Observation, user edit, etc.
CREATE OR REPLACE FUNCTION app.is_typed_product_profile_evidence_refs(
  candidate jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  evidence_ref jsonb;
  ref_kind text;
  ref_id text;
  target_id text;
  expected_keys integer;
  seen_ids text[] := ARRAY[]::text[];
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate) NOT BETWEEN 1 AND 50 THEN
    RETURN false;
  END IF;

  FOR evidence_ref IN SELECT value FROM jsonb_array_elements(candidate)
  LOOP
    IF jsonb_typeof(evidence_ref) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    ref_kind := evidence_ref ->> 'kind';
    ref_id := evidence_ref ->> 'evidenceRefId';
    IF ref_id IS NULL OR ref_id !~ uuid_pattern OR ref_id = ANY(seen_ids) THEN
      RETURN false;
    END IF;
    seen_ids := array_append(seen_ids, ref_id);

    CASE ref_kind
      WHEN 'declaredHint', 'userEdit' THEN
        expected_keys := 2;
        target_id := NULL;
      WHEN 'snapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'snapshotId';
      WHEN 'pageSnapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'pageSnapshotId';
      WHEN 'observation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'observationId';
      WHEN 'analysisInvocation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'analysisInvocationId';
      ELSE
        RETURN false;
    END CASE;

    IF (SELECT count(*) FROM jsonb_object_keys(evidence_ref))
       IS DISTINCT FROM expected_keys THEN
      RETURN false;
    END IF;
    IF expected_keys = 3 AND (target_id IS NULL OR target_id !~ uuid_pattern) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS app.competitor_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  domain text NOT NULL CHECK (app.is_normalized_competitor_domain(domain)),
  name text CHECK (
    name IS NULL
    OR (length(name) BETWEEN 1 AND 160 AND name = btrim(name))
  ),
  review_status text NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','approved','excluded')),
  relationship text CHECK (
    relationship IS NULL
    OR relationship IN (
      'direct',
      'indirect',
      'status_quo',
      'benchmark',
      'publisher'
    )
  ),
  analysis_scope text[] NOT NULL DEFAULT '{}'
    CHECK (app.is_competitor_analysis_scope(analysis_scope)),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, domain),
  CHECK (
    (
      review_status = 'approved'
      AND relationship IS NOT NULL
      AND cardinality(analysis_scope) BETWEEN 1 AND 5
    )
    OR (
      review_status IN ('candidate','excluded')
      AND relationship IS NULL
      AND cardinality(analysis_scope) = 0
    )
  )
);

CREATE INDEX IF NOT EXISTS competitor_entities_project_created_idx
  ON app.competitor_entities(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS competitor_entities_project_status_idx
  ON app.competitor_entities(project_id, review_status, created_at DESC, id DESC);

-- One immutable row is one exact origin occurrence. Only a canonical confirmed
-- Product Profile version, a canonical CSV Observation pointer, or a manual
-- entry may be represented in v1. There is intentionally no DataForSEO, SERP,
-- or AI-citation discriminator in this table.
CREATE TABLE IF NOT EXISTS app.competitor_origin_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK (
    origin_kind IN ('product_profile','csv_keyword_gap','manual')
  ),
  source_name text CHECK (
    source_name IS NULL
    OR (
      length(source_name) BETWEEN 1 AND 160
      AND source_name = btrim(source_name)
    )
  ),
  product_profile_id uuid
    REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  profile_version integer CHECK (
    profile_version IS NULL OR profile_version >= 1
  ),
  candidate_id uuid,
  field_provenance_path text,
  evidence_refs jsonb,
  source_review_status text CHECK (
    source_review_status IS NULL
    OR source_review_status IN ('candidate','approved','excluded')
  ),
  source_relationship text CHECK (
    source_relationship IS NULL
    OR source_relationship IN ('direct','indirect')
  ),
  source_analysis_scope text[],
  data_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  import_preview_id uuid
    REFERENCES app.import_previews(id) ON DELETE RESTRICT,
  source_pointer text,
  manual_entry_id uuid,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    source_analysis_scope IS NULL
    OR app.is_competitor_analysis_scope(source_analysis_scope)
  ),
  CHECK (
    evidence_refs IS NULL
    OR app.is_typed_product_profile_evidence_refs(evidence_refs)
  ),
  CHECK (
    (
      origin_kind = 'product_profile'
      AND source_name IS NOT NULL
      AND product_profile_id IS NOT NULL
      AND profile_version IS NOT NULL
      AND candidate_id IS NOT NULL
      AND field_provenance_path IS NOT NULL
      AND evidence_refs IS NOT NULL
      AND source_review_status IS NOT NULL
      AND source_analysis_scope IS NOT NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NULL
      AND observed_at IS NULL
    )
    OR (
      origin_kind = 'csv_keyword_gap'
      AND source_name IS NULL
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND import_preview_id IS NOT NULL
      AND source_pointer = '/valueJson/competitorDomain'
      AND manual_entry_id IS NULL
      AND observed_at IS NOT NULL
    )
    OR (
      origin_kind = 'manual'
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NOT NULL
      AND id = manual_entry_id
      AND observed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_profile_identity_idx
  ON app.competitor_origin_occurrences(
    product_profile_id,
    profile_version,
    candidate_id
  )
  WHERE origin_kind = 'product_profile';
CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_csv_identity_idx
  ON app.competitor_origin_occurrences(
    normalized_observation_id,
    source_pointer
  )
  WHERE origin_kind = 'csv_keyword_gap';
CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_manual_identity_idx
  ON app.competitor_origin_occurrences(manual_entry_id)
  WHERE origin_kind = 'manual';
CREATE INDEX IF NOT EXISTS competitor_origins_entity_observed_idx
  ON app.competitor_origin_occurrences(
    competitor_id,
    observed_at DESC NULLS LAST,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION app.enforce_competitor_entity_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'competitor stable identities cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'competitor project is absent, archived, or cross-workspace'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'competitor governance must begin at revision zero'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.domain IS DISTINCT FROM OLD.domain
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'competitor stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
    RAISE EXCEPTION 'competitor governance revision must advance exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.review_status IS NOT DISTINCT FROM OLD.review_status
     AND NEW.relationship IS NOT DISTINCT FROM OLD.relationship
     AND NEW.analysis_scope IS NOT DISTINCT FROM OLD.analysis_scope THEN
    RAISE EXCEPTION 'competitor revision requires a governance change'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_entities_governance_guard
  ON app.competitor_entities;
CREATE TRIGGER competitor_entities_governance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.competitor_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_entity_governance();

CREATE OR REPLACE FUNCTION app.enforce_competitor_origin_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  profile_row app.icp_profiles%ROWTYPE;
  profile_candidate jsonb;
  candidate_index integer;
  candidate_count integer;
  provenance_count integer;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'competitor origin occurrences are append-only'
      USING ERRCODE = '23514';
  END IF;

  SELECT entity.*
  INTO entity_row
  FROM app.competitor_entities entity
  JOIN app.client_projects project
    ON project.id = entity.project_id
   AND project.workspace_id = entity.workspace_id
   AND project.archived_at IS NULL
  WHERE entity.id = NEW.competitor_id
    AND entity.workspace_id = NEW.workspace_id
    AND entity.project_id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'competitor origin does not match an active scoped entity'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.origin_kind = 'product_profile' THEN
    SELECT profile.*
    INTO profile_row
    FROM app.icp_profiles profile
    JOIN app.client_projects project
      ON project.id = profile.project_id
     AND project.workspace_id = profile.workspace_id
     AND project.confirmed_icp_profile_id = profile.id
    WHERE profile.id = NEW.product_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.project_id
      AND profile.version = NEW.profile_version
      AND profile.status = 'complete'
      AND profile.profile ->> 'profileSchemaVersion'
        = 'product-profile.0.3.0';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'competitor Product Profile source is not the confirmed scoped version'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
    INTO candidate_count
    FROM jsonb_array_elements(profile_row.profile -> 'competitorCandidates') item
    WHERE item ->> 'candidateId' = NEW.candidate_id::text;
    IF candidate_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'competitor candidate identity is absent or ambiguous'
        USING ERRCODE = '23514';
    END IF;
    SELECT item, (ordinality - 1)::integer
    INTO profile_candidate, candidate_index
    FROM jsonb_array_elements(profile_row.profile -> 'competitorCandidates')
      WITH ORDINALITY candidate(item, ordinality)
    WHERE item ->> 'candidateId' = NEW.candidate_id::text;

    IF profile_candidate ->> 'domain' IS DISTINCT FROM entity_row.domain
       OR profile_candidate ->> 'name' IS DISTINCT FROM NEW.source_name
       OR profile_candidate ->> 'reviewStatus'
         IS DISTINCT FROM NEW.source_review_status
       OR profile_candidate ->> 'relationship'
         IS DISTINCT FROM NEW.source_relationship
       OR profile_candidate -> 'analysisScope'
         IS DISTINCT FROM to_jsonb(NEW.source_analysis_scope) THEN
      RAISE EXCEPTION 'competitor origin drifted from the immutable Product Profile candidate'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.source_review_status = 'approved'
       AND (
         NEW.source_relationship IS NULL
         OR NEW.source_relationship NOT IN ('direct','indirect')
         OR cardinality(NEW.source_analysis_scope) = 0
       ) THEN
      RAISE EXCEPTION 'approved Product Profile competitor is not actionable'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.field_provenance_path NOT IN (
      '/competitorCandidates',
      '/competitorCandidates/' || candidate_index::text
    ) THEN
      RAISE EXCEPTION 'competitor field provenance path does not cover its candidate'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*)::integer
    INTO provenance_count
    FROM jsonb_array_elements(profile_row.profile -> 'fieldProvenance') entry
    WHERE entry ->> 'path' = NEW.field_provenance_path
      AND entry -> 'evidenceRefs' = NEW.evidence_refs;
    IF provenance_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'competitor evidence refs do not match typed Product Profile provenance'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.origin_kind = 'csv_keyword_gap' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM app.normalized_observations observation
      JOIN app.data_snapshots snapshot
        ON snapshot.id = observation.snapshot_id
       AND snapshot.id = NEW.data_snapshot_id
       AND snapshot.workspace_id = NEW.workspace_id
       AND snapshot.project_id = NEW.project_id
       AND snapshot.provider = 'csv'
       AND snapshot.dataset_key = 'csv.keyword_gap.v1'
      JOIN app.collection_runs collection_run
        ON collection_run.id = snapshot.collection_run_id
       AND collection_run.workspace_id = NEW.workspace_id
       AND collection_run.project_id = NEW.project_id
       AND collection_run.site_id = snapshot.site_id
       AND collection_run.provider = 'csv'
       AND collection_run.import_preview_id = NEW.import_preview_id
      JOIN app.import_previews preview
        ON preview.id = collection_run.import_preview_id
       AND preview.workspace_id = NEW.workspace_id
       AND preview.project_id = NEW.project_id
       AND preview.site_id = snapshot.site_id
       AND preview.template_id = 'keyword_gap_v1'
       AND preview.status = 'consumed'
      WHERE observation.id = NEW.normalized_observation_id
        AND observation.workspace_id = NEW.workspace_id
        AND observation.project_id = NEW.project_id
        AND observation.provider = 'csv'
        AND observation.metric_key = 'csv.keyword_gap.v1'
        AND observation.origin = 'user_provided'
        AND observation.grade = 'C'
        AND observation.availability = 'available'
        AND observation.observed_at = NEW.observed_at
        AND observation.value_json ->> 'competitorDomain' = entity_row.domain
        AND NEW.source_pointer = '/valueJson/competitorDomain'
    ) THEN
      RAISE EXCEPTION 'competitor CSV origin does not match canonical Observation lineage'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.origin_kind = 'manual' THEN
    IF NEW.id IS DISTINCT FROM NEW.manual_entry_id THEN
      RAISE EXCEPTION 'manual competitor occurrence must retain its entry identity'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported competitor origin kind'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_origins_lineage_guard
  ON app.competitor_origin_occurrences;
CREATE TRIGGER competitor_origins_lineage_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.competitor_origin_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();

-- A single statement serializes an exact source identity, converges the stable
-- domain entity, and appends the origin. Existing governance is never touched.
CREATE OR REPLACE FUNCTION app.upsert_competitor_origin(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_domain text,
  selected_name text,
  selected_origin_kind text,
  selected_product_profile_id uuid,
  selected_profile_version integer,
  selected_candidate_id uuid,
  selected_field_provenance_path text,
  selected_evidence_refs jsonb,
  selected_source_review_status text,
  selected_source_relationship text,
  selected_source_analysis_scope text[],
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_import_preview_id uuid,
  selected_source_pointer text,
  selected_manual_entry_id uuid
)
RETURNS TABLE (occurrence_id uuid, competitor_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  occurrence_row app.competitor_origin_occurrences%ROWTYPE;
  selected_observed_at timestamptz;
  source_lock_key text;
  seed_review_status text := 'candidate';
  seed_relationship text := NULL;
  seed_analysis_scope text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'competitor project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF selected_domain IS NULL
     OR NOT app.is_normalized_competitor_domain(selected_domain)
     OR (
       selected_name IS NOT NULL
       AND (
         length(selected_name) NOT BETWEEN 1 AND 160
         OR selected_name IS DISTINCT FROM btrim(selected_name)
       )
     ) THEN
    RAISE EXCEPTION 'competitor identity is not canonical'
      USING ERRCODE = '23514';
  END IF;

  IF selected_origin_kind = 'product_profile' THEN
    IF selected_name IS NULL
       OR selected_product_profile_id IS NULL
       OR selected_profile_version IS NULL
       OR selected_profile_version < 1
       OR selected_candidate_id IS NULL
       OR selected_field_provenance_path IS NULL
       OR selected_evidence_refs IS NULL
       OR NOT app.is_typed_product_profile_evidence_refs(selected_evidence_refs)
       OR selected_source_review_status IS NULL
       OR selected_source_review_status NOT IN ('candidate','approved','excluded')
       OR selected_source_relationship IS NOT NULL
          AND selected_source_relationship NOT IN ('direct','indirect')
       OR selected_source_analysis_scope IS NULL
       OR NOT app.is_competitor_analysis_scope(selected_source_analysis_scope)
       OR selected_data_snapshot_id IS NOT NULL
       OR selected_normalized_observation_id IS NOT NULL
       OR selected_import_preview_id IS NOT NULL
       OR selected_source_pointer IS NOT NULL
       OR selected_manual_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Product Profile competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    IF selected_source_review_status = 'approved'
       AND (
         selected_source_relationship IS NULL
         OR selected_source_relationship NOT IN ('direct','indirect')
         OR cardinality(selected_source_analysis_scope) = 0
       ) THEN
      RAISE EXCEPTION 'approved Product Profile competitor source is incomplete'
        USING ERRCODE = '23514';
    END IF;
    source_lock_key := selected_origin_kind || ':'
      || selected_product_profile_id::text || ':'
      || selected_profile_version::text || ':'
      || selected_candidate_id::text;
    seed_review_status := selected_source_review_status;
    IF seed_review_status = 'approved' THEN
      seed_relationship := selected_source_relationship;
      seed_analysis_scope := selected_source_analysis_scope;
    END IF;
  ELSIF selected_origin_kind = 'csv_keyword_gap' THEN
    IF selected_name IS NOT NULL
       OR selected_product_profile_id IS NOT NULL
       OR selected_profile_version IS NOT NULL
       OR selected_candidate_id IS NOT NULL
       OR selected_field_provenance_path IS NOT NULL
       OR selected_evidence_refs IS NOT NULL
       OR selected_source_review_status IS NOT NULL
       OR selected_source_relationship IS NOT NULL
       OR selected_source_analysis_scope IS NOT NULL
       OR selected_data_snapshot_id IS NULL
       OR selected_normalized_observation_id IS NULL
       OR selected_import_preview_id IS NULL
       OR selected_source_pointer IS DISTINCT FROM '/valueJson/competitorDomain'
       OR selected_manual_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'CSV competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT observation.observed_at
    INTO selected_observed_at
    FROM app.normalized_observations observation
    WHERE observation.id = selected_normalized_observation_id;
    source_lock_key := selected_origin_kind || ':'
      || selected_normalized_observation_id::text || ':'
      || selected_source_pointer;
  ELSIF selected_origin_kind = 'manual' THEN
    IF selected_product_profile_id IS NOT NULL
       OR selected_profile_version IS NOT NULL
       OR selected_candidate_id IS NOT NULL
       OR selected_field_provenance_path IS NOT NULL
       OR selected_evidence_refs IS NOT NULL
       OR selected_source_review_status IS NOT NULL
       OR selected_source_relationship IS NOT NULL
       OR selected_source_analysis_scope IS NOT NULL
       OR selected_data_snapshot_id IS NOT NULL
       OR selected_normalized_observation_id IS NOT NULL
       OR selected_import_preview_id IS NOT NULL
       OR selected_source_pointer IS NOT NULL
       OR selected_manual_entry_id IS NULL THEN
      RAISE EXCEPTION 'manual competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    source_lock_key := selected_origin_kind || ':'
      || selected_manual_entry_id::text;
  ELSE
    RAISE EXCEPTION 'unsupported competitor origin kind'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    source_lock_key,
    0
  ));

  IF selected_origin_kind = 'product_profile' THEN
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'product_profile'
      AND occurrence.product_profile_id = selected_product_profile_id
      AND occurrence.profile_version = selected_profile_version
      AND occurrence.candidate_id = selected_candidate_id;
  ELSIF selected_origin_kind = 'csv_keyword_gap' THEN
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'csv_keyword_gap'
      AND occurrence.normalized_observation_id = selected_normalized_observation_id
      AND occurrence.source_pointer = selected_source_pointer;
  ELSE
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'manual'
      AND occurrence.manual_entry_id = selected_manual_entry_id;
  END IF;

  IF occurrence_row.id IS NOT NULL THEN
    SELECT * INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.id = occurrence_row.competitor_id;
    IF occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR entity_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.domain IS DISTINCT FROM selected_domain
       OR occurrence_row.origin_kind IS DISTINCT FROM selected_origin_kind
       OR occurrence_row.source_name IS DISTINCT FROM selected_name
       OR occurrence_row.product_profile_id IS DISTINCT FROM selected_product_profile_id
       OR occurrence_row.profile_version IS DISTINCT FROM selected_profile_version
       OR occurrence_row.candidate_id IS DISTINCT FROM selected_candidate_id
       OR occurrence_row.field_provenance_path IS DISTINCT FROM selected_field_provenance_path
       OR occurrence_row.evidence_refs IS DISTINCT FROM selected_evidence_refs
       OR occurrence_row.source_review_status IS DISTINCT FROM selected_source_review_status
       OR occurrence_row.source_relationship IS DISTINCT FROM selected_source_relationship
       OR occurrence_row.source_analysis_scope IS DISTINCT FROM selected_source_analysis_scope
       OR occurrence_row.data_snapshot_id IS DISTINCT FROM selected_data_snapshot_id
       OR occurrence_row.normalized_observation_id IS DISTINCT FROM selected_normalized_observation_id
       OR occurrence_row.import_preview_id IS DISTINCT FROM selected_import_preview_id
       OR occurrence_row.source_pointer IS DISTINCT FROM selected_source_pointer
       OR occurrence_row.manual_entry_id IS DISTINCT FROM selected_manual_entry_id
       OR occurrence_row.observed_at IS DISTINCT FROM selected_observed_at THEN
      RAISE EXCEPTION 'competitor source replay conflicts with immutable provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT occurrence_row.id, entity_row.id;
    RETURN;
  END IF;

  INSERT INTO app.competitor_entities (
    workspace_id,
    project_id,
    domain,
    name,
    review_status,
    relationship,
    analysis_scope
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_domain,
    selected_name,
    seed_review_status,
    seed_relationship,
    seed_analysis_scope
  )
  ON CONFLICT (project_id, domain) DO NOTHING
  RETURNING * INTO entity_row;

  IF entity_row.id IS NULL THEN
    SELECT * INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.project_id = selected_project_id
      AND entity.domain = selected_domain;
  END IF;
  IF entity_row.id IS NULL
     OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'competitor stable domain conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.competitor_origin_occurrences (
    id,
    workspace_id,
    project_id,
    competitor_id,
    origin_kind,
    source_name,
    product_profile_id,
    profile_version,
    candidate_id,
    field_provenance_path,
    evidence_refs,
    source_review_status,
    source_relationship,
    source_analysis_scope,
    data_snapshot_id,
    normalized_observation_id,
    import_preview_id,
    source_pointer,
    manual_entry_id,
    observed_at
  ) VALUES (
    coalesce(selected_manual_entry_id, gen_random_uuid()),
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    selected_origin_kind,
    selected_name,
    selected_product_profile_id,
    selected_profile_version,
    selected_candidate_id,
    selected_field_provenance_path,
    selected_evidence_refs,
    selected_source_review_status,
    selected_source_relationship,
    selected_source_analysis_scope,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    selected_import_preview_id,
    selected_source_pointer,
    selected_manual_entry_id,
    selected_observed_at
  )
  RETURNING * INTO occurrence_row;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0019_competitor_library_foundation'::text AS migration_version;

COMMIT;
