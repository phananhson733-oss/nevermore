BEGIN;

-- Publication is a first-class async run. Preserve every historical kind and
-- result type while widening the closed database vocabulary.
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

-- A server-issued grant is the durable authority and credential boundary.
-- GitHub stores installation/account/permission lineage only. WordPress stores
-- AES-GCM ciphertext and key metadata; there is no dangling vault:// pointer.
CREATE TABLE IF NOT EXISTS app.delivery_authorization_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  purpose text NOT NULL
    CHECK (purpose IN ('connector_configuration', 'publish', 'rollback')),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'consumed', 'revoked', 'expired')),
  destination_ref uuid,
  destination_revision integer
    CHECK (destination_revision IS NULL OR destination_revision >= 1),
  target_ref text
    CHECK (
      target_ref IS NULL
      OR length(btrim(target_ref)) BETWEEN 1 AND 2048
    ),
  requested_scope jsonb NOT NULL
    CHECK (jsonb_typeof(requested_scope) = 'object'),
  requested_scope_hash text NOT NULL
    CHECK (requested_scope_hash ~ '^[a-f0-9]{64}$'),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload bytea,
  cipher_version smallint CHECK (cipher_version IS NULL OR cipher_version >= 1),
  key_version text
    CHECK (key_version IS NULL OR length(btrim(key_version)) >= 1),
  secret_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(secret_metadata) = 'object'),
  expires_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text
    CHECK (
      revocation_reason IS NULL
      OR length(btrim(revocation_reason)) BETWEEN 3 AND 1000
    ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  CHECK (
    (
      destination_ref IS NULL
      AND destination_revision IS NULL
      AND target_ref IS NULL
    )
    OR (
      destination_ref IS NOT NULL
      AND destination_revision IS NOT NULL
      AND target_ref IS NOT NULL
    )
  ),
  CHECK (
    purpose = 'connector_configuration'
    OR expires_at IS NOT NULL
  ),
  CHECK (
    state <> 'consumed'
    OR expires_at IS NULL
    OR consumed_at <= expires_at
  ),
  CHECK (
    (
      provider_kind = 'github'
      AND encrypted_payload IS NULL
      AND cipher_version IS NULL
      AND key_version IS NULL
      AND secret_metadata = '{}'::jsonb
    )
    OR (
      provider_kind = 'wordpress'
      AND encrypted_payload IS NOT NULL
      AND octet_length(encrypted_payload) >= 32
      AND cipher_version IS NOT NULL
      AND key_version IS NOT NULL
    )
  ),
  CHECK (
    (
      state = 'ready'
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
    OR (
      state = 'consumed'
      AND consumed_at IS NOT NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
    OR (
      state = 'revoked'
      AND revoked_at IS NOT NULL
      AND revoked_by IS NOT NULL
      AND revocation_reason IS NOT NULL
    )
    OR (
      state = 'expired'
      AND expires_at IS NOT NULL
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS delivery_authorization_grants_project_state_idx
  ON app.delivery_authorization_grants(
    workspace_id,
    project_id,
    state,
    expires_at,
    created_at DESC,
    id DESC
  );

-- A ready Artifact is not approval authority. This append-only event ledger
-- binds one authenticated reviewer to one exact immutable revision and QA gate.
CREATE TABLE IF NOT EXISTS app.artifact_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
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
      AND customer_acknowledgement ? 'acknowledgementScope'
    ),
  customer_acknowledgement_hash text NOT NULL
    CHECK (customer_acknowledgement_hash ~ '^[a-f0-9]{64}$'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (id, event_kind),
  FOREIGN KEY (
    supersedes_approval_event_id,
    supersedes_approval_event_kind
  )
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

CREATE UNIQUE INDEX IF NOT EXISTS artifact_approval_events_one_approval_per_revision_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_revision_id
  )
  WHERE event_kind = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS artifact_approval_events_one_terminal_per_event_idx
  ON app.artifact_approval_events(supersedes_approval_event_id)
  WHERE event_kind IN ('revoked', 'superseded');

CREATE INDEX IF NOT EXISTS artifact_approval_events_artifact_timeline_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_id,
    created_at,
    id
  );

-- Delivery connections are append-only revisions. Each non-revocation revision
-- consumes one exact connector_configuration grant.
CREATE TABLE IF NOT EXISTS app.publication_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_ref uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  supersedes_id uuid
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  state text NOT NULL
    CHECK (state IN ('pending', 'ready', 'unavailable', 'revoked')),
  authorization_grant_id uuid NOT NULL
    REFERENCES app.delivery_authorization_grants(id) ON DELETE RESTRICT,
  provider_scope jsonb NOT NULL
    CHECK (jsonb_typeof(provider_scope) = 'object'),
  provider_scope_hash text NOT NULL
    CHECK (provider_scope_hash ~ '^[a-f0-9]{64}$'),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  readiness_observation jsonb NOT NULL
    CHECK (jsonb_typeof(readiness_observation) = 'object'),
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 2000
    ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, destination_ref, revision),
  UNIQUE (workspace_id, project_id, id),
  CHECK (
    (revision = 1 AND supersedes_id IS NULL)
    OR (revision > 1 AND supersedes_id IS NOT NULL)
  ),
  CHECK (
    state <> 'revoked'
    OR (revision > 1 AND supersedes_id IS NOT NULL)
  ),
  CHECK (state <> 'ready' OR limitation IS NULL),
  CHECK (
    state NOT IN ('unavailable', 'revoked')
    OR limitation IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS publication_destinations_project_ref_revision_idx
  ON app.publication_destinations(
    workspace_id,
    project_id,
    destination_ref,
    revision DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS publication_destinations_one_consuming_grant_idx
  ON app.publication_destinations(authorization_grant_id)
  WHERE state <> 'revoked';

-- A preview is server-issued publication authority, not browser-owned plan
-- data. Each issued event freezes one exact Artifact Revision, approval,
-- Destination Revision, provider plan and rollback plan. Revocation and
-- supersession are append-only terminal events that preserve that lineage.
CREATE TABLE IF NOT EXISTS app.publication_preview_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_ref text NOT NULL
    CHECK (
      length(preview_ref) BETWEEN 32 AND 1024
      AND preview_ref ~ '^[A-Za-z0-9._~-]+$'
    ),
  event_kind text NOT NULL
    CHECK (event_kind IN ('issued', 'revoked', 'superseded')),
  supersedes_preview_event_id uuid,
  supersedes_preview_event_kind text,
  preview_kind text NOT NULL
    CHECK (preview_kind IN ('publish', 'rollback')),
  facts_schema_version text NOT NULL
    CHECK (length(btrim(facts_schema_version)) BETWEEN 1 AND 100),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  destination_ref uuid NOT NULL,
  destination_revision integer NOT NULL CHECK (destination_revision >= 1),
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL CHECK (artifact_revision >= 1),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  artifact_approval_event_id uuid NOT NULL,
  artifact_approval_event_kind text NOT NULL,
  source_publication_attempt_id uuid,
  source_change_receipt_id uuid,
  provider_plan jsonb NOT NULL
    CHECK (
      jsonb_typeof(provider_plan) = 'object'
      AND provider_plan ? 'providerKind'
    ),
  remote_precondition jsonb NOT NULL
    CHECK (
      jsonb_typeof(remote_precondition) = 'object'
      AND remote_precondition ? 'kind'
    ),
  rollback_plan jsonb NOT NULL
    CHECK (
      jsonb_typeof(rollback_plan) = 'object'
      AND rollback_plan ? 'providerKind'
    ),
  preview_checksum text NOT NULL
    CHECK (preview_checksum ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  event_actor_id uuid NOT NULL,
  idempotency_key text NOT NULL
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[ -~]+$'
    ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reason text
    CHECK (
      reason IS NULL
      OR length(btrim(reason)) BETWEEN 3 AND 2000
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (id, event_kind),
  UNIQUE (workspace_id, project_id, idempotency_key),
  FOREIGN KEY (
    supersedes_preview_event_id,
    supersedes_preview_event_kind
  )
    REFERENCES app.publication_preview_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    artifact_approval_event_id,
    artifact_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (artifact_approval_event_kind = 'approved'),
  CHECK (preview_checksum = artifact_content_hash),
  CHECK (provider_plan->>'providerKind' = provider_kind),
  CHECK (rollback_plan->>'providerKind' = provider_kind),
  CHECK (expires_at > created_at),
  CHECK (
    (
      event_kind = 'issued'
      AND supersedes_preview_event_id IS NULL
      AND supersedes_preview_event_kind IS NULL
      AND reason IS NULL
    )
    OR (
      event_kind IN ('revoked', 'superseded')
      AND supersedes_preview_event_id IS NOT NULL
      AND supersedes_preview_event_kind = 'issued'
      AND reason IS NOT NULL
    )
  ),
  CHECK (
    (
      preview_kind = 'publish'
      AND source_publication_attempt_id IS NULL
      AND source_change_receipt_id IS NULL
    )
    OR (
      preview_kind = 'rollback'
      AND source_publication_attempt_id IS NOT NULL
      AND source_change_receipt_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS publication_preview_events_issued_ref_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    preview_ref
  )
  WHERE event_kind = 'issued';

CREATE UNIQUE INDEX IF NOT EXISTS publication_preview_events_one_terminal_per_event_idx
  ON app.publication_preview_events(supersedes_preview_event_id)
  WHERE event_kind IN ('revoked', 'superseded');

CREATE INDEX IF NOT EXISTS publication_preview_events_project_ref_timeline_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    preview_ref,
    created_at,
    id
  );

CREATE INDEX IF NOT EXISTS publication_preview_events_artifact_destination_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    artifact_revision_id,
    destination_ref,
    destination_revision,
    created_at DESC
  )
  WHERE event_kind = 'issued';

-- Frozen external-write requests. Lifecycle status is intentionally absent:
-- app.async_runs is the only queued/running/terminal truth.
CREATE TABLE IF NOT EXISTS app.publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_kind text NOT NULL
    CHECK (attempt_kind IN ('publish', 'rollback')),
  source_publication_attempt_id uuid
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  source_change_receipt_id uuid,
  preview_event_id uuid NOT NULL,
  preview_event_kind text NOT NULL
    CHECK (preview_event_kind = 'issued'),
  preview_facts_hash text NOT NULL
    CHECK (preview_facts_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  async_run_id uuid NOT NULL UNIQUE
    REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  destination_ref uuid NOT NULL,
  destination_revision integer NOT NULL CHECK (destination_revision >= 1),
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  approved_artifact_revision integer NOT NULL
    CHECK (approved_artifact_revision >= 1),
  approved_artifact_content_hash text NOT NULL
    CHECK (approved_artifact_content_hash ~ '^[a-f0-9]{64}$'),
  publication_approval_event_id uuid,
  publication_approval_event_kind text,
  source_approval_event_id uuid,
  source_approval_event_kind text,
  side_effect_class text NOT NULL CHECK (side_effect_class = 'external_write'),
  authorization_grant_id uuid NOT NULL UNIQUE
    REFERENCES app.delivery_authorization_grants(id) ON DELETE RESTRICT,
  authorization_purpose text NOT NULL
    CHECK (authorization_purpose IN ('publish', 'rollback')),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  preview_ref text NOT NULL
    CHECK (length(btrim(preview_ref)) BETWEEN 1 AND 1024),
  preview_checksum text NOT NULL
    CHECK (preview_checksum ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
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
  UNIQUE (workspace_id, project_id, preview_event_id),
  UNIQUE (
    workspace_id,
    project_id,
    destination_ref,
    destination_revision,
    request_hash
  ),
  FOREIGN KEY (
    preview_event_id,
    preview_event_kind
  )
    REFERENCES app.publication_preview_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    publication_approval_event_id,
    publication_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    source_approval_event_id,
    source_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (
    (
      attempt_kind = 'publish'
      AND source_publication_attempt_id IS NULL
      AND source_change_receipt_id IS NULL
      AND publication_approval_event_id IS NOT NULL
      AND publication_approval_event_kind = 'approved'
      AND source_approval_event_id IS NULL
      AND source_approval_event_kind IS NULL
      AND authorization_purpose = 'publish'
    )
    OR (
      attempt_kind = 'rollback'
      AND source_publication_attempt_id IS NOT NULL
      AND source_change_receipt_id IS NOT NULL
      AND publication_approval_event_id IS NULL
      AND publication_approval_event_kind IS NULL
      AND source_approval_event_id IS NOT NULL
      AND source_approval_event_kind = 'approved'
      AND authorization_purpose = 'rollback'
    )
  )
);

CREATE INDEX IF NOT EXISTS publication_attempts_target_timeline_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    target_ref,
    requested_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS publication_attempts_source_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    source_publication_attempt_id
  )
  WHERE source_publication_attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.publication_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  publication_attempt_id uuid NOT NULL
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  receipt_kind text NOT NULL
    CHECK (receipt_kind IN ('delivery_receipt', 'change_receipt')),
  predecessor_delivery_receipt_id uuid
    REFERENCES app.publication_receipts(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  provider_request_id text
    CHECK (
      provider_request_id IS NULL
      OR length(btrim(provider_request_id)) BETWEEN 1 AND 512
    ),
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
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
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
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 2000
    ),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (publication_attempt_id, receipt_kind),
  CHECK (
    (
      receipt_kind = 'delivery_receipt'
      AND predecessor_delivery_receipt_id IS NULL
      AND live_canonical_url IS NULL
      AND verification_state IN ('provider_accepted', 'pending', 'unavailable')
      AND remote_object_kind IN ('github_pull_request', 'wordpress_post')
      AND (
        verification_state <> 'unavailable'
        OR limitation IS NOT NULL
      )
    )
    OR (
      receipt_kind = 'change_receipt'
      AND predecessor_delivery_receipt_id IS NOT NULL
      AND verification_state = 'verified_live'
      AND live_canonical_url IS NOT NULL
      AND jsonb_array_length(evidence_refs) >= 1
      AND limitation IS NULL
      AND remote_object_kind IN ('github_merge', 'wordpress_revision')
    )
  ),
  CHECK (
    (
      provider_kind = 'github'
      AND remote_object_kind IN ('github_pull_request', 'github_merge')
    )
    OR (
      provider_kind = 'wordpress'
      AND remote_object_kind IN ('wordpress_post', 'wordpress_revision')
    )
  )
);

ALTER TABLE app.publication_attempts
  ADD CONSTRAINT publication_attempts_source_change_receipt_fk
  FOREIGN KEY (source_change_receipt_id)
  REFERENCES app.publication_receipts(id)
  ON DELETE RESTRICT;

ALTER TABLE app.publication_preview_events
  ADD CONSTRAINT publication_preview_events_source_attempt_fk
  FOREIGN KEY (source_publication_attempt_id)
  REFERENCES app.publication_attempts(id)
  ON DELETE RESTRICT;

ALTER TABLE app.publication_preview_events
  ADD CONSTRAINT publication_preview_events_source_change_receipt_fk
  FOREIGN KEY (source_change_receipt_id)
  REFERENCES app.publication_receipts(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS publication_receipts_attempt_timeline_idx
  ON app.publication_receipts(
    workspace_id,
    project_id,
    publication_attempt_id,
    observed_at,
    id
  );

COMMENT ON COLUMN app.publication_attempts.approved_artifact_content_hash IS
  'JCS SHA-256 identity of the approved Artifact content object';
COMMENT ON COLUMN app.publication_preview_events.preview_checksum IS
  'JCS SHA-256 identity of the exact immutable Artifact Revision';
COMMENT ON COLUMN app.publication_preview_events.content_checksum IS
  'SHA-256 of the exact UTF-8 content bytes the provider plan will write';
COMMENT ON COLUMN app.publication_preview_events.facts_hash IS
  'JCS SHA-256 of the complete server-issued publication preview facts';
COMMENT ON COLUMN app.publication_attempts.preview_checksum IS
  'JCS SHA-256 identity of the exact approved Artifact preview';
COMMENT ON COLUMN app.publication_attempts.content_checksum IS
  'SHA-256 of the exact UTF-8 content bytes submitted to the provider';
COMMENT ON COLUMN app.publication_receipts.artifact_content_hash IS
  'JCS SHA-256 identity of the approved Artifact bound to this receipt';
COMMENT ON COLUMN app.publication_receipts.content_checksum IS
  'SHA-256 of the exact provider content bytes observed by this receipt';

CREATE OR REPLACE FUNCTION app.enforce_delivery_authorization_grant_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM app.sites site_row
        JOIN app.client_projects project_row
          ON project_row.id = site_row.project_id
         AND project_row.workspace_id = site_row.workspace_id
       WHERE site_row.id = NEW.site_id
         AND site_row.workspace_id = NEW.workspace_id
         AND site_row.project_id = NEW.project_id
         AND project_row.id = NEW.project_id
         AND project_row.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'delivery authorization grant requires an active same-scope site and project'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.purpose IN ('publish', 'rollback')
       AND (NEW.expires_at IS NULL OR NEW.expires_at <= now()) THEN
      RAISE EXCEPTION
        'publish and rollback authorization grants require a future expiry'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.provider_kind IS DISTINCT FROM OLD.provider_kind
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.destination_ref IS DISTINCT FROM OLD.destination_ref
     OR NEW.destination_revision IS DISTINCT FROM OLD.destination_revision
     OR NEW.target_ref IS DISTINCT FROM OLD.target_ref
     OR NEW.requested_scope IS DISTINCT FROM OLD.requested_scope
     OR NEW.requested_scope_hash IS DISTINCT FROM OLD.requested_scope_hash
     OR NEW.authorization_snapshot IS DISTINCT FROM OLD.authorization_snapshot
     OR NEW.authorization_snapshot_hash IS DISTINCT FROM OLD.authorization_snapshot_hash
     OR NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload
     OR NEW.cipher_version IS DISTINCT FROM OLD.cipher_version
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.secret_metadata IS DISTINCT FROM OLD.secret_metadata
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'delivery authorization grant immutable facts cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'ready' AND NEW.state IN ('consumed', 'revoked', 'expired') THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'consumed' AND NEW.state = 'revoked' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'delivery authorization grant transition is invalid'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_artifact_approval_event_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact_row app.execution_artifacts%ROWTYPE;
  revision_row app.artifact_revisions%ROWTYPE;
  source_row app.artifact_approval_events%ROWTYPE;
BEGIN
  IF NEW.event_kind = 'approved' THEN
    SELECT * INTO artifact_row
      FROM app.execution_artifacts
     WHERE id = NEW.artifact_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
     FOR UPDATE;
    SELECT * INTO revision_row
      FROM app.artifact_revisions
     WHERE id = NEW.artifact_revision_id
       AND artifact_id = NEW.artifact_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id;
    IF artifact_row.id IS NULL
       OR revision_row.id IS NULL
       OR artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM NEW.artifact_content_hash
       OR revision_row.revision <> NEW.artifact_revision
       OR revision_row.content_hash IS DISTINCT FROM NEW.artifact_content_hash THEN
      RAISE EXCEPTION 'approval requires the exact current ready Artifact Revision'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO source_row
    FROM app.artifact_approval_events
   WHERE id = NEW.supersedes_approval_event_id
     AND event_kind = 'approved'
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND artifact_id = NEW.artifact_id
   FOR UPDATE;
  IF source_row.id IS NULL
     OR NEW.artifact_revision_id IS DISTINCT FROM source_row.artifact_revision_id
     OR NEW.artifact_revision IS DISTINCT FROM source_row.artifact_revision
     OR NEW.artifact_content_hash IS DISTINCT FROM source_row.artifact_content_hash
     OR NEW.qa_gate_version IS DISTINCT FROM source_row.qa_gate_version
     OR NEW.qa_gate_snapshot IS DISTINCT FROM source_row.qa_gate_snapshot
     OR NEW.qa_gate_snapshot_hash IS DISTINCT FROM source_row.qa_gate_snapshot_hash
     OR NEW.customer_acknowledgement IS DISTINCT FROM source_row.customer_acknowledgement
     OR NEW.customer_acknowledgement_hash IS DISTINCT FROM source_row.customer_acknowledgement_hash THEN
    RAISE EXCEPTION 'terminal approval event must preserve source approval lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_destination_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor app.publication_destinations%ROWTYPE;
  grant_row app.delivery_authorization_grants%ROWTYPE;
BEGIN
  IF NEW.revision = 1 THEN
    IF EXISTS (
      SELECT 1 FROM app.publication_destinations
       WHERE workspace_id = NEW.workspace_id
         AND project_id = NEW.project_id
         AND destination_ref = NEW.destination_ref
    ) THEN
      RAISE EXCEPTION 'destination revision 1 already exists'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO predecessor
      FROM app.publication_destinations
     WHERE id = NEW.supersedes_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND destination_ref = NEW.destination_ref
     FOR UPDATE;
    IF predecessor.id IS NULL
       OR predecessor.revision <> NEW.revision - 1
       OR predecessor.site_id IS DISTINCT FROM NEW.site_id
       OR predecessor.provider_kind IS DISTINCT FROM NEW.provider_kind
       OR predecessor.target_ref IS DISTINCT FROM NEW.target_ref THEN
      RAISE EXCEPTION 'destination revision does not supersede its exact predecessor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO grant_row
    FROM app.delivery_authorization_grants
   WHERE id = NEW.authorization_grant_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
   FOR UPDATE;
  IF grant_row.id IS NULL THEN
    RAISE EXCEPTION 'destination authorization grant scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'revoked' THEN
    IF NEW.revision = 1
       OR predecessor.state = 'revoked'
       OR NEW.authorization_grant_id IS DISTINCT FROM predecessor.authorization_grant_id
       OR NEW.authorization_snapshot IS DISTINCT FROM predecessor.authorization_snapshot
       OR NEW.authorization_snapshot_hash IS DISTINCT FROM predecessor.authorization_snapshot_hash THEN
      RAISE EXCEPTION 'revocation must preserve predecessor authorization lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF grant_row.purpose <> 'connector_configuration'
     OR grant_row.state <> 'ready'
     OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now())
     OR grant_row.destination_ref IS DISTINCT FROM NEW.destination_ref
     OR grant_row.destination_revision IS DISTINCT FROM NEW.revision
     OR grant_row.target_ref IS DISTINCT FROM NEW.target_ref
     OR NOT (NEW.provider_scope @> grant_row.requested_scope)
     OR grant_row.authorization_snapshot IS DISTINCT FROM NEW.authorization_snapshot
     OR grant_row.authorization_snapshot_hash IS DISTINCT FROM NEW.authorization_snapshot_hash THEN
    RAISE EXCEPTION 'destination requires a current exact connector authorization grant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_preview_event_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_project_id uuid;
  destination_row app.publication_destinations%ROWTYPE;
  artifact_row app.execution_artifacts%ROWTYPE;
  revision_row app.artifact_revisions%ROWTYPE;
  approval_row app.artifact_approval_events%ROWTYPE;
  source_attempt app.publication_attempts%ROWTYPE;
  source_row app.publication_preview_events%ROWTYPE;
  expected_source_approval uuid;
BEGIN
  -- Terminal events are allowed after project archive because they only reduce
  -- authority. They must target one still-current issued event and repeat every
  -- immutable publication fact byte-for-byte.
  IF NEW.event_kind <> 'issued' THEN
    SELECT * INTO source_row
      FROM app.publication_preview_events
     WHERE id = NEW.supersedes_preview_event_id
       AND event_kind = 'issued'
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND preview_ref = NEW.preview_ref
     FOR UPDATE;
    IF source_row.id IS NULL
       OR source_row.expires_at <= now()
       OR EXISTS (
         SELECT 1
           FROM app.publication_preview_events terminal
          WHERE terminal.supersedes_preview_event_id = source_row.id
       )
       OR EXISTS (
         SELECT 1
           FROM app.publication_attempts consumed_attempt
          WHERE consumed_attempt.workspace_id = NEW.workspace_id
            AND consumed_attempt.project_id = NEW.project_id
            AND consumed_attempt.preview_event_id = source_row.id
       )
       OR NEW.preview_kind IS DISTINCT FROM source_row.preview_kind
       OR NEW.facts_schema_version IS DISTINCT FROM source_row.facts_schema_version
       OR NEW.workspace_id IS DISTINCT FROM source_row.workspace_id
       OR NEW.project_id IS DISTINCT FROM source_row.project_id
       OR NEW.site_id IS DISTINCT FROM source_row.site_id
       OR NEW.destination_id IS DISTINCT FROM source_row.destination_id
       OR NEW.destination_ref IS DISTINCT FROM source_row.destination_ref
       OR NEW.destination_revision IS DISTINCT FROM source_row.destination_revision
       OR NEW.provider_kind IS DISTINCT FROM source_row.provider_kind
       OR NEW.target_ref IS DISTINCT FROM source_row.target_ref
       OR NEW.action_id IS DISTINCT FROM source_row.action_id
       OR NEW.artifact_id IS DISTINCT FROM source_row.artifact_id
       OR NEW.artifact_revision_id IS DISTINCT FROM source_row.artifact_revision_id
       OR NEW.artifact_revision IS DISTINCT FROM source_row.artifact_revision
       OR NEW.artifact_content_hash IS DISTINCT FROM source_row.artifact_content_hash
       OR NEW.artifact_approval_event_id IS DISTINCT FROM source_row.artifact_approval_event_id
       OR NEW.artifact_approval_event_kind IS DISTINCT FROM source_row.artifact_approval_event_kind
       OR NEW.source_publication_attempt_id IS DISTINCT FROM source_row.source_publication_attempt_id
       OR NEW.source_change_receipt_id IS DISTINCT FROM source_row.source_change_receipt_id
       OR NEW.provider_plan IS DISTINCT FROM source_row.provider_plan
       OR NEW.remote_precondition IS DISTINCT FROM source_row.remote_precondition
       OR NEW.rollback_plan IS DISTINCT FROM source_row.rollback_plan
       OR NEW.preview_checksum IS DISTINCT FROM source_row.preview_checksum
       OR NEW.content_checksum IS DISTINCT FROM source_row.content_checksum
       OR NEW.facts_hash IS DISTINCT FROM source_row.facts_hash
       OR NEW.expires_at IS DISTINCT FROM source_row.expires_at THEN
      RAISE EXCEPTION
        'terminal preview event must preserve the exact issued preview lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT project_row.id INTO active_project_id
    FROM app.sites site_row
    JOIN app.client_projects project_row
      ON project_row.id = site_row.project_id
     AND project_row.workspace_id = site_row.workspace_id
   WHERE site_row.id = NEW.site_id
     AND site_row.workspace_id = NEW.workspace_id
     AND site_row.project_id = NEW.project_id
     AND project_row.id = NEW.project_id
     AND project_row.archived_at IS NULL
   FOR SHARE OF site_row, project_row;
  IF active_project_id IS NULL OR NEW.expires_at <= now() THEN
    RAISE EXCEPTION
      'issued publication preview requires an active project and future expiry'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO destination_row
    FROM app.publication_destinations candidate_destination
   WHERE candidate_destination.id = NEW.destination_id
     AND candidate_destination.workspace_id = NEW.workspace_id
     AND candidate_destination.project_id = NEW.project_id
     AND candidate_destination.site_id = NEW.site_id
     AND candidate_destination.destination_ref = NEW.destination_ref
     AND candidate_destination.revision = NEW.destination_revision
     AND candidate_destination.provider_kind = NEW.provider_kind
     AND candidate_destination.target_ref = NEW.target_ref
     AND candidate_destination.state = 'ready'
   FOR SHARE;
  IF destination_row.id IS NULL
     OR EXISTS (
       SELECT 1
         FROM app.publication_destinations newer
        WHERE newer.workspace_id = NEW.workspace_id
          AND newer.project_id = NEW.project_id
          AND newer.destination_ref = NEW.destination_ref
          AND newer.revision > NEW.destination_revision
     ) THEN
    RAISE EXCEPTION
      'issued publication preview requires the latest ready destination'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO artifact_row
    FROM app.execution_artifacts
   WHERE id = NEW.artifact_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND action_id = NEW.action_id
   FOR SHARE;
  SELECT * INTO revision_row
    FROM app.artifact_revisions
   WHERE id = NEW.artifact_revision_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND artifact_id = NEW.artifact_id
     AND revision = NEW.artifact_revision
     AND content_hash = NEW.artifact_content_hash
   FOR SHARE;
  IF artifact_row.id IS NULL
     OR revision_row.id IS NULL
     OR NEW.preview_checksum IS DISTINCT FROM NEW.artifact_content_hash THEN
    RAISE EXCEPTION
      'issued publication preview Artifact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.preview_kind = 'publish' THEN
    IF artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM
         NEW.artifact_content_hash THEN
      RAISE EXCEPTION
        'publish preview requires the exact current ready Artifact Revision'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO approval_row
      FROM app.artifact_approval_events candidate_approval
     WHERE candidate_approval.id = NEW.artifact_approval_event_id
       AND candidate_approval.workspace_id = NEW.workspace_id
       AND candidate_approval.project_id = NEW.project_id
       AND candidate_approval.event_kind = 'approved'
       AND candidate_approval.artifact_id = NEW.artifact_id
       AND candidate_approval.artifact_revision_id = NEW.artifact_revision_id
       AND candidate_approval.artifact_revision = NEW.artifact_revision
       AND candidate_approval.artifact_content_hash = NEW.artifact_content_hash
     FOR SHARE;
    IF approval_row.id IS NULL
       OR EXISTS (
         SELECT 1
           FROM app.artifact_approval_events terminal
          WHERE terminal.workspace_id = NEW.workspace_id
            AND terminal.project_id = NEW.project_id
            AND terminal.supersedes_approval_event_id = approval_row.id
       ) THEN
      RAISE EXCEPTION
        'publish preview requires one current exact Artifact approval'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO source_attempt
      FROM app.publication_attempts
     WHERE id = NEW.source_publication_attempt_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND site_id = NEW.site_id
       AND destination_ref = NEW.destination_ref
       AND provider_kind = NEW.provider_kind
       AND target_ref = NEW.target_ref
     FOR SHARE;
    expected_source_approval := COALESCE(
      source_attempt.publication_approval_event_id,
      source_attempt.source_approval_event_id
    );
    IF source_attempt.id IS NULL
       OR expected_source_approval IS DISTINCT FROM NEW.artifact_approval_event_id
       OR source_attempt.action_id IS DISTINCT FROM NEW.action_id
       OR source_attempt.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR source_attempt.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
       OR source_attempt.approved_artifact_revision IS DISTINCT FROM NEW.artifact_revision
       OR source_attempt.approved_artifact_content_hash IS DISTINCT FROM NEW.artifact_content_hash
       OR NOT EXISTS (
         SELECT 1
           FROM app.publication_receipts source_change
          WHERE source_change.id = NEW.source_change_receipt_id
            AND source_change.publication_attempt_id = source_attempt.id
            AND source_change.workspace_id = NEW.workspace_id
            AND source_change.project_id = NEW.project_id
            AND source_change.site_id = NEW.site_id
            AND source_change.provider_kind = NEW.provider_kind
            AND source_change.receipt_kind = 'change_receipt'
            AND source_change.verification_state = 'verified_live'
            AND source_change.artifact_content_hash =
              source_attempt.approved_artifact_content_hash
            AND source_change.content_checksum = source_attempt.content_checksum
       ) THEN
      RAISE EXCEPTION
        'rollback preview requires a same-scope source with verified change'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_project_id uuid;
  preview_row app.publication_preview_events%ROWTYPE;
  destination_row app.publication_destinations%ROWTYPE;
  grant_row app.delivery_authorization_grants%ROWTYPE;
  artifact_row app.execution_artifacts%ROWTYPE;
  approval_row app.artifact_approval_events%ROWTYPE;
  source_attempt app.publication_attempts%ROWTYPE;
  expected_source_approval uuid;
BEGIN
  SELECT project_row.id INTO active_project_id
    FROM app.sites site_row
    JOIN app.client_projects project_row
      ON project_row.id = site_row.project_id
     AND project_row.workspace_id = site_row.workspace_id
   WHERE site_row.id = NEW.site_id
     AND site_row.workspace_id = NEW.workspace_id
     AND site_row.project_id = NEW.project_id
     AND project_row.id = NEW.project_id
     AND project_row.archived_at IS NULL
   FOR SHARE OF site_row, project_row;

  SELECT * INTO preview_row
    FROM app.publication_preview_events candidate_preview
   WHERE candidate_preview.id = NEW.preview_event_id
     AND candidate_preview.workspace_id = NEW.workspace_id
     AND candidate_preview.project_id = NEW.project_id
     AND candidate_preview.event_kind = 'issued'
     AND candidate_preview.preview_ref = NEW.preview_ref
     AND candidate_preview.expires_at > now()
   FOR UPDATE;
  IF active_project_id IS NULL
     OR preview_row.id IS NULL
     OR EXISTS (
       SELECT 1
         FROM app.publication_preview_events terminal
        WHERE terminal.workspace_id = NEW.workspace_id
          AND terminal.project_id = NEW.project_id
          AND terminal.supersedes_preview_event_id = preview_row.id
     ) THEN
    RAISE EXCEPTION
      'publication attempt requires one current unexpired issued preview'
      USING ERRCODE = '23514';
  END IF;

  IF preview_row.facts_hash IS DISTINCT FROM NEW.preview_facts_hash
     OR preview_row.provider_plan->>'providerKind' IS DISTINCT FROM NEW.provider_kind
     OR preview_row.preview_kind IS DISTINCT FROM NEW.attempt_kind
     OR preview_row.site_id IS DISTINCT FROM NEW.site_id
     OR preview_row.destination_id IS DISTINCT FROM NEW.destination_id
     OR preview_row.destination_ref IS DISTINCT FROM NEW.destination_ref
     OR preview_row.destination_revision IS DISTINCT FROM NEW.destination_revision
     OR preview_row.provider_kind IS DISTINCT FROM NEW.provider_kind
     OR preview_row.target_ref IS DISTINCT FROM NEW.target_ref
     OR preview_row.action_id IS DISTINCT FROM NEW.action_id
     OR preview_row.artifact_id IS DISTINCT FROM NEW.artifact_id
     OR preview_row.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
     OR preview_row.artifact_revision IS DISTINCT FROM NEW.approved_artifact_revision
     OR preview_row.artifact_content_hash IS DISTINCT FROM NEW.approved_artifact_content_hash
     OR preview_row.preview_checksum IS DISTINCT FROM NEW.preview_checksum
     OR preview_row.content_checksum IS DISTINCT FROM NEW.content_checksum
     OR preview_row.remote_precondition IS DISTINCT FROM NEW.remote_precondition
     OR preview_row.rollback_plan IS DISTINCT FROM NEW.rollback_plan THEN
    RAISE EXCEPTION
      'publication attempt facts must match the exact issued preview'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.preview_checksum <> NEW.approved_artifact_content_hash THEN
    RAISE EXCEPTION
      'publication attempt preview checksum must match the exact approved Artifact Revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM app.async_runs run
     WHERE run.id = NEW.async_run_id
       AND run.workspace_id = NEW.workspace_id
       AND run.project_id = NEW.project_id
       AND run.kind = 'publication'
       AND run.result_type = 'publication_attempt'
       AND run.result_id = NEW.id
       AND run.active_key =
         'publication:' || NEW.destination_ref::text || ':' || NEW.target_ref
  ) THEN
    RAISE EXCEPTION 'publication attempt async run lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO destination_row
    FROM app.publication_destinations
   WHERE id = NEW.destination_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND destination_ref = NEW.destination_ref
     AND revision = NEW.destination_revision
     AND provider_kind = NEW.provider_kind
     AND target_ref = NEW.target_ref
     AND state = 'ready'
   FOR SHARE;
  IF destination_row.id IS NULL
     OR EXISTS (
       SELECT 1 FROM app.publication_destinations newer
        WHERE newer.workspace_id = NEW.workspace_id
          AND newer.project_id = NEW.project_id
          AND newer.destination_ref = NEW.destination_ref
          AND newer.revision > NEW.destination_revision
     ) THEN
    RAISE EXCEPTION 'publication attempt requires the latest ready destination'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO grant_row
    FROM app.delivery_authorization_grants
   WHERE id = NEW.authorization_grant_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
     AND purpose = NEW.authorization_purpose
     AND state = 'ready'
     AND destination_ref = NEW.destination_ref
     AND destination_revision = NEW.destination_revision
     AND target_ref = NEW.target_ref
   FOR UPDATE;
  IF grant_row.id IS NULL
     OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now())
     OR NOT (destination_row.provider_scope @> grant_row.requested_scope)
     OR grant_row.authorization_snapshot IS DISTINCT FROM NEW.authorization_snapshot
     OR grant_row.authorization_snapshot_hash IS DISTINCT FROM NEW.authorization_snapshot_hash THEN
    RAISE EXCEPTION 'publication attempt authorization grant is stale or invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO artifact_row
    FROM app.execution_artifacts
   WHERE id = NEW.artifact_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
   FOR SHARE;
  IF artifact_row.id IS NULL
     OR artifact_row.action_id IS DISTINCT FROM NEW.action_id
     OR NOT EXISTS (
       SELECT 1 FROM app.artifact_revisions revision
        WHERE revision.id = NEW.artifact_revision_id
          AND revision.workspace_id = NEW.workspace_id
          AND revision.project_id = NEW.project_id
          AND revision.artifact_id = NEW.artifact_id
          AND revision.revision = NEW.approved_artifact_revision
          AND revision.content_hash = NEW.approved_artifact_content_hash
     ) THEN
    RAISE EXCEPTION 'publication attempt Artifact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_kind = 'publish' THEN
    IF artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.approved_artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM
         NEW.approved_artifact_content_hash
       OR preview_row.artifact_approval_event_id IS DISTINCT FROM
         NEW.publication_approval_event_id
       OR preview_row.source_publication_attempt_id IS NOT NULL
       OR preview_row.source_change_receipt_id IS NOT NULL THEN
      RAISE EXCEPTION
        'publish attempt preview approval lineage is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO approval_row
      FROM app.artifact_approval_events
     WHERE id = NEW.publication_approval_event_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND event_kind = 'approved'
       AND artifact_id = NEW.artifact_id
       AND artifact_revision_id = NEW.artifact_revision_id
       AND artifact_revision = NEW.approved_artifact_revision
       AND artifact_content_hash = NEW.approved_artifact_content_hash
     FOR SHARE;
    IF approval_row.id IS NULL
       OR EXISTS (
         SELECT 1 FROM app.artifact_approval_events terminal
          WHERE terminal.workspace_id = NEW.workspace_id
            AND terminal.project_id = NEW.project_id
            AND terminal.supersedes_approval_event_id = approval_row.id
       ) THEN
      RAISE EXCEPTION 'publish attempt requires a current exact approval and preview'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF preview_row.artifact_approval_event_id IS DISTINCT FROM
         NEW.source_approval_event_id
       OR preview_row.source_publication_attempt_id IS DISTINCT FROM
         NEW.source_publication_attempt_id
       OR preview_row.source_change_receipt_id IS DISTINCT FROM
         NEW.source_change_receipt_id THEN
      RAISE EXCEPTION
        'rollback attempt preview source lineage is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_attempt
      FROM app.publication_attempts
     WHERE id = NEW.source_publication_attempt_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND site_id = NEW.site_id
       AND destination_ref = NEW.destination_ref
       AND provider_kind = NEW.provider_kind
       AND target_ref = NEW.target_ref
     FOR SHARE;
    expected_source_approval := COALESCE(
      source_attempt.publication_approval_event_id,
      source_attempt.source_approval_event_id
    );
    IF source_attempt.id IS NULL
       OR expected_source_approval IS DISTINCT FROM NEW.source_approval_event_id
       OR source_attempt.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR source_attempt.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
       OR source_attempt.approved_artifact_revision IS DISTINCT FROM NEW.approved_artifact_revision
       OR source_attempt.approved_artifact_content_hash IS DISTINCT FROM NEW.approved_artifact_content_hash
       OR NOT EXISTS (
         SELECT 1 FROM app.publication_receipts source_change
          WHERE source_change.id = NEW.source_change_receipt_id
            AND source_change.publication_attempt_id = source_attempt.id
            AND source_change.workspace_id = NEW.workspace_id
            AND source_change.project_id = NEW.project_id
            AND source_change.site_id = NEW.site_id
            AND source_change.provider_kind = NEW.provider_kind
            AND source_change.receipt_kind = 'change_receipt'
            AND source_change.verification_state = 'verified_live'
            AND source_change.artifact_content_hash =
              source_attempt.approved_artifact_content_hash
            AND source_change.content_checksum =
              source_attempt.content_checksum
       ) THEN
      RAISE EXCEPTION 'rollback requires a same-scope source with verified change'
        USING ERRCODE = '23514';
    END IF;
    -- Historical source approval is lineage only. No terminal-event check is
    -- performed here: a later revocation cannot make an occurred live change
    -- impossible to roll back.
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_receipt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_row app.publication_attempts%ROWTYPE;
  predecessor app.publication_receipts%ROWTYPE;
BEGIN
  SELECT * INTO attempt_row
    FROM app.publication_attempts
   WHERE id = NEW.publication_attempt_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
     AND approved_artifact_content_hash = NEW.artifact_content_hash
     AND content_checksum = NEW.content_checksum
   FOR SHARE;
  IF attempt_row.id IS NULL THEN
    RAISE EXCEPTION 'publication receipt attempt lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.receipt_kind <> 'change_receipt' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO predecessor
    FROM app.publication_receipts
   WHERE id = NEW.predecessor_delivery_receipt_id
   FOR KEY SHARE;
  IF predecessor.id IS NULL
     OR predecessor.receipt_kind <> 'delivery_receipt'
     OR predecessor.publication_attempt_id <> NEW.publication_attempt_id
     OR predecessor.provider_kind <> NEW.provider_kind
     OR predecessor.artifact_content_hash <> NEW.artifact_content_hash
     OR predecessor.content_checksum <> NEW.content_checksum
     OR predecessor.remote_scope_ref <> NEW.remote_scope_ref
     OR predecessor.observed_at >= NEW.observed_at THEN
    RAISE EXCEPTION
      'change_receipt requires an earlier same-attempt delivery_receipt with matching provider, Artifact hash, content checksum, and remote scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_authorization_grants_transition_guard
  ON app.delivery_authorization_grants;
CREATE TRIGGER delivery_authorization_grants_transition_guard
BEFORE INSERT OR UPDATE ON app.delivery_authorization_grants
FOR EACH ROW
EXECUTE FUNCTION app.enforce_delivery_authorization_grant_transition();

DROP TRIGGER IF EXISTS delivery_authorization_grants_no_delete
  ON app.delivery_authorization_grants;
CREATE TRIGGER delivery_authorization_grants_no_delete
BEFORE DELETE ON app.delivery_authorization_grants
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS artifact_approval_events_lineage_guard
  ON app.artifact_approval_events;
CREATE TRIGGER artifact_approval_events_lineage_guard
BEFORE INSERT ON app.artifact_approval_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_approval_event_lineage();

DROP TRIGGER IF EXISTS publication_destinations_lineage_guard
  ON app.publication_destinations;
CREATE TRIGGER publication_destinations_lineage_guard
BEFORE INSERT ON app.publication_destinations
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_destination_lineage();

DROP TRIGGER IF EXISTS publication_preview_events_lineage_guard
  ON app.publication_preview_events;
CREATE TRIGGER publication_preview_events_lineage_guard
BEFORE INSERT ON app.publication_preview_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_preview_event_lineage();

DROP TRIGGER IF EXISTS publication_attempts_lineage_guard
  ON app.publication_attempts;
CREATE TRIGGER publication_attempts_lineage_guard
BEFORE INSERT ON app.publication_attempts
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_attempt_lineage();

DROP TRIGGER IF EXISTS publication_receipts_lineage_guard
  ON app.publication_receipts;
CREATE TRIGGER publication_receipts_lineage_guard
BEFORE INSERT ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_receipt_lineage();

DROP TRIGGER IF EXISTS artifact_approval_events_append_only
  ON app.artifact_approval_events;
CREATE TRIGGER artifact_approval_events_append_only
BEFORE UPDATE OR DELETE ON app.artifact_approval_events
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_destinations_append_only
  ON app.publication_destinations;
CREATE TRIGGER publication_destinations_append_only
BEFORE UPDATE OR DELETE ON app.publication_destinations
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_preview_events_append_only
  ON app.publication_preview_events;
CREATE TRIGGER publication_preview_events_append_only
BEFORE UPDATE OR DELETE ON app.publication_preview_events
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_attempts_append_only
  ON app.publication_attempts;
CREATE TRIGGER publication_attempts_append_only
BEFORE UPDATE OR DELETE ON app.publication_attempts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_receipts_append_only
  ON app.publication_receipts;
CREATE TRIGGER publication_receipts_append_only
BEFORE UPDATE OR DELETE ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Browser roles never access canonical publication authority or ciphertext.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.delivery_authorization_grants FROM anon';
    EXECUTE 'REVOKE ALL ON app.artifact_approval_events FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_destinations FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_preview_events FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_attempts FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_receipts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.delivery_authorization_grants FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.artifact_approval_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_destinations FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_preview_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_attempts FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_receipts FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0022_publication_foundation'::text AS migration_version;

COMMIT;
