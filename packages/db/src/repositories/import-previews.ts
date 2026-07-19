import { and, eq, gt, sql } from "drizzle-orm";
import { importPreviews } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `import_previews` backs the CSV two-phase import (spec §7.5). A `preview` parses
 * the file safely (no canonical observation written), stores the raw object in a
 * private bucket, and returns a 30-minute `importToken` — the DB keeps only the
 * token HASH. `confirm` validates the token (project/TTL/unconsumed), enqueues an
 * async CSV collection, then marks it consumed. Replay ⇒ 409 IMPORT_TOKEN_REPLAYED.
 */

export type ImportPreviewStatus = "previewed" | "consumed" | "expired";

export interface ImportPreviewRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly created_by: string;
  readonly token_hash: Buffer;
  readonly template_id: string;
  readonly raw_object_key: string;
  readonly file_checksum: string;
  readonly row_count: number;
  readonly detected_columns: unknown[];
  readonly suggested_mapping: Record<string, unknown>;
  readonly preview_rows: unknown[];
  readonly validation_errors: unknown[];
  readonly validation_warnings: unknown[];
  readonly status: ImportPreviewStatus;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class ImportPreviewsRepository extends Repository {
  /** Store a preview + its raw object key (spec §7.5 preview mode). */
  async insert(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    createdBy: string;
    tokenHash: Buffer;
    templateId: string;
    rawObjectKey: string;
    fileChecksum: string;
    rowCount: number;
    detectedColumns: unknown[];
    suggestedMapping: Record<string, unknown>;
    previewRows: unknown[];
    validationErrors: unknown[];
    validationWarnings: unknown[];
    expiresAt: string;
  }): Promise<ImportPreviewRow> {
    const [row] = await this.exec
      .insert(importPreviews)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        created_by: values.createdBy,
        token_hash: values.tokenHash,
        template_id: values.templateId,
        raw_object_key: values.rawObjectKey,
        file_checksum: values.fileChecksum,
        row_count: values.rowCount,
        detected_columns: values.detectedColumns,
        suggested_mapping: values.suggestedMapping,
        preview_rows: values.previewRows,
        validation_errors: values.validationErrors,
        validation_warnings: values.validationWarnings,
        expires_at: values.expiresAt,
      })
      .returning();
    return row as ImportPreviewRow;
  }

  /** A preview by id, project-scoped. */
  async findById(scope: ProjectScope, id: string): Promise<ImportPreviewRow | null> {
    const rows = await this.exec
      .select()
      .from(importPreviews)
      .where(and(projectPredicate(importPreviews, scope), eq(importPreviews.id, id)))
      .limit(1);
    return (rows[0] as ImportPreviewRow | undefined) ?? null;
  }

  /** The preview matching a confirm token hash, project-scoped. */
  async findByTokenHash(
    scope: ProjectScope,
    tokenHash: Buffer,
  ): Promise<ImportPreviewRow | null> {
    const rows = await this.exec
      .select()
      .from(importPreviews)
      .where(
        and(projectPredicate(importPreviews, scope), eq(importPreviews.token_hash, tokenHash)),
      )
      .limit(1);
    return (rows[0] as ImportPreviewRow | undefined) ?? null;
  }

  /**
   * Atomically consume one live preview inside the confirm transaction.
   * Project scope, state, and DB-clock TTL are all part of the UPDATE predicate,
   * so a stale application read can never consume a foreign, expired, or
   * already-consumed token.
   */
  async consume(scope: ProjectScope, id: string): Promise<boolean> {
    const rows = await this.exec
      .update(importPreviews)
      .set({ status: "consumed", consumed_at: sql`now()`, updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(importPreviews, scope),
          eq(importPreviews.id, id),
          eq(importPreviews.status, "previewed"),
          gt(importPreviews.expires_at, sql`now()`),
        ),
      )
      .returning({ id: importPreviews.id });
    return rows.length === 1;
  }
}
