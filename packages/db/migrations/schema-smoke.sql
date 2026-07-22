\set ON_ERROR_STOP on

BEGIN;
SET search_path = app, public;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE') <> 35 THEN
    RAISE EXCEPTION 'expected exactly 35 app tables';
  END IF;
END;
$$;

INSERT INTO app.workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Spec smoke workspace');

INSERT INTO app.operator_profiles (user_id, workspace_id, display_name)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Spec operator'
);

INSERT INTO app.client_projects (
  id, workspace_id, client_name, project_name, default_delivery_locale, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000001',
    'Spec client',
    'Spec project',
    'en',
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000001',
    'Other client',
    'Other project',
    'en',
    '00000000-0000-4000-8000-000000000101'
  );

INSERT INTO app.sites (
  id, workspace_id, project_id, origin, host, market_codes, language_codes
)
VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'https://example.com',
  'example.com',
  ARRAY[]::text[],
  ARRAY[]::text[]
);

INSERT INTO app.icp_profiles (
  id, workspace_id, project_id, version, status, profile, content_hash, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    1,
    'complete',
    '{"productName":"Spec product v1"}'::jsonb,
    repeat('1', 64),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000202',
    1,
    'complete',
    '{"productName":"Other product"}'::jsonb,
    repeat('2', 64),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    2,
    'draft',
    '{"productName":"Spec product working v2"}'::jsonb,
    repeat('3', 64),
    '00000000-0000-4000-8000-000000000101'
  );

UPDATE app.client_projects
SET current_icp_profile_id = '00000000-0000-4000-8000-000000000403',
    confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000401'
WHERE id = '00000000-0000-4000-8000-000000000201';

-- The database separates the latest working draft from the reviewed profile
-- used by downstream work, without advancing the project lifecycle.
DO $$
DECLARE
  current_splice_rejected boolean := false;
  confirmed_splice_rejected boolean := false;
  draft_confirmation_rejected boolean := false;
  profile_mutation_rejected boolean := false;
