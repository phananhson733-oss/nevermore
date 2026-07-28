BEGIN;

-- Project-level customer choice. V1 intentionally supports one real cadence:
-- calendar-month collection. GET never inserts this row.
CREATE TABLE app.competitor_monitor_settings (
  project_id uuid PRIMARY KEY
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  frequency text NOT NULL CHECK (frequency = 'monthly'),
  revision integer NOT NULL CHECK (revision BETWEEN 0 AND 2147483647),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

-- One monitor attempt is still a normal DataForSEO CollectionRun. This typed
-- child freezes why the target is an approved competitor rather than the
-- customer's primary Site. It prevents competitor data from entering the
-- ordinary Keyword Library projection.
CREATE TABLE app.competitor_monitor_runs (
  id uuid PRIMARY KEY
    REFERENCES app.collection_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  analysis_scopes text[] NOT NULL CHECK (
    cardinality(analysis_scopes) BETWEEN 1 AND 5
    AND analysis_scopes <@ ARRAY[
      'positioning',
      'product_capability',
      'keyword_gap',
      'content',
      'serp_visibility'
    ]::text[]
    AND (
      'content' = ANY(analysis_scopes)
      OR 'serp_visibility' = ANY(analysis_scopes)
    )
  ),
  settings_revision integer NOT NULL CHECK (settings_revision >= 0),
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  target_domain text NOT NULL
    CHECK (app.is_normalized_competitor_domain(target_domain)),
  market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
  language_tag text NOT NULL CHECK (
    length(language_tag) BETWEEN 1 AND 255
    AND language_tag = btrim(language_tag)
  ),
  scheduled_for timestamptz NOT NULL,
  previous_monitor_run_id uuid
    REFERENCES app.competitor_monitor_runs(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, competitor_id, scheduled_for),
  CHECK (
    (previous_monitor_run_id IS NULL) =
      (previous_snapshot_id IS NULL)
  ),
  CHECK (previous_monitor_run_id IS NULL OR previous_monitor_run_id <> id)
);

CREATE INDEX competitor_monitor_runs_competitor_created_idx
  ON app.competitor_monitor_runs(
    workspace_id,
    project_id,
    competitor_id,
    created_at DESC,
    id DESC
  );

-- Exactly one immutable evaluation can follow a completed/partial canonical
-- collection. Even an unavailable comparison names the current real Snapshot;
-- it never represents a missing rank as zero.
CREATE TABLE app.competitor_monitor_evaluations (
  monitor_run_id uuid PRIMARY KEY
    REFERENCES app.competitor_monitor_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  evaluation_state text NOT NULL CHECK (
    evaluation_state IN ('baseline','available','unavailable')
  ),
  result_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, monitor_run_id),
  CHECK (
    (
      evaluation_state = 'available'
      AND previous_snapshot_id IS NOT NULL
    )
    OR (
      evaluation_state = 'baseline'
      AND previous_snapshot_id IS NULL
      AND limitation IS NOT NULL
    )
    OR (
      evaluation_state = 'unavailable'
      AND limitation IS NOT NULL
    )
  )
);

CREATE INDEX competitor_monitor_evaluations_competitor_time_idx
  ON app.competitor_monitor_evaluations(
    workspace_id,
    project_id,
    competitor_id,
    evaluated_at DESC,
    monitor_run_id DESC
  );

