import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["DATABASE_URL"] ??= "postgres://wzb@localhost:5432/signalframe_mvp_dev";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  contentHash,
  DiagnosticRunsRepository,
  EvidenceRepository,
  ExecutionArtifactsRepository,
  FindingsRepository,
} from "@sf/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { reviewProjectFinding } from "@/lib/services/finding-review";
import { listProjectFindings } from "@/lib/services/findings-list";
import { listProjectActions, updateProjectAction } from "@/lib/services/actions-service";
import { getProjectReport } from "@/lib/services/report";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

type Scope = { workspaceId: string; projectId: string };

/** The delivery locale fixed onto the seeded READY artifact (spec §4.3). */
const ARTIFACT_OUTPUT_LOCALE = "zh-CN";
/** Distinctive already-generated delivery content (must survive locale switches). */
const ARTIFACT_ZH_CONTENT =
  "工单：修复返回 HTTP 404 的页面。恢复原内容或配置 301 重定向到最相关的存续 URL。";
/** Coverage limitations the report must echo verbatim from canonical (spec §10.4). */
const COVERAGE_LIMITATIONS: readonly string[] = [
  "GA4 is not connected; conversion-journey coverage is qualitative only.",
  "GSC snapshot is stale; search-performance findings may lag.",
];

async function seedIcp(handle: DbHandle, scope: Scope, actor: string): Promise<string> {
  const [icp] = await handle.db
    .insert(icpProfiles)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      version: 1,
      status: "complete",
      profile: { productName: "Acme", siteLanguageCodes: ["en"], defaultDeliveryLocale: "en" },
      content_hash: contentHash({ icp: randomUUID() }),
      created_by: actor,
    })
    .returning();
  return icp!.id;
}

/** Seed one diagnostic run (completed) with coverage limitations set. */
async function seedDiagnosticRun(
  handle: DbHandle,
  scope: Scope,
  siteId: string,
  icpId: string,
  actor: string,
): Promise<string> {
  const nowTs = new Date().toISOString();
  const [run] = await handle.db
    .insert(asyncRuns)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "diagnostic",
      status: "completed",
      active_key: null,
      initiated_by: actor,
      started_at: nowTs,
      completed_at: nowTs,
    })
    .returning();
  const diagRepo = new DiagnosticRunsRepository(handle.db);
  await diagRepo.insert({
    runId: run!.id,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    icpProfileId: icpId,
    icpProfileVersion: 1,
    ruleSetVersion: "mvp.rules.0.2.0",
    promptSetVersion: "mvp.prompts.0.2.0",
    outputLocale: "en",
    inputManifest: { snapshots: [] },
    inputHash: contentHash({ run: run!.id }),
  });
  await diagRepo.setCoverage(run!.id, {
    overall: "partial",
    domains: {
      technical_seo: "complete",
      search_performance: "partial",
      content_intent: "qualitative",
      conversion_journey: "unavailable",
      geo_ai: "unavailable",
    },
    limitations: [...COVERAGE_LIMITATIONS],
  });
  return run!.id;
}

/** Seed a TECH-HTTP-001 finding + primary evidence under a diagnostic run. */
async function seedFinding(
  handle: DbHandle,
  scope: Scope,
  runId: string,
  input: {
    findingKey: string;
    severity: "high" | "low";
    confidence: "high" | "low";
    subjectRef: string;
    summary: string;
    evidenceLimitation: string;
  },
): Promise<string> {
  const now = new Date().toISOString();
  const finding = await new FindingsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    findingKey: input.findingKey,
    ruleId: "TECH-HTTP-001",
    ruleVersion: 1,
    ruleFamily: "http-status",
    intent: "restore_or_redirect",
    domain: "technical_seo",
    titleKey: "finding.http_status",
    titleArgs: { status: "404", count: 3, __priorityRelevant: true },
    summary: input.summary,
    summaryLocale: "en",
    subjectRefs: [input.subjectRef],
    severity: input.severity,
    confidence: input.confidence,
    reviewState: "unreviewed",
    runId,
    seenAt: now,
  });
  const [evidenceId] = await new EvidenceRepository(handle.db).insertMany(
    { workspaceId: scope.workspaceId, projectId: scope.projectId, diagnosticRunId: runId },
    [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: [input.subjectRef],
        claim: "Page returns 404.",
        observedAt: now,
        limitation: input.evidenceLimitation,
      },
    ],
  );
  await new EvidenceRepository(handle.db).linkObservations(
    { workspaceId: scope.workspaceId, projectId: scope.projectId, diagnosticRunId: runId },
    [{ findingId: finding.id, evidenceId: evidenceId!, role: "primary" }],
  );
  return finding.id;
}

