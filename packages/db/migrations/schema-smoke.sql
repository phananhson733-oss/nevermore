\set ON_ERROR_STOP on

BEGIN;
SET search_path = app, public;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE') <> 28 THEN
    RAISE EXCEPTION 'expected exactly 28 app tables';
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
VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'Spec client',
  'Spec project',
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
  ARRAY['US'],
  ARRAY['en-US']
);

INSERT INTO app.icp_profiles (
  id, workspace_id, project_id, version, status, profile, content_hash, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  1,
  'complete',
  '{"productName":"Spec product"}'::jsonb,
  repeat('1', 64),
  '00000000-0000-4000-8000-000000000101'
);

UPDATE app.client_projects
SET current_icp_profile_id = '00000000-0000-4000-8000-000000000401'
WHERE id = '00000000-0000-4000-8000-000000000201';

INSERT INTO app.source_connections (
  id, workspace_id, project_id, site_id, provider, connection_type, state,
  limitation, connected_at, created_by
)
VALUES (
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
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'collection',
  'completed',
  'collect:crawl:site_graph',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id, provider,
  operation, method_version, parameters_hash, row_count
)
VALUES (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'site_graph',
  'crawl.v1',
  repeat('2', 64),
  1
);

INSERT INTO app.data_snapshots (
  id, workspace_id, project_id, site_id, collection_run_id, source_connection_id,
  provider, dataset_key, schema_version, method_version, captured_at, source_window,
  availability, limitation, row_count, checksum
)
VALUES (
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'crawl.site_graph.v1',
  '1',
  'crawl.v1',
  now(),
  '{"start":null,"end":null}'::jsonb,
  'available',
  'Static HTML public crawl only.',
  1,
  repeat('3', 64)
);

-- An observed zero is valid when availability is explicitly available.
INSERT INTO app.normalized_observations (
  id, workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
  subject_ref, observed_at, availability, value_numeric, unit, origin, grade,
  support, limitation
)
VALUES (
  '00000000-0000-4000-8000-000000000801',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000701',
  'crawl',
  'page.internal_inlinks',
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
      'page.fake_metric',
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
  'mvp.rules.0.2.0',
  'mvp.prompts.0.2.0',
  'en',
  '{"snapshotIds":["00000000-0000-4000-8000-000000000701"]}'::jsonb,
  repeat('4', 64),
  '{"overall":"complete"}'::jsonb
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
  1,
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
  id, workspace_id, project_id, source_finding_id, action_key, template_id,
  title, description, content_locale, priority_band, roadmap_lane, status,
  effort, risk, expected_outcome, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
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
  ) IS DISTINCT FROM '2026-07-18' THEN
    RAISE EXCEPTION 'async run contract-version default is stale';
  END IF;
  IF (
    SELECT migration_version FROM app.schema_migration_version
  ) IS DISTINCT FROM '0009_async_run_contract_version' THEN
    RAISE EXCEPTION 'database migration version projection is stale';
  END IF;
END;
$$;

ROLLBACK;