-- Signals are evidence for an existing Growth Map competitor-library
-- opportunity update. They are not a new product module and do not silently
-- create/approve an Action.
CREATE TABLE app.competitor_monitor_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  monitor_run_id uuid NOT NULL
    REFERENCES app.competitor_monitor_evaluations(monitor_run_id)
      ON DELETE RESTRICT,
  signal_kind text NOT NULL CHECK (
    signal_kind IN ('new_content_overlap','rank_gain')
  ),
  topic_node_id uuid NOT NULL
    REFERENCES app.topic_node_identities(id) ON DELETE RESTRICT,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  keyword_entity_id uuid
    REFERENCES app.keyword_entities(id) ON DELETE RESTRICT,
  content_url text,
  matched_keyword_ids uuid[],
  overlap_ratio numeric,
  publication_evidence text,
  previous_rank numeric,
  current_rank numeric,
  improvement numeric,
  previous_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  current_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  detected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_snapshot_id <> current_snapshot_id),
  CHECK (
    (
      signal_kind = 'rank_gain'
      AND keyword_entity_id IS NOT NULL
      AND content_url IS NULL
      AND matched_keyword_ids IS NULL
      AND overlap_ratio IS NULL
      AND publication_evidence IS NULL
      AND previous_rank > 0
      AND current_rank > 0
      AND improvement = previous_rank - current_rank
      AND improvement > 5
    )
    OR (
      signal_kind = 'new_content_overlap'
      AND keyword_entity_id IS NULL
      AND content_url IS NOT NULL
      AND length(content_url) BETWEEN 1 AND 2048
      AND matched_keyword_ids IS NOT NULL
      AND cardinality(matched_keyword_ids) >= 2
      AND overlap_ratio >= 0.5
      AND overlap_ratio <= 1
      AND publication_evidence = 'first_observed_in_ranked_keywords'
      AND previous_rank IS NULL
      AND current_rank IS NULL
      AND improvement IS NULL
      AND limitation IS NOT NULL
    )
  )
);

