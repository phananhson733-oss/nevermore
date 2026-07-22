import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import type { NextRequest } from "next/server";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { asyncRuns, icpProfiles, workspaces } from "@sf/db/schema";
import {
  contentHash,
  DiagnosticRunsRepository,
  FindingReviewEventsRepository,
  FindingsRepository,
} from "@sf/db";
import { ReviewFindingRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { parseJsonBody } from "@/lib/http/validate";

/**
 * AC-027 — an invalid finding review returns 422, and the finding-review-events
 * ledger is append-only (spec §5.2, §9.1).
 *
 * The 422 boundary is the request schema (`ReviewFindingRequest`, a discriminated
 * union in packages/contracts) parsed by `parseJsonBody`, which turns any Zod
 * failure into a 422 VALIDATION_ERROR problem. The ledger is `finding_review_events`,
 * guarded by an append-only trigger (migration 0001_init.sql:727) so no prior
 * event can be updated or deleted.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

/** A real Request carrying a JSON body (parseJsonBody reads headers + text). */
const jsonRequest = (body: unknown): NextRequest =>
  new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

// --- Part 1: invalid review payloads are rejected at the schema boundary (422). ---
describe("invalid finding review -> 422 VALIDATION_ERROR (AC-027, spec §9.1)", () => {
  const reject422 = async (body: unknown): Promise<void> => {
    const promise = parseJsonBody(jsonRequest(body), ReviewFindingRequest);
    await expect(promise).rejects.toBeInstanceOf(ProblemError);
    await expect(promise).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
  };

  it("bad transition: reviewState back to `unreviewed` is not a valid target", async () => {
    // §5.2 has no arrow back to `unreviewed`; the union has no such member.
    await reject422({ reviewState: "unreviewed", baseRevision: 1 });
  });

  it("bad enum: an unknown reviewState is rejected", async () => {
    await reject422({ reviewState: "bogus", baseRevision: 1 });
  });

  it("whitespace-only reason for `ignored` is rejected (trim().min(3))", async () => {
    await reject422({ reviewState: "ignored", baseRevision: 1, reason: "   " });
  });

  it("missing reason for `ignored` is rejected (reason required)", async () => {
    await reject422({ reviewState: "ignored", baseRevision: 1 });
  });

  it("whitespace-only note for `needs_more_data` is rejected", async () => {
    await reject422({
      reviewState: "needs_more_data",
      baseRevision: 1,
      note: "  ",
    });
  });

  it("a negative baseRevision is rejected", async () => {
    await reject422({ reviewState: "confirmed", baseRevision: -1 });
  });
});

// --- Part 2: the review-events ledger is append-only (no update / no delete). ---
describeDb("finding_review_events is append-only (AC-027, spec §5.2)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  let projectId: string;
  let findingId: string;
  let eventId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    workspaceId = ws!.id;
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Ledger",
        projectName: "Ledger",
        siteUrl: "https://ledger.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    projectId = created.project.id;
    const siteId = created.project.site.id;

    const [icp] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: projectId,
        version: 1,
        status: "complete",
        profile: { productName: "Ledger", siteLanguageCodes: ["en"] },
        content_hash: contentHash({ v: randomUUID() }),
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
      siteId,
      icpProfileId: icp!.id,
      icpProfileVersion: 1,
      ruleSetVersion: "mvp.rules.0.2.0",
      promptSetVersion: "mvp.prompts.0.2.0",
      outputLocale: "en",
      inputManifest: { snapshots: [] },
      inputHash: contentHash({ snapshots: [] }),
    });

    const finding = await new FindingsRepository(handle.db).insert({
      workspaceId,
      projectId,
      findingKey: contentHash({ projectId, k: "http_status:404" }),
      ruleId: "TECH-HTTP-001",
      ruleVersion: 1,
      ruleFamily: "http-status",
      intent: "restore_or_redirect",
      domain: "technical_seo",
      titleKey: "finding.http_status",
      titleArgs: { status: "404" },
      summary: "3 pages return HTTP 404.",
      summaryLocale: "en",
      subjectRefs: ["http_status:404"],
      severity: "high",
      confidence: "high",
      reviewState: "unreviewed",
      runId: run!.id,
      seenAt: nowTs,
    });
    findingId = finding.id;

    // Append one review event (the ledger row we will try to tamper with).
    await new FindingReviewEventsRepository(handle.db).append({
      workspaceId,
      projectId,
      findingId,
      fromState: "unreviewed",
      toState: "confirmed",
      revision: 1,
      reason: null,
      note: null,
      actorId: actor,
    });
    const found = await handle.pool.query<{ id: string }>(
      `SELECT id FROM app.finding_review_events WHERE finding_id = $1 LIMIT 1`,
      [findingId],
    );
    eventId = found.rows[0]!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("a prior review event cannot be UPDATEd", async () => {
    await expect(
      handle.pool.query(
        `UPDATE app.finding_review_events SET note = 'tampered' WHERE id = $1`,
        [eventId],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("a prior review event cannot be DELETEd", async () => {
    await expect(
      handle.pool.query(`DELETE FROM app.finding_review_events WHERE id = $1`, [
        eventId,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it("the ledger row survives the rejected mutations unchanged", async () => {
    const res = await handle.pool.query<{ c: string; note: string | null }>(
      `SELECT count(*)::int AS c, max(note) AS note
       FROM app.finding_review_events WHERE id = $1`,
      [eventId],
    );
    expect(Number(res.rows[0]!.c)).toBe(1);
    expect(res.rows[0]!.note).toBeNull();
  });
});
