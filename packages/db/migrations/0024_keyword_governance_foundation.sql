BEGIN;

-- This unpublished migration intentionally follows 0023_measurement_windows.
-- It keeps the current governed Keyword/Competitor projection gate unchanged
-- and remains the Task 4 ordinal for the Topic/Review foundation extensions
-- that will be assembled before this branch is merged.
--
-- 0.2.2 keeps every historical deterministic rule-set replayable while making
-- the governed Keyword/Competitor projection part of each new current run.
ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check;

ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (
    rule_set_version IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    )
  );

-- Historical 0.2.0 rows remain outside the current-manifest gate. New 0.2.1
-- rows retain their exact prior contract; new 0.2.2 rows additionally freeze
-- the strict top-level GovernanceProjectionV1 envelope. The application and
-- pure engine validate its nested canonical facts before persistence/replay.
CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
  governance jsonb;
BEGIN
  IF NEW.rule_set_version NOT IN (
    'mvp.rules.0.2.1',
    'mvp.rules.0.2.2'
  ) THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.input_manifest -> 'snapshots') <> 'array'
     OR jsonb_typeof(NEW.input_manifest -> 'icp') <> 'object'
     OR NEW.input_manifest ->> 'projectId' <> NEW.project_id::text
     OR NEW.input_manifest ->> 'siteId' <> NEW.site_id::text
     OR NEW.input_manifest ->> 'ruleSetVersion' <> NEW.rule_set_version
     OR NEW.input_manifest ->> 'promptSetVersion' <> NEW.prompt_set_version
     OR NEW.input_manifest ->> 'deliveryLocale' <> NEW.output_locale
     OR NEW.input_manifest #>> '{icp,id}' <> NEW.icp_profile_id::text
     OR (NEW.input_manifest #>> '{icp,version}')::integer <> NEW.icp_profile_version
     OR NOT EXISTS (
       SELECT 1
       FROM app.icp_profiles icp
       WHERE icp.id = NEW.icp_profile_id
         AND icp.workspace_id = NEW.workspace_id
         AND icp.project_id = NEW.project_id
         AND icp.version = NEW.icp_profile_version
         AND icp.status = 'complete'
         AND icp.content_hash = NEW.input_manifest #>> '{icp,contentHash}'
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest does not match its frozen run and ICP'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.rule_set_version = 'mvp.rules.0.2.2' THEN
    governance := NEW.input_manifest -> 'governance';
    IF jsonb_typeof(NEW.input_manifest -> 'governance')
         IS DISTINCT FROM 'object'
       OR governance ->> 'projectionVersion'
         IS DISTINCT FROM 'growth-governance.1.0.0'
       OR jsonb_typeof(governance -> 'keywordClusters')
         IS DISTINCT FROM 'array'
       OR jsonb_typeof(governance -> 'competitors')
         IS DISTINCT FROM 'array'
       OR (
         governance
           - ARRAY['projectionVersion', 'keywordClusters', 'competitors']
       ) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'current diagnostic manifest governance projection is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  snapshot_count := jsonb_array_length(NEW.input_manifest -> 'snapshots');
  SELECT
    count(*),
    count(DISTINCT entry ->> 'snapshotId'),
    count(DISTINCT entry ->> 'provider')
  INTO matched_snapshot_count, distinct_snapshot_count, distinct_provider_count
  FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
  JOIN app.data_snapshots snapshot
    ON snapshot.id = (entry ->> 'snapshotId')::uuid
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
   AND snapshot.site_id = NEW.site_id
   AND snapshot.provider = entry ->> 'provider'
   AND snapshot.dataset_key = entry ->> 'datasetKey'
   AND snapshot.schema_version = entry ->> 'schemaVersion'
   AND snapshot.method_version = entry ->> 'methodVersion'
   AND snapshot.checksum = entry ->> 'checksum'
   AND snapshot.availability = entry ->> 'availability'
   AND snapshot.source_window = entry -> 'sourceWindow'
   AND snapshot.captured_at = (entry ->> 'capturedAt')::timestamptz;

  IF snapshot_count = 0
     OR matched_snapshot_count <> snapshot_count
     OR distinct_snapshot_count <> snapshot_count
     OR distinct_provider_count <> snapshot_count
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
       WHERE entry ->> 'provider' = 'crawl'
         AND entry ->> 'methodVersion' = 'crawl.site_graph.v2'
         AND entry ->> 'availability' IN ('available','partial')
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest snapshot selection is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Only CONTENT-GAP-011 changes in 0.2.2. The three exact-URL technical rules
-- keep v2 from 0.2.1; all other registered rules stay at v1.
CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(
  selected_rule_set text,
  selected_rule_id text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN selected_rule_id NOT IN (
      'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005',
      'SEARCH-CTR-004','SEARCH-DECAY-002','CONTENT-COVERAGE-001',
      'CONTENT-GAP-011','CRO-PATH-001','CRO-LANDING-003',
      'GEO-ENTITY-001','GEO-CRAWLER-002'
    ) THEN NULL
    WHEN selected_rule_set = 'mvp.rules.0.2.2'
      AND selected_rule_id = 'CONTENT-GAP-011' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    )
      AND selected_rule_id IN (
        'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005'
      ) THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    ) THEN 1
    ELSE NULL
  END
$$;

-- Stable Topic identity and Keyword Review authority are scoped by both
-- workspace and project. The legacy tables predate composite foreign keys, so
-- expose their already-true scope identities before the new ledgers reference
-- them. The primary ids remain globally unique; these constraints add no new
-- merge or dedupe behavior.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_projects_workspace_project_key'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_workspace_project_key
      UNIQUE (workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'site_pages_workspace_project_id_key'
      AND conrelid = 'app.site_pages'::regclass
  ) THEN
    ALTER TABLE app.site_pages
      ADD CONSTRAINT site_pages_workspace_project_id_key
      UNIQUE (workspace_id, project_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'keyword_entities_workspace_project_id_key'
      AND conrelid = 'app.keyword_entities'::regclass
  ) THEN
    ALTER TABLE app.keyword_entities
      ADD CONSTRAINT keyword_entities_workspace_project_id_key
      UNIQUE (workspace_id, project_id, id);
  END IF;
END;
$$;

-- A Topic Model revision is the project-scoped envelope for one complete Topic
-- projection. Confirmation creates a new immutable revision; it never mutates
-- a previously confirmed row. root_topic_node_id stays nullable while a model
-- is drafted; the deferred confirmation guard below still requires a node.
CREATE TABLE IF NOT EXISTS app.topic_model_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  edit_revision integer NOT NULL DEFAULT 0 CHECK (edit_revision >= 0),
  status text NOT NULL
    CHECK (status IN ('draft','confirmed')),
  root_topic_node_id uuid,
  generation_basis jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(generation_basis) = 'object'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_refs) = 'array'),
  content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  CHECK (
    (
      status = 'draft'
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
      AND content_hash IS NULL
    )
    OR (
      status = 'confirmed'
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= created_at
      AND content_hash IS NOT NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, revision),
  UNIQUE (workspace_id, project_id, id)
);

