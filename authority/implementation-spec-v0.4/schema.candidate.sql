-- Nevermore v0.4 publication persistence candidate.
-- REVIEW ONLY / NON-NORMATIVE: this file is not an ordered migration and must
-- not be applied before the Task 8 atomic promotion gate.
--
-- async_runs remains status truth. These append-only rows own durable Artifact
-- approval events, destination revisions, frozen external-write requests, and
-- immutable provider receipts. They reference the canonical target_ref already
-- owned by the Action/Finding chain; they do not create, normalize, or own
-- another target identity.

BEGIN;

-- Extend the canonical async-run axis without deleting any historical value.
-- Publication tables do not own status; async_runs remains status truth.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check
  CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt'
    )
  );

-- A ready execution_artifacts row is not approval authority. This ledger binds
-- a human review to one exact immutable artifact revision and content hash.
CREATE TABLE app.artifact_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL CHECK (artifact_revision >= 1),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  event_kind text NOT NULL
    CHECK (event_kind IN ('approved', 'revoked', 'superseded')),
  supersedes_approval_event_id uuid,
  supersedes_approval_event_kind text,
  event_actor_id uuid NOT NULL,
  reviewer_actor_id uuid,
  qa_gate_version text NOT NULL
    CHECK (length(btrim(qa_gate_version)) BETWEEN 1 AND 100),
  qa_gate_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(qa_gate_snapshot) = 'object'),
  qa_gate_snapshot_hash text NOT NULL
    CHECK (qa_gate_snapshot_hash ~ '^[a-f0-9]{64}$'),
  customer_acknowledgement jsonb NOT NULL
    CHECK (
      jsonb_typeof(customer_acknowledgement) = 'object'
      AND customer_acknowledgement ? 'customerAcknowledgementId'
      AND customer_acknowledgement ? 'actorId'
      AND customer_acknowledgement ? 'acknowledgedAt'
    ),
  customer_acknowledgement_hash text NOT NULL
    CHECK (customer_acknowledgement_hash ~ '^[a-f0-9]{64}$'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (id, event_kind),
  FOREIGN KEY (supersedes_approval_event_id, supersedes_approval_event_kind)
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (
    (
      event_kind = 'approved'
      AND supersedes_approval_event_id IS NULL
      AND supersedes_approval_event_kind IS NULL
      AND reviewer_actor_id IS NOT NULL
      AND event_actor_id = reviewer_actor_id
      AND reason IS NULL
    )
    OR (
      event_kind IN ('revoked', 'superseded')
      AND supersedes_approval_event_id IS NOT NULL
      AND supersedes_approval_event_kind = 'approved'
      AND reviewer_actor_id IS NULL
      AND length(btrim(reason)) >= 3
    )
  )
);

CREATE UNIQUE INDEX artifact_approval_events_one_approval_per_revision_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_revision_id
  )
  WHERE event_kind = 'approved';

CREATE UNIQUE INDEX artifact_approval_events_one_terminal_per_event_idx
  ON app.artifact_approval_events(supersedes_approval_event_id)
  WHERE event_kind IN ('revoked', 'superseded');

CREATE INDEX artifact_approval_events_artifact_timeline_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_id,
    created_at,
    id
  );

CREATE TABLE app.publication_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_ref uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  supersedes_id uuid REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  -- canonical target_ref is copied only as an immutable lineage reference.
  target_ref text NOT NULL CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  state text NOT NULL CHECK (state IN ('pending', 'ready', 'unavailable', 'revoked')),
  provider_scope jsonb NOT NULL CHECK (jsonb_typeof(provider_scope) = 'object'),
  provider_scope_hash text NOT NULL CHECK (provider_scope_hash ~ '^[a-f0-9]{64}$'),
  encrypted_secret_ref text
    CHECK (
      encrypted_secret_ref IS NULL
      OR length(btrim(encrypted_secret_ref)) BETWEEN 1 AND 512
    ),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  readiness_observation jsonb NOT NULL
    CHECK (jsonb_typeof(readiness_observation) = 'object'),
  limitation text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, destination_ref, revision),
  UNIQUE (workspace_id, project_id, id),
  CHECK (
    (revision = 1 AND supersedes_id IS NULL)
    OR (revision > 1 AND supersedes_id IS NOT NULL)
  ),
  CHECK (
    (provider_kind = 'github' AND encrypted_secret_ref IS NULL)
    OR (provider_kind = 'wordpress' AND encrypted_secret_ref IS NOT NULL)
  ),
  CHECK ((state = 'ready') = (limitation IS NULL) OR state <> 'ready')
);