/** Seed a READY artifact (revision 1) off an action, with a fixed outputLocale. */
async function seedReadyArtifact(
  handle: DbHandle,
  scope: Scope,
  actionId: string,
  actor: string,
): Promise<string> {
  const nowTs = new Date().toISOString();
  const [artRun] = await handle.db
    .insert(asyncRuns)
    .values({
      workspace_id: scope.workspaceId,
      project_id: scope.projectId,
      kind: "artifact_generation",
      status: "completed",
      active_key: null,
      initiated_by: actor,
      started_at: nowTs,
      completed_at: nowTs,
    })
    .returning();
  const repo = new ExecutionArtifactsRepository(handle.db);
  const artifact = await repo.insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    actionId,
    artifactType: "technical_ticket",
    generationMode: "template",
    outputLocale: ARTIFACT_OUTPUT_LOCALE,
    latestGenerationRunId: artRun!.id,
    createdBy: actor,
  });
  const hash = contentHash({ c: ARTIFACT_ZH_CONTENT });
  await repo.insertRevision({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    artifactId: artifact.id,
    revision: 1,
    contentFormat: "markdown",
    contentText: ARTIFACT_ZH_CONTENT,
    contentJson: null,
    contentHash: hash,
    generatedBy: "template",
    editorId: null,
    analysisInvocationId: null,
    note: null,
    validationErrors: [],
  });
  await repo.setGenerated(artifact.id, {
    status: "ready",
    currentRevision: 1,
    validationState: "valid",
    contentHash: hash,
  });
  return artifact.id;
}