ALTER TABLE app.topic_model_revisions
  ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'topic_model_revisions_edit_revision_check'
      AND conrelid = 'app.topic_model_revisions'::regclass
  ) THEN
    ALTER TABLE app.topic_model_revisions
      ADD CONSTRAINT topic_model_revisions_edit_revision_check
      CHECK (edit_revision >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS topic_model_revisions_project_created_idx
  ON app.topic_model_revisions(
    workspace_id,
    project_id,
    revision DESC,
    created_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS topic_model_revisions_one_draft_idx
  ON app.topic_model_revisions(workspace_id, project_id)
  WHERE status = 'draft';

-- One UUID is the durable Topic Node identity across renames. Split and merge
-- operations create new identities and use topic_node_successors below; they
-- never recycle this id or rewrite the original legacy label.
CREATE TABLE IF NOT EXISTS app.topic_node_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  created_in_revision integer NOT NULL CHECK (created_in_revision >= 1),
  initial_cluster_key text NOT NULL CHECK (
    length(initial_cluster_key) BETWEEN 1 AND 200
    AND initial_cluster_key = btrim(initial_cluster_key)
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, created_in_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, initial_cluster_key),
  UNIQUE (workspace_id, project_id, id)
);

-- Labels, hierarchy, intent and lifecycle belong to a model revision, not the
-- stable identity. The composite uniqueness is also the exact historical
-- assignment target used by Keyword Review decisions.
CREATE TABLE IF NOT EXISTS app.topic_node_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  topic_node_id uuid NOT NULL,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  parent_topic_node_id uuid,
  label text NOT NULL CHECK (
    length(label) BETWEEN 1 AND 200
    AND label = btrim(label)
  ),
  description text CHECK (
    description IS NULL
    OR (
      length(description) BETWEEN 1 AND 2000
      AND description = btrim(description)
    )
  ),
  intent_envelope jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(intent_envelope) = 'array'),
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active','superseded')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    parent_topic_node_id IS NULL
    OR parent_topic_node_id <> topic_node_id
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_node_id)
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    parent_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'topic_model_revisions_root_node_fk'
      AND conrelid = 'app.topic_model_revisions'::regclass
  ) THEN
    ALTER TABLE app.topic_model_revisions
      ADD CONSTRAINT topic_model_revisions_root_node_fk
      FOREIGN KEY (
        workspace_id,
        project_id,
        root_topic_node_id,
        revision
      )
      REFERENCES app.topic_node_revisions(
        workspace_id,
        project_id,
        topic_node_id,
        topic_model_revision
      )
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS topic_node_revisions_project_model_idx
  ON app.topic_node_revisions(
    workspace_id,
    project_id,
    topic_model_revision DESC,
    label,
    topic_node_id
  );

