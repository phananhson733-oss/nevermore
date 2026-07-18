import { createHash, randomBytes, randomUUID } from "node:crypto";

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

import { eq } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { collectionRuns, workspaces } from "@sf/db/schema";
import { ImportPreviewsRepository, type ImportPreviewRow, type ProjectScope } from "@sf/db";
import type { ImportConfirmRequest } from "@sf/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { confirmImport } from "@/lib/services/csv-import";

/**
 * AC-016 (spec §7.5, §11.1): the CSV import token is single-use. `confirm`
 * validates the token's project/TTL/UNCONSUMED state, and a replay of an
 * already-consumed token is rejected as 409 `IMPORT_TOKEN_REPLAYED` (the frozen
 * code) — it must NOT create a (duplicate) collection run. An unissued token is
 * `IMPORT_TOKEN_INVALID` and an expired one `IMPORT_TOKEN_EXPIRED` (both 422).
 *
 * Tested at the service level against a seeded `import_previews` row (no blob
 * upload). The replay/invalid/expired guards are checked BEFORE the atomic
 * enqueue transaction, so these assertions are deterministic.
 *
 * NOTE (blocking defect surfaced here): the SUCCESSFUL first-confirm path cannot
 * currently run — `confirmImport` (csv-import.ts:402) inserts the `provider='csv'`
 * collection_runs placeholder WITHOUT `import_preview_id`, which the
 * `collection_runs_check` constraint `((provider='csv') = (import_preview_id IS
 * NOT NULL))` rejects; `CollectionRunsRepository.insertPlaceholder`
 * (collection-runs.ts:40) has no `importPreviewId` parameter. This is out of
 * scope for this test-only task; see the report. The replay guard below is the
 * step that precedes that transaction, so it is verified faithfully regardless.
 */

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const HEADERS = ["keyword", "search_volume", "market", "language"] as const;

const confirmBody = (importToken: string): ImportConfirmRequest => ({
  mode: "confirm",
  importToken,
  mapping: {
    keyword: "keyword",
    searchVolume: "search_volume",
    marketCode: "market",
    languageCode: "language",
  },
});

const tokenHashOf = (token: string) => createHash("sha256").update(token).digest();

/** Seed an `import_previews` row; returns the raw token + the inserted row. */
async function seedPreview(
  handle: DbHandle,
  scope: ProjectScope,
  siteId: string,
  actor: string,
  expiresAt: string,
): Promise<{ token: string; row: ImportPreviewRow }> {
  const token = randomBytes(32).toString("base64url");
  const row = await new ImportPreviewsRepository(handle.db).insert({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    siteId,
    createdBy: actor,
    tokenHash: tokenHashOf(token),
    templateId: "keyword_gap_v1",
    rawObjectKey: `raw-imports/${scope.projectId}/${randomUUID()}.csv`,
    fileChecksum: createHash("sha256").update("seed").digest("hex"),
    rowCount: 3,
    detectedColumns: [...HEADERS],
    suggestedMapping: {
      keyword: "keyword",
      searchVolume: "search_volume",
      marketCode: "market",
      languageCode: "language",
    },
    previewRows: [{ keyword: "shoes", search_volume: "100", market: "US", language: "en" }],
    validationErrors: [],
    validationWarnings: [],
    expiresAt,
  });
  return { token, row };
}

async function countCollectionRuns(handle: DbHandle, projectId: string): Promise<number> {
  const rows = await handle.db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(eq(collectionRuns.project_id, projectId));
  return rows.length;
}

describeDb("confirmImport — single-use import token (AC-016)", () => {
  let handle: DbHandle;
  let scope: ProjectScope;
  let siteId: string;
  const actor = randomUUID();

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
        clientName: "Csv",
        projectName: "Csv",
        siteUrl: "https://csv.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    scope = { workspaceId, projectId: created.project.id };
    siteId = created.project.site.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("replaying a consumed token returns 409 IMPORT_TOKEN_REPLAYED and writes no collection run", async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const { token, row } = await seedPreview(handle, scope, siteId, actor, future);

    // Represent the post-first-confirm state: the token has been consumed.
    await new ImportPreviewsRepository(handle.db).consume(row.id);

    await expect(
      confirmImport({ workspaceId: scope.workspaceId }, scope.projectId, actor, randomUUID(), confirmBody(token)),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_REPLAYED", status: 409 });

    // The replay must not create a (duplicate) collection run.
    expect(await countCollectionRuns(handle, scope.projectId)).toBe(0);

    // The preview stays consumed (single-use, append-only status).
    const after = await new ImportPreviewsRepository(handle.db).findByTokenHash(scope, tokenHashOf(token));
    expect(after?.status).toBe("consumed");
  });

  it("rejects a token that was never issued as IMPORT_TOKEN_INVALID (422)", async () => {
    await expect(
      confirmImport(
        { workspaceId: scope.workspaceId },
        scope.projectId,
        actor,
        randomUUID(),
        confirmBody(randomBytes(32).toString("base64url")),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_INVALID", status: 422 });
  });

  it("rejects an expired token as IMPORT_TOKEN_EXPIRED (422)", async () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    const { token } = await seedPreview(handle, scope, siteId, actor, past);
    await expect(
      confirmImport({ workspaceId: scope.workspaceId }, scope.projectId, actor, randomUUID(), confirmBody(token)),
    ).rejects.toMatchObject({ code: "IMPORT_TOKEN_EXPIRED", status: 422 });
    expect(await countCollectionRuns(handle, scope.projectId)).toBe(0);
  });
});
