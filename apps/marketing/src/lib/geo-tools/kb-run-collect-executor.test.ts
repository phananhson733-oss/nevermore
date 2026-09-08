import { describe, expect, it, vi } from "vitest";

import {
  createGeoRunCollectRuntime,
  type GeoRunCollectSources,
} from "./kb-run-collect-executor.ts";
import type { GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import type { GeoRunContext } from "./kb-run-advance.ts";
import type { GeoRunOperationRecord, GeoRunRecord } from "./kb-run-ledger.ts";

const USER = "6f3d1a04-77c5-4d31-9e60-0a1b2c3d4e5f";
const KB = "1f08f279-2b40-4c11-9a33-5d6e7f809a1b";
const RUN = "9c7b5e21-3a44-4f77-8d21-0b1c2d3e4f50";
const WEBSITE = "3d2c1b0a-9988-4766-9554-433221100fee";
const OBSERVATION = "aa11bb22-cc33-4d44-9e55-ff6677889900";
const NEXT_OBSERVATION = "bb22cc33-dd44-4e55-9f66-001122334455";
const OWN = "https://example.com/";
const OWN_KEY = "fetch:own:https://example.com/";
const NOW = new Date("2026-09-08T12:00:00.000Z");

const PAGE = `<!doctype html><html><head><title>Example</title></head><body>
  <h1>Example runs knowledge bases</h1>
  <p>The plan costs 19 dollars a month and includes the reviewer workflow.</p>
</body></html>`;

function observation(
  overrides: Partial<GeoEvidenceObservation> = {},
): GeoEvidenceObservation {
  return {
    schemaVersion: "marketing-website-evidence-observation.v1",
    observationId: OBSERVATION,
    websiteId: WEBSITE,
    kind: "own_page",
    url: OWN,
    observedAt: "2026-09-08T11:00:00.000Z",
    status: {
      kind: "ok",
      bodyHash: "a".repeat(64),
      excerpts: ["Example"],
      structured: {},
    },
    independence: null,
    ...overrides,
  };
}

function draft(payload: Record<string, unknown> | null = null) {
  return {
    kind: "ok" as const,
    value: {
      kbId: KB,
      draft:
        payload === null
          ? null
          : {
              draftVersion: 3,
              contentHash: "b".repeat(64),
              updatedAt: NOW.toISOString(),
              payload: payload as never,
            },
    },
  };
}

function v2Payload(competitors: readonly Record<string, unknown>[] = []) {
  return {
    schemaVersion: "marketing-geo-kb.v2",
    targetUrl: OWN,
    officialName: "Example",
    aliases: [],
    categoryTerms: [],
    market: { country: "US", language: "en" },
    roles: [],
    competitors,
    facts: [],
  };
}

function sources(
  overrides: Partial<GeoRunCollectSources> = {},
): GeoRunCollectSources {
  return {
    readDetails: async () => draft(v2Payload()),
    resolveWebsiteId: async () => ({ kind: "ok", websiteId: WEBSITE }),
    readLatestObservation: async () => ({ kind: "ok", value: null }),
    recordObservation: async (input) => ({
      kind: "ok",
      value: observation({
        observationId: NEXT_OBSERVATION,
        kind: input.kind,
        url: input.url,
        observedAt: input.observedAt,
        status: input.status,
      }),
    }),
    createReader: () => async () => ({
      kind: "ok",
      url: OWN,
      body: PAGE,
      contentType: "text/html; charset=utf-8",
      observedAt: NOW.toISOString(),
    }),
    now: () => NOW,
    ...overrides,
  };
}

function operation(
  overrides: Partial<GeoRunOperationRecord> = {},
): GeoRunOperationRecord {
  return {
    key: OWN_KEY,
    kind: "fetch",
    state: "dispatched",
    resultRef: null,
    reason: null,
    probeCount: 0,
    startedAt: NOW.toISOString(),
    finishedAt: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

const run: GeoRunRecord = {
  schemaVersion: "marketing-geo-kb-run.v1",
  runId: RUN,
  userId: USER,
  kbId: KB,
  idempotencyKey: "collect-key-01",
  state: "running",
  generationInputHash: null,
  leaseExpiresAt: "2026-09-08T12:06:00.000Z",
  createdAt: "2026-09-08T11:59:00.000Z",
};

const context: GeoRunContext = {
  userId: USER,
  kbId: KB,
  runId: RUN,
  run,
  appendOperations: async () => true,
  bindGenerationInput: async () => "bound" as const,
};

describe("deciding what a run holds", () => {
  it("seeds one fetch for the site and one for each confirmed competitor", async () => {
    const { seedOperations } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft(
            v2Payload([
              { domain: "rival.com", brandName: "Rival", confirmed: true },
              { domain: "maybe.com", brandName: "", confirmed: false },
            ]),
          ),
      }),
    );
    // The model step is last, and the position is the whole phase ordering:
    // `marketing_geo_kb_run_insert_operations` writes `seq` from this array's
    // order and `planGeoRun` acts on the first actionable row, so a knowledge
    // step seeded anywhere but the end would be bought before the pages it is
    // supposed to be about had been read.
    await expect(seedOperations({ userId: USER, kbId: KB })).resolves.toEqual({
      kind: "ready",
      seed: [
        { key: OWN_KEY, kind: "fetch" },
        { key: "fetch:competitor:https://rival.com/", kind: "fetch" },
        { key: "model:knowledge", kind: "model" },
      ],
    });
  });

  it("seeds no model step for a draft whose site nothing may read", async () => {
    // The empty-collection refusal governs the paid half too. A run made of a
    // lone knowledge step would buy a synthesis about a site we were never
    // allowed to look at, and then report the knowledge base as updated.
    const { seedOperations } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft({ ...v2Payload(), targetUrl: "https://127.0.0.1/" }),
      }),
    );
    const outcome = await seedOperations({ userId: USER, kbId: KB });
    expect(outcome.kind).toBe("invalid_input");
    expect(outcome).not.toHaveProperty("seed");
  });

  it("says there is nothing to update rather than opening an empty run", async () => {
    const { seedOperations } = createGeoRunCollectRuntime(
      sources({ readDetails: async () => draft(null) }),
    );
    await expect(seedOperations({ userId: USER, kbId: KB })).resolves.toEqual({
      kind: "missing",
    });
  });

  it("refuses a draft whose target is not a site anyone can read", async () => {
    const { seedOperations } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft({ ...v2Payload(), targetUrl: "https://localhost/" }),
      }),
    );
    await expect(seedOperations({ userId: USER, kbId: KB })).resolves.toEqual({
      kind: "invalid_input",
    });
  });

  it("reports an outage as an outage, never as an empty plan", async () => {
    const { seedOperations } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () => ({
          kind: "unavailable",
          reason: "store_unavailable",
        }),
      }),
    );
    await expect(seedOperations({ userId: USER, kbId: KB })).resolves.toEqual({
      kind: "unavailable",
    });
  });
});