CREATE INDEX publication_destinations_project_ref_revision_idx
  ON app.publication_destinations(
    workspace_id,
    project_id,
    destination_ref,
    revision DESC
  );

CREATE TABLE app.publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_kind text NOT NULL
    CHECK (attempt_kind IN ('publish', 'rollback')),
  source_publication_attempt_id uuid
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  async_run_id uuid NOT NULL UNIQUE REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  destination_ref uuid NOT NULL,
  destination_revision integer NOT NULL CHECK (destination_revision >= 1),
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  approved_artifact_revision integer NOT NULL CHECK (approved_artifact_revision >= 1),
  approved_artifact_content_hash text NOT NULL
    CHECK (approved_artifact_content_hash ~ '^[a-f0-9]{64}$'),
  publication_approval_event_id uuid,
  publication_approval_event_kind text,
  source_approval_event_id uuid,
  source_approval_event_kind text,
  side_effect_class text NOT NULL
    CHECK (side_effect_class = 'external_write'),
  authorization_purpose text NOT NULL
    CHECK (authorization_purpose IN ('publish', 'rollback')),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  preview_ref text NOT NULL CHECK (length(btrim(preview_ref)) BETWEEN 1 AND 1024),
  preview_checksum text NOT NULL CHECK (preview_checksum ~ '^[a-f0-9]{64}$'),
  remote_precondition jsonb NOT NULL
    CHECK (
      jsonb_typeof(remote_precondition) = 'object'
      AND remote_precondition ? 'kind'
    ),
  rollback_plan jsonb NOT NULL
    CHECK (jsonb_typeof(rollback_plan) = 'object'),
  idempotency_key text NOT NULL
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[ -~]+$'
    ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key),
  UNIQUE (
    workspace_id,
    project_id,
    destination_ref,
    destination_revision,
    request_hash
  ),
  FOREIGN KEY (
    publication_approval_event_id,
    publication_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_approval_event_id, source_approval_event_kind)
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (
    (
      attempt_kind = 'publish'
      AND source_publication_attempt_id IS NULL
      AND publication_approval_event_id IS NOT NULL
      AND publication_approval_event_kind = 'approved'
      AND source_approval_event_id IS NULL
      AND source_approval_event_kind IS NULL
      AND authorization_purpose = 'publish'
    )
    OR
    (
      attempt_kind = 'rollback'
      AND source_publication_attempt_id IS NOT NULL
      AND publication_approval_event_id IS NULL
      AND publication_approval_event_kind IS NULL
      AND source_approval_event_id IS NOT NULL
      AND source_approval_event_kind = 'approved'
      AND authorization_purpose = 'rollback'
    )
  )
);

CREATE INDEX publication_attempts_target_timeline_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    target_ref,
    requested_at DESC,
    id DESC
  );

CREATE INDEX publication_attempts_source_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    source_publication_attempt_id
  )
  WHERE source_publication_attempt_id IS NOT NULL;

CREATE TABLE app.publication_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  publication_attempt_id uuid NOT NULL REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  receipt_kind text NOT NULL
    CHECK (receipt_kind IN ('delivery_receipt', 'change_receipt')),
  predecessor_delivery_receipt_id uuid
    REFERENCES app.publication_receipts(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  provider_request_id text NOT NULL
    CHECK (length(btrim(provider_request_id)) BETWEEN 1 AND 512),
  remote_scope_ref text NOT NULL
    CHECK (length(btrim(remote_scope_ref)) BETWEEN 1 AND 1024),
  remote_object_kind text NOT NULL
    CHECK (
      remote_object_kind IN (
        'github_pull_request',
        'github_merge',
        'wordpress_post',
        'wordpress_revision'
      )
    ),
  remote_object_id text NOT NULL
    CHECK (length(btrim(remote_object_id)) BETWEEN 1 AND 512),
  remote_revision text NOT NULL
    CHECK (length(btrim(remote_revision)) BETWEEN 1 AND 512),
  delivery_url text CHECK (delivery_url IS NULL OR delivery_url ~ '^https?://'),
  live_canonical_url text
    CHECK (live_canonical_url IS NULL OR live_canonical_url ~ '^https?://'),
  content_checksum text NOT NULL CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  verification_state text NOT NULL
    CHECK (
      verification_state IN (
        'provider_accepted',
        'pending',
        'verified_live',
        'unavailable'
      )
    ),
  remote_facts jsonb NOT NULL CHECK (jsonb_typeof(remote_facts) = 'object'),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
  limitation text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (publication_attempt_id, receipt_kind),
  CHECK (
    (
      receipt_kind = 'delivery_receipt'
      AND predecessor_delivery_receipt_id IS NULL
    )
    OR (
      receipt_kind = 'change_receipt'
      AND predecessor_delivery_receipt_id IS NOT NULL
    )
  ),
  CHECK (
    receipt_kind <> 'change_receipt'
    OR (
      verification_state = 'verified_live'
      AND live_canonical_url IS NOT NULL
      AND jsonb_array_length(evidence_refs) >= 1
      AND limitation IS NULL
    )
  ),
  CHECK (
    receipt_kind <> 'delivery_receipt'
    OR verification_state IN ('provider_accepted', 'pending', 'unavailable')
  )
);