BEGIN
  IF (
    SELECT market_codes = ARRAY[]::text[]
       AND language_codes = ARRAY[]::text[]
    FROM app.sites
    WHERE id = '00000000-0000-4000-8000-000000000301'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'URL-first site did not preserve unknown market/language scope';
  END IF;

  IF (
    SELECT current_icp_profile_id = '00000000-0000-4000-8000-000000000403'
       AND confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000401'
       AND stage = 'setup'
    FROM app.client_projects
    WHERE id = '00000000-0000-4000-8000-000000000201'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'working and confirmed profile pointers were not kept distinct';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET current_icp_profile_id = '00000000-0000-4000-8000-000000000402'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    current_splice_rejected := true;
  END;
  IF NOT current_splice_rejected THEN
    RAISE EXCEPTION 'cross-project current profile splice was accepted';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000402'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    confirmed_splice_rejected := true;
  END;
  IF NOT confirmed_splice_rejected THEN
    RAISE EXCEPTION 'cross-project confirmed profile splice was accepted';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000403'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    draft_confirmation_rejected := true;
  END;
  IF NOT draft_confirmation_rejected THEN
    RAISE EXCEPTION 'draft profile was accepted as confirmed';
  END IF;

  BEGIN
    UPDATE app.icp_profiles
    SET profile = '{"mutated":true}'::jsonb
    WHERE id = '00000000-0000-4000-8000-000000000403';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    profile_mutation_rejected := true;
  END;
  IF NOT profile_mutation_rejected THEN
    RAISE EXCEPTION 'append-only ICP profile mutation was accepted';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'app.client_projects'::regclass
      AND conname IN (
        'client_projects_current_icp_profile_fk',
        'client_projects_confirmed_icp_profile_fk'
      )
      AND confdeltype = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'ICP profile pointers are not protected by ON DELETE RESTRICT';
  END IF;
END;
$$;

INSERT INTO app.source_connections (
  id, workspace_id, project_id, site_id, provider, connection_type, state,
  limitation, connected_at, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'crawl',
    'public',
    'connected',
    'Static HTML public crawl only.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'csv',
    'file_import',
    'connected',
    'User-provided keyword-gap import.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'dataforseo',
    'api_key_stub',
    'connected',
    'Vendor keyword-gap observation source.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  );

INSERT INTO app.import_previews (
  id, workspace_id, project_id, site_id, created_by, token_hash,
  template_id, raw_object_key, file_checksum, row_count, detected_columns,
  suggested_mapping, preview_rows, expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000001401',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  decode(repeat('a', 64), 'hex'),
  'keyword_gap_v1',
  'raw-import/00000000-0000-4000-8000-000000000201/00000000-0000-4000-8000-000000001401/preview.csv',
  repeat('a', 64),
  1,
  '["keyword"]'::jsonb,
  '{"keyword":"keyword"}'::jsonb,
  '[{"keyword":"growth audit"}]'::jsonb,
  now() + interval '30 minutes'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:crawl:site_graph',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:csv:keyword_gap',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:dataforseo:keyword_gap',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  );

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id,
  import_preview_id, provider, operation, method_version, parameters_hash
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000501',
    NULL,
    'crawl',
    'site_graph',
    'crawl.site_graph.v2',
    repeat('2', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000001401',
    'csv',
    'keyword_gap_import',
    'csv.keyword_gap.v1',
    repeat('5', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000503',
    NULL,
    'dataforseo',
    'keyword_gap_import',
    'dataforseo.ranked_keywords.v1',
    repeat('6', 64)
  );

INSERT INTO app.data_snapshots (
  id, workspace_id, project_id, site_id, collection_run_id, source_connection_id,
  provider, dataset_key, schema_version, method_version, captured_at, source_window,
  availability, limitation, row_count, checksum
)
VALUES
  (
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000501',
    'crawl',
    'crawl.site_graph.v1',
    'crawl.site_graph.v2',
    'crawl.site_graph.v2',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'Static HTML public crawl only.',
    1,
    repeat('3', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000502',
    'csv',
    'csv.keyword_gap.v1',
    '0.2.0',
    'csv.keyword_gap.v1',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'User-provided keyword-gap import.',
    1,
    repeat('6', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000503',
    'dataforseo',
    'csv.keyword_gap.v1',
    'dataforseo.ranked_keywords.v1',
    'dataforseo.ranked_keywords.v1',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'Vendor keyword-gap observation source.',
    1,
    repeat('7', 64)
  );

UPDATE app.collection_runs
SET row_count = 1,
    source_window = '{"start":null,"end":null}'::jsonb
WHERE id IN (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000606',
  '00000000-0000-4000-8000-000000000607'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at
)
VALUES (
  '00000000-0000-4000-8000-000000000605',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'collection',
  'running',
  'collect:crawl:placeholder-bypass',
  '00000000-0000-4000-8000-000000000101',
  now()
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id, provider,
      operation, method_version, parameters_hash, row_count
    ) VALUES (
      '00000000-0000-4000-8000-000000000605',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000501',
      'crawl',
      'site_graph',
      'crawl.site_graph.v2',
      repeat('9', 64),
      1
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'collection run terminal INSERT bypass was accepted';
  END IF;
END;
$$;

-- An observed zero is valid when availability is explicitly available.
INSERT INTO app.normalized_observations (
  id, workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
  subject_ref, observed_at, availability, value_numeric, unit, origin, grade,
  support, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000701',
    'crawl',
    'crawl.page.v1',
    'url',
    'https://example.com/pricing',
    now(),
    'available',
    0,
    'links',
    'direct_public',
    'B',
    'context',
    'Only links present in the static HTML crawl are counted.'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000702',
    'csv',
    'csv.keyword_gap.v1',
    'keyword_cluster',
    'growth-audit',
    now(),
    'available',
    12,
    'keywords',
    'user_provided',
    'C',
    'context',
    'User-provided rows retain their source identity.'
  ),
  (
    '00000000-0000-4000-8000-000000000803',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000703',
    'dataforseo',
    'csv.keyword_gap.v1',
    'keyword_cluster',
    'growth-audit',
    now(),
    'available',
    10,
    'keywords',
    'vendor_observation',
    'B',
    'context',
    'Vendor observations retain their source identity.'
  );

-- Unavailable is never allowed to carry a synthetic zero.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.normalized_observations (
      workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
      subject_ref, observed_at, availability, value_numeric, origin, grade, support,
      limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      'crawl',
      'crawl.page.v1',
      'url',
      'https://example.com/',
      now(),
      'unavailable',
      0,
      'direct_public',
      'B',
      'context',
      'The metric was unavailable.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unavailable observation with zero was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.normalized_observations (
      workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
      subject_ref, observed_at, availability, value_numeric, origin, grade,
      support, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      'crawl',
      'gsc.page.v1',
      'url',
      'https://example.com/provider-splice',
      now(),
      'available',
      1,
      'direct_public',
      'B',
      'context',
      'This row intentionally splices a GSC metric into a crawl snapshot.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'observation metric/provider/dataset splice was accepted';
  END IF;
END;
$$;

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'diagnostic',
  'completed',
  'diagnostic',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

INSERT INTO app.diagnostic_runs (
  id, workspace_id, project_id, site_id, icp_profile_id, icp_profile_version,
  rule_set_version, prompt_set_version, output_locale, input_manifest, input_hash,
  coverage
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401',
  1,
  'mvp.rules.0.2.1',
  'mvp.prompts.0.2.0',
  'en',
  jsonb_build_object(
    'projectId', '00000000-0000-4000-8000-000000000201',
    'siteId', '00000000-0000-4000-8000-000000000301',
    'ruleSetVersion', 'mvp.rules.0.2.1',
    'promptSetVersion', 'mvp.prompts.0.2.0',
    'deliveryLocale', 'en',
    'icp', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000401',
      'version', 1,
      'contentHash', repeat('1', 64)
    ),
    'snapshots',
    jsonb_build_array(
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000701',
        'provider', 'crawl',
        'datasetKey', 'crawl.site_graph.v1',
        'schemaVersion', 'crawl.site_graph.v2',
        'methodVersion', 'crawl.site_graph.v2',
        'checksum', repeat('3', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      ),
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000702',
        'provider', 'csv',
        'datasetKey', 'csv.keyword_gap.v1',
        'schemaVersion', '0.2.0',
        'methodVersion', 'csv.keyword_gap.v1',
        'checksum', repeat('6', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      ),
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000703',
        'provider', 'dataforseo',
        'datasetKey', 'csv.keyword_gap.v1',
        'schemaVersion', 'dataforseo.ranked_keywords.v1',
        'methodVersion', 'dataforseo.ranked_keywords.v1',
        'checksum', repeat('7', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      )
    )
  ),
  repeat('4', 64),
  '{"overall":"complete"}'::jsonb
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000608',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'diagnostic',
  'completed',
  'diagnostic:duplicate-provider',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    )
    SELECT
      '00000000-0000-4000-8000-000000000608',
      workspace_id,
      project_id,
      site_id,
      icp_profile_id,
      icp_profile_version,
      rule_set_version,
      prompt_set_version,
      output_locale,
      jsonb_set(
        input_manifest,
        '{snapshots}',
        (input_manifest -> 'snapshots')
          || jsonb_build_array(input_manifest -> 'snapshots' -> 1)
      ),
      repeat('8', 64),
      '{}'::jsonb
    FROM app.diagnostic_runs
    WHERE id = '00000000-0000-4000-8000-000000000602';
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'current diagnostic accepted duplicate provider snapshots';
  END IF;
END;
$$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.diagnostic_run_rules (
      diagnostic_run_id, rule_id, rule_version, domain,
      status, reason, metrics, duration_ms
    ) VALUES (
      '00000000-0000-4000-8000-000000000602',
      'TECH-LINKGRAPH-005',
      1,
      'technical_seo',
      'candidate',
      NULL,
      '{}'::jsonb,
      1
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'current diagnostic accepted a legacy technical rule version';
  END IF;
END;
$$;

INSERT INTO app.diagnostic_run_rules (
  diagnostic_run_id, rule_id, rule_version, domain,
  status, reason, metrics, duration_ms
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  'TECH-LINKGRAPH-005',
  2,
  'technical_seo',
  'candidate',
  NULL,
  '{}'::jsonb,
  1
);

-- Model-generated evidence must reference an immutable AnalysisInvocation.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, source_provider, origin, method,
      grade, availability, support, subject_refs, claim, observed_at, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      'llm',
      'generated',
      'generated',
      'C',
      'available',
      'context',
      '[{"type":"site","value":"https://example.com"}]'::jsonb,
      'Generated text without lineage must fail.',
      now(),
      'This smoke row intentionally has no model invocation.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'generated evidence without invocation was accepted';
  END IF;
END;
$$;

INSERT INTO app.evidence (
  id, workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000601',
  'crawl',
  'direct_public',
  'observed',
  'B',
  'available',
  'supports',
  '[{"type":"url","value":"https://example.com/pricing"}]'::jsonb,
  'The pricing page had zero observed internal inlinks.',
  now(),
  'Only links present in the static HTML crawl are counted.'
);

-- Bespoke observed-provider mappings retain the provider grade while sharing
-- the same exact frozen-lineage enforcement.
INSERT INTO app.evidence (
  workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000606',
    'csv', 'user_provided', 'observed', 'C', 'available', 'supports',
    '[{"type":"keyword_cluster","value":"growth-audit"}]'::jsonb,
    'The frozen CSV import contains the growth-audit keyword cluster.',
    now(),
    'The source and export settings remain user-provided.'
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000607',
    'dataforseo', 'vendor_observation', 'observed', 'B', 'available', 'supports',
    '[{"type":"keyword_cluster","value":"growth-audit"}]'::jsonb,
    'The frozen vendor snapshot observes the growth-audit keyword cluster.',
    now(),
    'Vendor estimates retain their market, language, filter, and row-cap limits.'
  );

-- Deterministic rules may compute or infer conclusions from the exact frozen
-- source snapshot without relabelling the underlying row as an observation.
INSERT INTO app.evidence (
  workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000601',
    'crawl', 'derived', 'computed', 'B', 'available', 'supports',
    '[{"type":"page_set","value":"low_internal_inlinks"}]'::jsonb,
    'The frozen crawl graph deterministically computes a low-inlink page set.',
    now(),
    'The computation is replayable from the frozen crawl snapshot.'
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000601',
    'crawl', 'derived', 'inferred', 'C', 'available', 'supports',
    '[{"type":"page_set","value":"missing_entity_proof"}]'::jsonb,
    'The frozen crawl content heuristically lacks entity proof.',
    now(),
    'The inference is limited to the documented language heuristic.'
  );

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl',
      'direct_public',
      'observed',
      'A',
      'available',
      'supports',
      '[{"type":"url","value":"https://example.com/pricing"}]'::jsonb,
      'This row intentionally overstates the trust grade.',
      now(),
      'Only links present in the static HTML crawl are counted.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'source evidence with a forged trust grade was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  pseudo_provider_rejected boolean := false;
  computed_grade_rejected boolean := false;
  inferred_grade_rejected boolean := false;
  derived_method_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'system', 'derived', 'computed', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_provider"}]'::jsonb,
      'This row tries to hide crawl lineage behind the system provider.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    pseudo_provider_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'computed', 'A', 'available', 'supports',
      '[{"type":"page_set","value":"forged_computed_grade"}]'::jsonb,
      'This deterministic computation overstates its grade.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    computed_grade_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'inferred', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_inferred_grade"}]'::jsonb,
      'This heuristic inference overstates its grade.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    inferred_grade_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'observed', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_derived_method"}]'::jsonb,
      'This derived claim tries to masquerade as observed.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    derived_method_rejected := true;
  END;

  IF NOT pseudo_provider_rejected THEN
    RAISE EXCEPTION 'source lineage hidden behind a pseudo-provider was accepted';
  END IF;
  IF NOT computed_grade_rejected THEN
    RAISE EXCEPTION 'derived computed evidence with a forged grade was accepted';
  END IF;
  IF NOT inferred_grade_rejected THEN
    RAISE EXCEPTION 'derived inferred evidence with a forged grade was accepted';
  END IF;
  IF NOT derived_method_rejected THEN
    RAISE EXCEPTION 'derived evidence with an observed method was accepted';
  END IF;
END;
$$;

-- Historical evidence is append-only.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.evidence
    SET claim = 'mutated'
    WHERE id = '00000000-0000-4000-8000-000000000901';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'append-only evidence update was accepted';
  END IF;
END;
$$;

INSERT INTO app.findings (
  id, workspace_id, project_id, finding_key, rule_id, rule_version, rule_family,
  intent, domain, title_key, summary, summary_locale, subject_refs, severity,
  confidence, first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
)
VALUES (
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  repeat('5', 64),
  'TECH-LINKGRAPH-005',
  2,
  'internal-link-equity',
  'strengthen_internal_links',
  'technical_seo',
  'finding.tech.linkgraph.title',
  'A priority page has fewer than two observed internal inlinks.',
  'en',
  '[{"type":"page_set","value":"low_internal_inlinks"}]'::jsonb,
  'high',
  'high',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000602',
  now(),
  now()
);

INSERT INTO app.finding_observations (
  workspace_id, project_id, finding_id, diagnostic_run_id, evidence_id, role
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000901',
  'primary'
);

UPDATE app.findings
SET review_state = 'confirmed', review_revision = 1
WHERE id = '00000000-0000-4000-8000-000000001001';

INSERT INTO app.finding_review_events (
  workspace_id, project_id, finding_id, from_state, to_state, revision, actor_id
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  'unreviewed',
  'confirmed',
  1,
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.actions (
  id, workspace_id, project_id, source_finding_id, source_diagnostic_run_id,
  action_key, template_id,
  title, description, content_locale, priority_band, roadmap_lane, status,
  effort, risk, expected_outcome, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000602',
  repeat('6', 64),
  'strengthen_internal_links.v1',
  'Strengthen internal links to priority pages',
  'Add contextual links from relevant pages to the affected priority page.',
  'en',
  'high',
  'now',
  'candidate',
  'small',
  'low',
  'Increase discoverability and connect high-intent journeys.',
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, attempt_count,
  initiated_by, started_at, completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'artifact_generation',
    'failed',
    NULL,
    1,
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000604',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'artifact_generation',
    'queued',
    'artifact:smoke-regeneration',
    0,
    '00000000-0000-4000-8000-000000000101',
    NULL,
    NULL
  );

-- A failed generation is allowed to have no revision; ready is not.
INSERT INTO app.execution_artifacts (
  id, workspace_id, project_id, action_id, artifact_type, status,
  generation_mode, output_locale, current_revision, validation_state,
  latest_generation_run_id, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001101',
  'technical_ticket',
  'failed',
  'template',
  'en',
  0,
  'invalid',
  '00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000101'
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.execution_artifacts (
      workspace_id, project_id, action_id, artifact_type, status,
      generation_mode, output_locale, current_revision, validation_state, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001101',
      'content_brief',
      'ready',
      'template',
      'en',
      0,
      'valid',
      '00000000-0000-4000-8000-000000000101'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready artifact without a revision was accepted';
  END IF;
END;
$$;

-- The database itself rejects bypasses of the frozen Artifact state machine.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'ready', current_revision = 1, validation_state = 'valid'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'failed artifact transitioned directly to ready';
  END IF;
END;
$$;

-- Merely reusing the failed owner is not a regeneration claim.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'generating'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'failed artifact reused its old generation Run';
  END IF;
END;
$$;

-- A fresh generation Run is the one legal exit from failed.
UPDATE app.execution_artifacts
SET status = 'generating',
    latest_generation_run_id = '00000000-0000-4000-8000-000000000604'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Generation completion must advance exactly one revision, not jump pointers.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'draft', current_revision = 2,
        validation_state = 'valid', content_hash = repeat('7', 64)
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'generation completion jumped more than one revision';
  END IF;
END;
$$;

INSERT INTO app.artifact_revisions (
  workspace_id, project_id, artifact_id, revision, output_locale,
  content_format, content_text, content_hash, generated_by, validation_errors
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001201',
  1,
  'en',
  'markdown',
  '# Smoke ticket revision one',
  repeat('7', 64),
  'template',
  '[]'::jsonb
);

UPDATE app.execution_artifacts
SET status = 'draft', current_revision = 1,
    validation_state = 'valid', content_hash = repeat('7', 64)
WHERE id = '00000000-0000-4000-8000-000000001201';

-- A status-only transition cannot smuggle a revision-pointer change.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'ready', current_revision = 2
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'draft to ready changed the revision pointer';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'ready'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Editing READY content must append exactly one new revision.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'draft'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready artifact returned to draft without a revision';
  END IF;
END;
$$;

INSERT INTO app.artifact_revisions (
  workspace_id, project_id, artifact_id, revision, output_locale,
  content_format, content_text, content_hash, generated_by, validation_errors
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001201',
  2,
  'zh-CN',
  'markdown',
  '# Smoke ticket revision two',
  repeat('8', 64),
  'operator',
  '[]'::jsonb
);

UPDATE app.execution_artifacts
SET status = 'draft', current_revision = 2,
    validation_state = 'valid', content_hash = repeat('8', 64)
WHERE id = '00000000-0000-4000-8000-000000001201';

DO $$
BEGIN
  IF (
    SELECT array_agg(output_locale ORDER BY revision)
    FROM app.artifact_revisions
    WHERE artifact_id = '00000000-0000-4000-8000-000000001201'
  ) IS DISTINCT FROM ARRAY['en', 'zh-CN']::text[] THEN
    RAISE EXCEPTION 'artifact revision output locale was not preserved';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'ready'
WHERE id = '00000000-0000-4000-8000-000000001201';

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'archived', current_revision = 3
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready to archived changed the revision pointer';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'archived'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Slice 1 growth-audit persistence only stores traceable canonical references.
INSERT INTO app.capability_runs (
  async_run_id, capability_id, capability_version, input_manifest_hash,
  mode, side_effect_class
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  'growth-audit',
  '0.3.0',
  repeat('a', 64),
  'production',
  'internal_write'
);

INSERT INTO app.audit_runs (
  id, workspace_id, project_id, diagnostic_run_id, capability_run_id,
  scope_kind, scope_key, projection_version
)
VALUES (
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000602',
  'site',
  '00000000-0000-4000-8000-000000000301',
  'growth-audit.0.3.0'
);

INSERT INTO app.audit_module_results (
  audit_run_id, module_id, coverage_state, summary
)
VALUES (
  '00000000-0000-4000-8000-000000001501',
  'technical_search',
  'available',
  '{}'::jsonb
);

INSERT INTO app.site_pages (
  id, workspace_id, project_id, site_id, normalized_url,
  normalized_url_hash
)
VALUES (
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'https://example.com/customer-onboarding',
  encode(
    digest(
      convert_to('https://example.com/customer-onboarding', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
);

INSERT INTO app.page_snapshots (
  id, workspace_id, project_id, site_page_id, data_snapshot_id,
  content_hash, canonical_extract, extract, captured_at
)
VALUES (
  '00000000-0000-4000-8000-000000001701',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000000701',
  encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
  '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
  '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
  now()
);

-- A URL-first Crawl run freezes one exact SitePage identity. The accepted row
-- and both negative cases exercise migration 0015, not a client projection.
INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  attempt_count, started_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000681',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'running',
    'collect:crawl:frozen-product-page',
    '00000000-0000-4000-8000-000000000101',
    1,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000682',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'running',
    'collect:crawl:mismatched-product-page',
    '00000000-0000-4000-8000-000000000101',
    1,
    now()
  );

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id,
  provider, operation, method_version, parameters_hash,
  crawl_seed_site_page_id, crawl_seed_url
)
VALUES (
  '00000000-0000-4000-8000-000000000681',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'site_graph',
  'crawl.site_graph.v2',
  repeat('8', 64),
  '00000000-0000-4000-8000-000000001601',
  'https://example.com/customer-onboarding'
);

DO $$
DECLARE
  mismatched_seed_rejected boolean := false;
  seed_mutation_rejected boolean := false;
BEGIN
  IF (
    SELECT crawl_seed_site_page_id =
             '00000000-0000-4000-8000-000000001601'::uuid
       AND crawl_seed_url = 'https://example.com/customer-onboarding'
    FROM app.collection_runs
    WHERE id = '00000000-0000-4000-8000-000000000681'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'exact frozen Crawl seed was not persisted';
  END IF;

  BEGIN
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      provider, operation, method_version, parameters_hash,
      crawl_seed_site_page_id, crawl_seed_url
    )
    VALUES (
      '00000000-0000-4000-8000-000000000682',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000501',
      'crawl',
      'site_graph',
      'crawl.site_graph.v2',
      repeat('9', 64),
      '00000000-0000-4000-8000-000000001601',
      'https://example.com/customer-onboarding/'
    );
  EXCEPTION WHEN check_violation THEN
    mismatched_seed_rejected := true;
  END;
  IF NOT mismatched_seed_rejected THEN
    RAISE EXCEPTION 'Crawl seed accepted a different exact URL';
  END IF;

  BEGIN
    UPDATE app.collection_runs
    SET crawl_seed_url = 'https://example.com/customer-onboarding/'
    WHERE id = '00000000-0000-4000-8000-000000000681';
  EXCEPTION WHEN check_violation THEN
    seed_mutation_rejected := true;
  END;
  IF NOT seed_mutation_rejected THEN
    RAISE EXCEPTION 'frozen Crawl seed identity was mutated';
  END IF;
END;
$$;

-- Product Profile synthesis freezes one canonical input manifest and reserves
-- provider budget durably before any network boundary.
INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  attempt_count, started_at
)
VALUES (
  '00000000-0000-4000-8000-000000000691',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'product_profile_synthesis',
  'running',
  'product-profile:smoke',
  '00000000-0000-4000-8000-000000000101',
  1,
  now()
);

INSERT INTO app.product_profile_runs (
  id, workspace_id, project_id, site_id,
  base_icp_profile_id, base_icp_profile_version,
  base_icp_profile_content_hash, source_snapshot_id,
  synthesis_version, prompt_set_version, input_manifest, input_hash
)
VALUES (
  '00000000-0000-4000-8000-000000000691',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000403',
  2,
  repeat('3', 64),
  '00000000-0000-4000-8000-000000000701',
  'product-profile-synthesis.0.3.0',
  'mvp.prompts.product-profile.0.3.0',
  jsonb_build_object(
    'schemaVersion', 'product-profile-synthesis-input.0.3.0',
    'selectionPolicyVersion', 'product-profile-page-selection.0.3.0',
    'projectId', '00000000-0000-4000-8000-000000000201',
    'siteId', '00000000-0000-4000-8000-000000000301',
    'sourcePageUrl', 'https://example.com/customer-onboarding',
    'baseProfile', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000403',
      'version', 2,
      'contentHash', repeat('3', 64),
      'status', 'draft'
    ),
    'crawlSnapshot', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000701'
    ),
    'pages', jsonb_build_array(jsonb_build_object(
      'pageSnapshotId', '00000000-0000-4000-8000-000000001701',
      'sitePageId', '00000000-0000-4000-8000-000000001601',
      'dataSnapshotId', '00000000-0000-4000-8000-000000000701',
      'normalizedUrl', 'https://example.com/customer-onboarding'
    ))
  ),
  repeat('a', 64)
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by
)
VALUES (
  '00000000-0000-4000-8000-000000000692',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'product_profile_synthesis',
  'queued',
  'product-profile:unfrozen-smoke',
  '00000000-0000-4000-8000-000000000101'
);

DO $$
DECLARE
  unfrozen_manifest_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.product_profile_runs (
      id, workspace_id, project_id, site_id,
      base_icp_profile_id, base_icp_profile_version,
      base_icp_profile_content_hash, source_snapshot_id,
      synthesis_version, prompt_set_version, input_manifest, input_hash
    )
    VALUES (
      '00000000-0000-4000-8000-000000000692',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000403',
      2,
      repeat('3', 64),
      '00000000-0000-4000-8000-000000000701',
      'product-profile-synthesis.0.3.0',
      'mvp.prompts.product-profile.0.3.0',
      jsonb_build_object(
        'projectId', '00000000-0000-4000-8000-000000000201',
        'siteId', '00000000-0000-4000-8000-000000000301',
        'sourcePageUrl', 'https://example.com/customer-onboarding',
        'baseProfile', jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000403',
          'version', 2,
          'contentHash', repeat('3', 64),
          'status', 'draft'
        ),
        'crawlSnapshot', jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000702'
        )
      ),
      repeat('c', 64)
    );
  EXCEPTION WHEN check_violation THEN
    unfrozen_manifest_rejected := true;
  END;
  IF NOT unfrozen_manifest_rejected THEN
    RAISE EXCEPTION 'product profile run accepted an unfrozen manifest';
  END IF;
END;
$$;

DO $$
DECLARE
  reservation jsonb;
  result jsonb;
  reservation_id uuid;
BEGIN
  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    1,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF reservation ->> 'kind' IS DISTINCT FROM 'reserved'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 1 THEN
    RAISE EXCEPTION 'product profile invocation reservation was not persisted';
  END IF;
  reservation_id := (reservation #>> '{reservation,id}')::uuid;

  UPDATE app.async_runs
  SET attempt_count = 2
  WHERE id = '00000000-0000-4000-8000-000000000691';

  result := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF result ->> 'kind' IS DISTINCT FROM 'unresolved'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 1 THEN
    RAISE EXCEPTION 'unresolved product profile invocation allowed another provider call';
  END IF;

  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    1,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    NULL,
    'failed',
    NULL,
    NULL,
    NULL,
    1,
    'PROVIDER_FAILED'
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'first product profile reservation did not finalize';
  END IF;

  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  reservation_id := (reservation #>> '{reservation,id}')::uuid;
  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    NULL,
    'failed',
    NULL,
    NULL,
    NULL,
    1,
    'PROVIDER_FAILED'
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'second product profile reservation did not finalize';
  END IF;

  UPDATE app.async_runs
  SET attempt_count = 3
  WHERE id = '00000000-0000-4000-8000-000000000691';

  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    3,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  reservation_id := (reservation #>> '{reservation,id}')::uuid;
  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    3,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    repeat('e', 64),
    'succeeded',
    10,
    20,
    0.001,
    2,
    NULL
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'third product profile reservation did not finalize';
  END IF;

  UPDATE app.async_runs
  SET attempt_count = 4
  WHERE id = '00000000-0000-4000-8000-000000000691';

  result := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    4,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF result ->> 'kind' IS DISTINCT FROM 'budget_exhausted'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 3 THEN
    RAISE EXCEPTION 'a fourth product profile invocation reservation was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  successful_invocation_id uuid;
  invalid_profile jsonb;
  validation jsonb;
  invalid_profile_rejected boolean := false;
BEGIN
  SELECT analysis_invocation_id
  INTO successful_invocation_id
  FROM app.product_profile_invocation_attempts
  WHERE product_profile_run_id =
      '00000000-0000-4000-8000-000000000691'
    AND status = 'succeeded';

  invalid_profile := jsonb_build_object(
    'profileSchemaVersion', 'product-profile.0.3.0',
    'sourceSiteId', '00000000-0000-4000-8000-000000000301',
    'sourceSnapshotId', '00000000-0000-4000-8000-000000000701',
    'analysisInvocationId', successful_invocation_id::text,
    'generatedAt', '2026-07-22T00:00:00.000Z',
    'fieldProvenance', jsonb_build_array(jsonb_build_object(
      'fieldPath', '/product/name',
      'evidenceRefs', jsonb_build_array(jsonb_build_object(
        'kind', 'pageSnapshot',
        'pageSnapshotId', '00000000-0000-4000-8000-000000009999'
      ))
    ))
  );
  validation := app.validate_product_profile_provenance(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    invalid_profile
  );
  IF validation ->> 'ok' IS DISTINCT FROM 'false'
     OR validation::text NOT LIKE '%page_snapshot_missing%' THEN
    RAISE EXCEPTION 'product profile provenance accepted a foreign canonical reference';
  END IF;

  BEGIN
    INSERT INTO app.icp_profiles (
      workspace_id, project_id, version, status, profile, content_hash, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      3,
      'draft',
      invalid_profile,
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000101'
    );
  EXCEPTION WHEN check_violation THEN
    invalid_profile_rejected := true;
  END;
  IF NOT invalid_profile_rejected THEN
    RAISE EXCEPTION 'invalid Product Profile provenance reached canonical ICP storage';
  END IF;
END;
$$;

DO $$
DECLARE
  duplicate_module_rejected boolean := false;
  capability_mutation_rejected boolean := false;
  audit_mutation_rejected boolean := false;
  module_mutation_rejected boolean := false;
  page_snapshot_mutation_rejected boolean := false;
  duplicate_page_source_rejected boolean := false;
  page_snapshot_capture_mismatch_rejected boolean := false;
  page_snapshot_hash_mismatch_rejected boolean := false;
  page_snapshot_payload_mismatch_rejected boolean := false;
  page_snapshot_missing_canonical_rejected boolean := false;
  page_snapshot_schema_mismatch_rejected boolean := false;
  page_snapshot_fetch_identity_rejected boolean := false;
  site_page_hash_mismatch_rejected boolean := false;
  site_page_identity_mutation_rejected boolean := false;
  forbidden_status_count integer;
BEGIN
  BEGIN
    INSERT INTO app.audit_module_results (
      audit_run_id, module_id, coverage_state, summary
    ) VALUES (
      '00000000-0000-4000-8000-000000001501',
      'technical_search',
      'partial',
      '{}'::jsonb
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_module_rejected := true;
  END;
  IF NOT duplicate_module_rejected THEN
    RAISE EXCEPTION 'duplicate audit module result was accepted';
  END IF;

  BEGIN
    UPDATE app.capability_runs
    SET mode = 'shadow'
    WHERE async_run_id = '00000000-0000-4000-8000-000000000602';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    capability_mutation_rejected := true;
  END;
  IF NOT capability_mutation_rejected THEN
    RAISE EXCEPTION 'capability run mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.audit_runs
    SET scope_key = 'unexpected'
    WHERE id = '00000000-0000-4000-8000-000000001501';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    audit_mutation_rejected := true;
  END;
  IF NOT audit_mutation_rejected THEN
    RAISE EXCEPTION 'audit run mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.audit_module_results
    SET coverage_state = 'partial'
    WHERE audit_run_id = '00000000-0000-4000-8000-000000001501'
      AND module_id = 'technical_search';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    module_mutation_rejected := true;
  END;
  IF NOT module_mutation_rejected THEN
    RAISE EXCEPTION 'audit module result mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.page_snapshots
    SET extract = '{}'::jsonb
    WHERE id = '00000000-0000-4000-8000-000000001701';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    page_snapshot_mutation_rejected := true;
  END;
  IF NOT page_snapshot_mutation_rejected THEN
    RAISE EXCEPTION 'page snapshot mutation was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_page_source_rejected := true;
  END;
  IF NOT duplicate_page_source_rejected THEN
    RAISE EXCEPTION 'a second extract for one page/source snapshot was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now() + interval '1 second'
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_capture_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_capture_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot with a different source capture time was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      repeat('f', 64),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_hash_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_hash_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot hash unrelated to its retained bytes was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_payload_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_payload_mismatch_rejected THEN
    RAISE EXCEPTION 'retained page bytes unrelated to the page extract were accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_missing_canonical_rejected := true;
  END;
  IF NOT page_snapshot_missing_canonical_rejected THEN
    RAISE EXCEPTION 'a new page snapshot without retained extract bytes was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_schema_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_schema_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot with an unknown extract schema was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_fetch_identity_rejected := true;
  END;
  IF NOT page_snapshot_fetch_identity_rejected THEN
    RAISE EXCEPTION 'a page snapshot for another fetch URL was accepted';
  END IF;

  BEGIN
    INSERT INTO app.site_pages (
      workspace_id, project_id, site_id, normalized_url, normalized_url_hash
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      'https://example.com/forged-hash',
      repeat('f', 64)
    );
  EXCEPTION WHEN check_violation THEN
    site_page_hash_mismatch_rejected := true;
  END;
  IF NOT site_page_hash_mismatch_rejected THEN
    RAISE EXCEPTION 'a site page with a caller-forged URL hash was accepted';
  END IF;

  BEGIN
    UPDATE app.site_pages
    SET normalized_url = 'https://example.com/mutated'
    WHERE id = '00000000-0000-4000-8000-000000001601';
  EXCEPTION WHEN check_violation THEN
    site_page_identity_mutation_rejected := true;
  END;
  IF NOT site_page_identity_mutation_rejected THEN
    RAISE EXCEPTION 'a durable site page identity was mutated';
  END IF;

  SELECT count(*) INTO forbidden_status_count
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND table_name IN ('capability_runs', 'audit_runs')
    AND column_name = 'status';
  IF forbidden_status_count <> 0 THEN
    RAISE EXCEPTION 'growth audit projection introduced a second status';
  END IF;
END;
$$;

DO $$
DECLARE
  locale_constraint_count integer;
BEGIN
  IF NOT app.is_bcp47_language_tag('en-US-u-hc-h12')
     OR NOT app.is_bcp47_language_tag('x-private')
     OR NOT app.is_bcp47_language_tag('i-klingon')
     OR app.is_bcp47_language_tag('de-1901-1901')
     OR app.is_bcp47_language_tag('en-a-first-a-second')
     OR app.is_bcp47_language_tag('en-u') THEN
    RAISE EXCEPTION 'RFC 5646 locale validation is inconsistent';
  END IF;
  IF NOT app.are_bcp47_language_tags(
    ARRAY['en-US-u-hc-h12', 'x-private']::text[]
  ) OR NOT app.are_bcp47_language_tags(
    ARRAY[]::text[]
  ) OR app.are_bcp47_language_tags(
    ARRAY['en', 'de-1901-1901']::text[]
  ) THEN
    RAISE EXCEPTION 'RFC 5646 locale array validation is inconsistent';
  END IF;
  SELECT count(*)
  INTO locale_constraint_count
  FROM pg_constraint
  WHERE connamespace = 'app'::regnamespace
    AND conname = ANY (ARRAY[
      'client_projects_default_delivery_locale_check',
      'sites_language_codes_bcp47_check',
      'diagnostic_runs_output_locale_check',
      'findings_summary_locale_check',
      'actions_content_locale_check',
      'execution_artifacts_output_locale_check',
      'artifact_revisions_output_locale_check',
      'export_bundles_output_locale_check'
    ]::text[])
    AND pg_get_constraintdef(oid) LIKE '%bcp47_language_tag%';
  IF locale_constraint_count <> 8 THEN
    RAISE EXCEPTION 'expected eight canonical RFC 5646 constraints, found %',
      locale_constraint_count;
  END IF;
  IF (
    SELECT contract_version
    FROM app.async_runs
    WHERE id = '00000000-0000-4000-8000-000000000601'
  ) IS DISTINCT FROM '2026-07-21' THEN
    RAISE EXCEPTION 'async run contract-version default is stale';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.export_bundles'::regclass
      AND conname = 'export_bundles_schema_version_check'
      AND pg_get_constraintdef(oid) LIKE '%signalframe.service-bundle.0.2.0%'
      AND pg_get_constraintdef(oid) LIKE '%signalframe.service-bundle.0.3.0%'
  ) THEN
    RAISE EXCEPTION 'export bundle schema-version compatibility is stale';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.page_snapshots'::regclass
      AND conname = 'page_snapshots_canonical_extract_required'
      AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%canonical_extract IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'page snapshot canonical extract requirement is missing or unvalidated';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.page_snapshots'::regclass
      AND conname = 'page_snapshots_site_page_data_snapshot_key'
      AND pg_get_constraintdef(oid) LIKE '%UNIQUE (site_page_id, data_snapshot_id)%'
  ) THEN
    RAISE EXCEPTION 'page snapshot page/source identity is not globally unique';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND tablename = 'page_snapshots'
      AND indexname = 'page_snapshots_verified_source_identity_idx'
      AND indexdef LIKE '%UNIQUE INDEX%'
      AND indexdef LIKE '%(site_page_id, data_snapshot_id)%'
      AND indexdef LIKE '%WHERE (canonical_extract IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'verified page snapshot identity index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.evidence'::regclass
      AND conname = 'evidence_source_lineage_required'
      AND convalidated
      AND obj_description(oid, 'pg_constraint') = 'signalframe.evidence-provenance.v2'
      AND pg_get_constraintdef(oid) LIKE '%snapshot_id IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%collection_run_id IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''system''%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''llm''%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''dataforseo''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''derived''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''generated''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''computed''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''inferred''%'
      AND pg_get_constraintdef(oid) LIKE '%grade = ''C''%'
  ) THEN
    RAISE EXCEPTION 'evidence provenance-shape requirement is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'app.evidence'::regclass
      AND tgname = 'evidence_provenance_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'evidence provenance guard is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.diagnostic_runs'::regclass
      AND conname = 'diagnostic_runs_rule_set_version_check'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.0%'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.1%'
  ) THEN
    RAISE EXCEPTION 'diagnostic rule-set compatibility is stale';
  END IF;
  IF (
    SELECT migration_version FROM app.schema_migration_version
  ) IS DISTINCT FROM '0015_frozen_crawl_seed' THEN
    RAISE EXCEPTION 'database migration version projection is stale';
  END IF;
END;
$$;

ROLLBACK;
