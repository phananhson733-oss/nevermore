import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import {
  DeliveryAuthorizationGrantsRepository,
  DeliveryConnectionsRepository,
} from "../repositories/publications.ts";
import {
  clientProjects,
  publicationDestinations,
  sites,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("publication authorization scope", () => {
  let handle: DbHandle;
  let workspaceA: string;
  let workspaceB: string;
  let projectA: string;
  let projectB: string;
  let siteA: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);

    const workspaceRows = await handle.db
      .insert(workspaces)
      .values([
        { name: `Publication authorization A ${randomUUID()}` },
        { name: `Publication authorization B ${randomUUID()}` },
      ])
      .returning();
    workspaceA = workspaceRows[0]!.id;
    workspaceB = workspaceRows[1]!.id;

    const projectRows = await handle.db
      .insert(clientProjects)
      .values([
        {
          workspace_id: workspaceA,
          client_name: "Client A",
          project_name: `Project A ${randomUUID()}`,
          default_delivery_locale: "en-US",
          created_by: randomUUID(),
        },
        {
          workspace_id: workspaceB,
          client_name: "Client B",
          project_name: `Project B ${randomUUID()}`,
          default_delivery_locale: "en-US",
          created_by: randomUUID(),
        },
      ])
      .returning();
    projectA = projectRows[0]!.id;
    projectB = projectRows[1]!.id;

    const [site] = await handle.db
      .insert(sites)
      .values({
        workspace_id: workspaceA,
        project_id: projectA,
        origin: `https://${randomUUID()}.example.com`,
        host: `${randomUUID()}.example.com`,
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    siteA = site!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("rejects a grant whose site belongs to another workspace and project", async () => {
    const destinationRef = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const repo = new DeliveryAuthorizationGrantsRepository(handle.db);

    await expect(
      repo.create({
        workspaceId: workspaceB,
        projectId: projectB,
        siteId: siteA,
        providerKind: "github",
        purpose: "publish",
        destinationRef,
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        requestedScope: {
          providerKind: "github",
          installationId: 201,
          repositoryId: 101,
        },
        authorizationSnapshot: {
          purpose: "publish",
          destinationRef,
          destinationRevision: 1,
          expiresAt,
        },
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        secretMetadata: {},
        expiresAt,
        createdBy: randomUUID(),
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("prevents a destination from widening its server-issued provider scope", async () => {
    const destinationRef = randomUUID();
    const targetRef = "/blog/customer-onboarding/";
    const authorizationSnapshot = {
      purpose: "connector_configuration",
      destinationRef,
      destinationRevision: 1,
      expiresAt: null,
    };
    const requestedScope = {
      providerKind: "github",
      repositoryId: 101,
      baseBranch: "main",
      branchPrefix: "gengrowth/",
      contentPath: "content/blog/customer-onboarding.md",
    };
    const grant = await new DeliveryAuthorizationGrantsRepository(
      handle.db,
    ).create({
      workspaceId: workspaceA,
      projectId: projectA,
      siteId: siteA,
      providerKind: "github",
      purpose: "connector_configuration",
      destinationRef,
      destinationRevision: 1,
      targetRef,
      requestedScope,
      authorizationSnapshot,
      encryptedPayload: null,
      cipherVersion: null,
      keyVersion: null,
      secretMetadata: {},
      expiresAt: null,
      createdBy: randomUUID(),
    });
    const providerScope = {
      ...requestedScope,
      installationId: 201,
      repositoryOwner: "gengrowth",
      repositoryName: "website",
      grantedPermissions: [
        "metadata_read",
        "contents_read",
        "contents_write",
        "pull_requests_write",
      ],
    };
    const destination = {
      destination_ref: destinationRef,
      revision: 1,
      supersedes_id: null,
      workspace_id: workspaceA,
      project_id: projectA,
      site_id: siteA,
      provider_kind: "github",
      target_ref: targetRef,
      state: "ready",
      authorization_grant_id: grant.id,
      authorization_snapshot: grant.authorization_snapshot,
      authorization_snapshot_hash: grant.authorization_snapshot_hash,
      readiness_observation: { permissionProbe: "passed" },
      limitation: null,
      created_by: randomUUID(),
    } as const;
    const widenedScope = { ...providerScope, repositoryId: 999 };

    await expect(
      handle.db.insert(publicationDestinations).values({
        ...destination,
        provider_scope: widenedScope,
        provider_scope_hash: contentHash(widenedScope),
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    await expect(
      handle.db
        .insert(publicationDestinations)
        .values({
          ...destination,
          provider_scope: providerScope,
          provider_scope_hash: contentHash(providerScope),
        })
        .returning({ id: publicationDestinations.id }),
    ).resolves.toHaveLength(1);

    const connections = new DeliveryConnectionsRepository(handle.db);
    await expect(
      connections.listHeads(
        { workspaceId: workspaceB, projectId: projectB },
        { limit: 10 },
      ),
    ).resolves.toEqual({ rows: [], nextCursor: null });
    await expect(
      connections.listRevisions(
        { workspaceId: workspaceB, projectId: projectB },
        destinationRef,
        { limit: 10 },
      ),
    ).resolves.toEqual([]);
  });

  it("rejects a rollback attempt without a current issued preview before trusting client checksums", async () => {
    const ids = Array.from({ length: 13 }, () => randomUUID());

    await expect(
      handle.pool.query(
        `
          INSERT INTO app.publication_attempts (
            id,
            attempt_kind,
            source_publication_attempt_id,
            source_change_receipt_id,
            workspace_id,
            project_id,
            site_id,
            async_run_id,
            destination_id,
            destination_ref,
            destination_revision,
            provider_kind,
            target_ref,
            action_id,
            artifact_id,
            artifact_revision_id,
            approved_artifact_revision,
            approved_artifact_content_hash,
            publication_approval_event_id,
            publication_approval_event_kind,
            source_approval_event_id,
            source_approval_event_kind,
            side_effect_class,
            authorization_grant_id,
            authorization_purpose,
            authorization_snapshot,
            authorization_snapshot_hash,
            preview_ref,
            preview_checksum,
            content_checksum,
            remote_precondition,
            rollback_plan,
            idempotency_key,
            request_hash,
            requested_by
          )
          VALUES (
            $1, 'rollback', $2, $3, $4, $5, $6, $7, $8, $9, 1,
            'github', '/blog/customer-onboarding/', $10, $11, $12, 1,
            repeat('a', 64), NULL, NULL, $13, 'approved',
            'external_write', $14, 'rollback', '{}'::jsonb, repeat('b', 64),
            'preview://rollback/mismatched', repeat('c', 64), repeat('e', 64),
            '{"kind":"must_match"}'::jsonb, '{}'::jsonb,
            'rollback-mismatched-preview', repeat('d', 64), $15
          )
        `,
        [
          ids[0],
          ids[1],
          ids[2],
          workspaceA,
          projectA,
          siteA,
          ids[3],
          ids[4],
          ids[5],
          ids[6],
          ids[7],
          ids[8],
          ids[9],
          ids[10],
          ids[11],
        ],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message:
        "publication attempt requires one current unexpired issued preview",
    });
  });

  it("rejects a new grant for an archived project", async () => {
    await handle.pool.query(
      "update app.client_projects set archived_at = now() where id = $1",
      [projectA],
    );
    const destinationRef = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const repo = new DeliveryAuthorizationGrantsRepository(handle.db);

    await expect(
      repo.create({
        workspaceId: workspaceA,
        projectId: projectA,
        siteId: siteA,
        providerKind: "github",
        purpose: "publish",
        destinationRef,
        destinationRevision: 1,
        targetRef: "/blog/customer-onboarding/",
        requestedScope: {
          providerKind: "github",
          installationId: 201,
          repositoryId: 101,
        },
        authorizationSnapshot: {
          purpose: "publish",
          destinationRef,
          destinationRevision: 1,
          expiresAt,
        },
        encryptedPayload: null,
        cipherVersion: null,
        keyVersion: null,
        secretMetadata: {},
        expiresAt,
        createdBy: randomUUID(),
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });

    const connections = new DeliveryConnectionsRepository(handle.db);
    await expect(
      connections.listHeads(
        { workspaceId: workspaceA, projectId: projectA },
        { limit: 10 },
      ),
    ).resolves.toEqual({ rows: [], nextCursor: null });
  });
});
