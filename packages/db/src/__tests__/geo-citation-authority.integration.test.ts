import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { runMigrations } from "../migrate.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";
import {
  asyncRuns,
  clientProjects,
  collectionRuns,
  dataSnapshots,
  geoCitationOccurrences,
  geoQueryObservations,
  normalizedObservations,
  sitePages,
  sites,
  sourceConnections,
  workspaces,
} from "../schema.ts";
import {
  GeoCitationAuthorityRepository,
} from "../repositories/geo-citations.ts";
import { AsyncRunsRepository } from "../repositories/async-runs.ts";
import { CollectionRunsRepository } from "../repositories/collection-runs.ts";
import { normalizedUrlHash } from "../repositories/site-pages.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("GEO citation canonical writer", () => {
  let handle: DbHandle;
  const ids = {
    workspace: randomUUID(),
    project: randomUUID(),
    site: randomUUID(),
    page: randomUUID(),
    actor: randomUUID(),
    source: randomUUID(),
    run: randomUUID(),
    snapshot: randomUUID(),
    normalized: randomUUID(),
    query: randomUUID(),
    citation: randomUUID(),
  };
  const canonicalUrl =
    "https://geo-citation-authority.example/customer-onboarding/";
  const excerptHash = "a".repeat(64);

  beforeAll(async () => {
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL!);
    await runMigrations(databaseUrl);
    handle = createDbHandle(databaseUrl);
    await handle.db.insert(workspaces).values({
      id: ids.workspace,
      name: `GEO authority ${randomUUID()}`,
    });
    await handle.db.insert(clientProjects).values({
      id: ids.project,
      workspace_id: ids.workspace,
      client_name: "GEO client",
      project_name: `GEO project ${randomUUID()}`,
      default_delivery_locale: "en-US",
      created_by: ids.actor,
    });
    await handle.db.insert(sites).values({
      id: ids.site,
      workspace_id: ids.workspace,
      project_id: ids.project,
      origin: "https://geo-citation-authority.example",
      host: "geo-citation-authority.example",
      market_codes: ["US"],
      language_codes: ["en-US"],
      is_primary: true,
    });
    await handle.db.insert(sitePages).values({
      id: ids.page,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      normalized_url: canonicalUrl,
      normalized_url_hash: normalizedUrlHash(canonicalUrl),
    });
    await handle.db.insert(sourceConnections).values({
      id: ids.source,
      workspace_id: ids.workspace,
      project_id: ids.project,
      site_id: ids.site,
      provider: "geo",
      connection_type: "api_key_stub",
      state: "connected",
      external_ref: "internal:geo-citation-collector",
      config: {
        visibility: "internal",
        authority: "geo_citation_authority",
      },
      limitation:
        "Point-in-time AI answer collector; no snapshot has been collected yet.",
      connected_at: "2026-06-01T00:00:00.000Z",
      created_by: ids.actor,
    });
    await handle.db.insert(asyncRuns).values({
      id: ids.run,
      workspace_id: ids.workspace,
      project_id: ids.project,
      kind: "collection",
      status: "queued",
      active_key: `geo-citation:${ids.site}:2026-07-01`,
      contract_version: "geo-citation-authority-v1",
      request_payload: {
        sourceConnectionId: ids.source,
        siteId: ids.site,
      },
      initiated_by: ids.actor,
      result_type: "collection_run",
      result_id: ids.run,
    });
    await new CollectionRunsRepository(
      handle.db,
    ).insertPlaceholder({
      runId: ids.run,
      workspaceId: ids.workspace,
      projectId: ids.project,
      siteId: ids.site,
      sourceConnectionId: ids.source,
      provider: "geo",
      operation: "ai_citation_monitor",
      methodVersion: "geo-citation-authority-v1",
      parametersHash: "b".repeat(64),
    });
  });

  afterAll(async () => {
    await handle?.end();
  });

  function batch() {
    return {
      projectId: ids.project,
      siteId: ids.site,
      sourceConnectionId: ids.source,
      collectionRunId: ids.run,
      capturedAt: "2026-07-02T00:00:00.000Z",
      coveredWindow: {
        startAt: "2026-07-01T00:00:00.000Z",
        endAt: "2026-07-02T00:00:00.000Z",
      },
      marketCode: "US",
      languageTag: "en-US",
      limitation:
        "Point-in-time AI answer evidence is observational and may vary.",
      queries: [
        {
          sitePageId: ids.page,
          canonicalUrl,
          query: "What is the best customer onboarding software?",
          platform: {
            kind: "known" as const,
            key: "perplexity" as const,
          },
          model: "sonar",
          collector: {
            kind: "vendor_api" as const,
            providerKey: "internal-ai-visibility",
            version: "2026-07-28",
          },
          collectedAt: "2026-07-01T12:00:00.000Z",
          citationState: "cited" as const,
          answerEvidence: {
            excerpt:
              "RelayOps appears in a cited onboarding software list.",
            contentHash: excerptHash,
            selector: "answer:citation[1]",
          },
          limitation:
            "One point-in-time answer; no causal conclusion is supported.",
          citations: [
            {
              citationUrl: canonicalUrl,
              citationOrdinal: 1,
              answerEvidenceExcerpt:
                "RelayOps appears in a cited onboarding software list.",
              citedPageExcerpt:
                "Automate customer onboarding workflows.",
              citedPageContentHash: excerptHash,
              citedParagraphHash: "c".repeat(64),
              citedParagraphSelector:
                "main > section:nth-of-type(2) > p",
              citedParagraphIndex: 2,
              evidenceClassification:
                "direct_observation" as const,
            },
          ],
        },
      ],
    };
  }

  it("atomically writes one immutable snapshot, page aggregate, query, and citation with exact scope", async () => {
    const claimed = await new AsyncRunsRepository(handle.db).claim(
      {
        workspaceId: ids.workspace,
        projectId: ids.project,
      },
      ids.run,
    );
    expect(claimed).not.toBeNull();
    const generatedIds = [
      ids.snapshot,
      ids.normalized,
      ids.query,
      ids.citation,
    ];
    const repository = new GeoCitationAuthorityRepository(
      handle.db,
      {
        newId: () => generatedIds.shift()!,
      },
    );
    const input = {
      attempt: {
        workspaceId: ids.workspace,
        projectId: ids.project,
        runId: ids.run,
        attemptCount: claimed!.attempt_count,
      },
      batch: batch(),
    };
    await expect(
      repository.appendBatch(
        {
          workspaceId: ids.workspace,
          projectId: ids.project,
        },
        input,
      ),
    ).resolves.toEqual({
      snapshotId: ids.snapshot,
      normalizedObservationIds: [ids.normalized],
      replayed: false,
    });

    const [snapshotRows, normalizedRows, queryRows, citationRows, runRows] =
      await Promise.all([
        handle.db.select().from(dataSnapshots),
        handle.db.select().from(normalizedObservations),
        handle.db.select().from(geoQueryObservations),
        handle.db.select().from(geoCitationOccurrences),
        handle.db.select().from(asyncRuns),
      ]);
    expect(
      snapshotRows.find((row) => row.id === ids.snapshot),
    ).toMatchObject({
      provider: "geo",
      dataset_key: "geo.answer_citations.v1",
      availability: "available",
      row_count: 1,
    });
    expect(
      normalizedRows.find((row) => row.id === ids.normalized),
    ).toMatchObject({
      site_page_id: ids.page,
      provider: "geo",
      metric_key: "geo.page_citations.v1",
      subject_ref: canonicalUrl,
      origin: "vendor_observation",
      grade: "B",
      value_json: {
        trackedQueries: 1,
        citedQueries: 1,
        citations: 1,
      },
    });
    expect(queryRows).toContainEqual(
      expect.objectContaining({
        id: ids.query,
        snapshot_id: ids.snapshot,
        normalized_observation_id: ids.normalized,
        site_page_id: ids.page,
        canonical_url: canonicalUrl,
        platform_kind: "known",
        platform_key: "perplexity",
        citation_state: "cited",
        answer_content_hash: excerptHash,
      }),
    );
    expect(citationRows).toContainEqual(
      expect.objectContaining({
        id: ids.citation,
        query_observation_id: ids.query,
        citation_url: canonicalUrl,
        cited_paragraph_hash: "c".repeat(64),
        evidence_classification: "direct_observation",
      }),
    );
    expect(
      runRows.find((row) => row.id === ids.run),
    ).toMatchObject({
      status: "completed",
      result_type: "collection_run",
      result_id: ids.run,
    });

    await expect(
      repository.appendBatch(
        {
          workspaceId: ids.workspace,
          projectId: ids.project,
        },
        input,
      ),
    ).resolves.toEqual({
      snapshotId: ids.snapshot,
      normalizedObservationIds: [ids.normalized],
      replayed: true,
    });
  });

  it("permanently rejects a different payload for the same Collection Run", async () => {
    const existing = await handle.db
      .select()
      .from(collectionRuns);
    expect(existing.some((row) => row.id === ids.run)).toBe(true);
    await expect(
      new GeoCitationAuthorityRepository(handle.db).appendBatch(
        {
          workspaceId: ids.workspace,
          projectId: ids.project,
        },
        {
          attempt: {
            workspaceId: ids.workspace,
            projectId: ids.project,
            runId: ids.run,
            attemptCount: 1,
          },
          batch: {
            ...batch(),
            limitation:
              "A changed payload must not overwrite canonical evidence.",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "GEO_REPLAY_CONFLICT",
    });
  });
});