-- Historical cluster labels are durable resolution records. Closing a current
-- alias sets its upper revision but never deletes or rewrites the row, so frozen
-- Finding/Opportunity/Content Shadow labels remain resolvable.
CREATE TABLE IF NOT EXISTS app.topic_cluster_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  topic_node_id uuid NOT NULL,
  legacy_cluster_key text NOT NULL CHECK (
    length(legacy_cluster_key) BETWEEN 1 AND 200
    AND legacy_cluster_key = btrim(legacy_cluster_key)
  ),
  valid_from_revision integer NOT NULL CHECK (valid_from_revision >= 1),
  valid_to_revision integer,
  alias_kind text NOT NULL
    CHECK (alias_kind IN ('legacy','canonical','rename')),
  is_current boolean NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    valid_to_revision IS NULL
    OR valid_to_revision >= valid_from_revision
  ),
  CHECK (
    (is_current AND valid_to_revision IS NULL)
    OR (NOT is_current AND valid_to_revision IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_node_id)
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, valid_from_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    topic_node_id,
    valid_from_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, valid_to_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    legacy_cluster_key,
    valid_from_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS topic_cluster_aliases_current_label_idx
  ON app.topic_cluster_aliases(
    workspace_id,
    project_id,
    legacy_cluster_key
  )
  WHERE is_current;

CREATE INDEX IF NOT EXISTS topic_cluster_aliases_node_history_idx
  ON app.topic_cluster_aliases(
    workspace_id,
    project_id,
    topic_node_id,
    valid_from_revision DESC
  );

-- Successor edges explain split/merge navigation only. They do not rewrite
-- historical evidence or silently transfer Keyword Review authority.
CREATE TABLE IF NOT EXISTS app.topic_node_successors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  predecessor_topic_node_id uuid NOT NULL,
  successor_topic_node_id uuid NOT NULL,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  successor_kind text NOT NULL
    CHECK (successor_kind IN ('split_into','merged_into')),
  created_by uuid NOT NULL,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 4000
    AND reason = btrim(reason)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_topic_node_id <> successor_topic_node_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    predecessor_topic_node_id
  )
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    successor_topic_node_id
  )
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    successor_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    successor_topic_node_id,
    topic_model_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS topic_node_successors_predecessor_idx
  ON app.topic_node_successors(
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    topic_model_revision DESC
  );

CREATE INDEX IF NOT EXISTS topic_node_successors_successor_idx
  ON app.topic_node_successors(
    workspace_id,
    project_id,
    successor_topic_node_id,
    topic_model_revision DESC
  );