describe("performing one collection operation", () => {
  it("reuses a fresh observation and sends nothing at all", async () => {
    const createReader = vi.fn(() => async () => {
      throw new Error("must not fetch");
    });
    const recordObservation = vi.fn();
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation(),
        }),
        createReader: createReader as never,
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: OBSERVATION,
    });
    expect(createReader).not.toHaveBeenCalled();
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("fetches once when the newest observation has expired, and records what it saw", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation({ observedAt: "2026-09-06T12:00:00.000Z" }),
        }),
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: NEXT_OBSERVATION,
    });
    expect(recordObservation).toHaveBeenCalledTimes(1);
    const appended = recordObservation.mock.calls[0]?.[0];
    expect(appended.websiteId).toBe(WEBSITE);
    expect(appended.kind).toBe("own_page");
    expect(appended.url).toBe(OWN);
    // The moment we looked, not the moment we wrote: a persist-time clock
    // would date every row later than the fetch it records.
    expect(appended.observedAt).toBe(NOW.toISOString());
    expect(appended.status.kind).toBe("ok");
    if (appended.status.kind === "ok") {
      expect(appended.status.excerpts.length).toBeGreaterThan(0);
    }
  });

  it("never stores a refused gate as an observation of the site", async () => {
    const recordObservation = vi.fn();
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: () => async () => ({
          kind: "unavailable",
          url: OWN,
          reason: "rate_limited",
        }),
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "failed_retryable",
      reason: "rate_limited",
    });
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("records a page that is not there as an observation of the site", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: () => async () => ({
          kind: "unavailable",
          url: OWN,
          reason: "not_found",
        }),
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: NEXT_OBSERVATION,
    });
    expect(recordObservation.mock.calls[0]?.[0].status).toEqual({
      kind: "unavailable",
      reason: "not_found",
    });
  });

  it("records a page with nothing quotable as observed but unusable", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: () => async () => ({
          kind: "ok",
          url: OWN,
          body: "<html><body></body></html>",
          contentType: "text/html",
          observedAt: NOW.toISOString(),
        }),
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(recordObservation.mock.calls[0]?.[0].status).toEqual({
      kind: "unavailable",
      reason: "insufficient_evidence",
    });
  });

  it("records something that is not a page as an invalid response", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: () => async () => ({
          kind: "ok",
          url: OWN,
          body: "{}",
          contentType: "application/json",
          observedAt: NOW.toISOString(),
        }),
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toMatchObject({
      kind: "succeeded",
    });
    expect(recordObservation.mock.calls[0]?.[0].status).toEqual({
      kind: "unavailable",
      reason: "invalid_response",
    });
  });

  it("leaves a fetch we cannot file unresolved rather than retryable", async () => {
    // The page was read: the site was reached and the allowance was spent. We
    // do not know whether the row landed, and that is not a free second try.
    const { executor } = createGeoRunCollectRuntime(
      sources({
        recordObservation: async () => ({ kind: "unavailable" }),
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "outcome_unknown",
    });
  });

  it("refuses a kind nothing here produces instead of reporting it done", async () => {
    const { executor } = createGeoRunCollectRuntime(sources());
    await expect(
      executor.start(
        operation({ key: "model:knowledge", kind: "model" }),
        context,
      ),
    ).resolves.toEqual({ kind: "failed_permanent", reason: "unsupported" });
  });

  it("refuses an operation this draft no longer plans", async () => {
    const { executor } = createGeoRunCollectRuntime(sources());
    await expect(
      executor.start(
        operation({ key: "fetch:competitor:https://gone.example/" }),
        context,
      ),
    ).resolves.toEqual({ kind: "failed_permanent", reason: "not_found" });
  });

  it("files a competitor's page under the owner's own website", async () => {
    const resolveWebsiteId = vi.fn<GeoRunCollectSources["resolveWebsiteId"]>(
      async () => ({ kind: "ok", websiteId: WEBSITE }),
    );
    const readLatestObservation = vi.fn<GeoRunCollectSources["readLatestObservation"]>(
      async () => ({ kind: "ok", value: null }),
    );
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft(
            v2Payload([
              { domain: "rival.com", brandName: "Rival", confirmed: true },
            ]),
          ),
        resolveWebsiteId,
        readLatestObservation,
      }),
    );
    await executor.start(
      operation({ key: "fetch:competitor:https://rival.com/" }),
      context,
    );
    // The library records what THIS site's update looked at. Resolving by the
    // rival's URL would file the page under a website this owner may not have.
    expect(resolveWebsiteId.mock.calls[0]?.[0]).toEqual({
      userId: USER,
      targetUrl: OWN,
    });
    expect(readLatestObservation.mock.calls[0]?.[0]).toMatchObject({
      websiteId: WEBSITE,
      kind: "competitor_page",
      url: "https://rival.com/",
    });
  });

  it("refuses to observe a website this owner does not have", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({ resolveWebsiteId: async () => ({ kind: "missing" }) }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "failed_permanent",
      reason: "not_found",
    });
  });

  it("retries later when the ledger itself is unreachable before any fetch", async () => {
    const createReader = vi.fn(() => async () => {
      throw new Error("must not fetch");
    });
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({ kind: "unavailable" }),
        createReader: createReader as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "failed_retryable",
      reason: "store_unavailable",
    });
    expect(createReader).not.toHaveBeenCalled();
  });
});

