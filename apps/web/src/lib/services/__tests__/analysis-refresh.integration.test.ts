import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["DATAFORSEO_MAX_KEYWORDS"] ??= "200";
process.env["DATAFORSEO_MAX_COMPETITORS"] ??= "100";
process.env["DATAFORSEO_BACKLINKS_ENABLED"] ??= "false";
process.env["DATAFORSEO_MAX_BACKLINKS"] ??= "500";
process.env["DATAFORSEO_MAX_REFERRING_DOMAINS"] ??= "100";
process.env["DATAFORSEO_MAX_BACKLINK_PAGES"] ??= "500";
process.env["DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS"] ??= "20";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  contentHash,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
} from "@sf/db";
import {
  analysisRefreshRuns,
  analysisRefreshSteps,
  asyncRuns,
  clientProjects,
  icpProfiles,
  idempotencyKeys,
  workspaces,
} from "@sf/db/schema";

const queue = vi.hoisted(() => ({
  send: vi.fn(async () => randomUUID()),
}));
vi.mock("@/lib/boss", () => ({ getBoss: async () => queue }));

const { createAnalysisRefreshRun } = await import("../analysis-refresh.ts");

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const actorId = randomUUID();

interface Fixture {
  readonly projectId: string;
  readonly siteId: string;
  readonly profileId: string | null;
  readonly crawlConnectionId: string;
  readonly gscConnectionId: string | null;
}

