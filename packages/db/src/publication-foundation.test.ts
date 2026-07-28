import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../migrations/0022_publication_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("publication foundation migration", () => {
  it("adds the six publication tables, with five append-only ledgers", () => {
    for (const table of [
      "artifact_approval_events",
      "publication_destinations",
      "publication_preview_events",
      "publication_attempts",
      "publication_receipts",
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?app\\.${table}`, "iu"),
      );
      expect(migration).toMatch(
        new RegExp(
          `CREATE\\s+TRIGGER\\s+${table}_append_only[\\s\\S]*?BEFORE\\s+UPDATE\\s+OR\\s+DELETE`,
          "iu",
        ),
      );
    }
    expect(migration).toMatch(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.delivery_authorization_grants/iu,
    );
    expect(
      [...migration.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\./giu)],
    ).toHaveLength(6);
  });

  it("widens async run axes without removing historical values", () => {
    for (const kind of [
      "collection",
      "diagnostic",
      "artifact_generation",
      "export",
      "product_profile_synthesis",
      "content_shadow",
      "publication",
    ]) {
      expect(migration).toContain(`'${kind}'`);
    }
    for (const resultType of [
      "collection_run",
      "diagnostic_run",
      "artifact",
      "export",
      "icp_profile",
      "flow_shadow_run",
      "publication_attempt",
    ]) {
      expect(migration).toContain(`'${resultType}'`);
    }
  });

  it("freezes grant, secret, approval, destination and idempotency lineage", () => {
    expect(migration).toMatch(
      /authorization_grant_id\s+uuid\s+NOT\s+NULL[\s\S]*?REFERENCES\s+app\.delivery_authorization_grants\s*\(\s*id\s*\)/iu,
    );
    expect(migration).toMatch(
      /delivery_authorization_grants[\s\S]*?encrypted_payload\s+bytea[\s\S]*?provider_kind\s*=\s*'wordpress'/iu,
    );
    expect(migration).not.toMatch(/\bencrypted_secret_ref\b/iu);
    expect(migration).toMatch(
      /artifact_approval_events_one_terminal_per_event_idx[\s\S]*?supersedes_approval_event_id/iu,
    );
    expect(migration).toMatch(
      /UNIQUE\s*\(\s*workspace_id\s*,\s*project_id\s*,\s*idempotency_key\s*\)/iu,
    );
    expect(migration).toMatch(
      /UNIQUE\s*\(\s*workspace_id\s*,\s*project_id\s*,\s*destination_ref\s*,\s*destination_revision\s*,\s*request_hash\s*\)/iu,
    );
    expect(migration).toMatch(
      /publication_destinations_one_consuming_grant_idx[\s\S]*?authorization_grant_id[\s\S]*?WHERE\s+state\s*<>\s*'revoked'/iu,
    );
    const destinationDdl = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS app.publication_destinations"),
      migration.indexOf("CREATE TABLE IF NOT EXISTS app.publication_attempts"),
    );
    expect(destinationDdl).not.toMatch(
      /UNIQUE\s*\(\s*authorization_grant_id\s*\)/iu,
    );
    expect(migration).not.toMatch(
      /CREATE\s+TABLE[\s\S]*?app\.publication_attempts[\s\S]*?\bstatus\s+text/iu,
    );
  });

  it("stores server-issued publish and rollback previews as exact append-only authority", () => {
    const previewDdl = migration.slice(
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_preview_events",
      ),
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_attempts",
      ),
    );

    expect(previewDdl).toMatch(
      /preview_ref\s+text\s+NOT\s+NULL[\s\S]*?length\s*\(\s*preview_ref\s*\)\s+BETWEEN\s+32\s+AND\s+1024/iu,
    );
    expect(previewDdl).toMatch(
      /event_kind\s+text\s+NOT\s+NULL[\s\S]*?'issued'[\s\S]*?'revoked'[\s\S]*?'superseded'/iu,
    );
    expect(previewDdl).toMatch(
      /preview_kind\s+text\s+NOT\s+NULL[\s\S]*?'publish'[\s\S]*?'rollback'/iu,
    );
    expect(previewDdl).toMatch(
      /destination_id\s+uuid\s+NOT\s+NULL[\s\S]*?destination_ref\s+uuid\s+NOT\s+NULL[\s\S]*?destination_revision\s+integer\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /artifact_id\s+uuid\s+NOT\s+NULL[\s\S]*?artifact_revision_id\s+uuid\s+NOT\s+NULL[\s\S]*?artifact_revision\s+integer\s+NOT\s+NULL[\s\S]*?artifact_content_hash\s+text\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /artifact_approval_event_id\s+uuid\s+NOT\s+NULL[\s\S]*?artifact_approval_event_kind\s+text\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /provider_plan\s+jsonb\s+NOT\s+NULL[\s\S]*?remote_precondition\s+jsonb\s+NOT\s+NULL[\s\S]*?rollback_plan\s+jsonb\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /preview_checksum\s+text\s+NOT\s+NULL[\s\S]*?content_checksum\s+text\s+NOT\s+NULL[\s\S]*?facts_hash\s+text\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /expires_at\s+timestamptz\s+NOT\s+NULL[\s\S]*?event_actor_id\s+uuid\s+NOT\s+NULL[\s\S]*?idempotency_key\s+text\s+NOT\s+NULL[\s\S]*?request_hash\s+text\s+NOT\s+NULL/iu,
    );
    expect(previewDdl).toMatch(
      /UNIQUE\s*\(\s*workspace_id\s*,\s*project_id\s*,\s*idempotency_key\s*\)/iu,
    );
    expect(previewDdl).not.toMatch(
      /\bencrypted_payload\b|\bcipher_version\b|\bkey_version\b/iu,
    );
    expect(migration).toMatch(
      /publication_preview_events_source_attempt_fk[\s\S]*?FOREIGN\s+KEY\s*\(\s*source_publication_attempt_id\s*\)[\s\S]*?REFERENCES\s+app\.publication_attempts\s*\(\s*id\s*\)/iu,
    );
    expect(migration).toMatch(
      /publication_preview_events_source_change_receipt_fk[\s\S]*?FOREIGN\s+KEY\s*\(\s*source_change_receipt_id\s*\)[\s\S]*?REFERENCES\s+app\.publication_receipts\s*\(\s*id\s*\)/iu,
    );
  });

  it("serializes preview issue and terminal events against exact current lineage", () => {
    expect(migration).toMatch(
      /publication_preview_events_one_terminal_per_event_idx[\s\S]*?supersedes_preview_event_id[\s\S]*?WHERE\s+event_kind\s+IN\s*\(\s*'revoked'\s*,\s*'superseded'\s*\)/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+app\.enforce_publication_preview_event_lineage/iu,
    );
    expect(migration).toMatch(
      /IF\s+NEW\.event_kind\s*<>\s*'issued'[\s\S]*?FROM\s+app\.publication_preview_events[\s\S]*?FOR\s+UPDATE[\s\S]*?project_row\.archived_at\s+IS\s+NULL[\s\S]*?NEW\.expires_at\s*<=\s*now\s*\(\s*\)/iu,
    );
    expect(migration).toMatch(
      /FROM\s+app\.publication_destinations\s+candidate_destination[\s\S]*?candidate_destination\.revision\s*=\s*NEW\.destination_revision[\s\S]*?candidate_destination\.state\s*=\s*'ready'[\s\S]*?FROM\s+app\.publication_destinations\s+newer[\s\S]*?newer\.revision\s*>\s*NEW\.destination_revision/iu,
    );
    expect(migration).toMatch(
      /NEW\.preview_kind\s*=\s*'publish'[\s\S]*?artifact_row\.current_revision\s*<>\s*NEW\.artifact_revision[\s\S]*?FROM\s+app\.artifact_approval_events\s+candidate_approval[\s\S]*?candidate_approval\.event_kind\s*=\s*'approved'[\s\S]*?supersedes_approval_event_id\s*=\s*approval_row\.id/iu,
    );
    expect(migration).toMatch(
      /NEW\.preview_kind\s*=\s*'publish'[\s\S]*?ELSE[\s\S]*?source_change\.publication_attempt_id\s*=\s*source_attempt\.id[\s\S]*?source_change\.receipt_kind\s*=\s*'change_receipt'[\s\S]*?source_change\.verification_state\s*=\s*'verified_live'/iu,
    );
    expect(migration).toMatch(
      /terminal preview event must preserve the exact issued preview lineage/iu,
    );
    expect(migration).toMatch(
      /FROM\s+app\.publication_attempts\s+consumed_attempt[\s\S]*?consumed_attempt\.preview_event_id\s*=\s*source_row\.id[\s\S]*?terminal preview event must preserve the exact issued preview lineage/iu,
    );
    expect(migration).toMatch(
      /NEW\.provider_plan\s+IS\s+DISTINCT\s+FROM\s+source_row\.provider_plan[\s\S]*?NEW\.remote_precondition\s+IS\s+DISTINCT\s+FROM\s+source_row\.remote_precondition[\s\S]*?NEW\.rollback_plan\s+IS\s+DISTINCT\s+FROM\s+source_row\.rollback_plan[\s\S]*?NEW\.facts_hash\s+IS\s+DISTINCT\s+FROM\s+source_row\.facts_hash/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+publication_preview_events_append_only[\s\S]*?BEFORE\s+UPDATE\s+OR\s+DELETE/iu,
    );
  });

  it("binds each publication attempt to one unexpired current issued preview", () => {
    const attemptDdl = migration.slice(
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_attempts",
      ),
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_receipts",
      ),
    );
    const attemptGuard = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION app.enforce_publication_attempt_lineage",
      ),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION app.enforce_publication_receipt_lineage",
      ),
    );
    expect(attemptDdl).toMatch(
      /preview_event_id\s+uuid\s+NOT\s+NULL[\s\S]*?preview_event_kind\s+text\s+NOT\s+NULL[\s\S]*?preview_facts_hash\s+text\s+NOT\s+NULL/iu,
    );
    expect(attemptDdl).toMatch(
      /FOREIGN\s+KEY\s*\(\s*preview_event_id\s*,\s*preview_event_kind\s*\)[\s\S]*?REFERENCES\s+app\.publication_preview_events\s*\(\s*id\s*,\s*event_kind\s*\)/iu,
    );
    expect(attemptDdl).toMatch(
      /UNIQUE\s*\(\s*workspace_id\s*,\s*project_id\s*,\s*preview_event_id\s*\)/iu,
    );
    expect(migration).toMatch(
      /FROM\s+app\.publication_preview_events\s+candidate_preview[\s\S]*?candidate_preview\.event_kind\s*=\s*'issued'[\s\S]*?candidate_preview\.expires_at\s*>\s*now\s*\(\s*\)[\s\S]*?FOR\s+UPDATE/iu,
    );
    expect(migration).toMatch(
      /supersedes_preview_event_id\s*=\s*preview_row\.id[\s\S]*?publication attempt requires one current unexpired issued preview/iu,
    );
    expect(migration).toMatch(
      /preview_row\.facts_hash\s+IS\s+DISTINCT\s+FROM\s+NEW\.preview_facts_hash[\s\S]*?preview_row\.provider_plan/iu,
    );
    expect(attemptGuard).toMatch(
      /project_row\.archived_at\s+IS\s+NULL[\s\S]*?FROM\s+app\.publication_preview_events\s+candidate_preview[\s\S]*?FOR\s+UPDATE/iu,
    );
    expect(attemptGuard).toMatch(
      /SELECT\s+\*\s+INTO\s+artifact_row[\s\S]*?FROM\s+app\.execution_artifacts[\s\S]*?FOR\s+SHARE[\s\S]*?IF\s+NEW\.attempt_kind\s*=\s*'publish'\s+THEN[\s\S]*?artifact_row\.status\s*<>\s*'ready'[\s\S]*?artifact_row\.validation_state\s*<>\s*'valid'[\s\S]*?artifact_row\.current_revision\s*<>\s*NEW\.approved_artifact_revision[\s\S]*?artifact_row\.content_hash\s+IS\s+DISTINCT\s+FROM[\s\S]*?NEW\.approved_artifact_content_hash/iu,
    );
    expect(attemptGuard).toMatch(
      /ELSE[\s\S]*?preview_row\.source_publication_attempt_id\s+IS\s+DISTINCT\s+FROM[\s\S]*?NEW\.source_publication_attempt_id[\s\S]*?source_change\.id\s*=\s*NEW\.source_change_receipt_id[\s\S]*?source_change\.verification_state\s*=\s*'verified_live'/iu,
    );
  });

  it("keeps canonical preview authority inaccessible to browser roles", () => {
    expect(migration).toContain(
      "REVOKE ALL ON app.publication_preview_events FROM anon",
    );
    expect(migration).toContain(
      "REVOKE ALL ON app.publication_preview_events FROM authenticated",
    );
  });

  it("rejects unbounded write grants and foreign or archived site scope", () => {
    expect(migration).toMatch(
      /purpose\s*=\s*'connector_configuration'\s+OR\s+expires_at\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /state\s*<>\s*'consumed'\s+OR\s+expires_at\s+IS\s+NULL\s+OR\s+consumed_at\s*<=\s*expires_at/iu,
    );
    expect(migration).toMatch(
      /TG_OP\s*=\s*'INSERT'[\s\S]*?FROM\s+app\.sites[\s\S]*?JOIN\s+app\.client_projects[\s\S]*?site_row\.workspace_id\s*=\s*NEW\.workspace_id[\s\S]*?site_row\.project_id\s*=\s*NEW\.project_id[\s\S]*?project_row\.archived_at\s+IS\s+NULL/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+delivery_authorization_grants_transition_guard[\s\S]*?BEFORE\s+INSERT\s+OR\s+UPDATE/iu,
    );
    expect(migration).toMatch(
      /NEW\.provider_scope\s+@>\s+grant_row\.requested_scope/iu,
    );
    expect(migration).toMatch(
      /destination_row\.provider_scope\s+@>\s+grant_row\.requested_scope/iu,
    );
    expect(migration).toMatch(
      /state\s+NOT\s+IN\s*\(\s*'unavailable'\s*,\s*'revoked'\s*\)\s+OR\s+limitation\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /state\s*<>\s*'revoked'[\s\S]*?revision\s*>\s*1[\s\S]*?supersedes_id\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /IF\s+NEW\.state\s*=\s*'revoked'[\s\S]*?NEW\.revision\s*=\s*1/iu,
    );
  });

  it("requires delivery-before-change with exact immutable lineage", () => {
    expect(migration).toMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+app\.enforce_publication_receipt_lineage/iu,
    );
    expect(migration).toMatch(
      /predecessor\.publication_attempt_id\s*<>\s*NEW\.publication_attempt_id/iu,
    );
    expect(migration).toMatch(
      /predecessor\.provider_kind\s*<>\s*NEW\.provider_kind/iu,
    );
    expect(migration).toMatch(
      /predecessor\.content_checksum\s*<>\s*NEW\.content_checksum/iu,
    );
    expect(migration).toMatch(
      /predecessor\.artifact_content_hash\s*<>\s*NEW\.artifact_content_hash/iu,
    );
    expect(migration).toMatch(
      /predecessor\.remote_scope_ref\s*<>\s*NEW\.remote_scope_ref/iu,
    );
    expect(migration).toMatch(
      /predecessor\.observed_at\s*>=\s*NEW\.observed_at/iu,
    );
    expect(migration).not.toMatch(
      /provider_request_id\s+text\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /source_change_receipt_id\s+uuid[\s\S]*?publication_attempts_source_change_receipt_fk[\s\S]*?REFERENCES\s+app\.publication_receipts\s*\(\s*id\s*\)/iu,
    );
    expect(migration).toMatch(
      /receipt_kind\s*=\s*'delivery_receipt'[\s\S]*?remote_object_kind\s+IN\s*\(\s*'github_pull_request'\s*,\s*'wordpress_post'\s*\)[\s\S]*?receipt_kind\s*=\s*'change_receipt'[\s\S]*?remote_object_kind\s+IN\s*\(\s*'github_merge'\s*,\s*'wordpress_revision'\s*\)/iu,
    );
    expect(migration).toMatch(
      /source_change\.id\s*=\s*NEW\.source_change_receipt_id[\s\S]*?source_change\.publication_attempt_id\s*=\s*source_attempt\.id[\s\S]*?source_change\.verification_state\s*=\s*'verified_live'/iu,
    );
    expect(migration).toMatch(
      /NEW\.preview_checksum\s*<>\s*NEW\.approved_artifact_content_hash[\s\S]*?publication attempt preview checksum must match the exact approved Artifact Revision/iu,
    );
  });

  it("separates the approved JCS Artifact hash from provider content bytes", () => {
    const attemptDdl = migration.slice(
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_attempts",
      ),
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_receipts",
      ),
    );
    expect(attemptDdl).toMatch(
      /approved_artifact_content_hash\s+text\s+NOT\s+NULL[\s\S]*?preview_checksum\s+text\s+NOT\s+NULL[\s\S]*?content_checksum\s+text\s+NOT\s+NULL/iu,
    );

    const receiptDdl = migration.slice(
      migration.indexOf(
        "CREATE TABLE IF NOT EXISTS app.publication_receipts",
      ),
      migration.indexOf(
        "ALTER TABLE app.publication_attempts",
      ),
    );
    expect(receiptDdl).toMatch(
      /artifact_content_hash\s+text\s+NOT\s+NULL[\s\S]*?content_checksum\s+text\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /approved_artifact_content_hash\s*=\s*NEW\.artifact_content_hash[\s\S]*?content_checksum\s*=\s*NEW\.content_checksum/iu,
    );
  });

  it("advances the database projection to migration 0022", () => {
    expect(migration).toMatch(
      /SELECT\s+'0022_publication_foundation'::text\s+AS\s+migration_version/iu,
    );
  });
});