describeDb("Report projection == list projections (spec §10.4, AC-035, AC-036)", () => {
  let handle: DbHandle;
  let scope: Scope;
  let defaultDeliveryLocale: string;
  let actionAId: string;
  const actor = randomUUID();
  const generatedAt = "2026-07-18T00:00:00.000Z";

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    const workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Report",
        projectName: "Report",
        siteUrl: "https://report.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId, projectId: created.project.id };
    defaultDeliveryLocale = created.project.defaultDeliveryLocale;

    const icpId = await seedIcp(handle, scope, actor);
    const runId = await seedDiagnosticRun(handle, scope, created.project.site.id, icpId, actor);

    // Two active findings with DIFFERENT deterministic priority so ordering matters.
    const findingAId = await seedFinding(handle, scope, runId, {
      findingKey: contentHash({ p: scope.projectId, k: "http_status:404:a" }),
      severity: "high",
      confidence: "high",
      subjectRef: "http_status:404",
      summary: "Three high-value pages return HTTP 404.",
      evidenceLimitation: "Current public response only; historical status not observed.",
    });
    const findingBId = await seedFinding(handle, scope, runId, {
      findingKey: contentHash({ p: scope.projectId, k: "http_status:404:b" }),
      severity: "low",
      confidence: "high",
      subjectRef: "http_status:404b",
      summary: "One low-traffic page returns HTTP 404.",
      evidenceLimitation: "Single crawl pass; low-traffic page.",
    });

    // Confirm both → same-transaction Action upsert (spec §5.1 gate 6).
    const confirmA = await reviewProjectFinding(scope, scope.projectId, findingAId, actor, {
      reviewState: "confirmed",
      baseRevision: 0,
    });
    await reviewProjectFinding(scope, scope.projectId, findingBId, actor, {
      reviewState: "confirmed",
      baseRevision: 0,
    });
    actionAId = confirmA.action!.id;
    // high severity + high confidence → deterministic band "high" (spec §9.3).
    expect(confirmA.action!.priorityBand).toBe("high");

    await seedReadyArtifact(handle, scope, actionAId, actor);
  });

  afterAll(async () => {
    await handle?.end();
  });

  // ---------------------------------------------------------------- AC-036 ---

  it("report.findings ARE the confirmed+active list findings — same ids, same order, same limitation strings", async () => {
    const report = await getProjectReport(scope, scope.projectId, null, generatedAt);
    const list = await listProjectFindings(scope, scope.projectId, {
      limit: 100,
      cursor: null,
      activeOnly: true,
    });
    const confirmed = list.data.filter((f) => f.reviewState === "confirmed");

    // Same underlying projection: identical id sequence (report never re-orders).
    expect(report.findings.map((f) => f.id)).toEqual(confirmed.map((f) => f.id));
    expect(report.findings.length).toBe(2);

    // Field-for-field the report finding equals the list finding (read-only view).
    const byId = new Map(confirmed.map((f) => [f.id, f]));
    for (const rf of report.findings) {
      const lf = byId.get(rf.id)!;
      expect(rf.summary).toBe(lf.summary);
      expect(rf.severity).toBe(lf.severity);
      expect(rf.confidence).toBe(lf.confidence);
      expect(rf.reviewState).toBe("confirmed");
      // Same limitation strings on evidence — not recomputed / re-templated.
      expect(rf.evidence.map((e) => e.limitation)).toEqual(lf.evidence.map((e) => e.limitation));
      expect(rf.evidence.length).toBeGreaterThan(0);
    }
  });

  it("report.limitations echo the canonical coverage limitations from the list meta (spec §10.4)", async () => {
    const report = await getProjectReport(scope, scope.projectId, null, generatedAt);
    const list = await listProjectFindings(scope, scope.projectId, {
      limit: 100,
      cursor: null,
      activeOnly: true,
    });
    expect(report.limitations).toEqual([...COVERAGE_LIMITATIONS]);
    expect(report.limitations).toEqual(list.meta.coverage?.limitations);
    expect(report.coverage.limitations).toEqual(list.meta.coverage?.limitations);
  });

  it("report.actions ARE the non-dismissed list actions — same ids, same order, same priority bands", async () => {
    const report = await getProjectReport(scope, scope.projectId, null, generatedAt);
    const list = await listProjectActions(scope, scope.projectId, { limit: 100, cursor: null });
    const nonDismissed = list.data.filter((a) => a.status !== "dismissed");

    expect(report.actions.map((a) => a.id)).toEqual(nonDismissed.map((a) => a.id));
    expect(report.actions.length).toBe(2);

    const byId = new Map(nonDismissed.map((a) => [a.id, a]));
    for (const ra of report.actions) {
      const la = byId.get(ra.id)!;
      expect(ra.priorityBand).toBe(la.priorityBand);
      expect(ra.roadmapLane).toBe(la.roadmapLane);
      expect(ra.status).toBe(la.status);
      expect(ra.templateId).toBe(la.templateId);
    }
    // The two findings' deterministic bands differ (high vs low): ordering is real.
    expect(new Set(report.actions.map((a) => a.priorityBand))).toEqual(new Set(["high", "low"]));
  });

  it("report does NOT recompute priority — a human override is reflected verbatim (spec §5.1 gate 8)", async () => {
    // Action A is derived high/now (high severity + high confidence). Override the
    // band to a value the deterministic rule could NEVER produce for high/high.
    const before = await listProjectActions(scope, scope.projectId, { limit: 100, cursor: null });
    const actionA = before.data.find((a) => a.id === actionAId)!;
    expect(actionA.priorityBand).toBe("high");

    await updateProjectAction(scope, scope.projectId, actionAId, actor, {
      baseRevision: actionA.revision,
      priorityBand: "low",
      reason: "Operator deprioritized this fix for the current window.",
    });

    const report = await getProjectReport(scope, scope.projectId, null, generatedAt);
    const list = await listProjectActions(scope, scope.projectId, { limit: 100, cursor: null });
    const reportA = report.actions.find((a) => a.id === actionAId)!;
    const listA = list.data.find((a) => a.id === actionAId)!;

    // Canonical override wins in BOTH — the report did not re-derive "high".
    expect(reportA.priorityBand).toBe("low");
    expect(listA.priorityBand).toBe("low");
    expect(reportA.priorityBand).toBe(listA.priorityBand);
  });

  // ---------------------------------------------------------------- AC-035 ---

  it("report body locale follows the outputLocale argument (default = project delivery locale)", async () => {
    const zh = await getProjectReport(scope, scope.projectId, "zh-CN", generatedAt);
    const en = await getProjectReport(scope, scope.projectId, "en", generatedAt);
    const def = await getProjectReport(scope, scope.projectId, null, generatedAt);

    expect(zh.outputLocale).toBe("zh-CN");
    expect(en.outputLocale).toBe("en");
    // Null override falls back to the project's defaultDeliveryLocale (spec §4.3).
    expect(def.outputLocale).toBe(defaultDeliveryLocale);
    expect(def.outputLocale).toBe("en");
  });

  it("outputLocale is independent of uiLocale — switching the report locale never re-localizes already-generated delivery content (AC-035)", async () => {
    // The server projection takes ONLY outputLocale — there is no uiLocale input,
    // so a product UI-locale toggle can never reach a delivery-facing string.
    // Requesting the report under two different delivery locales must leave the
    // stored artifact + action content byte-identical.
    const zh = await getProjectReport(scope, scope.projectId, "zh-CN", generatedAt);
    const en = await getProjectReport(scope, scope.projectId, "en", generatedAt);

    const zhArtifact = zh.artifacts.find((a) => a.id !== undefined && a.status === "ready")!;
    const enArtifact = en.artifacts.find((a) => a.id === zhArtifact.id)!;

    // The artifact's own outputLocale is FIXED at generation (zh-CN) regardless of
    // the report's requested locale — it is not re-rendered to "en".
    expect(zhArtifact.outputLocale).toBe(ARTIFACT_OUTPUT_LOCALE);
    expect(enArtifact.outputLocale).toBe(ARTIFACT_OUTPUT_LOCALE);

    // The generated delivery content is identical across both requests (no re-translation).
    expect(zhArtifact.current?.content).toBe(ARTIFACT_ZH_CONTENT);
    expect(enArtifact.current?.content).toBe(ARTIFACT_ZH_CONTENT);
    expect(enArtifact.current?.content).toBe(zhArtifact.current?.content);

    // Action delivery copy (contentLocale) was fixed at confirm time ("en") and is
    // NOT re-localized when the report is requested with a different outputLocale.
    const zhAction = zh.actions.find((a) => a.id === actionAId)!;
    const enAction = en.actions.find((a) => a.id === actionAId)!;
    expect(zhAction.contentLocale).toBe("en");
    expect(enAction.contentLocale).toBe("en");
    expect(zhAction.title).toBe(enAction.title);
    expect(zhAction.description).toBe(enAction.description);
  });
});