CREATE INDEX competitor_monitor_signals_competitor_time_idx
  ON app.competitor_monitor_signals(
    workspace_id,
    project_id,
    competitor_id,
    detected_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX competitor_monitor_signals_rank_unique_idx
  ON app.competitor_monitor_signals(
    project_id,
    monitor_run_id,
    topic_node_id,
    keyword_entity_id
  )
  WHERE signal_kind = 'rank_gain';

CREATE UNIQUE INDEX competitor_monitor_signals_content_unique_idx
  ON app.competitor_monitor_signals(
    project_id,
    monitor_run_id,
    topic_node_id,
    content_url
  )
  WHERE signal_kind = 'new_content_overlap';

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_run_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competitor app.competitor_entities%ROWTYPE;
  setting app.competitor_monitor_settings%ROWTYPE;
  collection app.collection_runs%ROWTYPE;
  run app.async_runs%ROWTYPE;
  topic app.topic_model_revisions%ROWTYPE;
  primary_site app.sites%ROWTYPE;
  source app.source_connections%ROWTYPE;
  latest_confirmed_revision integer;
  latest_evaluation app.competitor_monitor_evaluations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'competitor-monitor:' ||
        NEW.workspace_id::text || ':' || NEW.project_id::text || ':' ||
        NEW.competitor_id::text,
      0
    )
  );

  SELECT * INTO competitor
  FROM app.competitor_entities
  WHERE id = NEW.competitor_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR UPDATE;
  IF competitor.id IS NULL
     OR competitor.review_status IS DISTINCT FROM 'approved'
     OR competitor.relationship IS NULL
     OR NEW.analysis_scopes IS DISTINCT FROM competitor.analysis_scope
     OR NOT (
       'content' = ANY(competitor.analysis_scope)
       OR 'serp_visibility' = ANY(competitor.analysis_scope)
     ) THEN
    RAISE EXCEPTION 'competitor monitor requires an approved competitor and explicit content or serp_visibility scope'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.target_domain IS DISTINCT FROM
     regexp_replace(competitor.domain, '^www\.', '') THEN
    RAISE EXCEPTION 'competitor monitor target does not match approved competitor'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO setting
  FROM app.competitor_monitor_settings
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR UPDATE;
  IF setting.project_id IS NULL
     OR setting.enabled IS DISTINCT FROM true
     OR setting.frequency IS DISTINCT FROM 'monthly'
     OR setting.revision IS DISTINCT FROM NEW.settings_revision THEN
    RAISE EXCEPTION 'competitor monitor settings are missing, disabled, or stale'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO primary_site
  FROM app.sites
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND is_primary
  FOR UPDATE;
  IF primary_site.id IS NULL
     OR cardinality(primary_site.market_codes) IS DISTINCT FROM 1
     OR cardinality(primary_site.language_codes) IS DISTINCT FROM 1
     OR primary_site.market_codes[1] IS DISTINCT FROM NEW.market
     OR primary_site.language_codes[1] IS DISTINCT FROM NEW.language_tag THEN
    RAISE EXCEPTION 'competitor monitor requires one exact market and language'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(revision) INTO latest_confirmed_revision
  FROM app.topic_model_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND status = 'confirmed';
  SELECT * INTO topic
  FROM app.topic_model_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND revision = NEW.topic_model_revision;
  IF topic.id IS NULL
     OR topic.status IS DISTINCT FROM 'confirmed'
     OR latest_confirmed_revision IS DISTINCT FROM NEW.topic_model_revision THEN
    RAISE EXCEPTION 'competitor monitor requires the latest confirmed Topic model'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO collection
  FROM app.collection_runs
  WHERE id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  SELECT * INTO run
  FROM app.async_runs
  WHERE id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  IF collection.id IS NULL
     OR collection.site_id IS DISTINCT FROM primary_site.id
     OR collection.provider IS DISTINCT FROM 'dataforseo'
     OR collection.operation IS DISTINCT FROM 'keyword_gap_import'
     OR collection.method_version IS DISTINCT FROM 'dataforseo.ranked_keywords.v1'
     OR collection.source_connection_id IS NULL
     OR run.id IS NULL
     OR run.kind IS DISTINCT FROM 'collection'
     OR run.status IS DISTINCT FROM 'queued'
     OR run.active_key IS DISTINCT FROM
       ('monitor:competitor:' || NEW.competitor_id::text)
     OR run.request_payload ->> 'provider' IS DISTINCT FROM 'dataforseo'
     OR run.request_payload ->> 'operation' IS DISTINCT FROM
       'keyword_gap_import'
     OR run.request_payload #>> '{collectionScope,target}' IS DISTINCT FROM
       NEW.target_domain
     OR run.request_payload #>> '{collectionScope,marketCode}' IS DISTINCT FROM
       NEW.market
     OR run.request_payload #>> '{collectionScope,languageTag}' IS DISTINCT FROM
       NEW.language_tag THEN
    RAISE EXCEPTION 'competitor monitor CollectionRun lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO source
  FROM app.source_connections
  WHERE id = collection.source_connection_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  IF source.id IS NULL
     OR source.provider IS DISTINCT FROM 'dataforseo'
     OR source.site_id IS DISTINCT FROM primary_site.id
     OR source.state IS DISTINCT FROM 'connected'
     OR source.disconnected_at IS NOT NULL THEN
    RAISE EXCEPTION 'competitor monitor DataForSEO source is unavailable'
      USING ERRCODE = '23514';
  END IF;

  SELECT evaluation.* INTO latest_evaluation
  FROM app.competitor_monitor_evaluations evaluation
  WHERE evaluation.workspace_id = NEW.workspace_id
    AND evaluation.project_id = NEW.project_id
    AND evaluation.competitor_id = NEW.competitor_id
  ORDER BY evaluation.evaluated_at DESC, evaluation.monitor_run_id DESC
  LIMIT 1;
  IF (
    latest_evaluation.monitor_run_id IS NULL
    AND (
      NEW.previous_monitor_run_id IS NOT NULL
      OR NEW.previous_snapshot_id IS NOT NULL
    )
  ) OR (
    latest_evaluation.monitor_run_id IS NOT NULL
    AND (
      NEW.previous_monitor_run_id IS DISTINCT FROM
        latest_evaluation.monitor_run_id
      OR NEW.previous_snapshot_id IS DISTINCT FROM
        latest_evaluation.result_snapshot_id
    )
  ) THEN
    RAISE EXCEPTION 'competitor monitor previous collection is stale'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_runs_insert_guard
  BEFORE INSERT ON app.competitor_monitor_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_run_insert();

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_evaluation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  monitor app.competitor_monitor_runs%ROWTYPE;
  snapshot app.data_snapshots%ROWTYPE;
  previous_snapshot app.data_snapshots%ROWTYPE;
  run app.async_runs%ROWTYPE;
