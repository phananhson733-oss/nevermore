import {
  backlinkAuthoritySnapshots,
  backlinkFacts,
  backlinkPageMetrics,
} from "../schema.ts";
import { projectDataForSeoBacklinkSnapshot } from "../index.ts";
import type { ObservationInsert } from "./observations.ts";
import { describe, expect, it } from "vitest";

type StoredRow = Record<string, unknown>;
type KnownTable =
  | typeof backlinkAuthoritySnapshots
  | typeof backlinkFacts
  | typeof backlinkPageMetrics;

const ids = {
  workspace: "c1000000-0000-4000-8000-000000000001",
  project: "c1000000-0000-4000-8000-000000000002",
  site: "c1000000-0000-4000-8000-000000000003",
  dataSnapshot: "c1000000-0000-4000-8000-000000000004",
  authoritySnapshot: "c1000000-0000-4000-8000-000000000005",
  page: "c1000000-0000-4000-8000-000000000006",
} as const;

function tableKey(table: unknown): "authority" | "fact" | "page" {
  if (table === backlinkAuthoritySnapshots) return "authority";
  if (table === backlinkFacts) return "fact";
  if (table === backlinkPageMetrics) return "page";
  throw new Error("Unexpected projection table");
}

function conflictKey(
  key: "authority" | "fact" | "page",
  row: StoredRow,
): string {
  if (key === "authority") {
    return [
      row["project_id"],
      row["subject_kind"],
      row["site_id"],
      row["source_kind"],
      row["provider"],
      row["source_ref"],
    ].join("|");
  }
  if (key === "fact") {
    return `${String(row["snapshot_id"])}|${String(row["source_ref"])}`;
  }
  return `${String(row["snapshot_id"])}|${String(row["site_page_id"])}`;
}

class FakeInsertQuery {
  private valuesToInsert: StoredRow[] = [];
  private ignoreConflicts = false;
  private result: StoredRow[] | null = null;

  constructor(
    private readonly db: FakeProjectionTx,
    private readonly table: KnownTable,
  ) {}

  values(values: StoredRow | readonly StoredRow[]): this {
    this.valuesToInsert = Array.isArray(values)
      ? values.map((value) => ({ ...value }))
      : [{ ...(values as StoredRow) }];
    return this;
  }

  onConflictDoNothing(_options?: unknown): this {
    this.ignoreConflicts = true;
    return this;
  }

  returning(_selection?: unknown): Promise<StoredRow[]> {
    return Promise.resolve(this.commit());
  }

