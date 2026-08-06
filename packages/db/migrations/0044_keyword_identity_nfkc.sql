-- Align the trigger's keyword-identity comparison with the application's
-- NFKC-normalized identity (normalizeKeywordIdentity). Without NFKC here,
-- one decomposed-diacritic GSC query (e.g. "rodríguez" as i + U+0301)
-- fails 23514 and aborts the entire GSC collection transaction (issue #74).
BEGIN;

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
    lower(btrim(normalize(observation_keyword, NFKC))),
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

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0044_keyword_identity_nfkc'::text AS migration_version;

COMMIT;
