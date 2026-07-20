import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  asyncRuns,
  clientProjects,
  exportBundles,
  workspaces,
} from "../schema.ts";
import { ExportBundlesRepository } from "../repositories/export-bundles.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const ACTOR_ID = randomUUID();
const CHECKSUM = "a".repeat(64);

function pgCode(error: unknown): string | undefined {
  const candidate = error as
    | { readonly code?: string; readonly cause?: { readonly code?: string } }
    | null;
  return candidate?.code ?? candidate?.cause?.code;
}

async function expectCheckViolation(operation: Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(pgCode(caught)).toBe("23514");
}

describeDb("export bundle object-key invariants", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
    workspaceId = randomUUID();
    otherWorkspaceId = randomUUID();
    projectId = randomUUID();
    otherProjectId = randomUUID();

    await handle.db.insert(workspaces).values([
      { id: workspaceId, name: `Export invariant ${workspaceId}` },
      {
        id: otherWorkspaceId,
        name: `Export invariant ${otherWorkspaceId}`,
      },
    ]);
    await handle.db.insert(clientProjects).values([
      {
        id: projectId,
        workspace_id: workspaceId,
        client_name: "Export invariant client",
        project_name: "Export invariant project",
        default_delivery_locale: "en",
        created_by: ACTOR_ID,
      },
      {
        id: otherProjectId,
        workspace_id: otherWorkspaceId,
        client_name: "Other export invariant client",
        project_name: "Other export invariant project",
        default_delivery_locale: "en",
        created_by: ACTOR_ID,
      },
    ]);
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function insertRun(input: {
    readonly workspaceId?: string;
    readonly projectId?: string;
    readonly kind?: string;
  } = {}): Promise<string> {
    const id = randomUUID();
    await handle.db.insert(asyncRuns).values({
      id,
      workspace_id: input.workspaceId ?? workspaceId,
      project_id: input.projectId ?? projectId,
      kind: input.kind ?? "export",
      initiated_by: ACTOR_ID,
    });
    return id;
  }

  async function insertBundle(runId: string): Promise<string> {
    const bundle = await new ExportBundlesRepository(handle.db).insert({
      workspaceId,
      projectId,
      asyncRunId: runId,
      kind: "client_bundle",
      outputLocale: "en",
      createdBy: ACTOR_ID,
    });
    return bundle.id;
  }

  const finalizedValues = (runId: string, nonce: string = randomUUID()) => ({
    objectKey: `export/${projectId}/${runId}/${nonce}`,
    checksum: CHECKSUM,
    byteSize: 1,
    itemCounts: { findings: 1 },
    manifest: { schemaVersion: "signalframe.service-bundle.0.2.0" },
  });

  it("accepts one exact placeholder-to-finalized transition", async () => {
    const runId = await insertRun();
    const bundleId = await insertBundle(runId);
    const values = finalizedValues(runId);

    await expect(
      new ExportBundlesRepository(handle.db).finalize(bundleId, values),
    ).resolves.toBeUndefined();

    await expect(
      handle.db
        .select({
          objectKey: exportBundles.object_key,
          checksum: exportBundles.checksum,
          byteSize: exportBundles.byte_size,
        })
        .from(exportBundles)
        .where(eq(exportBundles.id, bundleId)),
    ).resolves.toEqual([
      {
        objectKey: values.objectKey,
        checksum: CHECKSUM,
        byteSize: 1,
      },
    ]);
  });

  it("rejects a same-project key that embeds a different export run", async () => {
    const bundleRunId = await insertRun();
    const otherRunId = await insertRun();
    const bundleId = await insertBundle(bundleRunId);

    await expectCheckViolation(
      new ExportBundlesRepository(handle.db).finalize(
        bundleId,
        finalizedValues(otherRunId),
      ),
    );

    await expect(
      handle.db
        .select({ objectKey: exportBundles.object_key })
        .from(exportBundles)
        .where(eq(exportBundles.id, bundleId)),
    ).resolves.toEqual([{ objectKey: null }]);
  });

  it("rejects a key that embeds a different project", async () => {
    const runId = await insertRun();
    const bundleId = await insertBundle(runId);
    const values = finalizedValues(runId);

    await expectCheckViolation(
      new ExportBundlesRepository(handle.db).finalize(bundleId, {
        ...values,
        objectKey: `export/${otherProjectId}/${runId}/${randomUUID()}`,
      }),
    );
  });

  it("rejects incomplete object metadata and unsafe nonce segments", async () => {
    const incompleteRunId = await insertRun();
    const incompleteBundleId = await insertBundle(incompleteRunId);
    await expectCheckViolation(
      handle.db
        .update(exportBundles)
        .set({
          object_key: `export/${projectId}/${incompleteRunId}/${randomUUID()}`,
        })
        .where(eq(exportBundles.id, incompleteBundleId)),
    );

    const unsafeRunId = await insertRun();
    const unsafeBundleId = await insertBundle(unsafeRunId);
    await expectCheckViolation(
      new ExportBundlesRepository(handle.db).finalize(
        unsafeBundleId,
        finalizedValues(unsafeRunId, ".."),
      ),
    );
  });

  it("rejects every second finalization, including a byte-for-byte replay", async () => {
    const runId = await insertRun();
    const bundleId = await insertBundle(runId);
    const values = finalizedValues(runId);
    const repository = new ExportBundlesRepository(handle.db);
    await repository.finalize(bundleId, values);

    await expectCheckViolation(repository.finalize(bundleId, values));
    await expectCheckViolation(
      repository.finalize(bundleId, {
        ...values,
        checksum: "b".repeat(64),
      }),
    );
  });

  it("rejects a bundle whose AsyncRun belongs to another scope or kind", async () => {
    const otherScopeRunId = await insertRun({
      workspaceId: otherWorkspaceId,
      projectId: otherProjectId,
    });
    await expectCheckViolation(
      new ExportBundlesRepository(handle.db).insert({
        workspaceId,
        projectId,
        asyncRunId: otherScopeRunId,
        kind: "client_bundle",
        outputLocale: "en",
        createdBy: ACTOR_ID,
      }),
    );

    const diagnosticRunId = await insertRun({ kind: "diagnostic" });
    await expectCheckViolation(
      new ExportBundlesRepository(handle.db).insert({
        workspaceId,
        projectId,
        asyncRunId: diagnosticRunId,
        kind: "client_bundle",
        outputLocale: "en",
        createdBy: ACTOR_ID,
      }),
    );
  });
});
