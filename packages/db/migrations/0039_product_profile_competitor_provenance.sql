BEGIN;

-- Competitor candidates are grounded in a DataForSEO snapshot that is collected
-- independently of the Crawl snapshot a Product Profile is built from. The
-- provenance validator required every observation reference to belong to the
-- profile's single Crawl source snapshot, so the first profile ever to carry
-- discovered competitors was rejected with observation_snapshot_mismatch and
-- its whole synthesis transaction rolled back.
--
-- Admit a second snapshot, but only the exact one this profile's own synthesis
-- run froze, and only observations that run enumerated in its immutable input
-- manifest. A looser rule would let a later or unrelated observation stand as
-- evidence for an older immutable profile.

CREATE OR REPLACE FUNCTION app.validate_product_profile_provenance(
  p_workspace_id uuid,
  p_project_id uuid,
  p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  issues jsonb := '[]'::jsonb;
  source_site_text text;
  source_snapshot_text text;
  analysis_invocation_text text;
  v_source_site_id uuid;
  v_source_snapshot_id uuid;
  v_analysis_invocation_id uuid;
  provenance_entry jsonb;
  evidence_refs jsonb;
  evidence_ref jsonb;
  ref_kind text;
  ref_id_text text;
  entry_index integer;
  ref_index integer;
  ref_path text;
  page_snapshot_snapshot_id uuid;
  page_snapshot_site_id uuid;
  observation_snapshot_id uuid;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
     OR p_profile ->> 'profileSchemaVersion'
       IS DISTINCT FROM 'product-profile.0.3.0' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'issues', jsonb_build_array(jsonb_build_object(
        'code', 'unsupported_profile_schema',
        'path', '/profileSchemaVersion'
      ))
    );
  END IF;

  source_site_text := p_profile ->> 'sourceSiteId';
  source_snapshot_text := p_profile ->> 'sourceSnapshotId';
  analysis_invocation_text := p_profile ->> 'analysisInvocationId';

  IF source_site_text IS NULL
     OR source_site_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'source_site_missing',
      'path', '/sourceSiteId'
    ));
  ELSE
    v_source_site_id := source_site_text::uuid;
    IF NOT EXISTS (
      SELECT 1
      FROM app.sites site
      WHERE site.id = v_source_site_id
        AND site.workspace_id = p_workspace_id
        AND site.project_id = p_project_id
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'source_site_missing',
        'path', '/sourceSiteId'
      ));
    END IF;
  END IF;

  IF source_snapshot_text IS NOT NULL THEN
    IF source_snapshot_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'source_snapshot_missing',
        'path', '/sourceSnapshotId'
      ));
    ELSE
      v_source_snapshot_id := source_snapshot_text::uuid;
      IF v_source_site_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM app.data_snapshots snapshot
        WHERE snapshot.id = v_source_snapshot_id
          AND snapshot.workspace_id = p_workspace_id
          AND snapshot.project_id = p_project_id
          AND snapshot.site_id = v_source_site_id
      ) THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'source_snapshot_site_mismatch',
          'path', '/sourceSnapshotId'
        ));
      END IF;
    END IF;
  END IF;

  IF analysis_invocation_text IS NOT NULL THEN
    IF analysis_invocation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'analysis_invocation_missing',
        'path', '/analysisInvocationId'
      ));
    ELSE
      v_analysis_invocation_id := analysis_invocation_text::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM app.analysis_invocations invocation
        JOIN app.product_profile_runs profile_run
          ON profile_run.id = invocation.async_run_id
         AND profile_run.workspace_id = p_workspace_id
         AND profile_run.project_id = p_project_id
         AND profile_run.site_id = v_source_site_id
         AND profile_run.source_snapshot_id = v_source_snapshot_id
         AND profile_run.prompt_input_hash = invocation.input_hash
        WHERE invocation.id = v_analysis_invocation_id
          AND invocation.workspace_id = p_workspace_id
          AND invocation.project_id = p_project_id
          AND invocation.task = 'product_profile_synthesis'
          AND invocation.status = 'succeeded'
          AND invocation.output_hash IS NOT NULL
          AND invocation.error_code IS NULL
      ) THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'analysis_invocation_task_mismatch',
          'path', '/analysisInvocationId'
        ));
      END IF;
    END IF;
  END IF;

  IF ((source_snapshot_text IS NULL)::integer
      + (analysis_invocation_text IS NULL)::integer
      + ((p_profile ->> 'generatedAt') IS NULL)::integer) NOT IN (0, 3) THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'incomplete_synthesis_lineage',
      'path', '/sourceSnapshotId'
    ));
  END IF;

  IF jsonb_typeof(p_profile -> 'fieldProvenance') IS DISTINCT FROM 'array' THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_field_provenance',
      'path', '/fieldProvenance'
    ));
  ELSE
    FOR provenance_entry, entry_index IN
      SELECT value, (ordinality - 1)::integer
      FROM jsonb_array_elements(p_profile -> 'fieldProvenance')
        WITH ORDINALITY AS entries(value, ordinality)
    LOOP
      evidence_refs := provenance_entry -> 'evidenceRefs';
      IF jsonb_typeof(evidence_refs) IS DISTINCT FROM 'array' THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_evidence_refs',
          'path', '/fieldProvenance/' || entry_index::text || '/evidenceRefs'
        ));
        CONTINUE;
      END IF;

      FOR evidence_ref, ref_index IN
        SELECT value, (ordinality - 1)::integer
        FROM jsonb_array_elements(evidence_refs)
          WITH ORDINALITY AS refs(value, ordinality)
      LOOP
        ref_kind := evidence_ref ->> 'kind';
        ref_path := '/fieldProvenance/' || entry_index::text
          || '/evidenceRefs/' || ref_index::text;

        IF ref_kind IN ('declaredHint','userEdit') THEN
          IF evidence_ref ?| ARRAY[
            'snapshotId',
            'pageSnapshotId',
            'observationId',
            'analysisInvocationId'
          ] THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'declared_reference_contains_canonical_id',
              'path', ref_path
            ));
          END IF;
          CONTINUE;
        END IF;

        IF ref_kind NOT IN (
          'snapshot',
          'pageSnapshot',
          'observation',
          'analysisInvocation'
        ) THEN
          issues := issues || jsonb_build_array(jsonb_build_object(
            'code', 'unsupported_evidence_reference',
            'path', ref_path
          ));
          CONTINUE;
        END IF;

        IF v_source_site_id IS NULL OR v_source_snapshot_id IS NULL THEN
          issues := issues || jsonb_build_array(jsonb_build_object(
            'code', 'canonical_lineage_missing',
            'path', ref_path,
            'refKind', ref_kind
          ));
          CONTINUE;
        END IF;

        IF ref_kind = 'snapshot' THEN
          ref_id_text := evidence_ref ->> 'snapshotId';
          IF ref_id_text IS NULL OR ref_id_text IS DISTINCT FROM source_snapshot_text THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'snapshot_reference_mismatch',
              'path', ref_path || '/snapshotId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          END IF;
        ELSIF ref_kind = 'pageSnapshot' THEN
          ref_id_text := evidence_ref ->> 'pageSnapshotId';
          IF ref_id_text IS NULL
             OR ref_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'page_snapshot_missing',
              'path', ref_path || '/pageSnapshotId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          ELSE
            SELECT page_snapshot.data_snapshot_id, site_page.site_id
            INTO page_snapshot_snapshot_id, page_snapshot_site_id
            FROM app.page_snapshots page_snapshot
            JOIN app.site_pages site_page
              ON site_page.id = page_snapshot.site_page_id
             AND site_page.workspace_id = p_workspace_id
             AND site_page.project_id = p_project_id
            WHERE page_snapshot.id = ref_id_text::uuid
              AND page_snapshot.workspace_id = p_workspace_id
              AND page_snapshot.project_id = p_project_id;

            IF NOT FOUND THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'page_snapshot_missing',
                'path', ref_path || '/pageSnapshotId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            ELSE
              IF page_snapshot_snapshot_id IS DISTINCT FROM v_source_snapshot_id THEN
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'code', 'page_snapshot_snapshot_mismatch',
                  'path', ref_path || '/pageSnapshotId',
                  'refKind', ref_kind,
                  'refId', ref_id_text
                ));
              END IF;
              IF page_snapshot_site_id IS DISTINCT FROM v_source_site_id THEN
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'code', 'page_snapshot_site_mismatch',
                  'path', ref_path || '/pageSnapshotId',
                  'refKind', ref_kind,
                  'refId', ref_id_text
                ));
              END IF;
            END IF;
          END IF;
        ELSIF ref_kind = 'observation' THEN
          ref_id_text := evidence_ref ->> 'observationId';
          IF ref_id_text IS NULL
             OR ref_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'observation_missing',
              'path', ref_path || '/observationId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          ELSE
            SELECT observation.snapshot_id
            INTO observation_snapshot_id
            FROM app.normalized_observations observation
            WHERE observation.id = ref_id_text::uuid
              AND observation.workspace_id = p_workspace_id
              AND observation.project_id = p_project_id;

            IF NOT FOUND THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'observation_missing',
                'path', ref_path || '/observationId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            ELSIF observation_snapshot_id IS DISTINCT FROM v_source_snapshot_id
              -- A Product Profile has exactly one Crawl source snapshot, but
              -- competitor candidates are grounded in a second, independently
              -- collected DataForSEO snapshot. Admit those observations only
              -- when this profile's own synthesis run froze that exact snapshot
              -- and enumerated that exact observation in its immutable input
              -- manifest. Anything looser would let a later or unrelated
              -- observation be presented as evidence for an older profile.
              AND NOT EXISTS (
                SELECT 1
                FROM app.analysis_invocations invocation
                JOIN app.product_profile_runs profile_run
                  ON profile_run.id = invocation.async_run_id
                 AND profile_run.workspace_id = p_workspace_id
                 AND profile_run.project_id = p_project_id
                 AND profile_run.site_id = v_source_site_id
                 AND profile_run.source_snapshot_id = v_source_snapshot_id
                 AND profile_run.prompt_input_hash = invocation.input_hash
                WHERE invocation.id = v_analysis_invocation_id
                  AND invocation.workspace_id = p_workspace_id
                  AND invocation.project_id = p_project_id
                  AND invocation.task = 'product_profile_synthesis'
                  AND invocation.status = 'succeeded'
                  AND invocation.output_hash IS NOT NULL
                  AND invocation.error_code IS NULL
                  AND (
                    profile_run.input_manifest
                      -> 'competitorDiscovery' ->> 'snapshotId'
                  )::uuid = observation_snapshot_id
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(
                      profile_run.input_manifest
                        -> 'competitorDiscovery' -> 'observations'
                    ) AS frozen_observation
                    WHERE frozen_observation ->> 'observationId' = ref_id_text
                  )
              )
            THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'observation_snapshot_mismatch',
                'path', ref_path || '/observationId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            END IF;
          END IF;
        ELSE
          ref_id_text := evidence_ref ->> 'analysisInvocationId';
          IF v_analysis_invocation_id IS NULL
             OR ref_id_text IS NULL
             OR ref_id_text IS DISTINCT FROM analysis_invocation_text THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'analysis_invocation_reference_mismatch',
              'path', ref_path || '/analysisInvocationId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(issues) = 0,
    'issues', issues
  );
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0039_product_profile_competitor_provenance'::text AS migration_version;

COMMIT;
