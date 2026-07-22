import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import {
  collectionRunParametersHash,
  CollectionRunsRepository,
} from "../repositories/collection-runs.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import { SitePagesRepository } from "../repositories/site-pages.ts";
import { SitesRepository } from "../repositories/sites.ts";
import { SourceConnectionsRepository } from "../repositories/source-connections.ts";
import { workspaces } from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

interface Fixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly siteId: string;
  readonly actorId: string;
  readonly crawlSourceId: string;
  readonly gscSourceId: string;
  readonly seedPageId: string;
  readonly seedUrl: string;
}

describeDb("CollectionRun frozen Product Profile Crawl seed", () => {
  let handle: DbHandle;
  let primary: Fixture;
  let foreign: Fixture;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL!);

    const createFixture = async (label: string): Promise<Fixture> => {
      const actorId = randomUUID();
      const [workspace] = await handle.db
        .insert(workspaces)
        .values({ name: `${label}-${randomUUID()}` })
        .returning();
      const workspaceId = workspace!.id;
      const project = await new ProjectsRepository(handle.db).insert({
        workspaceId,
        clientName: label,
        projectName: label,
        defaultDeliveryLocale: "en",
        createdBy: actorId,
      });
      const host = `${randomUUID()}.example.test`;
      const site = await new SitesRepository(handle.db).insertPrimary({
        workspaceId,
        projectId: project.id,
        origin: `https://${host}`,
        host,
        marketCodes: [],
        languageCodes: [],
      });
      const crawlSource = await new SourceConnectionsRepository(
        handle.db,
      ).insertDefaultCrawl({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        createdBy: actorId,
      });
      const gscSource = await new SourceConnectionsRepository(
        handle.db,
      ).insertConnection({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        provider: "gsc",
        connectionType: "oauth",
        state: "connected",
        externalRef: `https://${host}`,
        limitation: "Disposable frozen-seed integration fixture.",
        connectedAt: true,
        createdBy: actorId,
      });
      const seedUrl = `https://${host}/products/growth/`;
      const page = await new SitePagesRepository(
        handle.db,
      ).upsertNormalizedUrl({
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        normalizedUrl: seedUrl,
        templateKey: null,
      });
      return {
        workspaceId,
        projectId: project.id,
        siteId: site.id,
        actorId,
        crawlSourceId: crawlSource.id,
        gscSourceId: gscSource.id,
        seedPageId: page.id,
        seedUrl,
      };
    };

    primary = await createFixture("Frozen seed owner");
    foreign = await createFixture("Frozen seed foreign");
  });

  afterAll(async () => {
    await handle?.end();
  });

  async function insertAsyncRun(
    fixture: Fixture,
    provider: "crawl" | "gsc" = "crawl",
  ): Promise<string> {
    const run = await new AsyncRunsRepository(handle.db).insertQueued({
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      kind: "collection",
      activeKey: `${provider}:${randomUUID()}`,
      initiatedBy: fixture.actorId,
      contractVersion: "2026-07-21",
    });
    return run.id;
  }

  async function rawInsert(
    runId: string,
    input: {
      readonly fixture?: Fixture;
      readonly provider?: "crawl" | "gsc";
      readonly seedPageId: string | null;
      readonly seedUrl: string | null;
    },
  ): Promise<unknown> {
    const fixture = input.fixture ?? primary;
    const provider = input.provider ?? "crawl";
    return handle.pool.query(
      `INSERT INTO app.collection_runs (
         id, workspace_id, project_id, site_id, source_connection_id,
         provider, operation, method_version, parameters_hash,
         crawl_seed_site_page_id, crawl_seed_url
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11
       )`,
      [
        runId,
        fixture.workspaceId,
        fixture.projectId,
        fixture.siteId,
        provider === "crawl" ? fixture.crawlSourceId : fixture.gscSourceId,
        provider,
        provider === "crawl" ? "site_graph" : "search_analytics",
        provider === "crawl"
          ? "crawl.site_graph.v2"
          : "gsc.page_query_daily.v1",
        contentHash({ fixture: runId }),
        input.seedPageId,
        input.seedUrl,
      ],
    );
  }

  it("accepts both legacy null seeds and one exact same-Site Crawl seed", async () => {
    const legacyRunId = await insertAsyncRun(primary);
    await expect(
      rawInsert(legacyRunId, { seedPageId: null, seedUrl: null }),
    ).resolves.toMatchObject({ rowCount: 1 });

    const seededRunId = await insertAsyncRun(primary);
    const parametersHash = collectionRunParametersHash({
      provider: "crawl",
      operation: "site_graph",
      siteId: primary.siteId,
      crawlSeedSitePageId: primary.seedPageId,
      crawlSeedUrl: primary.seedUrl,
    });
    const persisted = await new CollectionRunsRepository(
      handle.db,
    ).insertPlaceholder({
      runId: seededRunId,
      workspaceId: primary.workspaceId,
      projectId: primary.projectId,
      siteId: primary.siteId,
      sourceConnectionId: primary.crawlSourceId,
      provider: "crawl",
      operation: "site_graph",
      methodVersion: "crawl.site_graph.v2",
      parametersHash,
      crawlSeedSitePageId: primary.seedPageId,
      crawlSeedUrl: primary.seedUrl,
    });

    expect(persisted).toMatchObject({
      crawl_seed_site_page_id: primary.seedPageId,
      crawl_seed_url: primary.seedUrl,
      parameters_hash: parametersHash,
    });
  });

  it.each([
    {
      label: "SitePage id without URL",
      seedPageId: (): string | null => primary.seedPageId,
      seedUrl: (): string | null => null,
    },
    {
      label: "URL without SitePage id",
      seedPageId: (): string | null => null,
      seedUrl: (): string | null => primary.seedUrl,
    },
  ])("rejects an incomplete seed pair: $label", async (testCase) => {
    const runId = await insertAsyncRun(primary);
    await expectPgCode(
      rawInsert(runId, {
        seedPageId: testCase.seedPageId(),
        seedUrl: testCase.seedUrl(),
      }),
      "23514",
    );
  });

  it("rejects seeds on a non-Crawl provider", async () => {
    const runId = await insertAsyncRun(primary, "gsc");
    await expectPgCode(
      rawInsert(runId, {
        provider: "gsc",
        seedPageId: primary.seedPageId,
        seedUrl: primary.seedUrl,
      }),
      "23514",
    );
  });

  it("rejects a foreign SitePage, a different exact URL, and an unbounded URL", async () => {
    const foreignRunId = await insertAsyncRun(primary);
    await expectPgCode(
      rawInsert(foreignRunId, {
        seedPageId: foreign.seedPageId,
        seedUrl: foreign.seedUrl,
      }),
      "23514",
    );

    const mismatchedUrlRunId = await insertAsyncRun(primary);
    await expectPgCode(
      rawInsert(mismatchedUrlRunId, {
        seedPageId: primary.seedPageId,
        seedUrl: primary.seedUrl.slice(0, -1),
      }),
      "23514",
    );

    const oversizedRunId = await insertAsyncRun(primary);
    await expectPgCode(
      rawInsert(oversizedRunId, {
        seedPageId: primary.seedPageId,
        seedUrl: `https://example.test/${"x".repeat(2049)}`,
      }),
      "23514",
    );
  });

  it("rejects a SitePage whose exact UTF-8 URL hash is forged", async () => {
    await expectPgCode(
      handle.pool.query(
        `INSERT INTO app.site_pages (
           workspace_id, project_id, site_id,
           normalized_url, normalized_url_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          primary.workspaceId,
          primary.projectId,
          primary.siteId,
          `${primary.seedUrl}forged`,
          "0".repeat(64),
        ],
      ),
      "23514",
    );
  });

  it("makes both frozen seed columns immutable after acceptance", async () => {
    const runId = await insertAsyncRun(primary);
    await rawInsert(runId, {
      seedPageId: primary.seedPageId,
      seedUrl: primary.seedUrl,
    });

    await expectPgCode(
      handle.pool.query(
        `UPDATE app.collection_runs
         SET crawl_seed_site_page_id = NULL, crawl_seed_url = NULL
         WHERE id = $1`,
        [runId],
      ),
      "23514",
    );
    await expectPgCode(
      handle.pool.query(
        `UPDATE app.collection_runs
         SET crawl_seed_url = $2
         WHERE id = $1`,
        [runId, primary.seedUrl.slice(0, -1)],
      ),
      "23514",
    );
  });
});
