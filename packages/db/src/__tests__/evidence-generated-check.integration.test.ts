import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import {
  asyncRuns,
  clientProjects,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";
import { AnalysisInvocationsRepository } from "../repositories/analysis-invocations.ts";
import { DiagnosticRunsRepository } from "../repositories/diagnostic-runs.ts";
import { EvidenceRepository, type EvidenceInsert } from "../repositories/evidence.ts";
import { contentHash } from "../hash.ts";

/**
 * AC-024 — generated evidence must carry an `analysis_invocation_id`.
 *
 * The evidence table (packages/db/migrations/0001_init.sql:400) enforces:
 *   CHECK (origin <> 'generated'
 *          OR (analysis_invocation_id IS NOT NULL AND method = 'generated'))
 * so a model output (spec §7.7: origin `generated`, method `generated`, grade C)
 * can NEVER masquerade as observed evidence. This test asserts the CHECK fires on
 * a generated row with no invocation id, that legitimately observed evidence needs
 * no invocation id, and that a properly-attributed generated row is accepted.
 */

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Dig a Postgres error code out of a possibly-wrapped driver error. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

const hex64 = (): string => contentHash({ v: randomUUID() });

describeDb("evidence generated-origin CHECK (AC-024, spec §7.7)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  let diagnosticRunId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);

    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    workspaceId = ws!.id;

    const [project] = await handle.db
      .insert(clientProjects)
      .values({
        workspace_id: workspaceId,
        client_name: "AC024",
        project_name: "AC024",
        default_delivery_locale: "en",
        created_by: actor,
      })
      .returning();
    projectId = project!.id;

    const [site] = await handle.db
      .insert(sites)
      .values({
        workspace_id: workspaceId,
        project_id: projectId,
        origin: "https://ac024.example",
        host: "ac024.example",
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();

    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: projectId,
        version: 1,
        status: "complete",
        profile: { productName: "AC024", siteLanguageCodes: ["en"] },
        content_hash: hex64(),
        created_by: actor,
      })
      .returning();

    const nowTs = new Date().toISOString();
    const [run] = await handle.db
      .insert(asyncRuns)
      .values({
        workspace_id: workspaceId,
        project_id: projectId,
        kind: "diagnostic",
        status: "completed",
        initiated_by: actor,
        started_at: nowTs,
        completed_at: nowTs,
      })
      .returning();

    await new DiagnosticRunsRepository(handle.db).insert({
      runId: run!.id,
      workspaceId,
      projectId,
      siteId: site!.id,
      icpProfileId: icp!.id,
      icpProfileVersion: 1,
      ruleSetVersion: "mvp.rules.0.2.0",
      promptSetVersion: "mvp.prompts.0.2.0",
      outputLocale: "en",
      inputManifest: { snapshots: [] },
      inputHash: hex64(),
    });
    diagnosticRunId = run!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  const runScope = () => ({ workspaceId, projectId, diagnosticRunId });
  const now = () => new Date().toISOString();

  const generatedRow = (
    invocationId: string | null,
  ): EvidenceInsert => ({
    sourceProvider: "llm",
    origin: "generated",
    method: "generated",
    grade: "C",
    availability: "available",
    support: "context",
    subjectRefs: ["https://ac024.example/page"],
    claim: "Model-generated summary claim.",
    observedAt: now(),
    limitation: "LLM output; not an observed measurement.",
    analysisInvocationId: invocationId,
  });

  it("rejects a generated-origin row with NO analysis_invocation_id (CHECK 400)", async () => {
    let caught: unknown;
    try {
      await new EvidenceRepository(handle.db).insertMany(runScope(), [
        generatedRow(null),
      ]);
    } catch (err) {
      caught = err;
    }
    expect(caught, "the CHECK constraint should reject the insert").toBeDefined();
    // 23514 = check_violation — proves the CHECK fired, not some unrelated error.
    expect(pgCode(caught)).toBe("23514");
  });

  it("accepts legitimately OBSERVED evidence with no invocation id (spec §7.7)", async () => {
    const ids = await new EvidenceRepository(handle.db).insertMany(runScope(), [
      {
        sourceProvider: "crawl",
        origin: "direct_public",
        method: "observed",
        grade: "B",
        availability: "available",
        support: "supports",
        subjectRefs: ["https://ac024.example/gone"],
        claim: "Page returns HTTP 404.",
        observedAt: now(),
        limitation: "Current public response only.",
      },
    ]);
    expect(ids.length).toBe(1);
  });

  it("accepts a generated row WHEN attributed to an analysis invocation", async () => {
    const invocationId = await new AnalysisInvocationsRepository(
      handle.db,
    ).insert({
      workspaceId,
      projectId,
      asyncRunId: diagnosticRunId,
      task: "finding_summary",
      provider: "openai",
      model: "test-model",
      promptSetVersion: "mvp.prompts.0.2.0",
      inputHash: hex64(),
      outputHash: hex64(),
      status: "succeeded",
      inputTokens: 10,
      outputTokens: 5,
      costUsd: null,
      latencyMs: 42,
      errorCode: null,
    });

    const ids = await new EvidenceRepository(handle.db).insertMany(runScope(), [
      generatedRow(invocationId),
    ]);
    expect(ids.length).toBe(1);
  });
});
