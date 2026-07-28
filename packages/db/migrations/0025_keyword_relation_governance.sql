BEGIN;

-- Duplicate/cannibalization is governed inside Growth Map. A relation is a
-- stable unordered Keyword pair; candidates and decisions are immutable
-- evidence revisions. Folding is a read-model choice and never deletes a
-- Keyword Entity, source occurrence, metric Observation, or result history.
CREATE TABLE app.keyword_relation_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  keyword_a_id uuid NOT NULL,
  keyword_b_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (keyword_a_id < keyword_b_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_a_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_b_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, keyword_a_id, keyword_b_id),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_identities_keyword_a_idx
  ON app.keyword_relation_identities(
    workspace_id,
    project_id,
    keyword_a_id,
    id
  );

CREATE INDEX keyword_relation_identities_keyword_b_idx
  ON app.keyword_relation_identities(
    workspace_id,
    project_id,
    keyword_b_id,
    id
  );

CREATE OR REPLACE FUNCTION app.normalize_keyword_relation_semantic(
  selected_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(
    regexp_replace(
      btrim(normalize(selected_value, NFKC)),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION app.keyword_relation_token_overlap(
  left_keyword text,
  right_keyword text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  WITH
  left_tokens AS (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      app.normalize_keyword_relation_semantic(left_keyword),
      '[[:space:]]+'
    ) token
    WHERE token <> ''
  ),
  right_tokens AS (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      app.normalize_keyword_relation_semantic(right_keyword),
      '[[:space:]]+'
    ) token
    WHERE token <> ''
  ),
  intersection_count AS (
    SELECT count(*)::numeric AS value
    FROM (
      SELECT token FROM left_tokens
      INTERSECT
      SELECT token FROM right_tokens
    ) intersection_tokens
  ),
  union_count AS (
    SELECT count(*)::numeric AS value
    FROM (
      SELECT token FROM left_tokens
      UNION
      SELECT token FROM right_tokens
    ) union_tokens
  )
  SELECT round(
    intersection_count.value / nullif(union_count.value, 0),
    5
  )
  FROM intersection_count, union_count
$$;

CREATE TABLE app.keyword_relation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  candidate_revision integer NOT NULL DEFAULT 1
    CHECK (candidate_revision >= 1),
  rule_version text NOT NULL
    CHECK (rule_version = 'keyword-relation.1.0.0'),
  keyword_a_id uuid NOT NULL,
  keyword_a_display_keyword text NOT NULL CHECK (
    length(keyword_a_display_keyword) BETWEEN 1 AND 500
    AND keyword_a_display_keyword = btrim(keyword_a_display_keyword)
  ),
  keyword_a_normalized_keyword text NOT NULL CHECK (
    length(keyword_a_normalized_keyword) BETWEEN 1 AND 500
    AND keyword_a_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_a_normalized_keyword
      )
    AND keyword_a_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_a_display_keyword
      )
  ),
  keyword_a_governance_revision integer NOT NULL
    CHECK (keyword_a_governance_revision >= 0),
  keyword_a_topic_node_id uuid,
  keyword_a_topic_model_revision integer CHECK (
    keyword_a_topic_model_revision IS NULL
    OR keyword_a_topic_model_revision >= 1
  ),
  keyword_b_id uuid NOT NULL,
  keyword_b_display_keyword text NOT NULL CHECK (
    length(keyword_b_display_keyword) BETWEEN 1 AND 500
    AND keyword_b_display_keyword = btrim(keyword_b_display_keyword)
  ),
  keyword_b_normalized_keyword text NOT NULL CHECK (
    length(keyword_b_normalized_keyword) BETWEEN 1 AND 500
    AND keyword_b_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_b_normalized_keyword
      )
    AND keyword_b_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_b_display_keyword
      )
  ),
  keyword_b_governance_revision integer NOT NULL
    CHECK (keyword_b_governance_revision >= 0),
  keyword_b_topic_node_id uuid,
  keyword_b_topic_model_revision integer CHECK (
    keyword_b_topic_model_revision IS NULL
    OR keyword_b_topic_model_revision >= 1
  ),
  mapped_site_page_id uuid NOT NULL,
  normalized_intent text NOT NULL CHECK (
    length(normalized_intent) BETWEEN 1 AND 100
    AND normalized_intent =
      app.normalize_keyword_relation_semantic(normalized_intent)
  ),
  market text NOT NULL CHECK (
    length(market) BETWEEN 2 AND 32
    AND market = upper(market)
  ),
  language_tag text NOT NULL CHECK (
    length(language_tag) BETWEEN 2 AND 64
    AND language_tag = btrim(language_tag)
  ),
  same_confirmed_topic boolean NOT NULL,
  lexical_token_overlap numeric(6,5) NOT NULL CHECK (
    lexical_token_overlap BETWEEN 0 AND 1
  ),
  serp_overlap_availability text NOT NULL CHECK (
    serp_overlap_availability IN ('available','unavailable')
  ),
  serp_overlap numeric(6,5) CHECK (
    serp_overlap IS NULL OR serp_overlap BETWEEN 0 AND 1
  ),
  serp_overlap_limitation text CHECK (
    serp_overlap_limitation IS NULL
    OR (
      length(serp_overlap_limitation) BETWEEN 1 AND 2000
      AND serp_overlap_limitation = btrim(serp_overlap_limitation)
    )
  ),
  evidence_hash text NOT NULL DEFAULT repeat('0', 64) CHECK (
    evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (keyword_a_id < keyword_b_id),
  CHECK (
    (keyword_a_topic_node_id IS NULL) =
      (keyword_a_topic_model_revision IS NULL)
  ),
  CHECK (
    (keyword_b_topic_node_id IS NULL) =
      (keyword_b_topic_model_revision IS NULL)
  ),
  CHECK (
    same_confirmed_topic = (
      keyword_a_topic_node_id IS NOT NULL
      AND keyword_b_topic_node_id IS NOT NULL
      AND keyword_a_topic_node_id = keyword_b_topic_node_id
    )
  ),
  CHECK (
    (
      serp_overlap_availability = 'available'
      AND serp_overlap IS NOT NULL
      AND serp_overlap_limitation IS NULL
    )
    OR (
      serp_overlap_availability = 'unavailable'
      AND serp_overlap IS NULL
      AND serp_overlap_limitation IS NOT NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id, relation_id)
    REFERENCES app.keyword_relation_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_a_id,
    keyword_a_governance_revision
  )
    REFERENCES app.keyword_review_decisions(
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_b_id,
    keyword_b_governance_revision
  )
    REFERENCES app.keyword_review_decisions(
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, mapped_site_page_id)
    REFERENCES app.site_pages(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_a_topic_node_id,
    keyword_a_topic_model_revision
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
    keyword_b_topic_node_id,
    keyword_b_topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    candidate_revision
  ),
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    evidence_hash
  ),
  UNIQUE (workspace_id, project_id, relation_id, id),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_candidates_latest_idx
  ON app.keyword_relation_candidates(
    workspace_id,
    project_id,
    relation_id,
    candidate_revision DESC,
    id DESC
  );