describeDb("createAnalysisRefreshRun real transaction", () => {
  let handle: DbHandle;
  let workspaceId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Analysis Refresh Web ${randomUUID()}`, plan_tier: "internal" })
      .returning();
    workspaceId = workspace!.id;
  });

  beforeEach(() => {
    queue.send.mockReset();
    queue.send.mockImplementation(async () => randomUUID());
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function fixture(options: {
    readonly confirmedProfile?: boolean;
    readonly gsc?: boolean;
  } = {}): Promise<Fixture> {
    const project = await new ProjectsRepository(handle.db).insert({
      workspaceId,
      clientName: `Refresh ${randomUUID()}`,
      projectName: `Refresh ${randomUUID()}`,
      defaultDeliveryLocale: "zh-CN",
      createdBy: actorId,
    });
    const site = await new SitesRepository(handle.db).insertPrimary({
      workspaceId,
      projectId: project.id,
      origin: "https://example.com",
      host: "example.com",
      marketCodes: [],
      // The command must not require an operator-selected language.
      languageCodes: [],
    });
    const crawl = await new SourceConnectionsRepository(
      handle.db,
    ).insertDefaultCrawl({
      workspaceId,
      projectId: project.id,
      siteId: site.id,
      createdBy: actorId,
    });

    let profileId: string | null = null;
    if (options.confirmedProfile !== false) {
      const [profile] = await handle.db
        .insert(icpProfiles)
        .values({
          workspace_id: workspaceId,
          project_id: project.id,
          version: 1,
          status: "complete",
          // Historical complete ICP: intentionally lacks ProductProfile version.
          profile: { productName: "Refresh fixture" },
          content_hash: contentHash({ projectId: project.id, version: 1 }),
          created_by: actorId,
        })
        .returning();
      profileId = profile!.id;
      await handle.db
        .update(clientProjects)
        .set({
          current_icp_profile_id: profileId,
          confirmed_icp_profile_id: profileId,
        })
        .where(eq(clientProjects.id, project.id));
    }

    const gsc =
      options.gsc === true
        ? await new SourceConnectionsRepository(handle.db).insertConnection({
            workspaceId,
            projectId: project.id,
            siteId: site.id,
            provider: "gsc",
            connectionType: "oauth",
            state: "connected",
            externalRef: "sc-domain:example.com",
            limitation: "Integration fixture.",
            connectedAt: true,
            createdBy: actorId,
          })
        : null;

    return {
      projectId: project.id,
      siteId: site.id,
      profileId,
      crawlConnectionId: crawl.id,
      gscConnectionId: gsc?.id ?? null,
    };
  }

  it("commits the parent, fixed skips, queue job, and completed idempotency record", async () => {
    const input = await fixture({ gsc: true });
    const key = randomUUID();

    const accepted = await createAnalysisRefreshRun(
      { workspaceId },
      input.projectId,
      actorId,
      key,
      {},
    );

    expect(accepted.status).toBe(202);
    expect(accepted.resourceRef).toEqual({
      type: "analysis_refresh_run",
      id: accepted.run.id,
    });
    const [parent] = await handle.db
      .select({
        kind: asyncRuns.kind,
        activeKey: asyncRuns.active_key,
        resultType: asyncRuns.result_type,
        resultId: asyncRuns.result_id,
        requestPayload: asyncRuns.request_payload,
      })
      .from(asyncRuns)
      .where(eq(asyncRuns.id, accepted.run.id));
    expect(parent).toEqual({
      kind: "analysis_refresh",
      activeKey: "analysis_refresh",
      resultType: "analysis_refresh_run",
      resultId: accepted.run.id,
      requestPayload: {
        siteId: input.siteId,
        icpProfile: {
          id: input.profileId,
          version: 1,
          contentHash: contentHash({ projectId: input.projectId, version: 1 }),
        },
        outputLocale: "zh-CN",
        sourceConnectionIds: {
          crawl: input.crawlConnectionId,
          gsc: input.gscConnectionId,
          ga4: null,
        },
        dataForSeo: {
          enabled: process.env["DATAFORSEO_ENABLED"] === "true",
          maxKeywords: Number(process.env["DATAFORSEO_MAX_KEYWORDS"] ?? "200"),
          maxCompetitors: Number(
            process.env["DATAFORSEO_MAX_COMPETITORS"] ?? "100",
          ),
        },
        dataForSeoBacklinks: {
          enabled:
            process.env["DATAFORSEO_BACKLINKS_ENABLED"] === "true",
          maxBacklinks: Number(
            process.env["DATAFORSEO_MAX_BACKLINKS"] ?? "500",
          ),
          maxReferringDomains: Number(
            process.env["DATAFORSEO_MAX_REFERRING_DOMAINS"] ?? "100",
          ),
          maxBacklinkPages: Number(
            process.env["DATAFORSEO_MAX_BACKLINK_PAGES"] ?? "500",
          ),
          maxSourceVerifications: Number(
            process.env[
              "DATAFORSEO_MAX_BACKLINK_SOURCE_VERIFICATIONS"
            ] ?? "20",
          ),
        },
      },
    });

    const typedParents = await handle.db
      .select({ id: analysisRefreshRuns.id })
      .from(analysisRefreshRuns)
      .where(eq(analysisRefreshRuns.id, accepted.run.id));
    expect(typedParents).toEqual([{ id: accepted.run.id }]);
    const steps = await handle.db
      .select({
        stepKey: analysisRefreshSteps.step_key,
        state: analysisRefreshSteps.state,
        skipReason: analysisRefreshSteps.skip_reason,
      })
      .from(analysisRefreshSteps)
      .where(
        eq(
          analysisRefreshSteps.analysis_refresh_run_id,
          accepted.run.id,
        ),
      )
      .orderBy(asc(analysisRefreshSteps.ordinal));
    expect(steps).toEqual([
      { stepKey: "crawl", state: "pending", skipReason: null },
      { stepKey: "gsc", state: "pending", skipReason: null },
      {
        stepKey: "ga4",
        state: "skipped",
        skipReason: "source_not_connected",
      },
      {
        stepKey: "dataforseo",
        state:
          process.env["DATAFORSEO_ENABLED"] === "true"
            ? "pending"
            : "skipped",
        skipReason:
          process.env["DATAFORSEO_ENABLED"] === "true"
            ? null
            : "feature_disabled",
      },
      {
        stepKey: "dataforseo_backlinks",
        state: "skipped",
        skipReason: "feature_disabled",
      },
      { stepKey: "growth_audit", state: "pending", skipReason: null },
    ]);
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(queue.send).toHaveBeenCalledWith(
      "refresh.analysis",
      expect.objectContaining({ runId: accepted.run.id }),
      expect.objectContaining({ id: accepted.run.id }),
    );

    const replay = await createAnalysisRefreshRun(
      { workspaceId },
      input.projectId,
      actorId,
      key,
      {},
    );
    expect(replay.replayed).toBe(true);
    expect(replay.run.id).toBe(accepted.run.id);
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it("rolls back parent and idempotency reservation when enqueue fails", async () => {
    const input = await fixture();
    const key = randomUUID();
    queue.send.mockRejectedValueOnce(new Error("pg-boss unavailable"));

    await expect(
      createAnalysisRefreshRun(
        { workspaceId },
        input.projectId,
        actorId,
        key,
        {},
      ),
    ).rejects.toThrow("pg-boss unavailable");

    const parents = await handle.db
      .select({ id: asyncRuns.id })
      .from(asyncRuns)
      .where(
        and(
          eq(asyncRuns.project_id, input.projectId),
          eq(asyncRuns.kind, "analysis_refresh"),
        ),
      );
    expect(parents).toEqual([]);
    const idem = await handle.db
      .select({ id: idempotencyKeys.id })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.workspace_id, workspaceId),
          eq(idempotencyKeys.scope, "createAnalysisRefreshRun"),
          eq(idempotencyKeys.idempotency_key, key),
        ),
      );
    expect(idem).toEqual([]);
  });

  it("rejects an incomplete project without creating or enqueueing a parent", async () => {
    const input = await fixture({ confirmedProfile: false });

    await expect(
      createAnalysisRefreshRun(
        { workspaceId },
        input.projectId,
        actorId,
        randomUUID(),
        {},
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
    });
    const parent = await handle.db
      .select({ id: analysisRefreshRuns.id })
      .from(analysisRefreshRuns)
      .where(eq(analysisRefreshRuns.project_id, input.projectId));
    expect(parent).toEqual([]);
    expect(queue.send).not.toHaveBeenCalled();
  });
});
