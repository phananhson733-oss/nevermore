import { randomUUID } from "node:crypto";

const previousEnabled = process.env["DATAFORSEO_ENABLED"];
const previousMaxKeywords = process.env["DATAFORSEO_MAX_KEYWORDS"];

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] = "true";
process.env["DATAFORSEO_MAX_KEYWORDS"] = "37";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { and, eq } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db";
import {
  asyncRuns,
  collectionRuns,
  idempotencyKeys,
  sourceConnections,
  sourceCredentials,
  workspaces,
} from "@sf/db/schema";
import type { CreateCollectionRunRequest } from "@sf/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCollectionRun } from "@/lib/services/collection";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { listProjectSources } from "@/lib/services/sources";
import { seedConfirmedSourceProfile } from "./confirmed-source-profile-fixture";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

interface PublicBoundaryState {
  readonly sourceConnections: number;
  readonly sourceCredentials: number;
  readonly asyncRuns: number;
  readonly collectionRuns: number;
  readonly idempotencyKeys: number;
}

async function boundaryState(
  handle: DbHandle,
  workspaceId: string,
  projectId: string,
): Promise<PublicBoundaryState> {
  const [
    connectionRows,
    credentialRows,
    asyncRunRows,
    collectionRunRows,
    idempotencyRows,
  ] = await Promise.all([
    handle.db
      .select({ id: sourceConnections.id })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, projectId)),
    handle.db
      .select({ id: sourceCredentials.id })
      .from(sourceCredentials)
      .where(eq(sourceCredentials.project_id, projectId)),
    handle.db
      .select({ id: asyncRuns.id })
      .from(asyncRuns)
      .where(eq(asyncRuns.project_id, projectId)),
    handle.db
      .select({ id: collectionRuns.id })
      .from(collectionRuns)
      .where(eq(collectionRuns.project_id, projectId)),
    handle.db
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, "createCollectionRun"),
        ),
      ),
  ]);
  return {
    sourceConnections: connectionRows.length,
    sourceCredentials: credentialRows.length,
    asyncRuns: asyncRunRows.length,
    collectionRuns: collectionRunRows.length,
    idempotencyKeys: idempotencyRows.length,
  };
}

describeDb("DataForSEO public collection boundary", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `DFS boundary ${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;

    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "DataForSEO boundary client",
        projectName: "DataForSEO boundary project",
        siteUrl: "https://www.dfs-boundary.example",
        marketCodes: ["GB"],
        siteLanguageCodes: ["fr-FR"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    projectId = created.project.id;
    await seedConfirmedSourceProfile(
      handle,
      { workspaceId, projectId },
      actorId,
    );
  });

  afterAll(async () => {
    await handle?.end();
    if (previousEnabled === undefined) delete process.env["DATAFORSEO_ENABLED"];
    else process.env["DATAFORSEO_ENABLED"] = previousEnabled;
    if (previousMaxKeywords === undefined) {
      delete process.env["DATAFORSEO_MAX_KEYWORDS"];
    } else {
      process.env["DATAFORSEO_MAX_KEYWORDS"] = previousMaxKeywords;
    }
  });

  it("keeps a credential-free internal evidence slot in the read DTO", async () => {
    const slots = await listProjectSources({ workspaceId }, projectId);
    const dataForSeo = slots.find((slot) => slot.provider === "dataforseo");

    expect(dataForSeo).toMatchObject({
      id: null,
      provider: "dataforseo",
      state: "disconnected",
      connectionType: "api_key_stub",
      externalRef: null,
      scopes: [],
      latestSnapshot: null,
    });
    expect(dataForSeo).not.toHaveProperty("apiKey");
    expect(dataForSeo).not.toHaveProperty("credential");
    expect(dataForSeo).not.toHaveProperty("credentials");
    expect(dataForSeo).not.toHaveProperty("secret");
  });

  it("rejects a bypassed direct command without any canonical write", async () => {
    const before = await boundaryState(handle, workspaceId, projectId);
    const bypassedBody = {
      provider: "dataforseo",
      apiKey: "must-never-cross-the-customer-boundary",
    } as unknown as CreateCollectionRunRequest;

    await expect(
      createCollectionRun(
        { workspaceId },
        projectId,
        actorId,
        randomUUID(),
        bypassedBody,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });

    await expect(
      boundaryState(handle, workspaceId, projectId),
    ).resolves.toEqual(before);
  });
});