CREATE TABLE app.keyword_relation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  relation_revision integer NOT NULL CHECK (relation_revision >= 1),
  decision_kind text NOT NULL CHECK (
    decision_kind IN (
      'primary_supporting',
      'keep_separate',
      'park_secondary',
      'needs_research'
    )
  ),
  primary_keyword_id uuid,
  supporting_keyword_id uuid,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 2000
    AND reason = btrim(reason)
  ),
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      decision_kind = 'primary_supporting'
      AND primary_keyword_id IS NOT NULL
      AND supporting_keyword_id IS NOT NULL
      AND primary_keyword_id <> supporting_keyword_id
    )
    OR (
      decision_kind <> 'primary_supporting'
      AND primary_keyword_id IS NULL
      AND supporting_keyword_id IS NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id, relation_id)
    REFERENCES app.keyword_relation_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    relation_id,
    candidate_id
  )
    REFERENCES app.keyword_relation_candidates(
      workspace_id,
      project_id,
      relation_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, primary_keyword_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, supporting_keyword_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    relation_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_decisions_latest_idx
  ON app.keyword_relation_decisions(
    workspace_id,
    project_id,
    relation_id,
    relation_revision DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION app.keyword_relation_candidate_stale_reasons(
  selected_candidate_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  candidate app.keyword_relation_candidates%ROWTYPE;
  keyword_a app.keyword_entities%ROWTYPE;
  keyword_b app.keyword_entities%ROWTYPE;
  decision_a app.keyword_review_decisions%ROWTYPE;
  decision_b app.keyword_review_decisions%ROWTYPE;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO candidate
  FROM app.keyword_relation_candidates
  WHERE id = selected_candidate_id;

  IF candidate.id IS NULL THEN
    RETURN ARRAY['keyword_unavailable']::text[];
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.keyword_relation_candidates newer
    WHERE newer.workspace_id = candidate.workspace_id
      AND newer.project_id = candidate.project_id
      AND newer.relation_id = candidate.relation_id
      AND newer.candidate_revision > candidate.candidate_revision
  ) THEN
    reasons := array_append(reasons, 'candidate_superseded');
  END IF;

  SELECT * INTO keyword_a
  FROM app.keyword_entities
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND id = candidate.keyword_a_id;
  SELECT * INTO keyword_b
  FROM app.keyword_entities
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND id = candidate.keyword_b_id;

  IF keyword_a.id IS NULL OR keyword_b.id IS NULL
     OR keyword_a.status <> 'approved'
     OR keyword_b.status <> 'approved'
     OR keyword_a.mapping_review_state <> 'confirmed'
     OR keyword_b.mapping_review_state <> 'confirmed' THEN
    RETURN array_append(reasons, 'keyword_unavailable');
  END IF;

  SELECT * INTO decision_a
  FROM app.keyword_review_decisions
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND keyword_entity_id = candidate.keyword_a_id
    AND governance_revision = keyword_a.mapping_revision;
  SELECT * INTO decision_b
  FROM app.keyword_review_decisions
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND keyword_entity_id = candidate.keyword_b_id
    AND governance_revision = keyword_b.mapping_revision;

  IF decision_a.id IS NULL OR decision_b.id IS NULL
     OR decision_a.assignment_invalidated_by IS NOT NULL
     OR decision_b.assignment_invalidated_by IS NOT NULL THEN
    RETURN array_append(reasons, 'keyword_unavailable');
  END IF;

  IF keyword_a.mapping_revision <>
       candidate.keyword_a_governance_revision
     OR keyword_b.mapping_revision <>
       candidate.keyword_b_governance_revision THEN
    reasons := array_append(
      reasons,
      'governance_revision_changed'
    );
  END IF;

  IF keyword_a.mapping_decision <> 'existing_page'
     OR keyword_b.mapping_decision <> 'existing_page'
     OR keyword_a.mapped_site_page_id IS DISTINCT FROM
       candidate.mapped_site_page_id
     OR keyword_b.mapped_site_page_id IS DISTINCT FROM
       candidate.mapped_site_page_id THEN
    reasons := array_append(reasons, 'mapping_changed');
  END IF;

  IF keyword_a.intent IS NULL
     OR keyword_b.intent IS NULL
     OR app.normalize_keyword_relation_semantic(keyword_a.intent)
       IS DISTINCT FROM candidate.normalized_intent
     OR app.normalize_keyword_relation_semantic(keyword_b.intent)
       IS DISTINCT FROM candidate.normalized_intent THEN
    reasons := array_append(reasons, 'intent_changed');
  END IF;

  IF keyword_a.market IS DISTINCT FROM candidate.market
     OR keyword_b.market IS DISTINCT FROM candidate.market THEN
    reasons := array_append(reasons, 'market_changed');
  END IF;

  IF keyword_a.language_tag IS DISTINCT FROM candidate.language_tag
     OR keyword_b.language_tag IS DISTINCT FROM candidate.language_tag THEN
    reasons := array_append(reasons, 'language_changed');
  END IF;

  RETURN reasons;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_keyword_relation_candidate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relation app.keyword_relation_identities%ROWTYPE;
  keyword_a app.keyword_entities%ROWTYPE;
  keyword_b app.keyword_entities%ROWTYPE;
  decision_a app.keyword_review_decisions%ROWTYPE;
  decision_b app.keyword_review_decisions%ROWTYPE;
  expected_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || NEW.workspace_id::text || ':'
      || NEW.project_id::text,
    0
  ));

  SELECT * INTO relation
  FROM app.keyword_relation_identities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.relation_id
  FOR UPDATE;

  IF relation.id IS NULL
     OR relation.keyword_a_id <> NEW.keyword_a_id
     OR relation.keyword_b_id <> NEW.keyword_b_id THEN
    RAISE EXCEPTION 'Keyword Relation candidate pair is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO keyword_a
  FROM app.keyword_entities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.keyword_a_id
  FOR UPDATE;
  SELECT * INTO keyword_b
  FROM app.keyword_entities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.keyword_b_id
  FOR UPDATE;

  SELECT * INTO decision_a
  FROM app.keyword_review_decisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND keyword_entity_id = NEW.keyword_a_id
    AND governance_revision = NEW.keyword_a_governance_revision;
  SELECT * INTO decision_b
  FROM app.keyword_review_decisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND keyword_entity_id = NEW.keyword_b_id
    AND governance_revision = NEW.keyword_b_governance_revision;

  IF keyword_a.id IS NULL OR keyword_b.id IS NULL
     OR keyword_a.status <> 'approved'
     OR keyword_b.status <> 'approved'
     OR keyword_a.mapping_review_state <> 'confirmed'
     OR keyword_b.mapping_review_state <> 'confirmed'
     OR keyword_a.mapping_decision <> 'existing_page'
     OR keyword_b.mapping_decision <> 'existing_page'
     OR keyword_a.mapped_site_page_id IS DISTINCT FROM
       NEW.mapped_site_page_id
     OR keyword_b.mapped_site_page_id IS DISTINCT FROM
       NEW.mapped_site_page_id
     OR keyword_a.mapping_revision <>
       NEW.keyword_a_governance_revision
     OR keyword_b.mapping_revision <>
       NEW.keyword_b_governance_revision
     OR decision_a.id IS NULL OR decision_b.id IS NULL
     OR decision_a.review_state <> 'confirmed'
     OR decision_b.review_state <> 'confirmed'
     OR decision_a.assignment_invalidated_by IS NOT NULL
     OR decision_b.assignment_invalidated_by IS NOT NULL
     OR decision_a.topic_node_id IS DISTINCT FROM
       NEW.keyword_a_topic_node_id
     OR decision_a.topic_model_revision IS DISTINCT FROM
       NEW.keyword_a_topic_model_revision
     OR decision_b.topic_node_id IS DISTINCT FROM
       NEW.keyword_b_topic_node_id
     OR decision_b.topic_model_revision IS DISTINCT FROM
       NEW.keyword_b_topic_model_revision
     OR NEW.same_confirmed_topic IS DISTINCT FROM (
       decision_a.topic_node_id IS NOT NULL
       AND decision_b.topic_node_id IS NOT NULL
       AND decision_a.topic_node_id = decision_b.topic_node_id
     )
     OR keyword_a.display_keyword IS DISTINCT FROM
       NEW.keyword_a_display_keyword
     OR keyword_b.display_keyword IS DISTINCT FROM
       NEW.keyword_b_display_keyword
     OR keyword_a.normalized_keyword IS DISTINCT FROM
       NEW.keyword_a_normalized_keyword
     OR keyword_b.normalized_keyword IS DISTINCT FROM
       NEW.keyword_b_normalized_keyword
     OR keyword_a.market IS DISTINCT FROM NEW.market
     OR keyword_b.market IS DISTINCT FROM NEW.market
     OR keyword_a.language_tag IS DISTINCT FROM NEW.language_tag
     OR keyword_b.language_tag IS DISTINCT FROM NEW.language_tag
     OR NEW.lexical_token_overlap IS DISTINCT FROM
       app.keyword_relation_token_overlap(
         keyword_a.normalized_keyword,
         keyword_b.normalized_keyword
       )
     OR keyword_a.intent IS NULL
     OR keyword_b.intent IS NULL
     OR app.normalize_keyword_relation_semantic(keyword_a.intent)
       IS DISTINCT FROM NEW.normalized_intent
     OR app.normalize_keyword_relation_semantic(keyword_b.intent)
       IS DISTINCT FROM NEW.normalized_intent THEN
    RAISE EXCEPTION 'Keyword Relation candidate is not current and eligible'
      USING ERRCODE = '23514';
  END IF;

  NEW.candidate_revision := coalesce(
    (
      SELECT max(existing.candidate_revision)
      FROM app.keyword_relation_candidates existing
      WHERE existing.workspace_id = NEW.workspace_id
        AND existing.project_id = NEW.project_id
        AND existing.relation_id = NEW.relation_id
    ),
    0
  ) + 1;

  expected_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'ruleVersion', NEW.rule_version,
          'keywordA', jsonb_build_object(
            'keywordId', NEW.keyword_a_id,
            'displayKeyword', NEW.keyword_a_display_keyword,
            'normalizedKeyword', NEW.keyword_a_normalized_keyword,
            'governanceRevision',
              NEW.keyword_a_governance_revision,
            'topicNodeId', NEW.keyword_a_topic_node_id,
            'topicModelRevision',
              NEW.keyword_a_topic_model_revision
          ),
          'keywordB', jsonb_build_object(
            'keywordId', NEW.keyword_b_id,
            'displayKeyword', NEW.keyword_b_display_keyword,
            'normalizedKeyword', NEW.keyword_b_normalized_keyword,
            'governanceRevision',
              NEW.keyword_b_governance_revision,
            'topicNodeId', NEW.keyword_b_topic_node_id,
            'topicModelRevision',
              NEW.keyword_b_topic_model_revision
          ),
          'mappedSitePageId', NEW.mapped_site_page_id,
          'normalizedIntent', NEW.normalized_intent,
          'market', NEW.market,
          'languageTag', NEW.language_tag,
          'sameConfirmedTopic', NEW.same_confirmed_topic,
          'lexicalTokenOverlap', NEW.lexical_token_overlap,
          'serpOverlapAvailability',
            NEW.serp_overlap_availability,
          'serpOverlap', NEW.serp_overlap,
          'serpOverlapLimitation',
            NEW.serp_overlap_limitation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  NEW.evidence_hash := expected_hash;
  RETURN NEW;
