import { describe, expect, it, vi } from "vitest";
import * as sourceModule from "../index.ts";
import {
  SourceError,
  type CollectionContext,
  type CollectionResult,
  type NormalizedObservation,
  type NormalizeContext,
} from "../adapter.ts";

const collectionContext: CollectionContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  runId: "r",
};

const normalizeContext: NormalizeContext = {
  workspaceId: "w",
  projectId: "p",
  siteId: "s",
  capturedAt: "2026-08-06T01:00:00.000Z",
};

interface BacklinksScopeInput {
  readonly target: unknown;
  readonly maxBacklinks: unknown;
  readonly maxReferringDomains: unknown;
  readonly maxBacklinkPages: unknown;
  readonly maxSourceVerifications: unknown;
}

interface BacklinksScope {
  readonly schemaVersion: "dataforseo.backlinks-scope.v1";
  readonly queryKind: "backlinks";
  readonly target: string;
  readonly includeSubdomains: true;
  readonly indirectLinksPolicy: {
    readonly summary: "included";
    readonly backlinks: "not_configurable";
    readonly referringDomains: "included";
    readonly domainPages: "not_configurable";
  };
  readonly excludeInternalBacklinks: true;
  readonly backlinksStatusType: "live";
  readonly rankScale: "one_hundred";
  readonly maxBacklinks: number;
  readonly maxReferringDomains: number;
  readonly maxBacklinkPages: number;
  readonly maxSourceVerifications: number;
}

interface VerificationResult {
  readonly status: "verified" | "absent" | "blocked" | "inconclusive";
  readonly checkedAt: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly anchorText: string | null;
  readonly rel: string | null;
  readonly limitation: string | null;
}

interface BacklinksRaw {
  readonly [key: string]: unknown;
}

interface BacklinksAdapter {
  collect(
    scope: BacklinksScope,
    context: CollectionContext,
  ): Promise<CollectionResult<BacklinksRaw>>;
  normalize(
    raw: BacklinksRaw,
    context: NormalizeContext,
  ): AsyncIterable<NormalizedObservation>;
}

interface BacklinksModuleApi {
  readonly createDataForSeoBacklinksScope: (
    input: BacklinksScopeInput,
  ) => BacklinksScope;
  readonly parseDataForSeoBacklinksScope: (value: unknown) => BacklinksScope;
  readonly createDataForSeoBacklinksAdapter: (
    client: FixtureBacklinksClient,
    options?: {
      readonly now?: () => Date;
      readonly sourcePageVerifier?: (
        input: { readonly sourceUrl: string; readonly targetUrl: string },
        signal?: AbortSignal,
      ) => Promise<VerificationResult>;
    },
  ) => BacklinksAdapter;
  readonly DATAFORSEO_BACKLINKS_DATASET_KEY: string;
  readonly DATAFORSEO_BACKLINKS_METHOD_VERSION: string;
  readonly DATAFORSEO_BACKLINKS_OPERATION: string;
  readonly METRIC_DATAFORSEO_BACKLINK_SUMMARY: string;
  readonly METRIC_DATAFORSEO_BACKLINK: string;
  readonly METRIC_DATAFORSEO_REFERRING_DOMAIN: string;
  readonly METRIC_DATAFORSEO_BACKLINK_PAGE: string;
}

function requireBacklinksModule(): BacklinksModuleApi {
  const candidate = sourceModule as unknown as Partial<BacklinksModuleApi>;
  expect(typeof candidate.createDataForSeoBacklinksScope).toBe("function");
  expect(typeof candidate.parseDataForSeoBacklinksScope).toBe("function");
  expect(typeof candidate.createDataForSeoBacklinksAdapter).toBe("function");
  expect(candidate.DATAFORSEO_BACKLINKS_DATASET_KEY).toBe(
    "dataforseo.backlinks.v1",
  );
  expect(candidate.DATAFORSEO_BACKLINKS_METHOD_VERSION).toBe(
    "dataforseo.backlinks.v1",
  );
  expect(candidate.DATAFORSEO_BACKLINKS_OPERATION).toBe("backlinks");
  expect(candidate.METRIC_DATAFORSEO_BACKLINK_SUMMARY).toBe(
    "dataforseo.backlink_summary.v1",
  );
  expect(candidate.METRIC_DATAFORSEO_BACKLINK).toBe(
    "dataforseo.backlink.v1",
  );
  expect(candidate.METRIC_DATAFORSEO_REFERRING_DOMAIN).toBe(
    "dataforseo.referring_domain.v1",
  );
  expect(candidate.METRIC_DATAFORSEO_BACKLINK_PAGE).toBe(
    "dataforseo.backlink_page.v1",
  );
  return candidate as BacklinksModuleApi;
}