-- One append-only decision freezes the complete row governed by the legacy
-- reviewAndMap command. governance_revision deliberately starts at the current
-- mapping_revision during migration; missing intermediate history is recorded,
-- never reconstructed.
CREATE TABLE IF NOT EXISTS app.keyword_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  keyword_entity_id uuid NOT NULL,
  governance_revision integer NOT NULL CHECK (governance_revision >= 0),
  decision_origin text NOT NULL CHECK (
    decision_origin IN ('migration_baseline','user','system_suggestion')
  ),
  status text NOT NULL
    CHECK (status IN ('candidate','approved','excluded','parked')),
  intent text CHECK (
    intent IS NULL
    OR (
      length(intent) BETWEEN 1 AND 100
      AND intent = btrim(intent)
    )
  ),
  buyer_stage text CHECK (
    buyer_stage IS NULL
    OR (
      length(buyer_stage) BETWEEN 1 AND 100
      AND buyer_stage = btrim(buyer_stage)
    )
  ),
  topic_node_id uuid,
  topic_model_revision integer CHECK (
    topic_model_revision IS NULL OR topic_model_revision >= 1
  ),
  cluster_key_at_decision text CHECK (
    cluster_key_at_decision IS NULL
    OR (
      length(cluster_key_at_decision) BETWEEN 1 AND 200
      AND cluster_key_at_decision = btrim(cluster_key_at_decision)
    )
  ),
  mapping_decision text NOT NULL
    CHECK (mapping_decision IN ('unassigned','existing_page','new_asset')),
  mapped_site_page_id uuid,
  review_state text NOT NULL
    CHECK (review_state IN ('unreviewed','confirmed')),
  assignment_invalidated_by text CHECK (
    assignment_invalidated_by IS NULL
    OR assignment_invalidated_by IN (
      'topic_split',
      'topic_merge',
      'topic_retire'
    )
  ),
  decided_by uuid,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 4000
    AND reason = btrim(reason)
  ),
  decided_at timestamptz NOT NULL,
  reviewed_projection jsonb NOT NULL
    CHECK (jsonb_typeof(reviewed_projection) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (topic_node_id IS NULL) = (topic_model_revision IS NULL)
  ),
  CHECK (
    topic_node_id IS NULL OR cluster_key_at_decision IS NOT NULL
  ),
  CHECK (
    assignment_invalidated_by IS NULL OR review_state = 'unreviewed'
  ),
  CHECK (
    (mapping_decision = 'existing_page' AND mapped_site_page_id IS NOT NULL)
    OR (
      mapping_decision IN ('unassigned','new_asset')
      AND mapped_site_page_id IS NULL
    )
  ),
  CHECK (
    (decision_origin = 'migration_baseline' AND decided_by IS NULL)
    OR (decision_origin <> 'migration_baseline' AND decided_by IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_entity_id)
    REFERENCES app.keyword_entities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, mapped_site_page_id)
    REFERENCES app.site_pages(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    keyword_entity_id,
    governance_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS keyword_review_decisions_project_decided_idx
  ON app.keyword_review_decisions(
    workspace_id,
    project_id,
    decided_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS keyword_review_decisions_topic_idx
  ON app.keyword_review_decisions(
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision DESC
  )
  WHERE topic_node_id IS NOT NULL;

-- Only a reviewed, non-null legacy cluster can become canonical Topic truth.
-- Projects with only uncategorized or unreviewed keywords receive baseline
-- Keyword Review Decisions below but no fabricated empty confirmed model.
INSERT INTO app.topic_model_revisions (
  id,
  workspace_id,
  project_id,
  revision,
  status,
  root_topic_node_id,
  generation_basis,
  evidence_refs,
  content_hash,
  created_by
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  1,
  'draft',
  NULL,
  jsonb_build_object(
    'origin', 'migration_baseline',
    'source', 'reviewed keyword_entities.cluster_key',
    'projectionVersion', 'topic-model.1.0.0',
    'contentHashMethod', 'postgres-jsonb-sha256.migration-baseline.v1',
    'earlierHistoryAvailable', false
  ),
  '[]'::jsonb,
  NULL,
  project.created_by
FROM app.keyword_entities entity
JOIN app.client_projects project
  ON project.workspace_id = entity.workspace_id
 AND project.id = entity.project_id
WHERE entity.mapping_review_state = 'confirmed'
  AND entity.cluster_key IS NOT NULL
GROUP BY
  entity.workspace_id,
  entity.project_id,
  project.created_by
ON CONFLICT (workspace_id, project_id, revision) DO NOTHING;

-- Every distinct reviewed cluster label receives exactly one durable identity.
-- Repeated reviewed keywords converge; an unreviewed legacy label remains only
-- in its Keyword Review baseline snapshot.
INSERT INTO app.topic_node_identities (
  id,
  workspace_id,
  project_id,
  created_in_revision,
  initial_cluster_key,
  created_by
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  1,
  entity.cluster_key,
  project.created_by
FROM app.keyword_entities entity
JOIN app.client_projects project
  ON project.workspace_id = entity.workspace_id
 AND project.id = entity.project_id
WHERE entity.mapping_review_state = 'confirmed'
  AND entity.cluster_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_node_identities existing
    WHERE existing.workspace_id = entity.workspace_id
      AND existing.project_id = entity.project_id
      AND existing.initial_cluster_key = entity.cluster_key
  )
GROUP BY
  entity.workspace_id,
  entity.project_id,
  entity.cluster_key,
  project.created_by
ON CONFLICT (
  workspace_id,
  project_id,
  initial_cluster_key
) DO NOTHING;

INSERT INTO app.topic_node_revisions (
  id,
  workspace_id,
  project_id,
  topic_node_id,
  topic_model_revision,
  parent_topic_node_id,
  label,
  description,
  intent_envelope,
  lifecycle_state,
  created_by
)
SELECT
  gen_random_uuid(),
  identity.workspace_id,
  identity.project_id,
  identity.id,
  1,
  NULL,
  identity.initial_cluster_key,
  NULL,
  '[]'::jsonb,
  'active',
  identity.created_by
FROM app.topic_node_identities identity
WHERE identity.created_in_revision = 1
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_node_revisions existing
    WHERE existing.workspace_id = identity.workspace_id
      AND existing.project_id = identity.project_id
      AND existing.topic_node_id = identity.id
      AND existing.topic_model_revision = 1
  )
ON CONFLICT (
  workspace_id,
  project_id,
  topic_node_id,
  topic_model_revision
) DO NOTHING;

-- The migration baseline did not have a hierarchy. Choose one deterministic
-- reviewed Topic as the structural root and attach the remaining reviewed
-- Topics beneath it so the confirmed projection is one reachable tree rather
-- than an unrooted forest. This changes no Keyword-to-Topic assignment.
WITH baseline_roots AS (
  SELECT
    model.workspace_id,
    model.project_id,
    model.revision,
    min(node.topic_node_id::text)::uuid AS root_topic_node_id
  FROM app.topic_model_revisions model
  JOIN app.topic_node_revisions node
    ON node.workspace_id = model.workspace_id
   AND node.project_id = model.project_id
   AND node.topic_model_revision = model.revision
  WHERE model.status = 'draft'
    AND model.generation_basis ->> 'origin' = 'migration_baseline'
  GROUP BY model.workspace_id, model.project_id, model.revision
)
UPDATE app.topic_model_revisions model
SET
  root_topic_node_id = root.root_topic_node_id,
  updated_at = statement_timestamp()
FROM baseline_roots root
WHERE model.workspace_id = root.workspace_id
  AND model.project_id = root.project_id
  AND model.revision = root.revision;

WITH baseline_roots AS (
  SELECT
    workspace_id,
    project_id,
    revision,
    root_topic_node_id
  FROM app.topic_model_revisions
  WHERE status = 'draft'
    AND generation_basis ->> 'origin' = 'migration_baseline'
)
UPDATE app.topic_node_revisions node
SET parent_topic_node_id = root.root_topic_node_id
FROM baseline_roots root
WHERE node.workspace_id = root.workspace_id
  AND node.project_id = root.project_id
  AND node.topic_model_revision = root.revision
  AND node.topic_node_id <> root.root_topic_node_id
  AND node.parent_topic_node_id IS NULL;

INSERT INTO app.topic_cluster_aliases (
  id,
  workspace_id,
  project_id,
  topic_node_id,
  legacy_cluster_key,
  valid_from_revision,
  valid_to_revision,
  alias_kind,
  is_current,
  created_by
)
SELECT
  gen_random_uuid(),
  identity.workspace_id,
  identity.project_id,
  identity.id,
  identity.initial_cluster_key,
  1,
  NULL,
  'legacy',
  true,
  identity.created_by
FROM app.topic_node_identities identity
WHERE identity.created_in_revision = 1
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_cluster_aliases existing
    WHERE existing.workspace_id = identity.workspace_id
      AND existing.project_id = identity.project_id
      AND existing.legacy_cluster_key = identity.initial_cluster_key
      AND existing.valid_from_revision = 1
  )
ON CONFLICT (
  workspace_id,
  project_id,
  legacy_cluster_key,
  valid_from_revision
) DO NOTHING;

-- Confirmation freezes the just-created baseline topology. PostgreSQL does not
-- implement the application JCS helper, so the migration records an explicit
-- versioned hash method and hashes its complete jsonb projection: model facts,
-- root, nodes, aliases and successor relationships. No two different baseline
-- topologies can share bytes merely because their node labels match.
WITH baseline_projection AS (
  SELECT
    model.workspace_id,
    model.project_id,
    model.revision,
    jsonb_build_object(
      'projectId', model.project_id,
      'topicModelRevision', model.revision,
      'state', 'confirmed',
      'rootTopicNodeId', model.root_topic_node_id,
      'generationBasis', model.generation_basis,
      'evidenceRefs', model.evidence_refs,
      'createdAt', model.created_at,
      'createdBy', model.created_by,
      'nodes', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'topicNodeId', node.topic_node_id,
              'parentTopicNodeId', node.parent_topic_node_id,
              'label', node.label,
              'description', node.description,
              'intentEnvelope', node.intent_envelope,
              'lifecycleState', node.lifecycle_state
            )
            ORDER BY node.topic_node_id
          )
          FROM app.topic_node_revisions node
          WHERE node.workspace_id = model.workspace_id
            AND node.project_id = model.project_id
            AND node.topic_model_revision = model.revision
        ),
        '[]'::jsonb
      ),
      'aliases', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'aliasId', alias.id,
              'topicNodeId', alias.topic_node_id,
              'clusterKey', alias.legacy_cluster_key,
              'validFromTopicModelRevision', alias.valid_from_revision,
              'validThroughTopicModelRevision', alias.valid_to_revision,
              'isCurrent', alias.is_current
            )
            ORDER BY
              alias.legacy_cluster_key,
              alias.valid_from_revision,
              alias.id
          )
          FROM app.topic_cluster_aliases alias
          WHERE alias.workspace_id = model.workspace_id
            AND alias.project_id = model.project_id
            AND alias.valid_from_revision <= model.revision
            AND (
              alias.valid_to_revision IS NULL
              OR alias.valid_to_revision >= model.revision
            )
        ),
        '[]'::jsonb
      ),
      'successorRelationships', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'kind', successor.successor_kind,
              'sourceTopicNodeId',
                successor.predecessor_topic_node_id,
              'successorTopicNodeId',
                successor.successor_topic_node_id,
              'topicModelRevision', successor.topic_model_revision
            )
            ORDER BY
              successor.predecessor_topic_node_id,
              successor.successor_topic_node_id,
              successor.successor_kind
          )
          FROM app.topic_node_successors successor
          WHERE successor.workspace_id = model.workspace_id
            AND successor.project_id = model.project_id
            AND successor.topic_model_revision = model.revision
        ),
        '[]'::jsonb
      )
    ) AS projection
  FROM app.topic_model_revisions model
  WHERE model.revision = 1
    AND model.status = 'draft'
    AND model.generation_basis ->> 'origin' = 'migration_baseline'
)
UPDATE app.topic_model_revisions model
SET
  status = 'confirmed',
  content_hash = encode(
    digest(
      convert_to(baseline.projection::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  confirmed_by = model.created_by,
  confirmed_at = statement_timestamp()
FROM baseline_projection baseline
WHERE model.workspace_id = baseline.workspace_id
  AND model.project_id = baseline.project_id
  AND model.revision = baseline.revision;

-- Only the current legacy row can be recovered. A mapping_revision of seven
-- therefore yields one baseline Decision at revision seven, never seven
-- invented events.
INSERT INTO app.keyword_review_decisions (
  id,
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision,
  decision_origin,
  status,
  intent,
  buyer_stage,
  topic_node_id,
  topic_model_revision,
  cluster_key_at_decision,
  mapping_decision,
  mapped_site_page_id,
  review_state,
  assignment_invalidated_by,
  decided_by,
  reason,
  decided_at,
  reviewed_projection
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  entity.id,
  entity.mapping_revision,
  'migration_baseline',
  entity.status,
  entity.intent,
  entity.buyer_stage,
  identity.id,
  CASE WHEN identity.id IS NULL THEN NULL ELSE 1 END,
  entity.cluster_key,
  entity.mapping_decision,
  entity.mapped_site_page_id,
  entity.mapping_review_state,
  NULL,
  NULL,
  'Migration baseline; earlier Keyword Review history is unavailable.',
  statement_timestamp(),
  jsonb_build_object(
    'projectId', entity.project_id,
    'keywordId', entity.id,
    'status', entity.status,
    'intent', entity.intent,
    'buyerStage', entity.buyer_stage,
    'topicNodeId', identity.id,
    'topicModelRevision',
      CASE WHEN identity.id IS NULL THEN NULL ELSE 1 END,
    'clusterKey', entity.cluster_key,
    'mappingDecision', entity.mapping_decision,
    'mappedSitePageId', entity.mapped_site_page_id,
    'mappingReviewState', entity.mapping_review_state,
    'governanceRevision', entity.mapping_revision,
    'assignmentInvalidatedBy', NULL,
    'earlierHistoryAvailable', false
  )
FROM app.keyword_entities entity
LEFT JOIN app.topic_node_identities identity
  ON identity.workspace_id = entity.workspace_id
 AND identity.project_id = entity.project_id
 AND identity.initial_cluster_key = entity.cluster_key
 AND entity.mapping_review_state = 'confirmed'
WHERE NOT EXISTS (
  SELECT 1
  FROM app.keyword_review_decisions existing
  WHERE existing.workspace_id = entity.workspace_id
    AND existing.project_id = entity.project_id
    AND existing.keyword_entity_id = entity.id
    AND existing.governance_revision = entity.mapping_revision
)
ON CONFLICT (
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision
) DO NOTHING;

-- The retained JSON projection is an audit copy of the typed authority, not a
-- second free-form truth. Reject any insert whose full projection diverges.
CREATE OR REPLACE FUNCTION app.enforce_keyword_review_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  governed_keys text[] := ARRAY[
    'projectId',
    'keywordId',
    'governanceRevision',
    'status',
    'intent',
    'buyerStage',
    'topicNodeId',
    'topicModelRevision',
    'clusterKey',
    'mappingDecision',
    'mappedSitePageId',
    'mappingReviewState',
    'assignmentInvalidatedBy',
    'earlierHistoryAvailable'
  ];
BEGIN
  IF NOT (NEW.reviewed_projection ?& governed_keys)
     OR (
       NEW.reviewed_projection - governed_keys
     ) IS DISTINCT FROM '{}'::jsonb
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'projectId'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'keywordId'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'governanceRevision'),
       ''
     ) <> 'number'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'status'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'intent'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'buyerStage'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'topicNodeId'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'topicModelRevision'),
       ''
     ) NOT IN ('number','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'clusterKey'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappingDecision'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappedSitePageId'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappingReviewState'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(
         NEW.reviewed_projection -> 'assignmentInvalidatedBy'
       ),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(
         NEW.reviewed_projection -> 'earlierHistoryAvailable'
       ),
       ''
     ) <> 'boolean' THEN
    RAISE EXCEPTION 'Keyword Review projection shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reviewed_projection ->> 'projectId'
       IS DISTINCT FROM NEW.project_id::text
     OR NEW.reviewed_projection ->> 'keywordId'
       IS DISTINCT FROM NEW.keyword_entity_id::text
     OR NEW.reviewed_projection ->> 'status'
       IS DISTINCT FROM NEW.status
     OR NEW.reviewed_projection ->> 'intent'
       IS DISTINCT FROM NEW.intent
     OR NEW.reviewed_projection ->> 'buyerStage'
       IS DISTINCT FROM NEW.buyer_stage
     OR NEW.reviewed_projection ->> 'topicNodeId'
       IS DISTINCT FROM NEW.topic_node_id::text
     OR (NEW.reviewed_projection ->> 'topicModelRevision')::integer
       IS DISTINCT FROM NEW.topic_model_revision
     OR NEW.reviewed_projection ->> 'clusterKey'
       IS DISTINCT FROM NEW.cluster_key_at_decision
     OR NEW.reviewed_projection ->> 'mappingDecision'
       IS DISTINCT FROM NEW.mapping_decision
     OR NEW.reviewed_projection ->> 'mappedSitePageId'
       IS DISTINCT FROM NEW.mapped_site_page_id::text
     OR NEW.reviewed_projection ->> 'mappingReviewState'
       IS DISTINCT FROM NEW.review_state
     OR NEW.reviewed_projection ->> 'assignmentInvalidatedBy'
       IS DISTINCT FROM NEW.assignment_invalidated_by
     OR (NEW.reviewed_projection ->> 'governanceRevision')::integer
       IS DISTINCT FROM NEW.governance_revision THEN
    RAISE EXCEPTION 'Keyword Review projection diverges from typed authority'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.decision_origin = 'migration_baseline'
     AND (
       NEW.reviewed_projection ->> 'earlierHistoryAvailable'
         IS DISTINCT FROM 'false'
     ) THEN
    RAISE EXCEPTION 'migration baseline must disclose unavailable earlier history'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_review_decisions_projection_guard
  ON app.keyword_review_decisions;