  then<TResult1 = StoredRow[], TResult2 = never>(
    onfulfilled?:
      | ((value: StoredRow[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.commit()).then(onfulfilled, onrejected);
  }

  private commit(): StoredRow[] {
    if (this.result !== null) return this.result;
    const key = tableKey(this.table);
    const stored = this.db.rows[key];
    const inserted: StoredRow[] = [];
    for (const pending of this.valuesToInsert) {
      const row =
        key === "authority" && pending["id"] === undefined
          ? { id: ids.authoritySnapshot, ...pending }
          : pending;
      const duplicate = stored.some(
        (candidate) =>
          conflictKey(key, candidate) === conflictKey(key, row),
      );
      if (duplicate) {
        if (!this.ignoreConflicts) throw new Error("duplicate projection row");
        continue;
      }
      stored.push(row);
      inserted.push(row);
    }
    this.result = inserted;
    return inserted;
  }
}

class FakeSelectQuery {
  private table: KnownTable | null = null;

  constructor(private readonly db: FakeProjectionTx) {}

  from(table: KnownTable): this {
    this.table = table;
    return this;
  }

  where(_predicate: unknown): this {
    return this;
  }

  limit(limit: number): Promise<StoredRow[]> {
    return Promise.resolve(this.read().slice(0, limit));
  }

  then<TResult1 = StoredRow[], TResult2 = never>(
    onfulfilled?:
      | ((value: StoredRow[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.read()).then(onfulfilled, onrejected);
  }

  private read(): StoredRow[] {
    if (this.table === null) throw new Error("Select table was not set");
    return this.db.rows[tableKey(this.table)].map((row) => ({ ...row }));
  }
}

class FakeProjectionTx {
  readonly rows: Record<"authority" | "fact" | "page", StoredRow[]> = {
    authority: [],
    fact: [],
    page: [],
  };

  insert(table: KnownTable): FakeInsertQuery {
    return new FakeInsertQuery(this, table);
  }

  select(_selection?: unknown): FakeSelectQuery {
    return new FakeSelectQuery(this);
  }
}

function observation(
  metricKey: string,
  subjectType: string,
  subjectRef: string,
  valueJson: Record<string, unknown>,
  sitePageId: string | null = null,
): ObservationInsert {
  return {
    sitePageId,
    metricKey,
    subjectType,
    subjectRef,
    observedAt: "2026-07-28T00:00:00.000Z",
    availability: "available",
    valueNumeric: null,
    valueText: null,
    valueJson,
    unit: null,
    origin: "vendor_observation",
    method: "observed",
    grade: "B",
    support: "supports",
    limitation:
      "DataForSEO live backlink index with a bounded detailed-row and page-row scope.",
  };
}

function projectionInput() {
  return {
    scope: {
      workspaceId: ids.workspace,
      projectId: ids.project,
    },
    siteId: ids.site,
    dataSnapshot: {
      id: ids.dataSnapshot,
      provider: "dataforseo",
      datasetKey: "dataforseo.backlinks.v1",
      methodVersion: "dataforseo.backlinks.v1",
      capturedAt: "2026-07-28T00:00:00.000Z",
      availability: "available",
      checksum: "d".repeat(64),
      rowCount: 4,
    },
    observations: [
      observation(
        "dataforseo.backlink_summary.v1",
        "site",
        "relayops.example",
        {
          targetDomain: "relayops.example",
          rank: 54,
          backlinks: 1240,
          referringDomains: 87,
        },
      ),
      observation(
        "dataforseo.backlink.v1",
        "url",
        "https://relayops.example/guide",
        {
          sourceRef: "dfs-backlink-4b30d92a",
          referringDomain: "publisher.example",
          sourceUrl: "https://publisher.example/relayops-review",
          targetUrl: "https://relayops.example/guide",
          sourceRank: 71,
          linkKind: "dofollow",
          anchorText: "RelayOps guide",
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-07-28T00:00:00.000Z",
          isNew: true,
          isLost: false,
          verification: {
            status: "verified",
            checkedAt: "2026-07-28T00:05:00.000Z",
            finalUrl: "https://publisher.example/relayops-review",
            httpStatus: 200,
            anchorText: "RelayOps guide",
            rel: [],
            limitation: null,
          },
        },
        ids.page,
      ),
      observation(
        "dataforseo.backlink_page.v1",
        "url",
        "https://relayops.example/guide",
        {
          sourceRef: "dfs-page-1fab38c2",
          targetUrl: "https://relayops.example/guide",
          title: "RelayOps backlink guide",
          backlinks: 12,
          referringDomains: 8,
        },
        ids.page,
      ),
      observation(
        "dataforseo.referring_domain.v1",
        "site",
        "publisher.example",
        {
          sourceRef: "dfs-domain-caa93977",
          referringDomain: "publisher.example",
          rank: 71,
          backlinks: 5,
        },
      ),
    ],
  };
}

type ProjectionResult = {
  readonly snapshotId: string;
  readonly replayed: boolean;
  readonly factCount: number;
  readonly pageMetricCount: number;
};

type ProjectionWriter = (
  tx: unknown,
  input: ReturnType<typeof projectionInput>,
) => Promise<ProjectionResult>;

describe("projectDataForSeoBacklinkSnapshot", () => {
  it("is exported from the existing DB boundary", () => {
    expect(projectDataForSeoBacklinkSnapshot).toBeTypeOf("function");
  });

  it("maps canonical summary, detail, and domain-page observations into three append-only projections", async () => {
    const writer = projectDataForSeoBacklinkSnapshot as ProjectionWriter;
    const tx = new FakeProjectionTx();

    await expect(writer(tx, projectionInput())).resolves.toEqual({
      snapshotId: ids.authoritySnapshot,
      replayed: false,
      factCount: 1,
      pageMetricCount: 1,
    });

    expect(tx.rows.authority).toEqual([
      expect.objectContaining({
        id: ids.authoritySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        competitor_id: null,
        subject_kind: "primary_site",
        source_kind: "provider_import",
        provider: "dataforseo",
        captured_at: "2026-07-28T00:00:00.000Z",
        availability: "available",
        index_scope: "provider_index",
        total_backlinks: 1240,
        total_referring_domains: 87,
        observed_backlinks: null,
        observed_referring_domains: null,
        authority_metric_kind: "dataforseo_rank",
        authority_metric_value: 54,
        source_ref: `dfs-${ids.dataSnapshot}`,
        checksum: "d".repeat(64),
        row_count: 4,
        import_preview_id: null,
        limitation: null,
      }),
    ]);
    expect(tx.rows.fact).toEqual([
      expect.objectContaining({
        snapshot_id: ids.authoritySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        referring_domain: "publisher.example",
        source_url: "https://publisher.example/relayops-review",
        target_url: "https://relayops.example/guide",
        target_site_page_id: ids.page,
        source_authority_metric_kind: "dataforseo_rank",
        source_authority_metric_value: 71,
        link_kind: "dofollow",
        source_ref: "dfs-backlink-4b30d92a",
        anchor_text: "RelayOps guide",
        first_seen_at: "2026-07-01T00:00:00.000Z",
        last_seen_at: "2026-07-28T00:00:00.000Z",
        is_new: true,
        is_lost: false,
        verification_status: "verified",
        verified_at: "2026-07-28T00:05:00.000Z",
        verification_final_url:
          "https://publisher.example/relayops-review",
        verification_http_status: 200,
        verification_limitation: null,
      }),
    ]);
    expect(tx.rows.page).toEqual([
      expect.objectContaining({
        snapshot_id: ids.authoritySnapshot,
        workspace_id: ids.workspace,
        project_id: ids.project,
        site_id: ids.site,
        site_page_id: ids.page,
        title: "RelayOps backlink guide",
        backlink_count: 12,
        referring_domain_count: 8,
        metric_semantics: "provider_index_total",
      }),
    ]);
  });

  it("replays the exact snapshot without appending duplicate authority, fact, or page rows", async () => {
    const writer = projectDataForSeoBacklinkSnapshot as ProjectionWriter;
    const tx = new FakeProjectionTx();

    await writer(tx, projectionInput());
    await expect(writer(tx, projectionInput())).resolves.toEqual({
      snapshotId: ids.authoritySnapshot,
      replayed: true,
      factCount: 1,
      pageMetricCount: 1,
    });
    expect(tx.rows.authority).toHaveLength(1);
    expect(tx.rows.fact).toHaveLength(1);
    expect(tx.rows.page).toHaveLength(1);
  });

  it("does not populate verified_at for an inconclusive crawler check", async () => {
    const writer = projectDataForSeoBacklinkSnapshot as ProjectionWriter;
    const tx = new FakeProjectionTx();
    const input = projectionInput();
    const detail = input.observations[1]!;
    const detailValue = detail.valueJson as Record<string, unknown>;

    await writer(tx, {
      ...input,
      observations: [
        input.observations[0]!,
        {
          ...detail,
          valueJson: {
            ...detailValue,
            verification: {
              status: "inconclusive",
              checkedAt: "2026-07-28T00:05:00.000Z",
              finalUrl: null,
              httpStatus: null,
              anchorText: null,
              rel: null,
              limitation: "Source page timed out.",
            },
          },
        },
        ...input.observations.slice(2),
      ],
    });

    expect(tx.rows.fact[0]).toMatchObject({
      verification_status: "inconclusive",
      verified_at: null,
      verification_final_url: null,
      verification_http_status: null,
      verification_limitation: "Source page timed out.",
    });
  });
});