END;
$$;

CREATE TRIGGER keyword_relation_candidates_insert_guard
  BEFORE INSERT ON app.keyword_relation_candidates
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_relation_candidate_insert();

CREATE TRIGGER keyword_relation_identities_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER keyword_relation_candidates_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_candidates
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_relation_decision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relation app.keyword_relation_identities%ROWTYPE;
  candidate app.keyword_relation_candidates%ROWTYPE;
  expected_revision integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || NEW.workspace_id::text || ':'
      || NEW.project_id::text,
    0
  ));

  SELECT * INTO relation
  FROM app.keyword_relation_identities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.relation_id
  FOR UPDATE;
  SELECT * INTO candidate
  FROM app.keyword_relation_candidates
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND relation_id = NEW.relation_id
    AND id = NEW.candidate_id;

  IF relation.id IS NULL OR candidate.id IS NULL
     OR candidate.candidate_revision <> (
       SELECT max(latest.candidate_revision)
       FROM app.keyword_relation_candidates latest
       WHERE latest.workspace_id = NEW.workspace_id
         AND latest.project_id = NEW.project_id
         AND latest.relation_id = NEW.relation_id
     )
     OR cardinality(
       app.keyword_relation_candidate_stale_reasons(candidate.id)
     ) <> 0 THEN
    RAISE EXCEPTION 'Keyword Relation decision requires the current candidate'
      USING ERRCODE = '55000';
  END IF;

  expected_revision := coalesce(
    (
      SELECT max(existing.relation_revision)
      FROM app.keyword_relation_decisions existing
      WHERE existing.workspace_id = NEW.workspace_id
        AND existing.project_id = NEW.project_id
        AND existing.relation_id = NEW.relation_id
    ),
    0
  ) + 1;
  IF NEW.relation_revision <> expected_revision THEN
    RAISE EXCEPTION 'Keyword Relation decision revision is stale'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.decision_kind = 'primary_supporting' THEN
    IF NOT (
      (
        NEW.primary_keyword_id = relation.keyword_a_id
        AND NEW.supporting_keyword_id = relation.keyword_b_id
      )
      OR (
        NEW.primary_keyword_id = relation.keyword_b_id
        AND NEW.supporting_keyword_id = relation.keyword_a_id
      )
    ) THEN
      RAISE EXCEPTION 'Fold decision must use the exact relation pair'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      WITH latest_decisions AS (
        SELECT DISTINCT ON (
          decision.workspace_id,
          decision.project_id,
          decision.relation_id
        )
          decision.*
        FROM app.keyword_relation_decisions decision
        WHERE decision.workspace_id = NEW.workspace_id
          AND decision.project_id = NEW.project_id
          AND decision.relation_id <> NEW.relation_id
        ORDER BY
          decision.workspace_id,
          decision.project_id,
          decision.relation_id,
          decision.relation_revision DESC,
          decision.id DESC
      )
      SELECT 1
      FROM latest_decisions decision
      WHERE decision.decision_kind = 'primary_supporting'
        AND cardinality(
          app.keyword_relation_candidate_stale_reasons(
            decision.candidate_id
          )
        ) = 0
        AND (
          decision.supporting_keyword_id IN (
            NEW.primary_keyword_id,
            NEW.supporting_keyword_id
          )
          OR decision.primary_keyword_id =
            NEW.supporting_keyword_id
        )
    ) THEN
      RAISE EXCEPTION 'Keyword folds cannot create chains or cycles'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER keyword_relation_decisions_insert_guard
  BEFORE INSERT ON app.keyword_relation_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_relation_decision_insert();

CREATE TRIGGER keyword_relation_decisions_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0025_keyword_relation_governance'::text AS migration_version;

COMMIT;
