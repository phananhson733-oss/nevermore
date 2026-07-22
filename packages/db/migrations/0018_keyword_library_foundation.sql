BEGIN;

-- DataForSEO historically reused the CSV keyword-gap dataset key. Preserve
-- those immutable rows, but allow new collection writers to state the actual
-- provider operation without rewriting history.
ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (dataset_key IN (
    'crawl.site_graph.v1',
    'gsc.page_query_daily.v1',
    'ga4.organic_landing_daily.v1',
    'csv.keyword_gap.v1',
    'dataforseo.ranked_keywords.v1'
  ));

CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = NEW.provider
      AND run.method_version = NEW.method_version
      AND run.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (NEW.provider = 'gsc' AND NEW.dataset_key = 'gsc.page_query_daily.v1')
    OR (NEW.provider = 'ga4' AND NEW.dataset_key = 'ga4.organic_landing_daily.v1')
    OR (NEW.provider = 'csv' AND NEW.dataset_key = 'csv.keyword_gap.v1')
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.dataset_key IN (
        'csv.keyword_gap.v1',
        'dataforseo.ranked_keywords.v1'
      )
    )
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = NEW.provider
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'observation provenance does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND (
        (
          snapshot.provider = 'crawl'
          AND snapshot.dataset_key = 'crawl.site_graph.v1'
          AND NEW.metric_key IN (
            'crawl.page.v1','crawl.robots.v1','crawl.sitemap.v1'
          )
        )
        OR (
          snapshot.provider = 'gsc'
          AND snapshot.dataset_key = 'gsc.page_query_daily.v1'
          AND NEW.metric_key = 'gsc.page.v1'
        )
        OR (
          snapshot.provider = 'ga4'
          AND snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
          AND NEW.metric_key = 'ga4.landing.v1'
        )
        OR (
          snapshot.provider = 'csv'
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          snapshot.provider = 'dataforseo'
          AND (
            (
              snapshot.dataset_key = 'csv.keyword_gap.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
            OR (
              snapshot.dataset_key = 'dataforseo.ranked_keywords.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider IN ('gsc','ga4') AND NEW.origin = 'first_party' AND NEW.grade = 'A')
    OR (NEW.provider = 'crawl' AND NEW.origin = 'direct_public' AND NEW.grade = 'B')
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.origin = 'vendor_observation'
      AND NEW.grade = 'B'
    )
    OR (NEW.provider = 'csv' AND NEW.origin = 'user_provided' AND NEW.grade = 'C')
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- A provider occurrence points to the canonical Snapshot and exact normalized
-- Observation that own all provider metrics. A manual occurrence is itself the
-- immutable source record and has no fabricated provider lineage. Search
-- volume, rank, current URL, competitor rank and KD are never duplicated here.
CREATE TABLE IF NOT EXISTS app.keyword_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  data_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  display_keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  market text NOT NULL,
  language_tag text NOT NULL,
  query_kind text NOT NULL CHECK (
    query_kind IN ('search_query','generative_query')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN (
      'csv_import',
      'dataforseo_ranked',
      'gsc_top_query',
      'manual'
    )
  ),
  scope_basis text NOT NULL CHECK (
    scope_basis IN (
      'provider_collection_scope',
      'user_provided',
      'project_context',
      'manual'
    )
  ),
  source_pointer text,
  source_ref text NOT NULL,
  collected_at timestamptz NOT NULL,
  provider_data_as_of timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    length(display_keyword) BETWEEN 1 AND 500
    AND display_keyword = btrim(display_keyword)
  ),
  CHECK (
    length(normalized_keyword) BETWEEN 1 AND 500
    AND normalized_keyword = btrim(normalized_keyword)
    AND normalized_keyword = lower(normalized_keyword)
    AND normalized_keyword !~ '[[:space:]]{2,}'
  ),
  CHECK (market ~ '^[A-Z]{2}$'),
  CHECK (app.is_bcp47_language_tag(language_tag)),
  CHECK (
    source_pointer IS NULL
    OR source_pointer = '/valueJson/keyword'
    OR source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
  ),
  CHECK (
    length(source_ref) BETWEEN 1 AND 2048
    AND source_ref = btrim(source_ref)
  ),
  CHECK (
    (
      source_kind = 'manual'
      AND scope_basis = 'manual'
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND source_pointer IS NULL
      AND provider_data_as_of IS NULL
    )
    OR (
      source_kind <> 'manual'
      AND scope_basis <> 'manual'
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND source_pointer IS NOT NULL
    )
  ),
  UNIQUE (project_id, source_kind, source_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS keyword_occurrences_observation_pointer_idx
  ON app.keyword_occurrences(normalized_observation_id, source_pointer)
  WHERE normalized_observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS keyword_occurrences_project_collected_idx
  ON app.keyword_occurrences(project_id, collected_at DESC, id DESC);

-- Stable keyword identity. Cluster membership and Existing Page/New Asset are
-- governed review decisions, never part of the identity tuple.
CREATE TABLE IF NOT EXISTS app.keyword_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  display_keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  market text NOT NULL,
  language_tag text NOT NULL,
  query_kind text NOT NULL CHECK (
    query_kind IN ('search_query','generative_query')
  ),
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','approved','excluded','parked')),
  intent text,
  buyer_stage text,
  cluster_key text,
  mapping_decision text NOT NULL DEFAULT 'unassigned'
    CHECK (mapping_decision IN ('unassigned','existing_page','new_asset')),
  mapped_site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  mapping_review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (mapping_review_state IN ('unreviewed','confirmed')),
  mapping_revision integer NOT NULL DEFAULT 0 CHECK (mapping_revision >= 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    length(display_keyword) BETWEEN 1 AND 500
    AND display_keyword = btrim(display_keyword)
  ),
  CHECK (
    length(normalized_keyword) BETWEEN 1 AND 500
    AND normalized_keyword = btrim(normalized_keyword)
    AND normalized_keyword = lower(normalized_keyword)
    AND normalized_keyword !~ '[[:space:]]{2,}'
  ),
  CHECK (market ~ '^[A-Z]{2}$'),
  CHECK (app.is_bcp47_language_tag(language_tag)),
  CHECK (
    intent IS NULL OR (
      length(intent) BETWEEN 1 AND 100 AND intent = btrim(intent)
    )
  ),
  CHECK (
    buyer_stage IS NULL OR (
      length(buyer_stage) BETWEEN 1 AND 100 AND buyer_stage = btrim(buyer_stage)
    )
  ),
  CHECK (
    cluster_key IS NULL OR (
      length(cluster_key) BETWEEN 1 AND 200 AND cluster_key = btrim(cluster_key)
    )
  ),
  CHECK (
    (mapping_decision = 'existing_page' AND mapped_site_page_id IS NOT NULL)
    OR (
      mapping_decision IN ('unassigned','new_asset')
      AND mapped_site_page_id IS NULL
    )
  ),
  CHECK (first_seen_at <= last_seen_at),
  UNIQUE (
    project_id,
    normalized_keyword,
    market,
    language_tag,
    query_kind
  )
);

CREATE INDEX IF NOT EXISTS keyword_entities_project_created_idx
  ON app.keyword_entities(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS keyword_entities_project_review_idx
  ON app.keyword_entities(
    project_id,
    status,
    mapping_review_state,
    updated_at DESC,
    id DESC
  );

CREATE TABLE IF NOT EXISTS app.keyword_entity_sources (
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  keyword_entity_id uuid NOT NULL
    REFERENCES app.keyword_entities(id) ON DELETE RESTRICT,
  keyword_occurrence_id uuid NOT NULL
    REFERENCES app.keyword_occurrences(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword_entity_id, keyword_occurrence_id)
);

CREATE INDEX IF NOT EXISTS keyword_entity_sources_project_occurrence_idx
  ON app.keyword_entity_sources(
    project_id,
    keyword_occurrence_id,
    keyword_entity_id
  );

CREATE OR REPLACE FUNCTION app.enforce_keyword_occurrence_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation_provider text;
  observation_metric_key text;
  observation_origin text;
  observation_keyword text;
  observation_market text;
  observation_language text;
  collection_market text;
  collection_language text;
  context_basis text;
  context_market text;
  context_language text;
  snapshot_data_as_of text;
  observation_data_as_of text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword occurrence project is absent or archived'
      USING ERRCODE = '23514';
  END IF;

  -- A manual entry is itself the immutable source record. It must not invent a
  -- provider Snapshot or Observation merely to satisfy a shared table shape.
  IF NEW.source_kind = 'manual' THEN
    IF NEW.scope_basis <> 'manual'
       OR NEW.data_snapshot_id IS NOT NULL
       OR NEW.normalized_observation_id IS NOT NULL
       OR NEW.source_pointer IS NOT NULL
       OR NEW.provider_data_as_of IS NOT NULL
       OR NEW.source_ref IS DISTINCT FROM ('manual:' || NEW.id::text) THEN
      RAISE EXCEPTION 'manual keyword occurrence has invalid first-class provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    observation.provider,
    observation.metric_key,
    observation.origin,
    CASE
      WHEN NEW.source_pointer = '/valueJson/keyword'
        THEN observation.value_json ->> 'keyword'
      WHEN NEW.source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
        THEN observation.value_json #>> ARRAY[
          'topQueries',
          substring(
            NEW.source_pointer
            FROM '^/valueJson/topQueries/([0-9])/query$'
          ),
          'query'
        ]
      ELSE NULL
    END,
    observation.value_json ->> 'marketCode',
    observation.value_json ->> 'languageCode',
    snapshot.summary #>> '{collectionScope,marketCode}',
    snapshot.summary #>> '{collectionScope,languageTag}',
    snapshot.summary #>> '{keywordLibraryContext,basis}',
    snapshot.summary #>> '{keywordLibraryContext,marketCode}',
    snapshot.summary #>> '{keywordLibraryContext,languageTag}',
    snapshot.summary #>> '{timing,dataAsOf}',
    observation.value_json ->> 'providerDataAsOf'
  INTO
    observation_provider,
    observation_metric_key,
    observation_origin,
    observation_keyword,
    observation_market,
    observation_language,
    collection_market,
    collection_language,
    context_basis,
    context_market,
    context_language,
    snapshot_data_as_of,
    observation_data_as_of
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.data_snapshot_id
   AND snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
  WHERE observation.id = NEW.normalized_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id
    AND observation.observed_at = NEW.collected_at;

  IF observation_provider IS NULL THEN
    RAISE EXCEPTION 'keyword occurrence lacks canonical Observation lineage'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (
      NEW.source_kind = 'csv_import'
      AND NEW.scope_basis = 'user_provided'
      AND NEW.source_pointer = '/valueJson/keyword'
      AND observation_provider = 'csv'
      AND observation_metric_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.source_kind = 'dataforseo_ranked'
      AND NEW.scope_basis = 'provider_collection_scope'
      AND NEW.source_pointer = '/valueJson/keyword'
      AND observation_provider = 'dataforseo'
      AND observation_metric_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.source_kind = 'gsc_top_query'
      AND NEW.scope_basis = 'project_context'
      AND NEW.source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
      AND observation_provider = 'gsc'
      AND observation_metric_key = 'gsc.page.v1'
    )
  ) THEN
    RAISE EXCEPTION 'keyword occurrence source kind/pointer is not supported by its Observation'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.query_kind <> 'search_query' THEN
    RAISE EXCEPTION 'current canonical keyword sources produce SearchQuery only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.source_kind = 'dataforseo_ranked' THEN
    IF collection_market IS NULL OR collection_language IS NULL THEN
      RAISE EXCEPTION 'DataForSEO keyword occurrence requires frozen provider collection scope'
        USING ERRCODE = '23514';
    END IF;
    observation_market := collection_market;
    observation_language := collection_language;
  ELSIF NEW.source_kind = 'gsc_top_query' THEN
    -- Search Analytics has no market/language request filter. This explicitly
    -- frozen project context is not presented as provider collection scope.
    IF context_basis IS DISTINCT FROM 'project_context'
       OR context_market IS NULL
       OR context_language IS NULL THEN
      RAISE EXCEPTION 'GSC keyword occurrence requires frozen Keyword Library project context'
        USING ERRCODE = '23514';
    END IF;
    observation_market := context_market;
    observation_language := context_language;
  END IF;
  IF NEW.source_ref IS DISTINCT FROM (
    'observation:' || NEW.normalized_observation_id::text || '#' ||
    NEW.source_pointer
  ) THEN
    RAISE EXCEPTION 'keyword occurrence source ref is not its canonical Observation pointer'
      USING ERRCODE = '23514';
  END IF;
  IF observation_keyword IS NULL OR regexp_replace(
    lower(btrim(observation_keyword)),
    '[[:space:]]+',
    ' ',
    'g'
  ) IS DISTINCT FROM NEW.normalized_keyword THEN
    RAISE EXCEPTION 'keyword occurrence identity does not match Observation keyword'
      USING ERRCODE = '23514';
  END IF;
  IF observation_market IS NULL OR upper(observation_market) IS DISTINCT FROM NEW.market THEN
    RAISE EXCEPTION 'keyword occurrence market does not match Observation provenance'
      USING ERRCODE = '23514';
  END IF;
  IF observation_language IS NULL OR lower(observation_language) IS DISTINCT FROM lower(NEW.language_tag) THEN
    RAISE EXCEPTION 'keyword occurrence language does not match Observation provenance'
      USING ERRCODE = '23514';
  END IF;
  IF coalesce(observation_data_as_of, snapshot_data_as_of) IS NULL THEN
    IF NEW.provider_data_as_of IS NOT NULL THEN
      RAISE EXCEPTION 'keyword provider data timestamp lacks canonical provenance'
      USING ERRCODE = '23514';
    END IF;
  ELSIF observation_data_as_of IS NOT NULL
     AND snapshot_data_as_of IS NOT NULL
     AND observation_data_as_of::timestamptz IS DISTINCT FROM
       snapshot_data_as_of::timestamptz THEN
    RAISE EXCEPTION 'canonical keyword provider timestamps contradict each other'
      USING ERRCODE = '23514';
  ELSIF NEW.provider_data_as_of IS NULL OR coalesce(
    observation_data_as_of,
    snapshot_data_as_of
  )::timestamptz IS DISTINCT FROM NEW.provider_data_as_of THEN
    RAISE EXCEPTION 'keyword provider data timestamp omits or conflicts with canonical provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_occurrences_lineage_guard
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_occurrence_lineage();

DROP TRIGGER IF EXISTS keyword_occurrences_append_only
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_entity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_changed boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword entity project is absent or archived'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.mapping_decision = 'existing_page' AND NOT EXISTS (
    SELECT 1
    FROM app.site_pages page
    WHERE page.id = NEW.mapped_site_page_id
      AND page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'keyword Existing Page mapping is outside project scope'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.display_keyword IS DISTINCT FROM OLD.display_keyword
     OR NEW.normalized_keyword IS DISTINCT FROM OLD.normalized_keyword
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.language_tag IS DISTINCT FROM OLD.language_tag
     OR NEW.query_kind IS DISTINCT FROM OLD.query_kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'keyword stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.first_seen_at > OLD.first_seen_at
     OR NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'keyword observation window may only expand'
      USING ERRCODE = '23514';
  END IF;

  review_changed :=
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.buyer_stage IS DISTINCT FROM OLD.buyer_stage
    OR NEW.cluster_key IS DISTINCT FROM OLD.cluster_key
    OR NEW.mapping_decision IS DISTINCT FROM OLD.mapping_decision
    OR NEW.mapped_site_page_id IS DISTINCT FROM OLD.mapped_site_page_id
    OR NEW.mapping_review_state IS DISTINCT FROM OLD.mapping_review_state;

  IF review_changed AND NEW.mapping_revision <> OLD.mapping_revision + 1 THEN
    RAISE EXCEPTION 'keyword review update must advance exactly one revision'
      USING ERRCODE = '23514';
  END IF;
  IF NOT review_changed AND NEW.mapping_revision <> OLD.mapping_revision THEN
    RAISE EXCEPTION 'keyword mapping revision cannot advance without a review change'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entities_mutation_guard
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_mutation_guard
  BEFORE INSERT OR UPDATE ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_entity_mutation();

DROP TRIGGER IF EXISTS keyword_entities_no_delete
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_no_delete
  BEFORE DELETE ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_entity_source_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.keyword_entities entity
      ON entity.id = NEW.keyword_entity_id
     AND entity.workspace_id = NEW.workspace_id
     AND entity.project_id = NEW.project_id
    JOIN app.keyword_occurrences occurrence
      ON occurrence.id = NEW.keyword_occurrence_id
     AND occurrence.workspace_id = NEW.workspace_id
     AND occurrence.project_id = NEW.project_id
     AND occurrence.normalized_keyword = entity.normalized_keyword
     AND occurrence.market = entity.market
     AND occurrence.language_tag = entity.language_tag
     AND occurrence.query_kind = entity.query_kind
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword entity source membership has invalid project provenance'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entity_sources_lineage_guard
  ON app.keyword_entity_sources;
CREATE TRIGGER keyword_entity_sources_lineage_guard
  BEFORE INSERT ON app.keyword_entity_sources
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_entity_source_lineage();

DROP TRIGGER IF EXISTS keyword_entity_sources_append_only
  ON app.keyword_entity_sources;
CREATE TRIGGER keyword_entity_sources_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_entity_sources
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

-- A single SQL call owns occurrence dedupe, stable entity convergence and
-- membership. The unique constraints serialize concurrent retries; a replay
-- with changed semantic bytes fails rather than mutating immutable provenance.
CREATE OR REPLACE FUNCTION app.upsert_keyword_library_occurrence(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_occurrence_id uuid,
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_display_keyword text,
  selected_normalized_keyword text,
  selected_market text,
  selected_language_tag text,
  selected_query_kind text,
  selected_source_kind text,
  selected_scope_basis text,
  selected_source_pointer text,
  selected_source_ref text,
  selected_collected_at timestamptz,
  selected_provider_data_as_of timestamptz
)
RETURNS TABLE (occurrence_id uuid, entity_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  occurrence_row app.keyword_occurrences%ROWTYPE;
  entity_row app.keyword_entities%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword library project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF (selected_source_kind = 'manual') IS DISTINCT FROM
     (selected_occurrence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'manual entry id is required only for manual occurrences'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_occurrences (
    id,
    workspace_id,
    project_id,
    data_snapshot_id,
    normalized_observation_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    source_kind,
    scope_basis,
    source_pointer,
    source_ref,
    collected_at,
    provider_data_as_of
  ) VALUES (
    coalesce(selected_occurrence_id, gen_random_uuid()),
    selected_workspace_id,
    selected_project_id,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_source_kind,
    selected_scope_basis,
    selected_source_pointer,
    selected_source_ref,
    selected_collected_at,
    selected_provider_data_as_of
  )
  ON CONFLICT (project_id, source_kind, source_ref) DO NOTHING
  RETURNING * INTO occurrence_row;

  IF occurrence_row.id IS NULL THEN
    SELECT *
    INTO occurrence_row
    FROM app.keyword_occurrences occurrence
    WHERE occurrence.project_id = selected_project_id
      AND occurrence.source_kind = selected_source_kind
      AND occurrence.source_ref = selected_source_ref;
  END IF;

  IF occurrence_row.id IS NULL
     OR (
       selected_source_kind = 'manual'
       AND occurrence_row.id IS DISTINCT FROM selected_occurrence_id
     )
     OR occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
     OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
     OR occurrence_row.data_snapshot_id IS DISTINCT FROM selected_data_snapshot_id
     OR occurrence_row.normalized_observation_id IS DISTINCT FROM selected_normalized_observation_id
     OR occurrence_row.display_keyword IS DISTINCT FROM selected_display_keyword
     OR occurrence_row.normalized_keyword IS DISTINCT FROM selected_normalized_keyword
     OR occurrence_row.market IS DISTINCT FROM selected_market
     OR occurrence_row.language_tag IS DISTINCT FROM selected_language_tag
     OR occurrence_row.query_kind IS DISTINCT FROM selected_query_kind
     OR occurrence_row.source_kind IS DISTINCT FROM selected_source_kind
     OR occurrence_row.scope_basis IS DISTINCT FROM selected_scope_basis
     OR occurrence_row.source_pointer IS DISTINCT FROM selected_source_pointer
     OR occurrence_row.source_ref IS DISTINCT FROM selected_source_ref
     OR occurrence_row.collected_at IS DISTINCT FROM selected_collected_at
     OR occurrence_row.provider_data_as_of IS DISTINCT FROM selected_provider_data_as_of THEN
    RAISE EXCEPTION 'keyword source occurrence conflicts with immutable provenance'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entities (
    workspace_id,
    project_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    first_seen_at,
    last_seen_at
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_collected_at,
    selected_collected_at
  )
  ON CONFLICT (
    project_id,
    normalized_keyword,
    market,
    language_tag,
    query_kind
  ) DO UPDATE SET
    first_seen_at = least(
      app.keyword_entities.first_seen_at,
      EXCLUDED.first_seen_at
    ),
    last_seen_at = greatest(
      app.keyword_entities.last_seen_at,
      EXCLUDED.last_seen_at
    )
  RETURNING * INTO entity_row;

  IF entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'keyword stable identity conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entity_sources (
    workspace_id,
    project_id,
    keyword_entity_id,
    keyword_occurrence_id
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    occurrence_row.id
  )
  ON CONFLICT (keyword_entity_id, keyword_occurrence_id) DO NOTHING;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0018_keyword_library_foundation'::text AS migration_version;

COMMIT;