BEGIN
  SELECT * INTO monitor
  FROM app.competitor_monitor_runs
  WHERE id = NEW.monitor_run_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND competitor_id = NEW.competitor_id;
  SELECT * INTO snapshot
  FROM app.data_snapshots
  WHERE id = NEW.result_snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND collection_run_id = NEW.monitor_run_id;
  SELECT * INTO run FROM app.async_runs WHERE id = NEW.monitor_run_id;
  IF NEW.previous_snapshot_id IS NOT NULL THEN
    SELECT * INTO previous_snapshot
    FROM app.data_snapshots
    WHERE id = NEW.previous_snapshot_id
      AND workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id;
  END IF;
  IF monitor.id IS NULL
     OR snapshot.id IS NULL
     OR snapshot.provider IS DISTINCT FROM 'dataforseo'
     OR snapshot.dataset_key IS DISTINCT FROM
       'dataforseo.ranked_keywords.v1'
     OR snapshot.availability NOT IN ('available','partial','unavailable')
     OR (
       snapshot.availability = 'unavailable'
       AND NEW.evaluation_state IS DISTINCT FROM 'unavailable'
     )
     OR run.status IS DISTINCT FROM 'running'
     OR NEW.previous_snapshot_id IS DISTINCT FROM
       monitor.previous_snapshot_id
     OR (
       NEW.evaluation_state = 'available'
       AND (
         previous_snapshot.id IS NULL
         OR previous_snapshot.provider IS DISTINCT FROM 'dataforseo'
         OR previous_snapshot.dataset_key IS DISTINCT FROM
           'dataforseo.ranked_keywords.v1'
         OR previous_snapshot.availability NOT IN ('available','partial')
         OR snapshot.captured_at - previous_snapshot.captured_at <
           interval '21 days'
         OR snapshot.captured_at - previous_snapshot.captured_at >
           interval '45 days'
       )
     ) THEN
    RAISE EXCEPTION 'competitor monitor evaluation lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_evaluations_insert_guard
  BEFORE INSERT ON app.competitor_monitor_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_evaluation_insert();

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_signal_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  monitor app.competitor_monitor_runs%ROWTYPE;
  evaluation app.competitor_monitor_evaluations%ROWTYPE;
  topic app.topic_node_revisions%ROWTYPE;
  keyword_row app.keyword_entities%ROWTYPE;
  current_snapshot app.data_snapshots%ROWTYPE;
  previous_snapshot app.data_snapshots%ROWTYPE;
  matched_keyword_count integer;
