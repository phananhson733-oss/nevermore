import { createHash, randomBytes } from "node:crypto";
import {
  AsyncRunsRepository,
  CollectionRunsRepository,
  contentHash,
  enqueueRunInTx,
  IdempotencyRepository,
  ImportPreviewsRepository,
  ProjectsRepository,
  SitesRepository,
  SourceConnectionsRepository,
  type WorkspaceScope,
} from "@sf/db";
import { previewCsv, objectKey, KEYWORD_GAP_TEMPLATE_ID } from "@sf/sources";
import type { CsvPreviewResult } from "@sf/sources";
import type { ImportConfirmRequest } from "@sf/contracts";
import { ProblemError } from "@sf/observability";
import { getDb } from "@/lib/db";
import { getBoss } from "@/lib/boss";
import { getBlobStore } from "@/lib/storage";
import { toAsyncRunDto, runStatusUrl, type AsyncRunDto } from "./runs";

/**
 * CSV keyword-gap import (spec §7.5). Two phases through one endpoint:
 *  - preview: parse safely (no canonical write), store the raw file privately,
 *    return the first 20 rows + a 30-minute importToken (the DB keeps its hash).
 *  - confirm: validate the token (project/TTL/unconsumed), atomically enqueue a
 *    CSV collection run, mark the token consumed. Replay ⇒ 409 IMPORT_TOKEN_REPLAYED.
 */

const CONTRACT_VERSION = "2026-07-18";
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const IDEMPOTENCY_SCOPE = "importProjectSourceFile";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CSV_METHOD_VERSION = "csv.keyword_gap.v1";
const CSV_ACTIVE_KEY = "collect:csv:keyword_gap_import";
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export interface ImportPreviewResult {
  readonly importToken: string;
  readonly expiresAt: string;
  readonly rowCount: number;
  readonly previewRows: unknown[];
  readonly detectedColumns: string[];
  readonly suggestedMapping: Record<string, string | null>;
  readonly errors: string[];
  readonly warnings: string[];
}

export interface ImportConfirmResult {
  readonly status: 202;
  readonly run: AsyncRunDto;
  readonly statusUrl: string;
  readonly resourceRef: { type: "collection_run"; id: string };
  readonly location: string;
  readonly replayed: boolean;
}

function sha256Buf(input: Buffer | string): Buffer {
  return createHash("sha256").update(input).digest();
}

const CSV_FIELDS = [
  "keyword",
  "searchVolume",
  "cluster",
  "currentUrl",
  "currentRank",
  "competitorDomain",
  "competitorRank",
  "marketCode",
  "languageCode",
] as const;

/**
 * Map the adapter's index-based `CsvPreviewResult` to the OpenAPI
 * `ImportPreviewResponse` shape: header strings, a NAME-based suggested mapping
 * (so the client echoes column names back on confirm), row objects, and string
 * issue lists.
 */
function mapPreview(preview: CsvPreviewResult): {
  detectedColumns: string[];
  suggestedMapping: Record<string, string | null>;
  previewRows: Record<string, string>[];
  errors: string[];
  warnings: string[];
} {
  const headers = preview.detectedColumns.map((c) => c.header);
  const nameByIndex = (i: number | null): string | null =>
    i === null ? null : (headers[i] ?? null);
  const suggestedMapping: Record<string, string | null> = {};
  for (const field of CSV_FIELDS) {
    suggestedMapping[field] = nameByIndex(preview.suggestedMapping[field]);
  }
  const previewRows = preview.previewRows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
  return {
    detectedColumns: headers,
    suggestedMapping,
    previewRows,
    errors: preview.validationErrors.map((e) => e.message),
    warnings: preview.validationWarnings.map((e) => e.message),
  };
}

