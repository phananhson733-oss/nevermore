import { describe, expect, it } from "vitest";
import {
  collectionRunParametersHash,
  CollectionRunsRepository,
  type CollectionRunRow,
} from "./collection-runs.ts";

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakeExecutor(): {
  readonly executor: never;
  readonly calls: Call[];
  enqueue(...values: unknown[]): void;
  last(method: string): Call;
} {
  const calls: Call[] = [];
  const results: unknown[] = [];
  const take = () => (results.length > 0 ? results.shift() : []);
  const query: object = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(take()).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  const executor = new Proxy(
    {},
    {
      get(_target, property) {
        return (...args: unknown[]) => {
          calls.push({ method: String(property), args });
          return query;
        };
      },
    },
  );
  return {
    executor: executor as never,
    calls,
    enqueue: (...values: unknown[]) => results.push(...values),
    last(method: string): Call {
      const found = calls.findLast((call) => call.method === method);
      if (!found) throw new Error(`No ${method} call`);
      return found;
    },
  };
}

const values = {
  runId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  siteId: "00000000-0000-4000-8000-000000000004",
  sourceConnectionId: "00000000-0000-4000-8000-000000000005",
  crawlSeedSitePageId: "00000000-0000-4000-8000-000000000006",
  crawlSeedUrl: "https://example.test/products/growth/",
} as const;

function row(): CollectionRunRow {
  return {
    id: values.runId,
    workspace_id: values.workspaceId,
    project_id: values.projectId,
    site_id: values.siteId,
    source_connection_id: values.sourceConnectionId,
    import_preview_id: null,
    crawl_seed_site_page_id: values.crawlSeedSitePageId,
    crawl_seed_url: values.crawlSeedUrl,
    provider: "crawl",
    operation: "site_graph",
    method_version: "crawl.site_graph.v2",
    parameters_hash: collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: values.siteId,
      crawlSeedSitePageId: values.crawlSeedSitePageId,
      crawlSeedUrl: values.crawlSeedUrl,
    }),
    row_count: null,
    stop_reason: null,
    created_at: "2026-07-22T08:00:00.000Z",
  };
}

describe("CollectionRunsRepository frozen Crawl seed", () => {
  it("addresses the exact frozen SitePage id and URL, including slash semantics", () => {
    const exact = collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: values.siteId,
      crawlSeedSitePageId: values.crawlSeedSitePageId,
      crawlSeedUrl: values.crawlSeedUrl,
    });
    const withoutSlash = collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: values.siteId,
      crawlSeedSitePageId: values.crawlSeedSitePageId,
      crawlSeedUrl: values.crawlSeedUrl.slice(0, -1),
    });
    const otherPage = collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: values.siteId,
      crawlSeedSitePageId: "00000000-0000-4000-8000-000000000099",
      crawlSeedUrl: values.crawlSeedUrl,
    });

    expect(exact).toMatch(/^[a-f0-9]{64}$/u);
    expect(exact).not.toBe(withoutSlash);
    expect(exact).not.toBe(otherPage);
  });

  it("persists the frozen seed pair on the placeholder and returns it", async () => {
    const fake = fakeExecutor();
    const persisted = row();
    fake.enqueue([persisted]);

    await expect(
      new CollectionRunsRepository(fake.executor).insertPlaceholder({
        runId: values.runId,
        workspaceId: values.workspaceId,
        projectId: values.projectId,
        siteId: values.siteId,
        sourceConnectionId: values.sourceConnectionId,
        provider: "crawl",
        operation: "site_graph",
        methodVersion: "crawl.site_graph.v2",
        parametersHash: persisted.parameters_hash,
        crawlSeedSitePageId: values.crawlSeedSitePageId,
        crawlSeedUrl: values.crawlSeedUrl,
      }),
    ).resolves.toEqual(persisted);

    expect(fake.last("values").args[0]).toMatchObject({
      crawl_seed_site_page_id: values.crawlSeedSitePageId,
      crawl_seed_url: values.crawlSeedUrl,
    });
  });

  it("writes an explicit null pair for legacy and non-Crawl collection rows", async () => {
    const fake = fakeExecutor();
    fake.enqueue([
      {
        ...row(),
        crawl_seed_site_page_id: null,
        crawl_seed_url: null,
      },
    ]);

    await new CollectionRunsRepository(fake.executor).insertPlaceholder({
      runId: values.runId,
      workspaceId: values.workspaceId,
      projectId: values.projectId,
      siteId: values.siteId,
      sourceConnectionId: values.sourceConnectionId,
      provider: "gsc",
      operation: "search_analytics",
      methodVersion: "gsc.page_query_daily.v1",
      parametersHash: collectionRunParametersHash({
        provider: "gsc",
        operation: "search_analytics",
        siteId: values.siteId,
        crawlSeedSitePageId: null,
        crawlSeedUrl: null,
      }),
    });

    expect(fake.last("values").args[0]).toMatchObject({
      crawl_seed_site_page_id: null,
      crawl_seed_url: null,
    });
  });
});