BEGIN
  SELECT * INTO monitor FROM app.competitor_monitor_runs
  WHERE id = NEW.monitor_run_id;
  SELECT * INTO evaluation FROM app.competitor_monitor_evaluations
  WHERE monitor_run_id = NEW.monitor_run_id;
  SELECT * INTO topic FROM app.topic_node_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND topic_node_id = NEW.topic_node_id
    AND topic_model_revision = NEW.topic_model_revision
    AND lifecycle_state = 'active';
  SELECT * INTO current_snapshot FROM app.data_snapshots
  WHERE id = NEW.current_snapshot_id;
  SELECT * INTO previous_snapshot FROM app.data_snapshots
  WHERE id = NEW.previous_snapshot_id;
  IF NEW.keyword_entity_id IS NOT NULL THEN
    SELECT * INTO keyword_row FROM app.keyword_entities
    WHERE id = NEW.keyword_entity_id
      AND workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id;
  END IF;
  IF NEW.matched_keyword_ids IS NOT NULL THEN
    SELECT count(DISTINCT matched.id)::integer
    INTO matched_keyword_count
    FROM unnest(NEW.matched_keyword_ids) matched(id);
  END IF;
  IF monitor.id IS NULL
     OR evaluation.monitor_run_id IS NULL
     OR evaluation.evaluation_state IS DISTINCT FROM 'available'
     OR monitor.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR monitor.project_id IS DISTINCT FROM NEW.project_id
     OR monitor.competitor_id IS DISTINCT FROM NEW.competitor_id
     OR monitor.topic_model_revision IS DISTINCT FROM
       NEW.topic_model_revision
     OR evaluation.result_snapshot_id IS DISTINCT FROM
       NEW.current_snapshot_id
     OR evaluation.previous_snapshot_id IS DISTINCT FROM
       NEW.previous_snapshot_id
     OR topic.id IS NULL
     OR (
       NEW.signal_kind = 'rank_gain'
       AND (
         NOT ('serp_visibility' = ANY(monitor.analysis_scopes))
         OR keyword_row.id IS NULL
         OR keyword_row.market IS DISTINCT FROM monitor.market
         OR keyword_row.language_tag IS DISTINCT FROM monitor.language_tag
         OR NOT EXISTS (
           SELECT 1
           FROM app.keyword_review_decisions decision
           WHERE decision.workspace_id = NEW.workspace_id
             AND decision.project_id = NEW.project_id
             AND decision.keyword_entity_id = NEW.keyword_entity_id
             AND decision.governance_revision =
               keyword_row.mapping_revision
             AND decision.review_state = 'confirmed'
             AND decision.assignment_invalidated_by IS NULL
             AND decision.topic_model_revision =
               NEW.topic_model_revision
             AND decision.topic_node_id = NEW.topic_node_id
         )
       )
     )
     OR (
       NEW.signal_kind = 'new_content_overlap'
       AND (
         NOT ('content' = ANY(monitor.analysis_scopes))
         OR current_snapshot.availability IS DISTINCT FROM 'available'
         OR previous_snapshot.availability IS DISTINCT FROM 'available'
         OR matched_keyword_count IS DISTINCT FROM
           cardinality(NEW.matched_keyword_ids)
         OR EXISTS (
           SELECT 1
           FROM unnest(NEW.matched_keyword_ids) matched(id)
           WHERE NOT EXISTS (
             SELECT 1
             FROM app.keyword_entities matched_keyword
             INNER JOIN app.keyword_review_decisions decision
               ON decision.workspace_id =
                    matched_keyword.workspace_id
              AND decision.project_id = matched_keyword.project_id
              AND decision.keyword_entity_id = matched_keyword.id
              AND decision.governance_revision =
                    matched_keyword.mapping_revision
              AND decision.review_state = 'confirmed'
              AND decision.assignment_invalidated_by IS NULL
              AND decision.topic_model_revision =
                    NEW.topic_model_revision
              AND decision.topic_node_id = NEW.topic_node_id
             WHERE matched_keyword.id = matched.id
               AND matched_keyword.workspace_id = NEW.workspace_id
               AND matched_keyword.project_id = NEW.project_id
               AND matched_keyword.market = monitor.market
               AND matched_keyword.language_tag =
                    monitor.language_tag
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'competitor monitor signal lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_signals_insert_guard
  BEFORE INSERT ON app.competitor_monitor_signals
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_signal_insert();

CREATE TRIGGER competitor_monitor_runs_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER competitor_monitor_evaluations_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER competitor_monitor_signals_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_signals
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0027_competitor_dynamic_monitor'::text AS migration_version;

COMMIT;
