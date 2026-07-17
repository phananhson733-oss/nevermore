import { collectionRuns } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * `collection_runs` shares its primary key with `async_runs` (spec §12.1). The
 * placeholder row is inserted in the same atomic enqueue transaction as the run
 * (spec §13.2); the worker fills in row_count / source_window / provider_usage /
 * stop_reason on completion.
 */

export interface CollectionRunRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly source_connection_id: string | null;
  readonly import_preview_id: string | null;
  readonly provider: string;
  readonly operation: string;
  readonly method_version: string;
  readonly parameters_hash: string;
  readonly row_count: number | null;
  readonly stop_reason: string | null;
  readonly created_at: string;
}

export class CollectionRunsRepository extends Repository {
  /** Insert the collection placeholder (id = the async run id). */
  async insertPlaceholder(values: {
    runId: string;
    workspaceId: string;
    projectId: string;
    siteId: string;
    sourceConnectionId: string | null;
    provider: string;
    operation: string;
    methodVersion: string;
    parametersHash: string;
  }): Promise<CollectionRunRow> {
    const [row] = await this.exec
      .insert(collectionRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        source_connection_id: values.sourceConnectionId,
        provider: values.provider,
        operation: values.operation,
        method_version: values.methodVersion,
        parameters_hash: values.parametersHash,
      })
      .returning();
    return row as CollectionRunRow;
  }
}
