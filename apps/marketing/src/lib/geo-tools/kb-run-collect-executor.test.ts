import { describe, expect, it, vi } from "vitest";

import {
  createGeoRunCollectRuntime,
  type GeoRunCollectSources,
} from "./kb-run-collect-executor.ts";
import type { GeoEvidenceObservation } from "./kb-evidence-observations.ts";
import { creditGeoKnowledgeObservedStructure } from "./kb-generation-preparer.ts";
import type { GeoRunContext } from "./kb-run-advance.ts";
import type { GeoRunOperationRecord, GeoRunRecord } from "./kb-run-ledger.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

const USER = "6f3d1a04-77c5-4d31-9e60-0a1b2c3d4e5f";
const KB = "1f08f279-2b40-4c11-9a33-5d6e7f809a1b";
const RUN = "9c7b5e21-3a44-4f77-8d21-0b1c2d3e4f50";
const WEBSITE = "3d2c1b0a-9988-4766-9554-433221100fee";
const OBSERVATION = "aa11bb22-cc33-4d44-9e55-ff6677889900";
const NEXT_OBSERVATION = "bb22cc33-dd44-4e55-9f66-001122334455";
const OWN = "https://example.com/";
const OWN_KEY = "fetch:own:https://example.com/";
const NOW = new Date("2026-09-08T12:00:00.000Z");

const PAGE = `<!doctype html><html lang="en"><head><title>Example</title>
  <link rel="alternate" hreflang="en" href="https://example.com/" />
  <link rel="alternate" hreflang="de" href="https://example.com/de/" />
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How much does Example cost?",
        acceptedAnswer: { "@type": "Answer", text: "19 dollars a month." },
      },
    ],
  })}</script>
</head><body>
  <h1>Example runs knowledge bases</h1>
  <p>The plan costs 19 dollars a month and includes the reviewer workflow.</p>
</body></html>`;

const ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml";
const LLMS = "# Example\n\n- [Docs](https://example.com/docs)";
const SITEMAP_URLS = Array.from(
  { length: 12 },
  (_value, index) => `https://example.com/page-${index}`,
);
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SITEMAP_URLS.map(
  (url) => `<url><loc>${url}</loc></url>`,
).join("")}</urlset>`;

/**
 * The whole site as one reader sees it: the page, and the three files a site
 * publishes for machines. One instance per operation, exactly as the runtime
 * builds it, so a test can count how many admissions an operation would open.
 */
function siteReader(
  overrides: Readonly<Record<string, unknown>> = {},
): GeoRunCollectSources["createReader"] {
  const bodies: Record<string, { body: string; contentType: string }> = {
    "https://example.com/robots.txt": { body: ROBOTS, contentType: "text/plain; charset=utf-8" },
    "https://example.com/sitemap.xml": { body: SITEMAP, contentType: "application/xml" },
    "https://example.com/llms.txt": { body: LLMS, contentType: "text/plain" },
  };
  return () => async ({ url }) => {
    const override = overrides[url];
    if (override !== undefined) return override as never;
    const resource = bodies[url];
    return resource === undefined
      ? {
          kind: "ok",
          url,
          body: PAGE,
          contentType: "text/html; charset=utf-8",
          observedAt: NOW.toISOString(),
        }
      : {
          kind: "ok",
          url,
          body: resource.body,
          contentType: resource.contentType,
          observedAt: NOW.toISOString(),
        };
  };
}

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
    createReader: siteReader(),
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
  it("sends nothing at all for a competitor page it already holds", async () => {
    const createReader = vi.fn(() => async () => {
      throw new Error("must not fetch");
    });
    const recordObservation = vi.fn();
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft(
            v2Payload([{ domain: "rival.com", brandName: "Rival", confirmed: true }]),
          ),
        readLatestObservation: async () => ({
          kind: "ok",
          value: observation({
            kind: "competitor_page",
            url: "https://rival.com/",
            observedAt: NOW.toISOString(),
          }),
        }),
        createReader: createReader as never,
        recordObservation: recordObservation as never,
      }),
    );
    // A rival has no machine-readable files this card asks about, so a fresh
    // competitor page really is the whole operation.
    await expect(
      executor.start(
        operation({ key: "fetch:competitor:https://rival.com/" }),
        context,
      ),
    ).resolves.toEqual({ kind: "succeeded", resultRef: OBSERVATION });
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
    // One row for the page, then one for each machine-readable file the site
    // publishes -- all inside this one operation, on one crawl-gate admission.
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "own_page",
      "robots",
      "sitemap",
      "llms",
    ]);
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

describe("observing the site's machine-readable files", () => {
  function machineSources(
    overrides: Partial<GeoRunCollectSources> = {},
  ): {
    readonly sources: GeoRunCollectSources;
    readonly recordObservation: ReturnType<typeof vi.fn>;
    readonly createReader: ReturnType<typeof vi.fn>;
    readonly reads: readonly string[];
  } {
    const reads: string[] = [];
    const base = overrides.createReader ?? siteReader();
    const createReader = vi.fn((clientKey: string) => {
      const reader = base(clientKey);
      return async (input: Parameters<typeof reader>[0]) => {
        reads.push(input.url);
        return await reader(input);
      };
    });
    const recordObservation = vi.fn(sources().recordObservation);
    return {
      sources: sources({
        ...overrides,
        createReader: createReader as never,
        recordObservation: recordObservation as never,
      }),
      recordObservation,
      createReader,
      reads,
    };
  }

  function recorded(recordObservation: ReturnType<typeof vi.fn>, kind: string) {
    return recordObservation.mock.calls
      .map((call) => call[0])
      .find((append) => append.kind === kind);
  }

  it("reads all three through the operation's one reader, not a second admission", async () => {
    const { sources: deps, createReader, reads } = machineSources();
    const { executor } = createGeoRunCollectRuntime(deps);
    await expect(executor.start(operation(), context)).resolves.toMatchObject({
      kind: "succeeded",
    });
    // One reader is one crawl-gate admission: `createGeoKnowledgeResourceReader`
    // memoises the gate per canonical host, so every read after the first is
    // free of the site's 4-per-hour allowance. A second reader would open it
    // again, which is the whole reason these are not separate operations.
    expect(createReader).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([
      OWN,
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/llms.txt",
    ]);
  });

  it("asks the origin for the three files, not the draft's own directory", async () => {
    // `normalizeAccountWebsiteUrl` keeps the submitted path, so a draft may name
    // `https://example.com/product/`. The standards put these three files at the
    // origin, and `kb-knowledge-evidence.ts` throws outright on a robots source
    // whose pathname is not `/robots.txt` -- a relative resolution would ask the
    // wrong address and file the page it got back as the site's robots.txt.
    const { sources: deps, reads } = machineSources({
      readDetails: async () => draft({ ...v2Payload(), targetUrl: "https://example.com/product/" }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    await executor.start(operation({ key: "fetch:own:https://example.com/product/" }), context);

    expect(reads).toContain("https://example.com/robots.txt");
    expect(reads).not.toContain("https://example.com/product/robots.txt");
  });

  it("refuses an HTML shell served at robots.txt, the same as at llms.txt", async () => {
    // A single-page app answers every unknown path with its shell. Filed as
    // `ok`, that records the site as publishing a robots.txt it does not
    // publish. Unlike the sitemap, robots has no structural backstop -- the
    // shell's own lines are non-empty -- so the content type is the only check.
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/robots.txt": {
          kind: "ok", url: "https://example.com/robots.txt", body: PAGE,
          contentType: "text/html; charset=utf-8", observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    await executor.start(operation(), context);

    expect(recorded(recordObservation, "robots")?.status)
      .toEqual({ kind: "unavailable", reason: "invalid_response" });
  });

  it("refuses a file answered from another address", async () => {
    // A same-host redirect that lands somewhere else means this file is not
    // published HERE. Recorded as ok, the row would say the site publishes a
    // /llms.txt whose body came from a page that is not it.
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/llms.txt": {
          kind: "ok", url: "https://example.com/somewhere-else.txt", body: LLMS,
          contentType: "text/plain", observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    await executor.start(operation(), context);

    expect(recorded(recordObservation, "llms")?.status)
      .toEqual({ kind: "unavailable", reason: "invalid_response" });
  });

  it("lets a machine row that cannot be filed change nothing about the fetch", async () => {
    // The operation's verdict is the page it was dispatched for. A ledger that
    // refuses the extra rows must not turn a paid, successful page fetch into a
    // failure the run will pay to repeat.
    // Built through `sources` rather than `machineSources`: that helper replaces
    // `recordObservation` with its own spy, so an override handed to it never
    // reaches the executor and the test would pass without exercising anything.
    const deps = sources({
      recordObservation: (async (input: { readonly kind: string }) => {
        if (input.kind !== "own_page") throw new Error("ledger down");
        return { kind: "ok", value: observation() };
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    await expect(executor.start(operation(), context)).resolves.toMatchObject({ kind: "succeeded" });
  });

  it("counts a sitemap's distinct locations, not its repeated ones", async () => {
    // The same URL listed twice is one page. Counting the lines would report a
    // site as covering more of itself than it does.
    const repeated = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
      [...SITEMAP_URLS, SITEMAP_URLS[0]!, SITEMAP_URLS[1]!].map((url) => `<url><loc>${url}</loc></url>`).join("")
    }</urlset>`;
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/sitemap.xml": {
          kind: "ok", url: "https://example.com/sitemap.xml", body: repeated,
          contentType: "application/xml", observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    await executor.start(operation(), context);

    const sitemap = recorded(recordObservation, "sitemap");
    expect(sitemap?.status).toMatchObject({ structured: { sitemapUrlCount: String(SITEMAP_URLS.length) } });
  });

  it("counts a sitemap's URLs rather than reporting how many it kept", async () => {
    const { sources: deps, recordObservation } = machineSources();
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    const sitemap = recorded(recordObservation, "sitemap");
    expect(sitemap.url).toBe("https://example.com/sitemap.xml");
    expect(sitemap.status.kind).toBe("ok");
    // The excerpt cap is eight. Reporting the sample's length as the sitemap's
    // size would turn a twelve-URL sitemap into "8" -- a number nothing
    // measured. The count is taken from the whole document and stored as a
    // string, this ledger's convention.
    expect(sitemap.status.excerpts).toHaveLength(8);
    expect(sitemap.status.structured.sitemapUrlCount).toBe("12");
  });

  it("stores no URL count for a sitemap index, which lists sitemaps not pages", async () => {
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/sitemap.xml": {
          kind: "ok",
          url: "https://example.com/sitemap.xml",
          body: '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>',
          contentType: "application/xml",
          observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    const sitemap = recorded(recordObservation, "sitemap");
    expect(sitemap.status.kind).toBe("ok");
    expect(sitemap.status.structured).not.toHaveProperty("sitemapUrlCount");
  });

  it("records a file it could not read as a failed read, never as absent", async () => {
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/llms.txt": {
          kind: "unavailable",
          url: "https://example.com/llms.txt",
          reason: "fetch_failed",
          // The request went out and this is what came back. Without that, the
          // same `reason` is what our own gate says when it refuses admission,
          // and a row would then assert something about a site nobody asked.
          reached: true,
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    // "We could not reach it" and "the site does not publish one" are
    // different facts, and only the second may ever render as absent.
    expect(recorded(recordObservation, "llms").status).toEqual({
      kind: "unavailable",
      reason: "fetch_failed",
    });
  });

  it("refuses an HTML shell served at llms.txt instead of calling it published", async () => {
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/llms.txt": {
          kind: "ok",
          url: "https://example.com/llms.txt",
          body: PAGE,
          contentType: "text/html; charset=utf-8",
          observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    expect(recorded(recordObservation, "llms").status).toEqual({
      kind: "unavailable",
      reason: "invalid_response",
    });
  });

  it("stores an empty file as published-nothing, the one honest absent", async () => {
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/robots.txt": {
          kind: "ok",
          url: "https://example.com/robots.txt",
          body: "\n\n   \n",
          contentType: "text/plain",
          observedAt: NOW.toISOString(),
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    expect(recorded(recordObservation, "robots").status).toEqual({
      kind: "unavailable",
      reason: "not_published",
    });
  });

  it("never files the gate's own refusal as a reading of the site", async () => {
    const { sources: deps, recordObservation } = machineSources({
      createReader: siteReader({
        "https://example.com/robots.txt": {
          kind: "unavailable",
          url: "https://example.com/robots.txt",
          reason: "rate_limited",
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "own_page",
      "sitemap",
      "llms",
    ]);
  });

  it("does not let a slow ledger write spend the budget for the read after it", async () => {
    // `MACHINE_BUDGET_MS` is six seconds of READING, which is what the comment
    // above the constant has always said. Here the reads take none of it and
    // each ledger write takes four seconds; a single wall-clock deadline taken
    // before the loop -- which is what this was -- is gone before llms.txt, and
    // the file the update promised to read silently is not one.
    let clockMs = NOW.getTime();
    const base = sources();
    const recordObservation = vi.fn(
      async (append: Parameters<GeoRunCollectSources["recordObservation"]>[0]) => {
        clockMs += 4_000;
        return await base.recordObservation(append);
      },
    );
    const { executor } = createGeoRunCollectRuntime(
      sources({
        now: () => new Date(clockMs),
        createReader: siteReader() as never,
        recordObservation: recordObservation as never,
      }),
    );
    await executor.start(operation(), context);
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "own_page",
      "robots",
      "sitemap",
      "llms",
    ]);
  });

  it("leaves no row at all for a file the operation ran out of time to read", async () => {
    // Five seconds per look at the clock exhausts the machine budget partway
    // through. A row written here would say we looked; no row is the only
    // shape this ledger has for "we did not".
    let tick = 0;
    const { sources: deps, recordObservation } = machineSources({
      now: () => new Date(NOW.getTime() + tick++ * 5_000),
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(operation(), context);
    const kinds = recordObservation.mock.calls.map((call) => call[0].kind);
    expect(kinds).toContain("own_page");
    expect(kinds).not.toContain("llms");
  });

  it("spends nothing more on machine files once the page's own row is lost", async () => {
    const { executor } = createGeoRunCollectRuntime(
      sources({ recordObservation: async () => ({ kind: "unavailable" }) }),
    );
    const reads: string[] = [];
    const { executor: counted } = createGeoRunCollectRuntime(
      sources({
        recordObservation: async () => ({ kind: "unavailable" }),
        createReader: ((clientKey: string) => {
          const reader = siteReader()(clientKey);
          return async (input: Parameters<typeof reader>[0]) => {
            reads.push(input.url);
            return await reader(input);
          };
        }) as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "outcome_unknown",
    });
    await counted.start(operation(), context);
    // The page is what the operation is for. Throwing three more reads and
    // three more writes at a ledger we just watched fail buys nothing.
    expect(reads).toEqual([OWN]);
  });

  /*
   * This used to assert the opposite -- that a fresh page observation meant the
   * operation sent nothing at all -- and that is the defect it pinned. The page
   * is the part that gets a day of reuse; the three machine-readable files are
   * read on every update, which is what the button's own copy promises. In
   * production one site's robots.txt, sitemap.xml and llms.txt were therefore
   * frozen at a single 09:58 reading while three later updates re-filed it
   * without sending a request.
   */
  it("reuses a fresh page without re-reading it, and still reads the three files", async () => {
    const { sources: deps, recordObservation, reads } = machineSources({
      readLatestObservation: async ({ kind }: { readonly kind: string }) =>
        kind === "own_page"
          ? { kind: "ok" as const, value: observation({ observedAt: NOW.toISOString() }) }
          : { kind: "ok" as const, value: null },
    });
    const { executor } = createGeoRunCollectRuntime(deps);

    // The page's own row is still what the operation resolves to: nothing about
    // it was re-read, so the row that stood before this run is the result.
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: OBSERVATION,
    });
    expect(reads).toEqual([
      "https://example.com/robots.txt",
      "https://example.com/sitemap.xml",
      "https://example.com/llms.txt",
    ]);
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "robots",
      "sitemap",
      "llms",
    ]);
  });

  /*
   * The reused-page path put these three in front of the crawl gate, and a gate
   * refusal wears the same `reason` values a site does -- `blocked` for a 400,
   * `fetch_failed` when opening it throws. The reader memoises that verdict per
   * host, so a version that read the refusal as an answer filed three rows
   * about a site none of the three requests ever left for, and reported the
   * update as done.
   */
  it("writes nothing and does not claim success when the gate refuses the reused page's files", async () => {
    const { sources: deps, recordObservation } = machineSources({
      readLatestObservation: async ({ kind }: { readonly kind: string }) =>
        kind === "own_page"
          ? { kind: "ok" as const, value: observation({ observedAt: NOW.toISOString() }) }
          : { kind: "ok" as const, value: null },
      // What `createGeoKnowledgeResourceReader` returns for a gate that answers
      // 400: a reason with no `reached`, repeated for every later url.
      createReader: (() => async ({ url }: { readonly url: string }) => ({
        kind: "unavailable" as const,
        url,
        reason: "blocked" as const,
      })) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "failed_retryable",
      reason: "rate_limited",
    });
    expect(recordObservation).not.toHaveBeenCalled();
  });

  it("files the site's own refusal, which is not the gate's", async () => {
    const { sources: deps, recordObservation } = machineSources({
      readLatestObservation: async ({ kind }: { readonly kind: string }) =>
        kind === "own_page"
          ? { kind: "ok" as const, value: observation({ observedAt: NOW.toISOString() }) }
          : { kind: "ok" as const, value: null },
      createReader: siteReader({
        "https://example.com/robots.txt": {
          kind: "unavailable",
          url: "https://example.com/robots.txt",
          reason: "blocked",
          reached: true,
        },
      }) as never,
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    // Same reason, opposite meaning: the request got out, so the row is a
    // reading of the site and the other two files still get their turn.
    await expect(executor.start(operation(), context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: OBSERVATION,
    });
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "robots",
      "sitemap",
      "llms",
    ]);
  });

  it("keeps a competitor's operation to the competitor's own page", async () => {
    const { sources: deps, recordObservation, reads } = machineSources({
      readDetails: async () =>
        draft(
          v2Payload([{ domain: "rival.com", brandName: "Rival", confirmed: true }]),
        ),
    });
    const { executor } = createGeoRunCollectRuntime(deps);
    await executor.start(
      operation({ key: "fetch:competitor:https://rival.com/" }),
      context,
    );
    // A rival's robots.txt answers no question the owner's card asks, and it
    // would be a second host's hourly allowance.
    expect(reads).toEqual(["https://rival.com/"]);
    expect(recordObservation.mock.calls.map((call) => call[0].kind)).toEqual([
      "competitor_page",
    ]);
  });
});

describe("what the site's own page is recorded as carrying", () => {
  it("stores the structure the shared parser reads, beside the authorship", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({ recordObservation: recordObservation as never }),
    );
    await executor.start(operation(), context);
    const appended = recordObservation.mock.calls[0]?.[0];
    expect(appended.kind).toBe("own_page");
    // Not a bare `if`: a narrowing that quietly skipped every assertion below
    // would leave this test green for a row that carried nothing.
    if (appended.status.kind !== "ok") throw new Error("expected an observed page");
    expect(appended.status.structured.jsonLdTypes).toEqual(["FAQPage"]);
    expect(appended.status.structured.hreflangLocales).toEqual(["de", "en"]);
    // The FAQ the site itself publishes, so the card can show it the moment
    // collection finishes rather than waiting for the model.
    expect(appended.status.structured.faqPairs).toEqual([
      { question: "How much does Example cost?", answer: "19 dollars a month." },
    ]);
  });

  it("stores an empty list for a page that publishes none, not a missing key", async () => {
    /*
     * The single-language site with no JSON-LD: the common case, and the one
     * that decides whether the machine-readable module can ever be published.
     * The consumer reads a MISSING key as "we kept no answer" and an EMPTY one
     * as "this page publishes none" (`storedList` in kb-generation-preparer.ts),
     * and the module's publish gate demands the second. Omitting the key here
     * because the list happened to be empty made that gate unsatisfiable for
     * every real site and told its owner the page had never been collected.
     */
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: siteReader({
          [OWN]: {
            kind: "ok",
            url: OWN,
            body: `<!doctype html><html lang="en"><head><title>Example</title></head>
              <body><h1>Example</h1><p>The plan costs 19 dollars a month.</p></body></html>`,
            contentType: "text/html; charset=utf-8",
            observedAt: NOW.toISOString(),
          },
        }) as never,
        recordObservation: recordObservation as never,
      }),
    );
    await executor.start(operation(), context);
    const appended = recordObservation.mock.calls[0]?.[0];
    expect(appended.kind).toBe("own_page");
    if (appended.status.kind !== "ok") throw new Error("expected an observed page");
    // All three keys present and all empty. `toEqual` rather than property
    // checks: a key that came back `undefined` would satisfy `toEqual([])`
    // nowhere, and this is the exact shape the consumer's gate reads. The
    // alternates are stored twice on purpose -- the bare list for readers that
    // only count them, the pairs because the evidence contract's page shape
    // refuses a locale without the URL it points at.
    expect(appended.status.structured).toEqual({ jsonLdTypes: [], hreflangLocales: [], hreflang: [] });
  });

  it("hands the consumer a shape its publish gate can actually accept", async () => {
    /*
     * The seam, driven with real data on both ends rather than a hand-written
     * fixture. The producer's row goes straight into the consumer's own reader,
     * because the two halves of this rule live in different files and agreeing
     * by inspection is how the publish path came to be unreachable in the first
     * place: the consumer's gate wanted `stored` with an empty list, the
     * producer could only ever emit `stored` with a full one or nothing at all,
     * and every test on each side passed.
     */
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: siteReader({
          [OWN]: {
            kind: "ok",
            url: OWN,
            body: `<!doctype html><html lang="en"><head><title>Example</title></head>
              <body><h1>Example</h1><p>The plan costs 19 dollars a month.</p></body></html>`,
            contentType: "text/html; charset=utf-8",
            observedAt: NOW.toISOString(),
          },
        }) as never,
        recordObservation: recordObservation as never,
      }),
    );
    await executor.start(operation(), context);
    const appended = recordObservation.mock.calls[0]?.[0];
    if (appended.status.kind !== "ok") throw new Error("expected an observed page");
    const credited = creditGeoKnowledgeObservedStructure({
      kind: "own_page",
      url: OWN,
      observedAt: NOW.toISOString(),
      status: appended.status,
    } as never);
    expect(credited?.jsonLdTypes).toEqual({ kind: "stored", values: [] });
    expect(credited?.hreflangLocales).toEqual({ kind: "stored", values: [] });
  });

  it("trims a page's structure to the column's budget instead of being refused", async () => {
    // Every FAQ pair the parser will hand over, each as long as it allows. The
    // column is checked at 64 KiB and an oversized row comes back `invalid`,
    // which this executor reports as PERMANENT failure -- for a fetch already
    // paid for. Trimming understates; being refused loses the page.
    // Under the parser's own 64 KiB ceiling on one JSON-LD script -- a bigger
    // block is skipped entirely and would test nothing -- but over the budget
    // once bounded and stored.
    const answer = "a".repeat(1_150);
    const question = `${"q".repeat(640)}?`;
    const huge = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(
      {
        "@type": "FAQPage",
        mainEntity: Array.from({ length: 30 }, (_value, index) => ({
          "@type": "Question",
          name: `${index} ${question}`,
          acceptedAnswer: { "@type": "Answer", text: `${index} ${answer}` },
        })),
      },
    )}</script></head><body><h1>Example</h1><p>A quotable line.</p></body></html>`;
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        createReader: siteReader({
          [OWN]: {
            kind: "ok",
            url: OWN,
            body: huge,
            contentType: "text/html",
            observedAt: NOW.toISOString(),
          },
        }) as never,
        recordObservation: recordObservation as never,
      }),
    );
    await expect(executor.start(operation(), context)).resolves.toMatchObject({
      kind: "succeeded",
    });
    const appended = recordObservation.mock.calls[0]?.[0];
    if (appended.status.kind !== "ok") throw new Error("expected an observed page");
    const pairs = appended.status.structured.faqPairs ?? [];
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.length).toBeLessThan(30);
    expect(geoV2JsonbBytes(appended.status.structured)).toBeLessThanOrEqual(65_536);
  });

  it("stores no page structure for a competitor", async () => {
    const recordObservation = vi.fn(sources().recordObservation);
    const { executor } = createGeoRunCollectRuntime(
      sources({
        readDetails: async () =>
          draft(
            v2Payload([{ domain: "rival.com", brandName: "Rival", confirmed: true }]),
          ),
        createReader: siteReader({
          "https://rival.com/": {
            kind: "ok",
            url: "https://rival.com/",
            body: PAGE,
            contentType: "text/html",
            observedAt: NOW.toISOString(),
          },
        }) as never,
        recordObservation: recordObservation as never,
      }),
    );
    await executor.start(
      operation({ key: "fetch:competitor:https://rival.com/" }),
      context,
    );
    const appended = recordObservation.mock.calls[0]?.[0];
    expect(appended.kind).toBe("competitor_page");
    if (appended.status.kind !== "ok") throw new Error("expected an observed page");
    // Empty object, not `{jsonLdTypes: [], hreflangLocales: []}`. Nobody parsed
    // this rival's page for structure, and an empty list would say we did and
    // found none. This is the other half of the three-state rule the own-page
    // test above pins.
    expect(appended.status.structured).toEqual({});
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