CREATE TRIGGER keyword_review_decisions_projection_guard
  BEFORE INSERT ON app.keyword_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_review_projection();

-- A model has only the contract states draft/confirmed. Node supersession is a
-- Topic Node lifecycle value, not a mutable model state. A draft may be edited
-- and then confirmed once; after confirmation every model fact is immutable.
CREATE OR REPLACE FUNCTION app.enforce_topic_model_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'confirmed Topic Model revisions are immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topic Model revision identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed Topic Model revisions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.content_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Topic Model draft cannot carry confirmation facts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed'
     AND NEW.root_topic_node_id IS NOT DISTINCT FROM OLD.root_topic_node_id
     AND NEW.generation_basis IS NOT DISTINCT FROM OLD.generation_basis
     AND NEW.evidence_refs IS NOT DISTINCT FROM OLD.evidence_refs
     AND NEW.edit_revision IS NOT DISTINCT FROM OLD.edit_revision
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
     AND NEW.confirmed_by IS NOT NULL
     AND NEW.confirmed_at IS NOT NULL
     AND NEW.content_hash IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Topic Model confirmation may only freeze the draft'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION app.validate_confirmed_topic_model_topology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  node_count integer;
  reachable_count integer;
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NEW.root_topic_node_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.topic_node_revisions root
      WHERE root.workspace_id = NEW.workspace_id
        AND root.project_id = NEW.project_id
        AND root.topic_model_revision = NEW.revision
        AND root.topic_node_id = NEW.root_topic_node_id
        AND root.parent_topic_node_id IS NULL
        AND root.lifecycle_state = 'active'
    ) THEN
      RAISE EXCEPTION 'confirmed Topic Model must declare a parentless root'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO node_count
    FROM app.topic_node_revisions node
    WHERE node.workspace_id = NEW.workspace_id
      AND node.project_id = NEW.project_id
      AND node.topic_model_revision = NEW.revision;

    WITH RECURSIVE reachable(topic_node_id) AS (
      SELECT NEW.root_topic_node_id
      UNION
      SELECT child.topic_node_id
      FROM app.topic_node_revisions child
      JOIN reachable parent
        ON child.parent_topic_node_id = parent.topic_node_id
      WHERE child.workspace_id = NEW.workspace_id
        AND child.project_id = NEW.project_id
        AND child.topic_model_revision = NEW.revision
    )
    SELECT count(*)
    INTO reachable_count
    FROM reachable;

    IF node_count = 0 OR reachable_count <> node_count THEN
      RAISE EXCEPTION 'every confirmed Topic Node must be reachable from the root'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_model_revisions_mutation_guard
  ON app.topic_model_revisions;