CREATE INDEX publication_receipts_attempt_timeline_idx
  ON app.publication_receipts(
    workspace_id,
    project_id,
    publication_attempt_id,
    observed_at,
    id
  );

CREATE FUNCTION app.enforce_publication_receipt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor app.publication_receipts%ROWTYPE;
BEGIN
  IF NEW.receipt_kind <> 'change_receipt' THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO predecessor
    FROM app.publication_receipts
   WHERE id = NEW.predecessor_delivery_receipt_id
   FOR KEY SHARE;

  IF NOT FOUND
     OR predecessor.receipt_kind <> 'delivery_receipt'
     OR predecessor.publication_attempt_id <> NEW.publication_attempt_id
     OR predecessor.provider_kind <> NEW.provider_kind
     OR predecessor.content_checksum <> NEW.content_checksum
     OR predecessor.remote_scope_ref <> NEW.remote_scope_ref
     OR predecessor.observed_at > NEW.observed_at THEN
    RAISE EXCEPTION
      'change_receipt requires an earlier same-attempt delivery_receipt with matching provider, checksum, and remote scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER publication_receipts_lineage_guard
BEFORE INSERT ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_receipt_lineage();

CREATE TRIGGER artifact_approval_events_append_only
BEFORE UPDATE OR DELETE ON app.artifact_approval_events
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER publication_destinations_append_only
BEFORE UPDATE OR DELETE ON app.publication_destinations
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER publication_attempts_append_only
BEFORE UPDATE OR DELETE ON app.publication_attempts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER publication_receipts_append_only
BEFORE UPDATE OR DELETE ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Candidate repository/trigger invariants that must accompany promotion:
--
-- 1. A destination revision's workspace/project/site and target_ref must match
--    the canonical Project/Site/Action target lineage.
-- 2. A revision N > 1 must supersede revision N-1 of the same destination_ref.
-- 3. Approval insert must prove artifact_revision_id, artifact_revision and
--    artifact_content_hash match the same canonical artifact_revisions row.
--    An approved event has event_actor_id = reviewer_actor_id. A terminal event
--    records event_actor_id, leaves reviewer_actor_id null and points to an
--    earlier approved event in the same workspace/project/artifact lineage.
-- 4. A publish attempt must bind the latest ready destination revision, an exact
--    artifact_revisions row, the current publication approval with no later
--    revocation/supersession, and an async_run with kind publication,
--    result_type publication_attempt, result_id equal to the attempt id, and
--    active_key publication:<destination_ref>:<target_ref>.
-- 5. A publish attempt has no source attempt and authorization_purpose=publish.
--    A rollback attempt points to a prior verified change in the same
--    scope/provider/target; source_approval_event_id is historical lineage only.
--    It freezes a fresh authorization_purpose=rollback snapshot, acknowledgement,
--    preview, current remote precondition and resolved rollback plan.
-- 6. Idempotent same-hash replay returns the existing attempt/run/receipts
--    without a provider call. Different-hash conflict returns 409. Stale replay
--    with the original key is read-only; a new key revalidates current facts.
-- 7. A change_receipt requires a prior same-attempt delivery_receipt whose
--    provider, content checksum and remote_scope_ref match, plus provider and
--    live canonical verification.
-- 8. No receipt row contains outcome metrics or directly drives positive
--    Results; Task 9 observations remain the only measurement truth.

ROLLBACK;
