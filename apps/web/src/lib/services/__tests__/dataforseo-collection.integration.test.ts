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

import { eq } from "drizzle-orm";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  createDbHandle,
  type DbHandle,
} from "@sf/db";
import {
  sites,
  sourceConnections,
  sourceCredentials,
  workspaces,
} from "@sf/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCollectionRun } from "@/lib/services/collection";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { listProjectSources } from "@/lib/services/sources";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

describeDb("DataForSEO Web collection integration", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `DFS Web ${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;

    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "DataForSEO client",
        projectName: "DataForSEO legacy project",
        siteUrl: "https://www.dfs-auto.example",
        marketCodes: ["GB"],
        siteLanguageCodes: ["fr-FR"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    projectId = created.project.id;
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

  it("exposes an enabled but honestly disconnected legacy slot", async () => {
    const slots = await listProjectSources({ workspaceId }, projectId);
    const dataForSeo = slots.find((slot) => slot.provider === "dataforseo");

    expect(dataForSeo).toMatchObject({
      id: null,
      provider: "dataforseo",
      state: "disconnected",
      connectionType: "api_key_stub",
      featureEnabled: true,
      latestSnapshot: null,
    });
    expect(dataForSeo?.limitation).toContain(
      "ranked-keyword collection is enabled",
    );
  });

  it("atomically provisions one secret-free connection and queues collection", async () => {
    const accepted = await createCollectionRun(
      { workspaceId },
      projectId,
      actorId,
      randomUUID(),
      { provider: "dataforseo" },
    );

    expect(accepted).toMatchObject({
      status: 202,
      replayed: false,
      run: { kind: "collection", status: "queued" },
    });

    const connections = await handle.db
      .select()
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, projectId));
    const dataForSeoConnections = connections.filter(
      (connection) => connection.provider === "dataforseo",
    );
    expect(dataForSeoConnections).toHaveLength(1);
    expect(dataForSeoConnections[0]).toMatchObject({
      connection_type: "api_key_stub",
      state: "connected",
      external_ref: "dfs-auto.example",
      scopes: [],
      config: {
        target: "dfs-auto.example",
        marketCode: "GB",
        locationName: "United Kingdom",
        languageCode: "fr",
        maxKeywords: 37,
      },
    });
    expect(dataForSeoConnections[0]?.limitation).toContain(
      "not a complete competitor-gap analysis",
    );

    const credentialRows = await handle.db
      .select({ id: sourceCredentials.id })
      .from(sourceCredentials)
      .where(eq(sourceCredentials.project_id, projectId));
    expect(credentialRows).toEqual([]);

    const collection = await new CollectionRunsRepository(handle.db).findById(
      accepted.run.id,
    );
    const canonicalRun = await new AsyncRunsRepository(handle.db).findById(
      { workspaceId, projectId },
      accepted.run.id,
    );
    const collectionScope = {
      schemaVersion: "dataforseo.collection-scope.v1",
      queryKind: "ranked_keywords",
      target: "dfs-auto.example",
      marketCode: "GB",
      languageTag: "fr-FR",
      providerLanguageCode: "fr",
      location: { kind: "name", name: "United Kingdom" },
      limit: 37,
    };
    expect(collection).toMatchObject({
      provider: "dataforseo",
      operation: "keyword_gap_import",
      method_version: "dataforseo.ranked_keywords.v1",
      source_connection_id: dataForSeoConnections[0]!.id,
      parameters_hash: contentHash({
        provider: "dataforseo",
        operation: "keyword_gap_import",
        siteId: collection!.site_id,
        collectionScope,
      }),
    });
    expect(canonicalRun?.request_payload).toEqual({
      provider: "dataforseo",
      operation: "keyword_gap_import",
      sourceConnectionId: dataForSeoConnections[0]!.id,
      collectionScope,
    });

    const slots = await listProjectSources({ workspaceId }, projectId);
    expect(slots.find((slot) => slot.provider === "dataforseo")).toMatchObject({
      id: dataForSeoConnections[0]!.id,
      state: "connected",
      externalRef: "dfs-auto.example",
      featureEnabled: true,
      activeRun: { id: accepted.run.id, status: "queued" },
    });
  });

  it("keeps the lazy connection unique under concurrent first collections", async () => {
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "Concurrent DataForSEO client",
        projectName: "Concurrent DataForSEO project",
        siteUrl: `https://www.dfs-race-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en-US"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const raceProjectId = created.project.id;

    const outcomes = await Promise.allSettled([
      createCollectionRun(
        { workspaceId },
        raceProjectId,
        actorId,
        randomUUID(),
        { provider: "dataforseo" },
      ),
      createCollectionRun(
        { workspaceId },
        raceProjectId,
        actorId,
        randomUUID(),
        { provider: "dataforseo" },
      ),
    ]);
    const accepted = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      status: 409,
    });

    const connections = await handle.db
      .select({ provider: sourceConnections.provider })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, raceProjectId));
    expect(connections).toHaveLength(2);
    expect(
      connections.filter((connection) => connection.provider === "dataforseo"),
    ).toHaveLength(1);
  });

  it("does not auto-provision when the client supplies an invalid connection id", async () => {
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "Explicit DataForSEO client",
        projectName: "Explicit DataForSEO project",
        siteUrl: `https://dfs-explicit-${randomUUID()}.example`,
        marketCodes: ["CA"],
        siteLanguageCodes: ["en-CA"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );

    await expect(
      createCollectionRun(
        { workspaceId },
        created.project.id,
        actorId,
        randomUUID(),
        { provider: "dataforseo", sourceConnectionId: randomUUID() },
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_CONNECTED", status: 422 });

    const connections = await handle.db
      .select({ provider: sourceConnections.provider })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, created.project.id));
    expect(connections.map((connection) => connection.provider)).toEqual([
      "crawl",
    ]);
  });

  it("rolls back without provisioning when the primary Site scope is incomplete", async () => {
    const created = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "Incomplete DataForSEO client",
        projectName: "Incomplete DataForSEO project",
        siteUrl: `https://dfs-incomplete-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    await handle.db
      .update(sites)
      .set({ market_codes: [] })
      .where(eq(sites.project_id, created.project.id));

    await expect(
      createCollectionRun(
        { workspaceId },
        created.project.id,
        actorId,
        randomUUID(),
        { provider: "dataforseo" },
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
      current: {
        missingField: "primaryMarket",
      },
    });

    const connections = await handle.db
      .select({ provider: sourceConnections.provider })
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, created.project.id));
    expect(connections.map((connection) => connection.provider)).toEqual([
      "crawl",
    ]);
  });
});