CREATE TRIGGER topic_model_revisions_mutation_guard
  BEFORE UPDATE OR DELETE ON app.topic_model_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_revision_mutation();

DROP TRIGGER IF EXISTS topic_model_revisions_topology_guard
  ON app.topic_model_revisions;
CREATE CONSTRAINT TRIGGER topic_model_revisions_topology_guard
  AFTER INSERT OR UPDATE ON app.topic_model_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION app.validate_confirmed_topic_model_topology();

CREATE OR REPLACE FUNCTION app.enforce_topic_node_identity_creation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.created_in_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic Node identity must be created in a draft model'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_identities_creation_guard
  ON app.topic_node_identities;
CREATE TRIGGER topic_node_identities_creation_guard
  BEFORE INSERT ON app.topic_node_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_node_identity_creation();

DROP TRIGGER IF EXISTS topic_node_identities_append_only
  ON app.topic_node_identities;
CREATE TRIGGER topic_node_identities_append_only
  BEFORE UPDATE OR DELETE ON app.topic_node_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_topic_node_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  model_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status
    INTO model_status
    FROM app.topic_model_revisions
    WHERE workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id
      AND revision = NEW.topic_model_revision;

    IF model_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Topic Node revisions may be added only to a draft model'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status
  INTO model_status
  FROM app.topic_model_revisions
  WHERE workspace_id = OLD.workspace_id
    AND project_id = OLD.project_id
    AND revision = OLD.topic_model_revision;

  IF model_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'confirmed Topic Node revisions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.topic_node_id IS DISTINCT FROM OLD.topic_node_id
     OR NEW.topic_model_revision IS DISTINCT FROM OLD.topic_model_revision
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topic Node revision identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_revisions_mutation_guard
  ON app.topic_node_revisions;