/** Drop `undefined` optional fields so the mapping is a stable canonical value. */
function cleanMapping(
  mapping: ImportConfirmRequest["mapping"],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function requireLiveProject(scope: WorkspaceScope, projectId: string) {
  const { db } = getDb();
  const project = await new ProjectsRepository(db).findById(scope, projectId);
  if (!project) throw new ProblemError("NOT_FOUND", "Project not found.");
  if (project.archived_at) {
    throw new ProblemError(
      "PROJECT_ARCHIVED",
      "Project is archived and read-only.",
    );
  }
  const site = await new SitesRepository(db).findPrimary({
    workspaceId: scope.workspaceId,
    projectId,
  });
  if (!site)
    throw new ProblemError("NOT_FOUND", "Project has no primary site.");
  return { site };
}

/** CSV preview (spec §7.5). Parses safely, stores raw privately, returns a token. */
export async function previewImport(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  file: { bytes: Buffer; templateId: string },
): Promise<ImportPreviewResult> {
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ProblemError(
      "IMPORT_TOO_LARGE",
      "CSV exceeds the 20MB import limit.",
    );
  }
  if (file.templateId !== KEYWORD_GAP_TEMPLATE_ID) {
    throw new ProblemError("VALIDATION_ERROR", "Unsupported import template.", {
      errors: [
        {
          pointer: "/templateId",
          code: "unsupported",
          message: "Only keyword_gap_v1 is supported.",
        },
      ],
    });
  }
  const { site } = await requireLiveProject(scope, projectId);
  const text = file.bytes.toString("utf8");

  let preview;
  try {
    preview = previewCsv(text, file.templateId);
  } catch {
    throw new ProblemError(
      "VALIDATION_ERROR",
      "The CSV file could not be parsed.",
    );
  }

  // Store the raw object privately (spec §7.5); the DB keeps only the key + sha256.
  const nonce = randomBytes(16).toString("hex");
  const key = objectKey({ projectId, runId: nonce, kind: "raw-import", nonce });
  const put = await getBlobStore().put({
    key,
    body: file.bytes,
    contentType: "text/csv",
  });

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();

  const mapped = mapPreview(preview);
  const { db } = getDb();
  await new ImportPreviewsRepository(db).insert({
    workspaceId: scope.workspaceId,
    projectId,
    siteId: site.id,
    createdBy: actorId,
    tokenHash: sha256Buf(token),
    templateId: file.templateId,
    rawObjectKey: put.key,
    fileChecksum: put.sha256,
    rowCount: preview.rowCount,
    detectedColumns: mapped.detectedColumns,
    suggestedMapping: mapped.suggestedMapping,
    previewRows: mapped.previewRows,
    validationErrors: mapped.errors,
    validationWarnings: mapped.warnings,
    expiresAt,
  });

  return {
    importToken: token,
    expiresAt,
    rowCount: preview.rowCount,
    previewRows: mapped.previewRows,
    detectedColumns: mapped.detectedColumns,
    suggestedMapping: mapped.suggestedMapping,
    errors: mapped.errors,
    warnings: mapped.warnings,
  };
}

function replayConfirm(
  row: {
    request_hash: string;
    status: string;
    resource_id: string | null;
    response_body: unknown;
  },
  requestHash: string,
): ImportConfirmResult | null {
  if (row.request_hash !== requestHash) {
    throw new ProblemError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency-Key reused with a different body.",
    );
  }
  if (row.status === "completed" && row.resource_id) {
    const body = row.response_body as {
      run: AsyncRunDto;
      statusUrl: string;
      resourceRef: { type: "collection_run"; id: string };
    } | null;
    if (body?.run) {
      return {
        status: 202,
        run: body.run,
        statusUrl: body.statusUrl,
        resourceRef: body.resourceRef,
        location: body.statusUrl,
        replayed: true,
      };
    }
  }
  return null;
}

