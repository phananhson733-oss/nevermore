BEGIN;

-- Product Profile synthesis deterministically mints candidate and evidence
-- identities as UUIDv8. Migration 0019 accidentally retained the pre-RFC 9562
-- [1-5] version bound, so the database rejected the same evidence references
-- that the application had already validated when a confirmed profile carried
-- a competitor. Keep the typed shape and uniqueness checks unchanged while
-- accepting every UUID version used by the current contracts (1 through 8).
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
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
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

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0035_uuidv8_product_profile_competitor_evidence'::text
    AS migration_version;

COMMIT;