CREATE TRIGGER topic_node_revisions_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.topic_node_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_node_revision_mutation();

CREATE OR REPLACE FUNCTION app.prevent_topic_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  IF NEW.parent_topic_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE ancestors(topic_node_id) AS (
    SELECT NEW.parent_topic_node_id
    UNION
    SELECT parent.parent_topic_node_id
    FROM app.topic_node_revisions parent
    JOIN ancestors
      ON ancestors.topic_node_id = parent.topic_node_id
    WHERE parent.workspace_id = NEW.workspace_id
      AND parent.project_id = NEW.project_id
      AND parent.topic_model_revision = NEW.topic_model_revision
      AND parent.parent_topic_node_id IS NOT NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM ancestors
    WHERE topic_node_id = NEW.topic_node_id
  )
  INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Topic Node parent relationships cannot form a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_revisions_parent_cycle_guard
  ON app.topic_node_revisions;
CREATE TRIGGER topic_node_revisions_parent_cycle_guard
  BEFORE INSERT OR UPDATE ON app.topic_node_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_parent_cycle();

CREATE OR REPLACE FUNCTION app.prevent_topic_alias_window_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.valid_from_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic aliases may be added only to a draft model'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.valid_to_revision IS DISTINCT FROM OLD.valid_to_revision
     AND (
       NEW.valid_to_revision IS NULL
       OR NEW.valid_to_revision = 2147483647
       OR NOT EXISTS (
         SELECT 1
         FROM app.topic_model_revisions model
         WHERE model.workspace_id = NEW.workspace_id
           AND model.project_id = NEW.project_id
           AND model.revision = NEW.valid_to_revision + 1
           AND model.status = 'draft'
       )
     ) THEN
    RAISE EXCEPTION 'Topic aliases must close immediately before a draft model'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.topic_cluster_aliases existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.project_id = NEW.project_id
      AND existing.legacy_cluster_key = NEW.legacy_cluster_key
      AND existing.id <> NEW.id
      AND existing.valid_from_revision
        <= coalesce(NEW.valid_to_revision, 2147483647)
      AND NEW.valid_from_revision
        <= coalesce(existing.valid_to_revision, 2147483647)
  ) THEN
    RAISE EXCEPTION 'Topic cluster alias validity windows cannot overlap'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_cluster_aliases_window_guard
  ON app.topic_cluster_aliases;