/** CSV confirm (spec §7.5): validate token, enqueue a CSV collection run atomically. */
export async function confirmImport(
  scope: WorkspaceScope,
  projectId: string,
  actorId: string,
  idempotencyKey: string,
  body: ImportConfirmRequest,
): Promise<ImportConfirmResult> {
  const projectScope = { workspaceId: scope.workspaceId, projectId };
  const { site } = await requireLiveProject(scope, projectId);
  const { db } = getDb();
  const boss = await getBoss();

  const previews = new ImportPreviewsRepository(db);
  const preview = await previews.findByTokenHash(
    projectScope,
    sha256Buf(body.importToken),
  );
  if (!preview)
    throw new ProblemError("IMPORT_TOKEN_INVALID", "Import token is invalid.");
  if (preview.status === "consumed") {
    throw new ProblemError(
      "IMPORT_TOKEN_REPLAYED",
      "Import token was already used.",
    );
  }
  if (Date.parse(preview.expires_at) <= Date.now()) {
    throw new ProblemError("IMPORT_TOKEN_EXPIRED", "Import token has expired.");
  }

  // Validate the operator's column mapping against the detected headers.
  const headers = new Set(preview.detected_columns.map((c) => String(c)));
  for (const field of [
    "keyword",
    "searchVolume",
    "marketCode",
    "languageCode",
  ] as const) {
    const column = body.mapping[field];
    if (!headers.has(column)) {
      throw new ProblemError(
        "VALIDATION_ERROR",
        `Mapping column for ${field} is not in the file.`,
        {
          errors: [
            {
              pointer: `/mapping/${field}`,
              code: "unknown_column",
              message: `Column "${column}" not found.`,
            },
          ],
        },
      );
    }
  }

  const mapping = cleanMapping(body.mapping);
  const requestHash = contentHash({ importPreviewId: preview.id, mapping });
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const idem = new IdempotencyRepository(db);
  const existingKey = await idem.find(
    scope.workspaceId,
    IDEMPOTENCY_SCOPE,
    idempotencyKey,
  );
  if (existingKey) {
    const replay = replayConfirm(existingKey, requestHash);
    if (replay) return replay;
  }
  const active = await new AsyncRunsRepository(db).findActive(
    projectScope,
    CSV_ACTIVE_KEY,
  );
  if (active) {
    throw new ProblemError(
      "RUN_ALREADY_ACTIVE",
      "A CSV import is already running.",
      {
        headers: { Location: runStatusUrl(projectId, active.id) },
      },
    );
  }

  // Find-or-create the csv source connection so the snapshot can attach to a slot.
  const connections = new SourceConnectionsRepository(db);
  const existingCsv = await connections.findConnectedByProvider(
    projectScope,
    "csv",
  );

  try {
    return await db.transaction(async (tx) => {
      const txIdem = new IdempotencyRepository(tx);
      const reserved = await txIdem.begin({
        workspaceId: scope.workspaceId,
        scope: IDEMPOTENCY_SCOPE,
        key: idempotencyKey,
        requestHash,
        expiresAt,
      });
      if (!reserved) {
        const now = await txIdem.find(
          scope.workspaceId,
          IDEMPOTENCY_SCOPE,
          idempotencyKey,
        );
        const replay = now ? replayConfirm(now, requestHash) : null;
        if (replay) return replay;
        throw new ProblemError(
          "IDEMPOTENCY_KEY_REUSED",
          "Idempotency key is being processed.",
        );
      }

      const csvConnection =
        existingCsv ??
        (await new SourceConnectionsRepository(tx).insertConnection({
          workspaceId: scope.workspaceId,
          projectId,
          siteId: site.id,
          provider: "csv",
          connectionType: "file_import",
          state: "connected",
          limitation: "Keyword-gap CSV provided by the operator.",
          connectedAt: true,
          createdBy: actorId,
        }));

      const run = await new AsyncRunsRepository(tx).insertQueued({
        workspaceId: scope.workspaceId,
        projectId,
        kind: "collection",
        activeKey: CSV_ACTIVE_KEY,
        initiatedBy: actorId,
        contractVersion: CONTRACT_VERSION,
        requestPayload: {
          provider: "csv",
          operation: "keyword_gap_import",
          importPreviewId: preview.id,
          mapping,
          marketFallback: site.market_codes[0] ?? null,
          languageFallback: site.language_codes[0] ?? null,
        },
      });
      await new CollectionRunsRepository(tx).insertPlaceholder({
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        siteId: site.id,
        sourceConnectionId: csvConnection.id,
        // Required by collection_runs_check for provider='csv' (spec §12.1).
        importPreviewId: preview.id,
        provider: "csv",
        operation: "keyword_gap_import",
        methodVersion: CSV_METHOD_VERSION,
        parametersHash: requestHash,
      });
      await new ImportPreviewsRepository(tx).consume(preview.id);
      await enqueueRunInTx(boss, tx, "collect.csv", {
        runId: run.id,
        workspaceId: scope.workspaceId,
        projectId,
        contractVersion: CONTRACT_VERSION,
      });

      const dto = toAsyncRunDto(run);
      const statusUrl = runStatusUrl(projectId, run.id);
      await txIdem.complete(reserved.id, {
        responseStatus: 202,
        responseBody: {
          run: dto,
          statusUrl,
          resourceRef: { type: "collection_run", id: run.id },
        },
        resourceType: "collection_run",
        resourceId: run.id,
      });

      return {
        status: 202,
        run: dto,
        statusUrl,
        resourceRef: { type: "collection_run" as const, id: run.id },
        location: statusUrl,
        replayed: false,
      };
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      const winner = await new AsyncRunsRepository(db).findActive(
        projectScope,
        CSV_ACTIVE_KEY,
      );
      throw new ProblemError(
        "RUN_ALREADY_ACTIVE",
        "A CSV import is already running.",
        {
          ...(winner
            ? { headers: { Location: runStatusUrl(projectId, winner.id) } }
            : {}),
        },
      );
    }
    throw error;
  }
}
