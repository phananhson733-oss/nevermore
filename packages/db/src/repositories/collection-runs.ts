import { eq } from "drizzle-orm";
import { contentHash } from "../hash.ts";
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
  readonly crawl_seed_site_page_id: string | null;
  readonly crawl_seed_url: string | null;
  readonly provider: string;
  readonly operation: string;
  readonly method_version: string;
  readonly parameters_hash: string;
  readonly row_count: number | null;
  readonly stop_reason: string | null;
  readonly created_at: string;
}

export interface CollectionRunParameterIdentity {
  readonly provider: string;
  readonly operation: string;
  readonly siteId: string;
  readonly crawlSeedSitePageId: string | null;
  readonly crawlSeedUrl: string | null;
  /** Optional command-time context used only for GSC Keyword Library projection. */
  readonly keywordLibraryContext?: CollectionRunKeywordLibraryContext | null;
}

export interface CollectionRunKeywordLibraryContext {
  readonly basis: "project_context";
  readonly marketCode: string;
  readonly languageTag: string;
}

/**
 * Address the exact collection input selected by the command transaction. A
 * Crawl Product Profile seed is first-class input identity; a trailing slash
 * therefore changes the hash instead of being normalized away later.
 */
export function collectionRunParametersHash(
  identity: CollectionRunParameterIdentity,
): string {
  return contentHash({
    provider: identity.provider,
    operation: identity.operation,
    siteId: identity.siteId,
    ...(identity.provider === "crawl"
      ? {
          crawlSeedSitePageId: identity.crawlSeedSitePageId,
          crawlSeedUrl: identity.crawlSeedUrl,
        }
      : {}),
    ...(identity.provider === "gsc" && identity.keywordLibraryContext
      ? {
          keywordLibraryContext: {
            basis: identity.keywordLibraryContext.basis,
            marketCode: identity.keywordLibraryContext.marketCode,
            languageTag: identity.keywordLibraryContext.languageTag,
          },
        }
      : {}),
  });
}

export class CollectionRunsRepository extends Repository {
  /** Load a collection run by id (worker; id = the async run id). */
  async findById(id: string): Promise<CollectionRunRow | null> {
    const rows = await this.exec
      .select()
      .from(collectionRuns)
      .where(eq(collectionRuns.id, id))
      .limit(1);
    return (rows[0] as CollectionRunRow | undefined) ?? null;
  }

  /**
   * Insert the collection placeholder (id = the async run id). A `csv` provider
   * MUST carry its `importPreviewId` — the `collection_runs_check` constraint
   * enforces `(provider = 'csv') = (import_preview_id IS NOT NULL)`, so a CSV
   * placeholder without it fails at insert (spec §12.1).
   */
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
    importPreviewId?: string | null;
    crawlSeedSitePageId?: string | null;
    crawlSeedUrl?: string | null;
  }): Promise<CollectionRunRow> {
    const crawlSeedSitePageId = values.crawlSeedSitePageId ?? null;
    const crawlSeedUrl = values.crawlSeedUrl ?? null;
    if ((crawlSeedSitePageId === null) !== (crawlSeedUrl === null)) {
      throw new TypeError("Crawl seed SitePage id and URL must be supplied together");
    }
    if (values.provider !== "crawl" && crawlSeedSitePageId !== null) {
      throw new TypeError("Only Crawl collection runs may carry a frozen seed");
    }
    const [row] = await this.exec
      .insert(collectionRuns)
      .values({
        id: values.runId,
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        source_connection_id: values.sourceConnectionId,
        import_preview_id: values.importPreviewId ?? null,
        crawl_seed_site_page_id: crawlSeedSitePageId,
        crawl_seed_url: crawlSeedUrl,
        provider: values.provider,
        operation: values.operation,
        method_version: values.methodVersion,
        parameters_hash: values.parametersHash,
      })
      .returning();
    return row as CollectionRunRow;
  }

  /**
   * Fill in the collection outcome on completion (worker tx). `source_window`,
   * `provider_usage`, `row_count` and `stop_reason` come from the adapter's
   * `CollectionResult`; the run row itself is otherwise immutable.
   */
  async finalize(
    id: string,
    values: {
      rowCount: number;
      sourceWindow: Record<string, unknown>;
      providerUsage: Record<string, number>;
      stopReason: string | null;
    },
  ): Promise<void> {
    await this.exec
      .update(collectionRuns)
      .set({
        row_count: values.rowCount,
        source_window: values.sourceWindow,
        provider_usage: values.providerUsage,
        stop_reason: values.stopReason,
      })
      .where(eq(collectionRuns.id, id));
  }
}