CREATE TRIGGER topic_cluster_aliases_window_guard
  BEFORE INSERT OR UPDATE ON app.topic_cluster_aliases
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_alias_window_overlap();

CREATE OR REPLACE FUNCTION app.enforce_topic_cluster_alias_retention()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Topic cluster aliases are retained for frozen data'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.topic_node_id IS DISTINCT FROM OLD.topic_node_id
     OR NEW.legacy_cluster_key IS DISTINCT FROM OLD.legacy_cluster_key
     OR NEW.valid_from_revision IS DISTINCT FROM OLD.valid_from_revision
     OR NEW.alias_kind IS DISTINCT FROM OLD.alias_kind
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT OLD.is_current
     OR OLD.valid_to_revision IS NOT NULL
     OR NEW.is_current
     OR NEW.valid_to_revision IS NULL THEN
    RAISE EXCEPTION 'Topic cluster alias history is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_cluster_aliases_retention_guard
  ON app.topic_cluster_aliases;
CREATE TRIGGER topic_cluster_aliases_retention_guard
  BEFORE UPDATE OR DELETE ON app.topic_cluster_aliases
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_cluster_alias_retention();

CREATE OR REPLACE FUNCTION app.prevent_topic_successor_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.topic_model_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic successor relationships may be added only to a draft model'
      USING ERRCODE = '55000';
  END IF;

  WITH RECURSIVE reachable(topic_node_id) AS (
    SELECT NEW.successor_topic_node_id
    UNION
    SELECT successor.successor_topic_node_id
    FROM app.topic_node_successors successor
    JOIN reachable
      ON reachable.topic_node_id = successor.predecessor_topic_node_id
    WHERE successor.workspace_id = NEW.workspace_id
      AND successor.project_id = NEW.project_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM reachable
    WHERE topic_node_id = NEW.predecessor_topic_node_id
  )
  INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Topic successor relationships cannot form a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_successors_cycle_guard
  ON app.topic_node_successors;
CREATE TRIGGER topic_node_successors_cycle_guard
  BEFORE INSERT ON app.topic_node_successors
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_successor_cycle();

DROP TRIGGER IF EXISTS topic_node_successors_append_only
  ON app.topic_node_successors;
CREATE TRIGGER topic_node_successors_append_only
  BEFORE UPDATE OR DELETE ON app.topic_node_successors
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS keyword_review_decisions_append_only
  ON app.keyword_review_decisions;
CREATE TRIGGER keyword_review_decisions_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0024_keyword_governance_foundation'::text AS migration_version;

COMMIT;
