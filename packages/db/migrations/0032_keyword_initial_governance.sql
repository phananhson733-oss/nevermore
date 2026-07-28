BEGIN;

-- Automated ingestion suggestions do not have a human decision maker. Keep
-- migration baselines actorless, require an actor for user decisions, and let
-- system suggestions truthfully carry either no actor (ingestion) or the actor
-- that initiated a later system invalidation.
ALTER TABLE app.keyword_review_decisions
  DROP CONSTRAINT keyword_review_decisions_check4;
ALTER TABLE app.keyword_review_decisions
  ADD CONSTRAINT keyword_review_decisions_check4 CHECK (
    (
      decision_origin = 'migration_baseline'
      AND decided_by IS NULL
    )
    OR decision_origin = 'system_suggestion'
    OR (
      decision_origin = 'user'
      AND decided_by IS NOT NULL
    )
  );

-- Review writers resolve one authoritative instant and persist it on both the
-- mutable current projection and append-only Decision. Preserve that explicit
-- instant when governed fields change. Observation-only UPSERTs do not provide
-- a review instant, so the database continues to advance updated_at for them.
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

  IF review_changed THEN
    IF NOT isfinite(NEW.updated_at)
       OR NEW.updated_at <= OLD.updated_at THEN
      RAISE EXCEPTION 'keyword review instant must advance monotonically'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- Installing the trigger takes a transactional lock on keyword_entities. Any
-- old in-flight writer that already owns the table lock completes before this
-- DDL; any writer admitted after commit sees the trigger, even if its caller
-- began before the migration. This closes the upgrade window without relying
-- on one repository function as the only insertion path.
CREATE OR REPLACE FUNCTION app.initialize_keyword_review_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mapping_revision = 0
     AND NEW.status = 'candidate'
     AND NEW.intent IS NULL
     AND NEW.buyer_stage IS NULL
     AND NEW.cluster_key IS NULL
     AND NEW.mapping_decision = 'unassigned'
     AND NEW.mapped_site_page_id IS NULL
     AND NEW.mapping_review_state = 'unreviewed' THEN
    INSERT INTO app.keyword_review_decisions (
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
    ) VALUES (
      NEW.workspace_id,
      NEW.project_id,
      NEW.id,
      0,
      'system_suggestion',
      NEW.status,
      NEW.intent,
      NEW.buyer_stage,
      NULL,
      NULL,
      NEW.cluster_key,
      NEW.mapping_decision,
      NEW.mapped_site_page_id,
      NEW.mapping_review_state,
      NULL,
      NULL,
      'Keyword ingestion generated the initial candidate decision.',
      NEW.created_at,
      jsonb_build_object(
        'projectId', NEW.project_id,
        'keywordId', NEW.id,
        'status', NEW.status,
        'intent', NEW.intent,
        'buyerStage', NEW.buyer_stage,
        'topicNodeId', NULL,
        'topicModelRevision', NULL,
        'clusterKey', NEW.cluster_key,
        'mappingDecision', NEW.mapping_decision,
        'mappedSitePageId', NEW.mapped_site_page_id,
        'mappingReviewState', NEW.mapping_review_state,
        'governanceRevision', 0,
        'assignmentInvalidatedBy', NULL,
        'earlierHistoryAvailable', false
      )
    )
    ON CONFLICT (
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    ) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entities_initial_review_decision
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_initial_review_decision
  AFTER INSERT ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.initialize_keyword_review_decision();

-- Close the production gap left by default-state entities ingested after 0024.
-- Only the complete revision-zero default is knowable without inventing
-- history. Nonzero or non-default missing-ledger rows remain corrupt so strict
-- readers continue to fail closed.
INSERT INTO app.keyword_review_decisions (
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
  entity.workspace_id,
  entity.project_id,
  entity.id,
  0,
  'system_suggestion',
  entity.status,
  entity.intent,
  entity.buyer_stage,
  NULL,
  NULL,
  entity.cluster_key,
  entity.mapping_decision,
  entity.mapped_site_page_id,
  entity.mapping_review_state,
  NULL,
  NULL,
  'Keyword ingestion generated the initial candidate decision.',
  entity.created_at,
  jsonb_build_object(
    'projectId', entity.project_id,
    'keywordId', entity.id,
    'status', entity.status,
    'intent', entity.intent,
    'buyerStage', entity.buyer_stage,
    'topicNodeId', NULL,
    'topicModelRevision', NULL,
    'clusterKey', entity.cluster_key,
    'mappingDecision', entity.mapping_decision,
    'mappedSitePageId', entity.mapped_site_page_id,
    'mappingReviewState', entity.mapping_review_state,
    'governanceRevision', 0,
    'assignmentInvalidatedBy', NULL,
    'earlierHistoryAvailable', false
  )
FROM app.keyword_entities entity
WHERE entity.mapping_revision = 0
  AND entity.status = 'candidate'
  AND entity.intent IS NULL
  AND entity.buyer_stage IS NULL
  AND entity.cluster_key IS NULL
  AND entity.mapping_decision = 'unassigned'
  AND entity.mapped_site_page_id IS NULL
  AND entity.mapping_review_state = 'unreviewed'
  AND NOT EXISTS (
    SELECT 1
    FROM app.keyword_review_decisions existing
    WHERE existing.workspace_id = entity.workspace_id
      AND existing.project_id = entity.project_id
      AND existing.keyword_entity_id = entity.id
  )
ON CONFLICT (
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision
) DO NOTHING;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0032_keyword_initial_governance'::text AS migration_version;

COMMIT;
