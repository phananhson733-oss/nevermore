import { and, eq } from "drizzle-orm";
import { exportBundles } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `export_bundles` (spec §10.5). Created as a placeholder in the atomic enqueue tx
 * (id shares nothing with async_runs; it references async_run_id). The worker
 * uploads the ZIP to Storage, computes its checksum, and finalizes the row +
 * manifest. Download URLs are signed for 15 minutes; objects live 30 days and can
 * be regenerated.
 */

export interface ExportBundleRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly async_run_id: string;
  readonly kind: string;
  readonly schema_version: string;
  readonly output_locale: string;
  readonly object_key: string | null;
  readonly checksum: string | null;
  readonly byte_size: number | null;
  readonly item_counts: Record<string, unknown>;
  readonly manifest: Record<string, unknown> | null;
  readonly created_by: string;
  readonly created_at: string;
}

export class ExportBundlesRepository extends Repository {
  async insert(values: {
    workspaceId: string;
    projectId: string;
    asyncRunId: string;
    kind: string;
    outputLocale: string;
    createdBy: string;
  }): Promise<ExportBundleRow> {
    const [row] = await this.exec
      .insert(exportBundles)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        async_run_id: values.asyncRunId,
        kind: values.kind,
        output_locale: values.outputLocale,
        created_by: values.createdBy,
      })
      .returning();
    return row as ExportBundleRow;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<ExportBundleRow | null> {
    const rows = await this.exec
      .select()
      .from(exportBundles)
      .where(
        and(projectPredicate(exportBundles, scope), eq(exportBundles.id, id)),
      )
      .limit(1);
    return (rows[0] as ExportBundleRow | undefined) ?? null;
  }

  /** The bundle for an async run (unified status → export detail). */
  async findByRun(
    scope: ProjectScope,
    asyncRunId: string,
  ): Promise<ExportBundleRow | null> {
    const rows = await this.exec
      .select()
      .from(exportBundles)
      .where(
        and(
          projectPredicate(exportBundles, scope),
          eq(exportBundles.async_run_id, asyncRunId),
        ),
      )
      .limit(1);
    return (rows[0] as ExportBundleRow | undefined) ?? null;
  }

  /** Worker completion: object key + checksum + size + counts + manifest. */
  async finalize(
    id: string,
    values: {
      objectKey: string;
      checksum: string;
      byteSize: number;
      itemCounts: Record<string, unknown>;
      manifest: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.exec
      .update(exportBundles)
      .set({
        object_key: values.objectKey,
        checksum: values.checksum,
        byte_size: values.byteSize,
        item_counts: values.itemCounts,
        manifest: values.manifest,
      })
      .where(eq(exportBundles.id, id));
  }
}
