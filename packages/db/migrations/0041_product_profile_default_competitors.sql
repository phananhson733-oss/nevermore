BEGIN;

-- Product Profile 0.3.0 generated evidence-backed relationship/scope values
-- but labelled every generated row `candidate`. Competitor Library governance
-- therefore discarded an otherwise complete default comparison set. Preserve
-- immutable origin truth and promote only untouched revision-zero entities.
-- A customer-authored governance revision is never overwritten.
WITH ranked_profile_defaults AS (
  SELECT
    origin.competitor_id,
    origin.source_name,
    origin.source_review_status,
    origin.source_relationship,
    origin.source_analysis_scope,
    row_number() OVER (
      PARTITION BY origin.competitor_id
      ORDER BY
        origin.profile_version DESC,
        origin.created_at DESC,
        origin.id DESC
    ) AS source_rank
  FROM app.competitor_origin_occurrences origin
  WHERE origin.origin_kind = 'product_profile'
    AND (
      origin.source_review_status IN ('approved', 'excluded')
      OR (
        origin.source_review_status = 'candidate'
        AND origin.source_relationship IN ('direct', 'indirect')
        AND cardinality(origin.source_analysis_scope) BETWEEN 1 AND 5
      )
    )
), latest_profile_defaults AS (
  SELECT
    competitor_id,
    source_name,
    CASE
      WHEN source_review_status = 'excluded' THEN 'excluded'
      ELSE 'approved'
    END AS default_review_status,
    CASE
      WHEN source_review_status = 'excluded' THEN NULL
      ELSE source_relationship
    END AS default_relationship,
    CASE
      WHEN source_review_status = 'excluded' THEN ARRAY[]::text[]
      ELSE source_analysis_scope
    END AS default_analysis_scope
  FROM ranked_profile_defaults
  WHERE source_rank = 1
)
UPDATE app.competitor_entities entity
SET
  name = defaults.source_name,
  review_status = defaults.default_review_status,
  relationship = defaults.default_relationship,
  analysis_scope = defaults.default_analysis_scope,
  revision = entity.revision + 1
FROM latest_profile_defaults defaults
WHERE entity.id = defaults.competitor_id
  AND entity.revision = 0
  AND (
    entity.name,
    entity.review_status,
    entity.relationship,
    entity.analysis_scope
  ) IS DISTINCT FROM (
    defaults.source_name,
    defaults.default_review_status,
    defaults.default_relationship,
    defaults.default_analysis_scope
  );

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0041_product_profile_default_competitors'::text AS migration_version;

COMMIT;
