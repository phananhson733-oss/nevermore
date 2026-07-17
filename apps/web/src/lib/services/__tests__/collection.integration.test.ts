import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["DATABASE_URL"] ??= "postgres://wzb@localhost:5432/signalframe_mvp_dev";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { workspaces } from "@sf/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { createCollectionRun } from "@/lib/services/collection";
import { getProjectRun } from "@/lib/services/runs";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

describeDb("createCollectionRun (AC-019, spec §7.5)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db.insert(workspaces).values({ name: `WS-${randomUUID()}` }).returning();
    workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Coll",
        projectName: "Coll",
        siteUrl: "https://coll.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    projectId = created.project.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("queues a crawl collection (202) against the default crawl source", async () => {
    const result = await createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), {
      provider: "crawl",
    });
    expect(result.status).toBe(202);
    expect(result.run.kind).toBe("collection");
    expect(result.run.status).toBe("queued");
    expect(result.statusUrl).toBe(`/api/mvp/projects/${projectId}/runs/${result.run.id}`);
    expect(result.resourceRef).toEqual({ type: "collection_run", id: result.run.id });

    // The run is pollable via the unified status endpoint.
    const polled = await getProjectRun({ workspaceId }, projectId, result.run.id);
    expect(polled.id).toBe(result.run.id);
  });

  it("409s a second active run for the same provider/operation (AC-019)", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), { provider: "crawl" }),
    ).rejects.toMatchObject({ code: "RUN_ALREADY_ACTIVE" });
  });

  it("422s when the provider has no connected source (gsc)", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), { provider: "gsc" }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_CONNECTED" });
  });

  it("422s an operation that doesn't match the provider", async () => {
    await expect(
      createCollectionRun({ workspaceId }, projectId, actor, randomUUID(), {
        provider: "crawl",
        operation: "search_analytics",
      }),
    ).rejects.toMatchObject({ code: "INVALID_COLLECTION_OPERATION" });
  });

  it("replays the 202 for the same Idempotency-Key + body", async () => {
    // A fresh project so no active run interferes with the replay assertion.
    const [ws2] = await handle.db.insert(workspaces).values({ name: `WS-${randomUUID()}` }).returning();
    const proj = await createProject(
      { workspaceId: ws2!.id },
      actor,
      randomUUID(),
      {
        clientName: "R",
        projectName: "R",
        siteUrl: "https://r.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    const key = randomUUID();
    const first = await createCollectionRun({ workspaceId: ws2!.id }, proj.project.id, actor, key, {
      provider: "crawl",
    });
    const second = await createCollectionRun({ workspaceId: ws2!.id }, proj.project.id, actor, key, {
      provider: "crawl",
    });
    expect(second.replayed).toBe(true);
    expect(second.run.id).toBe(first.run.id);
  });
});