function summaryResponse() {
  return {
    summary: {
      target: "example.com",
      firstSeen: "2024-01-02 03:04:05 +00:00",
      lostDate: null,
      rank: 74,
      backlinks: 12,
      referringDomains: 5,
      referringMainDomains: 4,
    },
    costUsd: 0.02,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

function backlinksResponse() {
  return {
    rows: [
      {
        sourceDomain: "referrer.test",
        sourceUrl: "https://referrer.test/post?utm_source=fixture",
        targetDomain: "example.com",
        targetUrl: "https://example.com/guide?utm_campaign=fixture",
        isNew: true,
        isLost: false,
        spamScore: 2,
        rank: 66,
        pageRank: 61,
        domainRank: 63,
        sourceStatusCode: 200,
        firstSeen: "2026-07-01 00:00:00 +00:00",
        previousSeen: "2026-07-30 00:00:00 +00:00",
        lastSeen: "2026-08-05 00:00:00 +00:00",
        attributes: ["nofollow"],
        dofollow: false,
        anchor: "GenGrowth guide",
        linksCount: 1,
        isBroken: false,
        targetStatusCode: 200,
      },
    ],
    totalCount: 12,
    itemsCount: 1,
    costUsd: 0.03,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

function referringDomainsResponse() {
  return {
    rows: [
      {
        domain: "referrer.test",
        rank: 63,
        backlinks: 3,
        firstSeen: "2026-07-01 00:00:00 +00:00",
        lostDate: null,
        spamScore: 2,
      },
    ],
    totalCount: 5,
    itemsCount: 1,
    costUsd: 0.04,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

function domainPagesResponse() {
  return {
    rows: [
      {
        pageUrl: "https://example.com/guide?utm_campaign=fixture",
        title: "Example guide",
        statusCode: 200,
        rank: 55,
        backlinks: 7,
        referringDomains: 3,
      },
    ],
    totalCount: 8,
    itemsCount: 1,
    costUsd: 0.05,
    providerStatusCode: 20_000,
    taskStatusCode: 20_000,
  };
}

class FixtureBacklinksClient {
  /** Deliberately enumerable: snapshot raw data still must never copy it. */
  readonly credentials = {
    login: "fixture-login",
    password: "fixture-password",
  };
  readonly summaryRequests: unknown[] = [];
  readonly backlinkRequests: unknown[] = [];
  readonly referringDomainRequests: unknown[] = [];
  readonly pageRequests: unknown[] = [];

  constructor(
    private readonly summaryResult:
      | ReturnType<typeof summaryResponse>
      | Error = summaryResponse(),
  ) {}

  backlinkSummary(request: unknown) {
    this.summaryRequests.push(request);
    return this.summaryResult instanceof Error
      ? Promise.reject(this.summaryResult)
      : Promise.resolve(this.summaryResult);
  }

  backlinks(request: unknown) {
    this.backlinkRequests.push(request);
    return Promise.resolve(backlinksResponse());
  }

  referringDomains(request: unknown) {
    this.referringDomainRequests.push(request);
    return Promise.resolve(referringDomainsResponse());
  }

  domainPages(request: unknown) {
    this.pageRequests.push(request);
    return Promise.resolve(domainPagesResponse());
  }
}

class CappedFixtureBacklinksClient extends FixtureBacklinksClient {
  override backlinkSummary(request: unknown) {
    this.summaryRequests.push(request);
    const response = summaryResponse();
    return Promise.resolve({
      ...response,
      summary: {
        ...response.summary,
        backlinks: 2_500,
        referringDomains: 1_500,
      },
    });
  }

  override backlinks(request: unknown) {
    this.backlinkRequests.push(request);
    return Promise.resolve({ ...backlinksResponse(), totalCount: 2_500 });
  }

  override referringDomains(request: unknown) {
    this.referringDomainRequests.push(request);
    return Promise.resolve({
      ...referringDomainsResponse(),
      totalCount: 1_500,
    });
  }

  override domainPages(request: unknown) {
    this.pageRequests.push(request);
    return Promise.resolve({ ...domainPagesResponse(), totalCount: 1_200 });
  }
}

class SharedSourceBacklinksClient extends FixtureBacklinksClient {
  override backlinks(request: unknown) {
    this.backlinkRequests.push(request);
    const response = backlinksResponse();
    const first = response.rows[0]!;
    return Promise.resolve({
      ...response,
      rows: [
        first,
        {
          ...first,
          targetUrl: "https://example.com/pricing",
          domainRank: first.domainRank - 1,
          pageRank: first.pageRank - 1,
          anchor: "GenGrowth pricing",
        },
      ],
      totalCount: 2,
      itemsCount: 2,
    });
  }
}

class CanonicalTargetCollisionBacklinksClient extends FixtureBacklinksClient {
  override backlinks(request: unknown) {
    this.backlinkRequests.push(request);
    const response = backlinksResponse();
    const first = response.rows[0]!;
    return Promise.resolve({
      ...response,
      rows: [
        first,
        {
          ...first,
          targetUrl: "https://example.com/guide?utm_campaign=alternate",
          anchor: "Alternate canonical link",
        },
      ],
      totalCount: 2,
      itemsCount: 2,
    });
  }
}

class InvalidTimestampBacklinksClient extends FixtureBacklinksClient {
  constructor(private readonly invalidTimestamp: string) {
    super();
  }

  override backlinks(request: unknown) {
    this.backlinkRequests.push(request);
    const response = backlinksResponse();
    return Promise.resolve({
      ...response,
      rows: response.rows.map((row) => ({
        ...row,
        firstSeen: this.invalidTimestamp,
      })),
    });
  }
}

function createScope(api: BacklinksModuleApi): BacklinksScope {
  return api.createDataForSeoBacklinksScope({
    target: "https://www.example.com/pricing?utm_source=fixture",
    maxBacklinks: 500,
    maxReferringDomains: 100,
    maxBacklinkPages: 500,
    maxSourceVerifications: 20,
  });
}

async function observationsFor(
  adapter: BacklinksAdapter,
  raw: BacklinksRaw,
): Promise<NormalizedObservation[]> {
  const observations: NormalizedObservation[] = [];
  for await (const observation of adapter.normalize(raw, normalizeContext)) {
    observations.push(observation);
  }
  return observations;
}

describe("DataForSEO Backlinks adapter", () => {
  it("freezes a credential-free, one_hundred/live scope with bounded row and verification caps", async () => {
    const api = await requireBacklinksModule();

    const scope = createScope(api);

    expect(scope).toEqual({
      schemaVersion: "dataforseo.backlinks-scope.v1",
      queryKind: "backlinks",
      target: "example.com",
      includeSubdomains: true,
      indirectLinksPolicy: {
        summary: "included",
        backlinks: "not_configurable",
        referringDomains: "included",
        domainPages: "not_configurable",
      },
      excludeInternalBacklinks: true,
      backlinksStatusType: "live",
      rankScale: "one_hundred",
      maxBacklinks: 500,
      maxReferringDomains: 100,
      maxBacklinkPages: 500,
      maxSourceVerifications: 20,
    });
    expect(api.parseDataForSeoBacklinksScope(scope)).toEqual(scope);
    expect(() =>
      api.createDataForSeoBacklinksScope({
        target: "example.com",
        maxBacklinks: 1_001,
        maxReferringDomains: 100,
        maxBacklinkPages: 500,
        maxSourceVerifications: 20,
      }),
    ).toThrowError(SourceError);
    expect(() =>
      api.createDataForSeoBacklinksScope({
        target: "example.com",
        maxBacklinks: 500,
        maxReferringDomains: 100,
        maxBacklinkPages: 500,
        maxSourceVerifications: 21,
      }),
    ).toThrowError(SourceError);
    expect(JSON.stringify(scope)).not.toContain("fixture-password");
    expect(JSON.stringify(scope)).not.toContain("Authorization");
  });

  it("fails closed unless the frozen indirect-link policy is endpoint-exact", async () => {
    const api = await requireBacklinksModule();
    const scope = createScope(api);

    for (const invalidScope of [
      {
        ...scope,
        indirectLinksPolicy: {
          ...scope.indirectLinksPolicy,
          summary: "not_configurable",
        },
      },
      {
        ...scope,
        indirectLinksPolicy: {
          summary: "included",
          backlinks: "not_configurable",
          referringDomains: "included",
        },
      },
      {
        ...scope,
        indirectLinksPolicy: {
          ...scope.indirectLinksPolicy,
          unknownEndpoint: "included",
        },
      },
      Object.fromEntries(
        Object.entries(scope).map(([key, value]) =>
          key === "indirectLinksPolicy"
            ? ["includeIndirectLinks", true]
            : [key, value],
        ),
      ),
    ]) {
      expect(() => api.parseDataForSeoBacklinksScope(invalidScope)).toThrowError(
        expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
      );
    }
  });

  it("collects the four required provider datasets and emits canonical vendor observations", async () => {
    const api = await requireBacklinksModule();
    const client = new FixtureBacklinksClient();
    const verifier = vi.fn(
      async (): Promise<VerificationResult> => ({
        status: "verified",
        checkedAt: "2026-08-06T00:59:00.000Z",
        finalUrl: "https://referrer.test/post?utm_source=fixture",
        httpStatus: 200,
        anchorText: "GenGrowth guide",
        rel: "nofollow",
        limitation: null,
      }),
    );
    const adapter = api.createDataForSeoBacklinksAdapter(client, {
      now: () => new Date("2026-08-06T01:00:00.000Z"),
      sourcePageVerifier: verifier,
    });

    const result = await adapter.collect(createScope(api), collectionContext);
    const observations = await observationsFor(adapter, result.raw);

    expect(client.summaryRequests).toEqual([{ target: "example.com" }]);
    expect(client.backlinkRequests).toEqual([
      { target: "example.com", limit: 500 },
    ]);
    expect(client.referringDomainRequests).toEqual([
      { target: "example.com", limit: 100 },
    ]);
    expect(client.pageRequests).toEqual([
      { target: "example.com", limit: 500 },
    ]);
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledWith(
      {
        sourceUrl: "https://referrer.test/post?utm_source=fixture",
        targetUrl: "https://example.com/guide?utm_campaign=fixture",
      },
      undefined,
    );
    expect(result).toMatchObject({
      availability: "available",
      capturedAt: "2026-08-06T01:00:00.000Z",
      rowCount: 4,
      stopReason: null,
      providerUsage: {
        apiCalls: 4,
        rowsReturned: 4,
        rowsRetained: 4,
        sourcePagesVerified: 1,
        costUsd: 0.14,
      },
    });
    expect(JSON.stringify(result.raw)).not.toContain("fixture-password");
    expect(JSON.stringify(result.raw)).not.toContain("fixture-login");
    expect(JSON.stringify(result.raw)).not.toContain("Authorization");

    expect(observations).toHaveLength(4);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: api.METRIC_DATAFORSEO_BACKLINK_SUMMARY,
          subjectType: "site",
          subjectRef: "example.com",
          observedAt: "2026-08-06T01:00:00.000Z",
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            targetDomain: "example.com",
            rank: 74,
            backlinks: 12,
            referringDomains: 5,
          },
          origin: "vendor_observation",
          grade: "B",
        }),
        expect.objectContaining({
          metricKey: api.METRIC_DATAFORSEO_BACKLINK,
          subjectType: "url",
          subjectRef: "https://example.com/guide",
          availability: "available",
          valueNumeric: null,
          valueText: null,
          valueJson: {
            sourceRef: expect.any(String),
            referringDomain: "referrer.test",
            sourceUrl: "https://referrer.test/post?utm_source=fixture",
            targetUrl: "https://example.com/guide",
            sourceRank: 63,
            linkKind: "nofollow",
            anchorText: "GenGrowth guide",
            firstSeenAt: "2026-07-01 00:00:00+00:00",
            lastSeenAt: "2026-08-05 00:00:00+00:00",
            isNew: true,
            isLost: false,
            verification: {
              status: "verified",
              checkedAt: "2026-08-06T00:59:00.000Z",
              finalUrl: "https://referrer.test/post?utm_source=fixture",
              httpStatus: 200,
              anchorText: "GenGrowth guide",
              rel: "nofollow",
              limitation: null,
            },
          },
          origin: "vendor_observation",
          grade: "B",
        }),
        expect.objectContaining({
          metricKey: api.METRIC_DATAFORSEO_REFERRING_DOMAIN,
          subjectType: "site",
          subjectRef: "referrer.test",
          availability: "available",
          valueJson: {
            targetDomain: "example.com",
            referringDomain: "referrer.test",
            rank: 63,
            backlinks: 3,
          },
          origin: "vendor_observation",
          grade: "B",
        }),
        expect.objectContaining({
          metricKey: api.METRIC_DATAFORSEO_BACKLINK_PAGE,
          subjectType: "url",
          subjectRef: "https://example.com/guide",
          availability: "available",
          valueJson: {
            sourceRef: expect.any(String),
            targetUrl: "https://example.com/guide",
            title: "Example guide",
            backlinks: 7,
            referringDomains: 3,
          },
          origin: "vendor_observation",
          grade: "B",
        }),
      ]),
    );
  });

  it("does not copy one exact target verification to other facts from the same source page", async () => {
    const api = await requireBacklinksModule();
    const verifier = vi.fn(
      async (): Promise<VerificationResult> => ({
        status: "verified",
        checkedAt: "2026-08-06T00:59:00.000Z",
        finalUrl: "https://referrer.test/post?utm_source=fixture",
        httpStatus: 200,
        anchorText: "GenGrowth guide",
        rel: "nofollow",
        limitation: null,
      }),
    );
    const adapter = api.createDataForSeoBacklinksAdapter(
      new SharedSourceBacklinksClient(),
      {
        now: () => new Date("2026-08-06T01:00:00.000Z"),
        sourcePageVerifier: verifier,
      },
    );

    const result = await adapter.collect(createScope(api), collectionContext);
    const backlinks = (await observationsFor(adapter, result.raw)).filter(
      (observation) =>
        observation.metricKey === api.METRIC_DATAFORSEO_BACKLINK,
    );

    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledWith(
      {
        sourceUrl: "https://referrer.test/post?utm_source=fixture",
        targetUrl: "https://example.com/guide?utm_campaign=fixture",
      },
      undefined,
    );
    expect(backlinks).toHaveLength(2);
    expect(backlinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectRef: "https://example.com/guide",
          valueJson: expect.objectContaining({
            verification: expect.objectContaining({ status: "verified" }),
          }),
        }),
        expect.objectContaining({
          subjectRef: "https://example.com/pricing",
          valueJson: expect.objectContaining({ verification: null }),
        }),
      ]),
    );
  });

  it("keeps distinct provider link identities when raw targets share one canonical subject", async () => {
    const api = await requireBacklinksModule();
    const adapter = api.createDataForSeoBacklinksAdapter(
      new CanonicalTargetCollisionBacklinksClient(),
      {
        now: () => new Date("2026-08-06T01:00:00.000Z"),
        sourcePageVerifier: async () => ({
          status: "inconclusive",
          checkedAt: "2026-08-06T00:59:00.000Z",
          finalUrl: null,
          httpStatus: null,
          anchorText: null,
          rel: null,
          limitation: "Fixture verification was not attempted.",
        }),
      },
    );

    const result = await adapter.collect(createScope(api), collectionContext);
    const backlinks = (await observationsFor(adapter, result.raw)).filter(
      (observation) =>
        observation.metricKey === api.METRIC_DATAFORSEO_BACKLINK,
    );

    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((backlink) => backlink.subjectRef)).toEqual([
      "https://example.com/guide",
      "https://example.com/guide",
    ]);
    expect(
      new Set(
        backlinks.map(
          (backlink) =>
            (backlink.valueJson as { readonly sourceRef: string }).sourceRef,
        ),
      ).size,
    ).toBe(2);
  });

  it.each([
    "2026-13-01 00:00:00 +00:00",
    "9999-12-31 23:30:00 -14:00",
  ])(
    "rejects malformed provider backlink timestamp %s during normalization",
    async (invalidTimestamp) => {
      const api = await requireBacklinksModule();
      const adapter = api.createDataForSeoBacklinksAdapter(
        new InvalidTimestampBacklinksClient(invalidTimestamp),
        {
          now: () => new Date("2026-08-06T01:00:00.000Z"),
          sourcePageVerifier: async () => ({
            status: "inconclusive",
            checkedAt: "2026-08-06T00:59:00.000Z",
            finalUrl: null,
            httpStatus: null,
            anchorText: null,
            rel: null,
            limitation: "Fixture verification was not attempted.",
          }),
        },
      );

      const result = await adapter.collect(
        createScope(api),
        collectionContext,
      );
      const error = await observationsFor(adapter, result.raw).catch(
        (value: unknown) => value,
      );

      expect(error).toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );

  it("keeps an inconclusive source-page check from downgrading provider availability", async () => {
    const api = await requireBacklinksModule();
    const adapter = api.createDataForSeoBacklinksAdapter(
      new FixtureBacklinksClient(),
      {
        now: () => new Date("2026-08-06T01:00:00.000Z"),
        sourcePageVerifier: async () => ({
          status: "inconclusive",
          checkedAt: "2026-08-06T00:59:00.000Z",
          finalUrl: null,
          httpStatus: null,
          anchorText: null,
          rel: null,
          limitation: "Source page timed out; provider fact remains available.",
        }),
      },
    );

    const result = await adapter.collect(createScope(api), collectionContext);
    const observations = await observationsFor(adapter, result.raw);
    const backlink = observations.find(
      (observation) =>
        observation.metricKey === api.METRIC_DATAFORSEO_BACKLINK,
    );

    expect(result.availability).toBe("available");
    expect(backlink).toMatchObject({
      availability: "available",
      valueJson: {
        verification: {
          status: "inconclusive",
          httpStatus: null,
        },
      },
    });
  });

  it("keeps complete summary facts available while disclosing capped detail samples", async () => {
    const api = await requireBacklinksModule();
    const adapter = api.createDataForSeoBacklinksAdapter(
      new CappedFixtureBacklinksClient(),
      {
        now: () => new Date("2026-08-06T01:00:00.000Z"),
        sourcePageVerifier: async () => ({
          status: "inconclusive",
          checkedAt: "2026-08-06T00:59:00.000Z",
          finalUrl: null,
          httpStatus: null,
          anchorText: null,
          rel: null,
          limitation: "Fixture verification was not attempted.",
        }),
      },
    );

    const result = await adapter.collect(createScope(api), collectionContext);
    const observations = await observationsFor(adapter, result.raw);
    const summary = observations.find(
      (observation) =>
        observation.metricKey === api.METRIC_DATAFORSEO_BACKLINK_SUMMARY,
    );

    expect(result.availability).toBe("available");
    expect(result.raw.availability).toBe("available");
    expect(result.stopReason).toBe("DATAFORSEO_BACKLINKS_ROW_CAP_REACHED");
    expect(result.limitation).toContain(
      "Summary and referring-domain aggregates include indirect links",
    );
    expect(result.limitation).toContain(
      "backlink and target-page detail endpoints do not provide an indirect-link selector",
    );
    expect(result.limitation).toContain(
      "backlinks 2500/500, referring domains 1500/100, backlink pages 1200/500",
    );
    expect(result.providerUsage).toMatchObject({
      apiCalls: 4,
      rowsReturned: 4,
      rowsRetained: 4,
      backlinksTotalCount: 2_500,
      referringDomainsTotalCount: 1_500,
      backlinkPagesTotalCount: 1_200,
      rowCapsReached: 3,
    });
    expect(summary).toMatchObject({
      availability: "available",
      valueJson: {
        targetDomain: "example.com",
        backlinks: 2_500,
        referringDomains: 1_500,
      },
    });
  });

  it("propagates a required provider failure instead of fabricating an available zero snapshot", async () => {
    const api = await requireBacklinksModule();
    const providerError = new SourceError(
      "UNAVAILABLE",
      "DataForSEO backlinks summary was unavailable.",
    );
    const adapter = api.createDataForSeoBacklinksAdapter(
      new FixtureBacklinksClient(providerError),
    );

    const error = await adapter
      .collect(createScope(api), collectionContext)
      .catch((value: unknown) => value);

    expect(error).toBe(providerError);
    expect(error).toMatchObject({ code: "UNAVAILABLE" });
  });
});
