import { randomUUID } from "node:crypto";

// Full web env (fail-fast) — set before any service import touches getEnv().
process.env["APP_ORIGIN"] ??= "http://localhost:3000";
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

import { eq } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import {
  contentHash,
  ProjectsRepository,
  type CanonicalValue,
} from "@sf/db";
import { sourceConnections, telemetryEvents, workspaces } from "@sf/db/schema";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, getProject, type UrlGuard } from "@/lib/services/projects";
import { getContext, updateContext } from "@/lib/services/context";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});
const blockGuard: UrlGuard = async () => ({
  safe: false,
  normalizedUrl: null,
  pinnedIp: null,
  reason: "resolves to a blocked private address",
});

async function newWorkspace(handle: DbHandle): Promise<string> {
  const [ws] = await handle.db.insert(workspaces).values({ name: `WS-${randomUUID()}` }).returning();
  return ws!.id;
}

const baseBody = (siteUrl: string) => ({
  clientName: "Acme",
  projectName: "Acme SEO",
  siteUrl,
  marketCodes: ["US"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
});

describeDb("createProject (AC-007)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    workspaceId = await newWorkspace(handle);
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("creates project + primary site + default crawl source + telemetry on a safe URL", async () => {
    const result = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      baseBody("https://Example.com/"),
      safeGuard,
    );
    expect(result.status).toBe(201);
    expect(result.location).toBe(`/p/${result.project.id}/overview`);
    // Origin normalized to lowercase host, no trailing slash.
    expect(result.project.site.origin).toBe("https://example.com");
    expect(result.project.site.host).toBe("example.com");
    expect(result.project.contextStatus).toBe("missing");
    expect(result.project.stage).toBe("setup");

    const sources = await handle.db
      .select()
      .from(sourceConnections)
      .where(eq(sourceConnections.project_id, result.project.id));
    expect(sources).toHaveLength(1);
    expect(sources[0]!.provider).toBe("crawl");
    expect(sources[0]!.state).toBe("connected");

    const events = await handle.db
      .select()
      .from(telemetryEvents)
      .where(eq(telemetryEvents.project_id, result.project.id));
    expect(events.map((e) => e.event_name)).toContain("project_created");
  });

  it("rejects a non-http(s) URL with 422 before the guard runs", async () => {
    await expect(
      createProject({ workspaceId }, actor, randomUUID(), baseBody("ftp://example.com"), safeGuard),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a non-root path/query instead of silently changing the submitted target", async () => {
    const guard = vi.fn(safeGuard);
    await expect(
      createProject(
        { workspaceId },
        actor,
        randomUUID(),
        baseBody("https://example.com/customer-path?campaign=private"),
        guard,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [expect.objectContaining({ pointer: "/siteUrl" })],
    });
    expect(guard).not.toHaveBeenCalled();
  });

  it("probes a DNS-pinned HTTPS origin before upgrading production HTTP input", async () => {
    const guard = vi.fn(safeGuard);
    const siteOriginProbe = vi.fn(async () => true);
    const result = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      baseBody("http://Upgrade.Example/"),
      guard,
      { environment: "production", siteOriginProbe },
    );

    expect(result.project.site.origin).toBe("https://upgrade.example");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith("https://upgrade.example");
    expect(siteOriginProbe).toHaveBeenCalledWith({
      origin: "https://upgrade.example",
      pinnedIp: "93.184.216.34",
    });
  });

  it("fails closed when the production HTTPS upgrade is not reachable", async () => {
    const siteOriginProbe = vi.fn(async () => false);
    await expect(
      createProject(
        { workspaceId },
        actor,
        randomUUID(),
        baseBody("http://unreachable.example"),
        safeGuard,
        { environment: "production", siteOriginProbe },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: [
        expect.objectContaining({ code: "https_unreachable" }),
      ],
    });
    expect(siteOriginProbe).toHaveBeenCalledTimes(1);
  });

  it("rejects a URL the SSRF guard blocks (private/metadata) with 422", async () => {
    await expect(
      createProject({ workspaceId }, actor, randomUUID(), baseBody("http://10.0.0.1"), blockGuard),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it("replays the original 201 for the same Idempotency-Key + body", async () => {
    const key = randomUUID();
    const first = await createProject({ workspaceId }, actor, key, baseBody("https://replay.example"), safeGuard);
    const changedDnsGuard = vi.fn(blockGuard);
    const second = await createProject(
      { workspaceId },
      actor,
      key,
      baseBody("https://replay.example"),
      changedDnsGuard,
    );
    expect(second.replayed).toBe(true);
    expect(second.project.id).toBe(first.project.id);
    expect(changedDnsGuard).not.toHaveBeenCalled();
  });

  it("409s when the same Idempotency-Key is reused with a different body", async () => {
    const key = randomUUID();
    await createProject({ workspaceId }, actor, key, baseBody("https://a.example"), safeGuard);
    const shouldNotRun = vi.fn(blockGuard);
    await expect(
      createProject({ workspaceId }, actor, key, baseBody("https://b.example"), shouldNotRun),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });
});

describeDb("context versioning (AC-009) and isolation (AC-010)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  const actor = randomUUID();

  const completeProfile = () => ({
    productName: "Acme Analytics",
    oneLineDescription: "Analytics for teams.",
    customerModel: "b2b" as const,
    businessProfile: "b2b_saas" as const,
    businessProfileNote: null,
    marketCodes: ["US"],
    siteLanguageCodes: ["en"],
    defaultDeliveryLocale: "en",
    segments: ["Growth"],
    personas: [{ name: "PM", roleOrContext: "PM", jobs: ["ship"], painPoints: ["no data"] }],
    useCases: ["Funnels"],
    offers: ["Free plan"],
    differentiators: ["Fast"],
    primaryConversion: { label: "Demo", type: "demo" as const, targetUrl: null },
    priorityProductsOrServices: ["Dashboards"],
    priorityUrls: [],
    competitors: [],
    brandConstraints: [],
    complianceConstraints: [],
    technicalConstraints: [],
    resourceConstraints: [],
    growthQuestions: ["Grow?"],
    ninetyDayGoals: ["2x signups"],
  });

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    workspaceId = await newWorkspace(handle);
    otherWorkspaceId = await newWorkspace(handle);
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      baseBody("https://ctx.example"),
      safeGuard,
    );
    projectId = created.project.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("first draft save creates version 1; identical re-save is a no-op (AC-009)", async () => {
    const v1 = await updateContext({ workspaceId }, projectId, actor, {
      mode: "draft",
      baseVersion: 0,
      profile: { productName: "Draft One" },
    });
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("draft");

    const again = await updateContext({ workspaceId }, projectId, actor, {
      mode: "draft",
      baseVersion: 1,
      profile: { productName: "Draft One" },
    });
    expect(again.version).toBe(1); // identical canonical content → same version
  });

  it("a different draft advances to version 2", async () => {
    const v2 = await updateContext({ workspaceId }, projectId, actor, {
      mode: "draft",
      baseVersion: 1,
      profile: { productName: "Draft Two" },
    });
    expect(v2.version).toBe(2);
  });

  it("a stale baseVersion returns VERSION_CONFLICT (AC-009)", async () => {
    await expect(
      updateContext({ workspaceId }, projectId, actor, {
        mode: "draft",
        baseVersion: 0,
        profile: { productName: "Way behind" },
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("serializes two truly concurrent saves so exactly one succeeds and one returns VERSION_CONFLICT", async () => {
    const concurrentWorkspaceId = await newWorkspace(handle);
    const created = await createProject(
      { workspaceId: concurrentWorkspaceId },
      actor,
      randomUUID(),
      baseBody("https://ctx-concurrent.example"),
      safeGuard,
    );

    // RED-phase race amplifier: the old implementation used the unlocked
    // `findById`, so hold both calls after they observed version 0 and release
    // them together. The fixed implementation must use the FOR UPDATE read and
    // therefore never enter this unlocked path.
    const originalFindById = ProjectsRepository.prototype.findById;
    let unlockedReads = 0;
    let releaseBoth!: () => void;
    const bothUnlockedReads = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    const unlockedFind = vi
      .spyOn(ProjectsRepository.prototype, "findById")
      .mockImplementation(async function (
        this: ProjectsRepository,
        scope,
        id,
      ) {
        const row = await originalFindById.call(this, scope, id);
        unlockedReads += 1;
        if (unlockedReads === 2) releaseBoth();
        await bothUnlockedReads;
        return row;
      });

    try {
      const results = await Promise.allSettled([
        updateContext(
          { workspaceId: concurrentWorkspaceId },
          created.project.id,
          actor,
          {
            mode: "draft",
            baseVersion: 0,
            profile: { productName: "Concurrent A" },
          },
        ),
        updateContext(
          { workspaceId: concurrentWorkspaceId },
          created.project.id,
          actor,
          {
            mode: "draft",
            baseVersion: 0,
            profile: { productName: "Concurrent B" },
          },
        ),
      ]);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof updateContext>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      expect(unlockedFind).not.toHaveBeenCalled();
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]!.value.version).toBe(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(ProblemError);
      expect(rejected[0]!.reason).toMatchObject({
        code: "VERSION_CONFLICT",
        status: 409,
      });
    } finally {
      unlockedFind.mockRestore();
    }
  });

  it("includes immutable status in the version-semantic hash so draft to complete can append", async () => {
    const statusWorkspaceId = await newWorkspace(handle);
    const created = await createProject(
      { workspaceId: statusWorkspaceId },
      actor,
      randomUUID(),
      baseBody("https://ctx-status-hash.example"),
      safeGuard,
    );
    // Draft patches treat null as a delete instruction. Keep this field
    // concrete so both saves exercise an exactly identical profile payload.
    const profile = {
      ...completeProfile(),
      businessProfileNote: "Not applicable",
    };

    const draft = await updateContext(
      { workspaceId: statusWorkspaceId },
      created.project.id,
      actor,
      { mode: "draft", baseVersion: 0, profile },
    );
    const complete = await updateContext(
      { workspaceId: statusWorkspaceId },
      created.project.id,
      actor,
      { mode: "complete", baseVersion: 1, profile },
    );
    const replay = await updateContext(
      { workspaceId: statusWorkspaceId },
      created.project.id,
      actor,
      { mode: "complete", baseVersion: 2, profile },
    );

    expect(draft.contentHash).toBe(
      contentHash({ status: "draft", profile } as CanonicalValue),
    );
    expect(complete.contentHash).toBe(
      contentHash({ status: "complete", profile } as CanonicalValue),
    );
    expect(complete.contentHash).not.toBe(draft.contentHash);
    expect(complete.version).toBe(2);
    expect(replay.version).toBe(2);
  });

  it("a complete save creates a new complete version and mirrors projections", async () => {
    const current = await getContext({ workspaceId }, projectId);
    const complete = await updateContext({ workspaceId }, projectId, actor, {
      mode: "complete",
      baseVersion: current!.version,
      profile: completeProfile(),
    });
    expect(complete.status).toBe("complete");
    expect(complete.version).toBeGreaterThan(current!.version);

    const project = await getProject({ workspaceId }, projectId);
    expect(project.contextStatus).toBe("complete");
    expect(project.currentIcpProfileVersion).toBe(complete.version);
  });

  it("a foreign workspace cannot read the project (404, not 403) (AC-010)", async () => {
    await expect(getProject({ workspaceId: otherWorkspaceId }, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(getContext({ workspaceId: otherWorkspaceId }, projectId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