describe("finding out what happened to a collection we lost sight of", () => {
  it("sends nothing", async () => {
    const createReader = vi.fn(() => async () => {
      throw new Error("a probe must not fetch");
    });
    const recordObservation = vi.fn();
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: createReader as never,
        recordObservation: recordObservation as never,
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation(),
        }),
      }),
    );
    await executor.probe(operation(), context);
    expect(createReader).not.toHaveBeenCalled();
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("says nothing was sent only for a claim that expired before dispatch", async () => {
    const { executor } = createGeoRunCollectRuntime(sources());
    await expect(
      executor.probe(
        operation({ state: "claimed", leaseExpiresAt: NOW.toISOString() }),
        context,
      ),
    ).resolves.toEqual({ kind: "not_dispatched" });
  });

  it("reads the outcome out of the ledger when the fetch did land", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation(),
        }),
      }),
    );
    await expect(executor.probe(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: OBSERVATION,
    });
  });

  it("stays unresolved when nothing this run could have written is there", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({ kind: "ok", value: null }),
      }),
    );
    await expect(executor.probe(operation(), context)).resolves.toEqual({
      kind: "unresolved",
    });
  });

  it("stays unresolved rather than claiming success from an expired row", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation({ observedAt: "2026-09-06T12:00:00.000Z" }),
        }),
      }),
    );
    await expect(executor.probe(operation(), context)).resolves.toEqual({
      kind: "unresolved",
    });
  });

  it("stays unresolved when the ledger cannot be read", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readLatestObservation: async () => ({ kind: "unavailable" }),
      }),
    );
    await expect(executor.probe(operation(), context)).resolves.toEqual({
      kind: "unresolved",
    });
  });
});
