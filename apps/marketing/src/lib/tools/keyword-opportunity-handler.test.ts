import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  KeywordCoverageRead,
  KeywordOpportunityProviderRow,
} from "@sf/public-tools";
import { SourceError, type DomainRegistrationEvidence } from "@sf/sources";
import { open, seal } from "../auth/sealed-cookie.ts";
import { openCrawlGate, type CrawlGateDependencies } from "./crawl-gate.ts";
import { createKeywordCostAccumulator } from "./keyword-cost-guard.ts";
import { KeywordLlmError } from "./keyword-llm-client.ts";
import type { KeywordSerpInterpretationInput } from "./keyword-prompts.ts";
import {
  acquirePublicCrawlSlot,
  resetPublicToolSlots,
} from "./public-tool-request.ts";
import { crawlTargetBucket } from "./shared-rate-limit.ts";
import {
  handleKeywordContextRequest,
  handleKeywordOpportunitiesRequest,
  KEYWORD_CANDIDATE_CAP,
  KEYWORD_CONTEXT_TTL_SECONDS,
  OPPORTUNITIES_BODY_LIMIT_BYTES,
  trimKeywordContextHeadings,
  type KeywordCandidateDraft,
  type KeywordContextToken,
  type KeywordOpportunityDependencies,
  type KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";

// 32 bytes of hex, the shape of the deployed key. Set at module scope because
// the sealed fixtures below are built while this file is evaluated. No network
// and no real key material: the root secret only has to be deterministic for a
// seal/open round trip to mean anything.
process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

const SUB = "108124453711223344556";
const SITE_URL = "https://acme.example/";
const COMPLETED_AT = "2026-08-10T12:00:00.000Z";

/**
 * Titles chosen to share no token with any candidate keyword below.
 *
 * Coverage falls back to title overlap, so a page called "Dental Billing" would
 * silently mark the matching candidate as related-covered and pull it out of
 * the SERP sample — a case that reads as a broken cap rather than as coverage.
 */
const PAGES = [
  { url: "https://acme.example/", title: "Overview", headings: [] },
  { url: "https://acme.example/pricing", title: "Pricing", headings: [] },
  { url: "https://acme.example/docs", title: "Docs", headings: [] },
] as const;

const CRAWL = {
  pages: PAGES.map((page, index) => ({
    ...page,
    text: "",
    score: 10 - index,
  })),
  pagesFetched: 3,
  productPagesFetched: 1,
  selection: {
    eligibleCandidates: 28,
    excludedCandidates: 8,
    attemptedCandidates: 23,
    truncatedCandidates: 5,
  },
  stopReason: "budget_reached",
};

const PROPOSITIONS = [
  {
    statement: "Same-day insurance claim submission",
    sourceUrl: "https://acme.example/",
  },
  {
    statement: "Runs on a single clinic laptop",
    sourceUrl: "https://acme.example/docs",
  },
] as const;

function draft(
  keyword: string,
  overrides: Partial<KeywordCandidateDraft> = {},
): KeywordCandidateDraft {
  return {
    keyword,
    discoveryBasis: "traditional_expansion",
    questionForm: false,
    propositionIndex: null,
    ...overrides,
  };
}

/**
 * Six candidates, all of which survive every default stage.
 *
 * Six and not three: the report reports `insufficient_evidence` below five
 * shown rows, so a smaller default would make every degradation case pass for
 * the wrong reason.
 */
const DRAFTS: readonly KeywordCandidateDraft[] = [
  draft("dental billing software"),
  draft("clinic scheduling tool", {
    discoveryBasis: "site_proposition",
    propositionIndex: 0,
  }),
  draft("patient intake forms"),
  draft("insurance claim tracking"),
  draft("appointment reminder texts"),
  draft("treatment plan templates", {
    discoveryBasis: "site_proposition",
    propositionIndex: 1,
  }),
];

const TOKEN: KeywordContextToken = {
  siteUrl: SITE_URL,
  marketCode: "GB",
  languageCode: "en",
  propositions: PROPOSITIONS,
  pages: PAGES,
  pagesFetched: 3,
  productPagesFetched: 1,
  selection: CRAWL.selection,
  stopReason: "budget_reached",
  seeds: [],
  sub: SUB,
};

const COMPLETE_SITEMAP_INVENTORY = {
  urls: [
    "https://acme.example/",
    "https://acme.example/pricing",
    "https://acme.example/docs",
  ],
  fetched: true,
  complete: true,
  documentsRead: 1,
  truncationReasons: [],
} as const;

function contextToken(overrides: Partial<KeywordContextToken> = {}): string {
  return seal(
    "gg_kw_context",
    { ...TOKEN, ...overrides },
    KEYWORD_CONTEXT_TTL_SECONDS,
  );
}

function rows(keywords: readonly string[]): KeywordOpportunityProviderRow[] {
  return keywords.map((keyword) => ({
    keyword,
    volume: 320,
    difficulty: 12,
    intent: "informational",
    serpFeatures: [],
  }));
}

function completeSample(
  keyword: string,
  domain = "small-blog.com",
): KeywordSerpSampleResult {
  return {
    keyword,
    status: "complete",
    failureReason: null,
    observedAt: COMPLETED_AT,
    results: [
      {
        domain,
        position: 3,
        title: "A useful answer",
        url: `https://${domain}/answer`,
      },
    ],
    pageItemTypes: [],
    aiOverview: null,
    communityItems: [],
  };
}

function availableRegistration(domain: string): DomainRegistrationEvidence {
  return {
    domain,
    availability: "available",
    registeredAt: "2026-01-01T00:00:00.000Z",
    observedAt: COMPLETED_AT,
    sourceHost: "rdap.example",
    reason: null,
  };
}

function cleanCoverageRead(
  queryRows: KeywordCoverageRead["queryRows"] = [],
  queryPageRows: KeywordCoverageRead["queryPageRows"] = [],
): KeywordCoverageRead {
  return {
    queryRows,
    queryPageRows,
    queryPaging: { pagesFetched: 1, truncated: false },
    queryPagePaging: { pagesFetched: 1, truncated: false },
  };
}

/**
 * Every seam in its "everything worked" state.
 *
 * A case overrides exactly the one seam whose behaviour it is about, so a
 * failure names that seam rather than a fixture two levels away.
 */
function deps(
  overrides: Partial<KeywordOpportunityDependencies> = {},
): KeywordOpportunityDependencies {
  return {
    resolveGrant: () =>
      Promise.resolve({
        kind: "grant",
        accessToken: "ya29.test",
        properties: [SITE_URL],
        propertyTotal: 1,
      }),
    costs: createKeywordCostAccumulator(),
    readIdentity: () => Promise.resolve({ sub: SUB }),
    openCrawlGate: () =>
      Promise.resolve({ ok: true, kind: "crawl", release: () => {} }),
    openGscGate: () => Promise.resolve({ ok: true, release: () => {} }),
    crawlContext: () => Promise.resolve(CRAWL),
    extractPropositions: () => Promise.resolve(PROPOSITIONS),
    expandCandidates: () => Promise.resolve(DRAFTS),
    validateVolumes: ({ keywords }) => Promise.resolve(rows(keywords)),
    sampleSerp: ({ keywords }) =>
      Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    // 40 is below the weak-domain ceiling, so the default page one reads as
    // one a new site has already been let into.
    resolveDomainRanks: (domains) =>
      Promise.resolve(
        new Map<string, number>(domains.map((domain) => [domain, 40] as const)),
      ),
    resolveDomainTraffic: ({ domains }) =>
      Promise.resolve(
        new Map<string, number | null>(
          domains.map((domain) => [domain, 100] as const),
        ),
      ),
    resolveDomainRegistrations: (domains) =>
      Promise.resolve(
        new Map(
          domains.map(
            (domain) => [domain, availableRegistration(domain)] as const,
          ),
        ),
      ),
    readCoverageQueries: () => Promise.resolve(cleanCoverageRead()),
    now: () => new Date(COMPLETED_AT),
    extractClientIp: () => "203.0.113.9",
    ...overrides,
  };
}

function request(body: unknown, stage = "context"): Request {
  return new Request(
    `https://gengrowth.ai/api/tools/hidden-keywords/${stage}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const CONTEXT_BODY = {
  siteUrl: SITE_URL,
  marketCode: "GB",
  languageCode: "en",
} as const;

function refusal(status: number): Response {
  return Response.json({ error: { code: "rate_limited" } }, { status });
}

interface ErrorBody {
  readonly error: { readonly code: string };
}

interface ContextBody {
  readonly data: {
    readonly propositions: readonly { readonly statement: string }[];
    readonly pagesFetched: number;
    readonly productPagesFetched: number;
    readonly selection: {
      readonly eligibleCandidates: number;
      readonly excludedCandidates: number;
      readonly attemptedCandidates: number;
      readonly truncatedCandidates: number;
    };
    readonly stopReason: string;
    readonly contextSufficient: boolean;
    readonly contextToken: string;
  };
}

interface OpportunitiesBody {
  readonly data: {
    readonly run: Record<string, unknown>;
    readonly result: {
      readonly availability: string;
      readonly unavailableStages: readonly string[];
      readonly rows: readonly {
        readonly keyword: string;
        readonly lane: string;
        readonly coverage: string;
        readonly supportingPageUrl: string | null;
        readonly validation: {
          readonly availability: string;
          readonly providerIntent: string | null;
        };
        readonly serp: {
          readonly verdict: string;
          readonly status: string;
          readonly failureReason: string | null;
          readonly organicResults: readonly {
            readonly domain: string;
            readonly title: string | null;
            readonly url: string | null;
          }[];
        };
        readonly serpIntent: {
          readonly intent: string;
          readonly source: string;
          readonly observedAt: string;
          readonly modelId: string | null;
          readonly promptVersion: string | null;
        } | null;
        readonly signals: {
          readonly youngDomain: { readonly state: string };
          readonly lowOrganicTrafficDomain: { readonly state: string };
          readonly communityResult: { readonly state: string };
        };
        readonly aiOverview: {
          readonly availability: string;
          readonly loadedAsync: boolean | null;
          readonly answerAssessment: string;
          readonly reason: string | null;
          readonly modelId: string | null;
          readonly promptVersion: string | null;
        } | null;
        readonly decision: {
          readonly disposition: string;
          readonly discounts: readonly string[];
        };
      }[];
      readonly withheld: readonly {
        readonly keyword: string;
        readonly reason: string;
      }[];
      readonly funnel: Record<string, number>;
      readonly incomplete: readonly {
        readonly keyword: string;
        readonly reason: string;
        readonly serp: {
          readonly status: string;
          readonly failureReason: string | null;
          readonly organicResults: readonly unknown[];
          readonly verdict: string;
        };
        readonly signals: {
          readonly youngDomain: { readonly state: string };
          readonly lowOrganicTrafficDomain: { readonly state: string };
          readonly communityResult: { readonly state: string };
        };
      }[];
    };
  };
}

/** Every line the handler wrote to `console.error` during one case. */
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  // Silenced and captured: the failure reason IS the product on the error
  // paths, so a case can assert on it instead of merely on a call count.
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleKeywordContextRequest", () => {
  it("refuses a visitor who is not signed in before reading anything", async () => {
    const crawlContext = vi.fn();
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ readIdentity: () => Promise.resolve(null), crawlContext }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "authentication_required" },
    });
    // Sign-in is what ties a crawl to somebody; without it the endpoint is an
    // open proxy that fetches any URL a stranger names.
    expect(crawlContext).not.toHaveBeenCalled();
  });

  it("rejects a body larger than the stage's limit instead of parsing it", async () => {
    const crawlContext = vi.fn();
    const response = await handleKeywordContextRequest(
      request({ ...CONTEXT_BODY, filler: "x".repeat(5_000) }),
      deps({ crawlContext }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
    expect(crawlContext).not.toHaveBeenCalled();
  });

  it("rejects a malformed body rather than guessing what was meant", async () => {
    const malformed = new Request(
      "https://gengrowth.ai/api/tools/hidden-keywords/context",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      },
    );

    const broken = await handleKeywordContextRequest(malformed, deps());
    expect(broken.status).toBe(400);
    // The transport-level code, distinct from the field-level one below: a
    // client that sent bytes we cannot parse has a different bug from a client
    // that parsed fine and omitted a field.
    await expect(broken.json()).resolves.toEqual({
      error: { code: "invalid_request" },
    });

    for (const body of [
      {},
      { marketCode: "GB", languageCode: "en" },
      [CONTEXT_BODY],
    ]) {
      const response = await handleKeywordContextRequest(request(body), deps());
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_input" },
      });
    }
  });

  it("refuses a target that is not an http or https URL", async () => {
    const crawlContext = vi.fn();
    for (const siteUrl of [
      "acme.example",
      "ftp://acme.example",
      "javascript:alert(1)",
      "",
      42,
    ]) {
      const response = await handleKeywordContextRequest(
        request({ ...CONTEXT_BODY, siteUrl }),
        deps({ crawlContext }),
      );
      expect(response.status).toBe(400);
    }

    // The guard is what keeps the crawler off file:, ftp: and data: targets,
    // so it has to bite before the crawl seam is reached at all.
    expect(crawlContext).not.toHaveBeenCalled();
  });

  it("refuses to run without a market and a language rather than defaulting them", async () => {
    // Defaulting to US English would attach American volume and an American
    // page one to whichever market the visitor had in mind, and nothing in the
    // response would say so. A 400 is the only honest answer.
    for (const body of [
      { siteUrl: SITE_URL, languageCode: "en" },
      { siteUrl: SITE_URL, marketCode: "GB" },
      { ...CONTEXT_BODY, marketCode: "   " },
      { ...CONTEXT_BODY, languageCode: "" },
      { ...CONTEXT_BODY, marketCode: 826 },
    ]) {
      const response = await handleKeywordContextRequest(request(body), deps());
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_input" },
      });
    }
  });

  it("refuses more seeds than the limit and any seed longer than the limit", async () => {
    const tooMany = await handleKeywordContextRequest(
      request({
        ...CONTEXT_BODY,
        seeds: Array.from({ length: 11 }, (_unused, index) => `seed ${index}`),
      }),
      deps(),
    );
    expect(tooMany.status).toBe(400);

    const tooLong = await handleKeywordContextRequest(
      request({ ...CONTEXT_BODY, seeds: ["s".repeat(81)] }),
      deps(),
    );
    expect(tooLong.status).toBe(400);

    // A non-string in the list is a client bug, not a term to coerce.
    const notStrings = await handleKeywordContextRequest(
      request({ ...CONTEXT_BODY, seeds: [{ term: "crm" }] }),
      deps(),
    );
    expect(notStrings.status).toBe(400);
  });

  it("drops a blank seed instead of failing the whole request over it", async () => {
    // Ten real seeds plus one blank is still ten seeds. A trailing empty input
    // box is the most ordinary thing a form produces; rejecting the run for it
    // would fail the request for a term the visitor never typed.
    const response = await handleKeywordContextRequest(
      request({
        ...CONTEXT_BODY,
        seeds: [
          ...Array.from({ length: 10 }, (_unused, index) => `seed ${index}`),
          "   ",
        ],
      }),
      deps(),
    );

    expect(response.status).toBe(200);
  });

  it("hands back the gate's own refusal without touching the target site", async () => {
    const denial = refusal(429);
    const crawlContext = vi.fn();
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        crawlContext,
        openCrawlGate: () => Promise.resolve({ ok: false, response: denial }),
      }),
    );

    // The same Response object: the gate owns the status, the retry hint and
    // the code, and a handler that re-wraps them loses whichever it forgets.
    expect(response).toBe(denial);
    // The point of the gate is the request to somebody else's server that it
    // prevents, so a refusal that still crawled would be no gate at all.
    expect(crawlContext).not.toHaveBeenCalled();
  });

  /**
   * Runs stage one against the REAL crawl gate, not a stub.
   *
   * The shipped bug this pins: the handler passed the target's hostname where
   * the gate expects the site URL, so the gate's `new URL(...)` threw and every
   * single request was refused with `invalid_url` before any crawl. Every test
   * above injects a stub gate, and a stub accepts whatever it is handed — which
   * is exactly why a suite of 8,972 passing tests said nothing about an
   * endpoint that could not serve one request in production.
   *
   * So this case wires the real gate with an in-memory quota, and asserts on
   * the bucket key it derived: proof that what the handler passes is something
   * the gate can actually parse.
   */
  it("passes the crawl gate a URL it can parse, not a bare hostname", async () => {
    resetPublicToolSlots();
    const buckets: string[] = [];
    const gateDependencies: CrawlGateDependencies = {
      acquireSlot: acquirePublicCrawlSlot,
      quota: {
        callQuota: async (bucketKey) => {
          buckets.push(bucketKey);
          return {
            allowed: true,
            hits: 1,
            reset_at: "2099-01-01T00:00:00.000Z",
          };
        },
      },
    };

    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        openCrawlGate: (clientIp, siteUrl) =>
          openCrawlGate(clientIp, siteUrl, gateDependencies),
      }),
    );

    expect(response.status).toBe(200);
    // The per-target bucket carries the host the gate parsed out for itself.
    // A bare hostname would never have reached this line — the gate would have
    // answered 400 without calling the quota at all.
    expect(buckets).toContain(crawlTargetBucket("acme.example"));
  });

  it("keeps the sealed token inside the limit stage two will accept", async () => {
    // Headings started travelling in the token so the coverage check can see
    // more than a four-word title. Twenty heading-rich pages is a realistic
    // crawl, and an unbounded token would 413 at stage two — breaking the tool
    // for exactly the sites with the most content, and only in production,
    // where real pages have real headings.
    const heavy = {
      ...CRAWL,
      pages: Array.from({ length: 20 }, (_, index) => ({
        url: `https://acme.example/page-${String(index)}`,
        title: `Page ${String(index)}`,
        headings: Array.from(
          { length: 40 },
          (_, n) =>
            `A long section heading about clinic billing workflows number ${String(n)} with padding`,
        ),
        text: "",
        score: 5,
      })),
    };

    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ crawlContext: () => Promise.resolve(heavy) }),
    );
    const parsed = (await response.json()) as {
      readonly data: { readonly contextToken: string };
    };

    const body = JSON.stringify({ contextToken: parsed.data.contextToken });
    expect(new TextEncoder().encode(body).length).toBeLessThan(
      OPPORTUNITIES_BODY_LIMIT_BYTES,
    );
  });

  it("carries the complete bounded sitemap inventory through the sealed token", async () => {
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        crawlContext: () =>
          Promise.resolve({
            ...CRAWL,
            sitemapInventory: COMPLETE_SITEMAP_INVENTORY,
          }),
      }),
    );
    const parsed = (await response.json()) as ContextBody;
    const opened = open<KeywordContextToken>(
      "gg_kw_context",
      parsed.data.contextToken,
    );

    expect(response.status).toBe(200);
    expect(opened?.sitemapInventory).toEqual(COMPLETE_SITEMAP_INVENTORY);
  });

  it("truncates only the deterministic inventory tail when the token budget is reached", async () => {
    const inventoryUrls = Array.from(
      { length: 500 },
      (_unused, index) =>
        `https://acme.example/${"inventory-segment-".repeat(10)}${String(index).padStart(3, "0")}`,
    );
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        crawlContext: () =>
          Promise.resolve({
            ...CRAWL,
            sitemapInventory: {
              urls: inventoryUrls,
              fetched: true,
              complete: true,
              documentsRead: 1,
              truncationReasons: [],
            },
          }),
      }),
    );
    expect(response.status).toBe(200);
    if (!response.ok) return;

    const parsed = (await response.json()) as ContextBody;
    const opened = open<KeywordContextToken>(
      "gg_kw_context",
      parsed.data.contextToken,
    );
    const carried = opened?.sitemapInventory;

    expect(carried).toBeDefined();
    expect(carried?.urls.length).toBeGreaterThan(0);
    expect(carried?.urls.length).toBeLessThan(inventoryUrls.length);
    expect(carried?.urls).toEqual(inventoryUrls.slice(0, carried?.urls.length));
    expect(carried?.complete).toBe(false);
    expect(carried?.truncationReasons).toContain("token_budget");
    expect(
      new TextEncoder().encode(
        JSON.stringify({ contextToken: parsed.data.contextToken }),
      ).length,
    ).toBeLessThan(OPPORTUNITIES_BODY_LIMIT_BYTES);
  });

  it("round-trips 20 long-URL CJK pages through the stage-two body limit", async () => {
    // The budget is spent in bytes because the limit is a byte limit, and one
    // CJK character is three of them. A character budget would let this site
    // spend triple and 413 at stage two. Long but valid URLs prove the token
    // budget covers the complete 20-page context rather than only short slugs.
    const longPath = "safe-segment/".repeat(50);
    const heavy = {
      ...CRAWL,
      pages: Array.from({ length: 20 }, (_, index) => ({
        url: `https://acme.example/${longPath}page-${String(index)}`,
        title: `ページ ${String(index)}`,
        headings: Array.from(
          { length: 40 },
          (_, n) =>
            `診療所の請求ワークフローに関する長い見出し番号${String(n)}`,
        ),
        text: "",
        score: 5,
      })),
    };

    const context = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ crawlContext: () => Promise.resolve(heavy) }),
    );
    expect(context.status).toBe(200);
    if (!context.ok) return;

    const parsed = (await context.json()) as {
      readonly data: {
        readonly contextToken: string;
        readonly headingBudgetBytes: number;
      };
    };

    const body = JSON.stringify({ contextToken: parsed.data.contextToken });
    const bodyBytes = new TextEncoder().encode(body).length;
    expect(OPPORTUNITIES_BODY_LIMIT_BYTES).toBe(22 * 1024);
    expect(bodyBytes).toBeGreaterThan(21 * 1024);
    expect(bodyBytes).toBeLessThan(OPPORTUNITIES_BODY_LIMIT_BYTES);
    expect(parsed.data.headingBudgetBytes).toBe(1_200);

    const opened = open<KeywordContextToken>(
      "gg_kw_context",
      parsed.data.contextToken,
    );
    expect(opened?.pages).toHaveLength(20);
    expect(opened?.pages[0]?.headings?.[0]).toContain("診療所");
    expect(opened?.pages[19]?.url).toBe(heavy.pages[19]?.url);

    const opportunities = await handleKeywordOpportunitiesRequest(
      request({ contextToken: parsed.data.contextToken }, "opportunities"),
      deps(),
    );
    expect(opportunities.status).toBe(200);
  });

  it("carries a real heading through the seal and into stage two's matching", async () => {
    // Both size tests above prove only that the token is small — an
    // implementation that always seals `headings: []` passes them, and that is
    // precisely the regression this feature exists to undo. This one takes the
    // token stage one actually minted, feeds it to stage two, and asserts on a
    // match that is only possible if a heading survived: the page title shares
    // nothing with the candidate.
    const context = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        crawlContext: () =>
          Promise.resolve({
            ...CRAWL,
            pages: [
              {
                url: "https://acme.example/claims",
                title: "Acme",
                headings: ["Insurance claim tracking"],
                text: "",
                score: 9,
              },
            ],
          }),
      }),
    );
    const minted = (await context.json()) as {
      readonly data: { readonly contextToken: string };
    };

    const response = await handleKeywordOpportunitiesRequest(
      request({ contextToken: minted.data.contextToken }, "opportunities"),
      deps(),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    const row = parsed.data.result.rows.find(
      (candidate) => candidate.keyword === "insurance claim tracking",
    );
    expect(row?.supportingPageUrl).toBe("https://acme.example/claims");
  });

  it("refuses rather than handing back a token it has proved stage two will reject", async () => {
    // The ladder bounds headings; propositions and URLs are not bounded here,
    // so its last rung can still be over the limit. Answering 200 with that
    // token is a success the handler already knows is unusable — the surface
    // would post it and get a body-limit rejection that retrying cannot fix.
    const huge = {
      ...CRAWL,
      pages: Array.from({ length: 20 }, (_, index) => ({
        url: `https://acme.example/${"segment/".repeat(120)}${String(index)}`,
        title: "x",
        headings: [],
        text: "",
        score: 5,
      })),
    };

    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ crawlContext: () => Promise.resolve(huge) }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "payload_too_large" },
    });
  });

  it("spends the heading budget on the pages the crawl valued most", async () => {
    // Crawl order is page-value order, so a site that exhausts the budget
    // should lose its tail, not its front page.
    const trimmed = trimKeywordContextHeadings(
      [
        { url: "https://acme.example/", headings: ["alpha", "beta"] },
        { url: "https://acme.example/last", headings: ["gamma"] },
      ],
      9,
    );

    expect(trimmed).toEqual([["alpha", "beta"], []]);
  });

  it("counts a heading budget in bytes rather than characters", async () => {
    // Nine bytes is three CJK characters, so the second heading does not fit
    // even though six characters would suggest it does.
    expect(
      trimKeywordContextHeadings(
        [{ url: "https://acme.example/", headings: ["見出し", "番号一"] }],
        9,
      ),
    ).toEqual([["見出し"]]);
  });

  it("returns the crawl summary sealed to the identity that asked for it", async () => {
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps(),
    );
    const body = (await response.json()) as ContextBody;

    expect(response.status).toBe(200);
    expect(body.data.propositions).toEqual(PROPOSITIONS);
    expect(body.data.pagesFetched).toBe(3);
    expect(body.data.productPagesFetched).toBe(1);
    expect(body.data.selection).toEqual(CRAWL.selection);
    expect(body.data.stopReason).toBe("budget_reached");
    expect(body.data.contextSufficient).toBe(true);

    // Stage two trusts this token for everything it does not re-derive, so the
    // identity has to travel inside the seal rather than beside it.
    const opened = open<KeywordContextToken>(
      "gg_kw_context",
      body.data.contextToken,
    );
    expect(opened?.sub).toBe(SUB);
    expect(opened?.siteUrl).toBe(SITE_URL);
    expect(opened?.marketCode).toBe("GB");
    expect(opened?.selection).toEqual(CRAWL.selection);
  });

  it("names the reason a site could not be read, with the status the sibling crawl tools use", async () => {
    // A quarter of real sites answer a crawler with a challenge page. Which
    // wall was hit is the one thing the visitor can act on differently, so the
    // code is carried through and the run is logged for the operator.
    //
    // 422, matching the `robots_disallowed` answer from the internal-link and
    // SEO audits: the request was well-formed and the service worked, but the
    // target would not be read. This used to answer 200, which made
    // `response.ok` true for a response carrying no report.
    const blocked = Object.assign(new Error("cf challenge"), {
      code: "bot_protection_blocked",
    });
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ crawlContext: () => Promise.reject(blocked) }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: { code: "bot_protection_blocked" },
    });
    expect(logged).toEqual([
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "context",
        code: "bot_protection_blocked",
      }),
    ]);
  });

  it("keeps an unknown crawl failure at 502 rather than blaming the target", async () => {
    // 422 says the target refused us. A failure we cannot name is not evidence
    // about the target at all, so it stays in the range that means "ours or
    // unknown" — the same place the sibling tools put `scan_failed`.
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({ crawlContext: () => Promise.reject(new Error("socket hang up")) }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "site_unreachable" },
    });
  });

  it("identifies proposition-generation failure without blaming the target or search data", async () => {
    const response = await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        extractPropositions: () =>
          Promise.reject(
            new KeywordLlmError(
              "network_error",
              "LLM request did not reach the provider.",
            ),
          ),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_generation_unavailable" },
    });
    expect(logged).toContain(
      JSON.stringify({
        tool: "keyword_opportunity",
        stage: "context",
        code: "keyword_generation_unavailable",
      }),
    );
  });

  it("releases the crawl gate after a successful read", async () => {
    const release = vi.fn();
    await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        openCrawlGate: () =>
          Promise.resolve({ ok: true, kind: "crawl", release }),
      }),
    );

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the crawl gate when the read throws", async () => {
    // The slot is per visitor and per target host. A leak here locks the
    // visitor out of their own next run until the isolate recycles, and the
    // throwing path is precisely the one they will retry.
    const release = vi.fn();
    await handleKeywordContextRequest(
      request(CONTEXT_BODY),
      deps({
        crawlContext: () => Promise.reject(new Error("socket hang up")),
        openCrawlGate: () =>
          Promise.resolve({ ok: true, kind: "crawl", release }),
      }),
    );

    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("handleKeywordOpportunitiesRequest", () => {
  function costReports(info: {
    readonly mock: {
      readonly calls: readonly (readonly unknown[])[];
    };
  }): Record<string, unknown>[] {
    return info.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0])) as Record<string, unknown>;
        } catch {
          return {};
        }
      })
      .filter((line) => line["tool"] === "keyword_opportunity" && "runCostUsd" in line);
  }

  it("emits exactly one successful cost record when a report is produced", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await handleKeywordOpportunitiesRequest(body(), deps());

    expect(response.status).toBe(200);
    const reports = costReports(info);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.["reportProduced"]).toBe(true);
  });

  it("emits exactly one failed cost record after paid evidence but no report", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const costs = createKeywordCostAccumulator();

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        costs,
        sampleSerp: () => {
          costs.record("serp_organic", 0.02);
          return Promise.reject(
            new SourceError("AUTH_REQUIRED", "provider rejected credentials"),
          );
        },
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    const reports = costReports(info);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reportProduced: false,
      runCostUsd: 0.02,
      candidateCount: DRAFTS.length,
      serpSampled: 0,
    });
  });

  function body(overrides: Record<string, unknown> = {}): Request {
    return request(
      { contextToken: contextToken(), ...overrides },
      "opportunities",
    );
  }

  it("refuses a visitor who is not signed in before spending anything", async () => {
    const validateVolumes = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ readIdentity: () => Promise.resolve(null), validateVolumes }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "authentication_required" },
    });
    expect(validateVolumes).not.toHaveBeenCalled();
  });

  it("rejects a request that carries no context token", async () => {
    for (const overrides of [
      { contextToken: undefined },
      { contextToken: "" },
    ]) {
      const response = await handleKeywordOpportunitiesRequest(
        request({ ...overrides }, "opportunities"),
        deps(),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "invalid_input" },
      });
    }
  });

  it("rejects a context token it cannot open, separately from a missing one", async () => {
    // A distinct code because the fixes differ: a missing token is a client
    // that skipped stage one, an unopenable one is a token that expired, was
    // tampered with, or was sealed under a rotated key. Both are 400 — nothing
    // about the caller's identity is wrong yet.
    const response = await handleKeywordOpportunitiesRequest(
      body({ contextToken: "not-a-sealed-value" }),
      deps(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "context_token_invalid" },
    });
  });

  it("accepts a token minted before headings existed instead of throwing on it", async () => {
    // `open()` decrypts and asserts a type; it does not validate a schema. For
    // ten minutes after this ships, live tokens have pages of `{url, title}`
    // and no `headings` key at all — and spreading `undefined` throws after
    // admission and after this run has already paid for expansion and volume
    // validation. The visitor would see a 502 for a deploy they had no part in.
    const legacyPages = PAGES.map((page) => ({
      url: page.url,
      title: page.title,
    })) as unknown as KeywordContextToken["pages"];

    const response = await handleKeywordOpportunitiesRequest(
      body({ contextToken: contextToken({ pages: legacyPages }) }),
      deps(),
    );

    expect(response.status).toBe(200);
    const parsed = (await response.json()) as OpportunitiesBody;
    expect(parsed.data.result.rows.length).toBeGreaterThan(0);
    for (const row of parsed.data.result.rows) {
      expect(row.coverage).toBe("inventory_unavailable");
    }
  });

  it("refuses a valid token that was issued to somebody else", async () => {
    // Without this the token is a bearer credential for the expensive half of
    // the pipeline: one sign-in could mint tokens and hand them out, and every
    // redemption would bill this project's providers.
    const validateVolumes = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body({ contextToken: contextToken({ sub: "someone-else" }) }),
      deps({ validateVolumes }),
    );

    // 403, not 400: the token is well-formed and unexpired, it just is not
    // this caller's.
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "context_token_invalid" },
    });
    expect(validateVolumes).not.toHaveBeenCalled();
  });

  it("hands back the Search Console gate's refusal without pricing anything", async () => {
    const denial = refusal(429);
    const validateVolumes = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        validateVolumes,
        openGscGate: () => Promise.resolve({ ok: false, response: denial }),
      }),
    );

    expect(response).toBe(denial);
    // Volume validation is the paid call. A refusal that still made it has
    // spent the money the limit exists to protect.
    expect(validateVolumes).not.toHaveBeenCalled();
  });

  it("prices a repeated term once however the generator spelled it", async () => {
    // A duplicate is a second charge for a fact already bought, and the funnel
    // reports the gap between generated and deduplicated, so collapsing them
    // here is what makes that number mean anything.
    const validateVolumes = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(rows(keywords)),
    );
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        validateVolumes,
        expandCandidates: () =>
          Promise.resolve([
            draft("dental billing software"),
            draft("Dental Billing Software"),
            draft("  dental billing software  "),
            draft("patient intake forms"),
          ]),
      }),
    );

    expect(validateVolumes).toHaveBeenCalledTimes(1);
    expect(validateVolumes.mock.calls[0]?.[0].keywords).toEqual([
      "dental billing software",
      "patient intake forms",
    ]);
  });

  it("folds a term whose only difference is an inner double space", async () => {
    // The handler used to key deduplication on a plain lowercase while the
    // validation layer collapsed whitespace too. The pair therefore survived
    // as two candidates, got priced twice and — the expensive part — sampled
    // twice, then rendered as two rows sharing one validation, while the
    // funnel reported them as deduplicated.
    const priced: string[][] = [];
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        validateVolumes: ({ keywords }) => {
          priced.push([...keywords]);
          return Promise.resolve(rows(keywords));
        },
        expandCandidates: () =>
          Promise.resolve([draft("dental billing"), draft("dental  billing")]),
      }),
    );

    expect(priced).toEqual([["dental billing"]]);
  });

  it("passes the seed terms the visitor typed at stage one into the generator", async () => {
    // The seeds were validated at stage one and then dropped: they never
    // entered the token and stage two hard-coded an empty list. A thin run
    // still suggested "add seed keywords", which could not change anything.
    const seen: string[][] = [];
    await handleKeywordOpportunitiesRequest(
      body({
        contextToken: contextToken({ seeds: ["orthodontics", "crowns"] }),
      }),
      deps({
        expandCandidates: (input) => {
          seen.push([...input.seeds]);
          return Promise.resolve(DRAFTS);
        },
      }),
    );

    expect(seen).toEqual([["orthodontics", "crowns"]]);
  });

  it("prices no more candidates than the run's cap however many were generated", async () => {
    // The linear cost driver. A generator that returns more than the cap is a
    // generator bug, but the bill lands here, so the ceiling is enforced on
    // this side of the seam rather than trusted on the other.
    const validateVolumes = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(rows(keywords)),
    );
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        validateVolumes,
        expandCandidates: () =>
          Promise.resolve(
            Array.from({ length: KEYWORD_CANDIDATE_CAP + 50 }, (_u, index) =>
              draft(`billing term ${index}`),
            ),
          ),
      }),
    );

    expect(validateVolumes.mock.calls[0]?.[0].keywords).toHaveLength(
      KEYWORD_CANDIDATE_CAP,
    );
  });

  it("still answers when Search Console coverage cannot be read, and says so", async () => {
    // Coverage absence only weakens a claim — the tool can no longer say a
    // term is already served. Turning that into a failure would deny somebody
    // their whole keyword read over a stage that never blocks the answer.
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ readCoverageQueries: () => Promise.reject(new Error("403")) }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toContain("gsc_coverage");
    // Named, so the run can never read as a clean one.
    expect(parsed.data.result.availability).not.toBe("available");
    expect(parsed.data.result.availability).toBe("partial");
    // This old fixture has no inventory either, so the exact per-row state is
    // the stronger missing evidence. The failed GSC read remains visible in
    // `unavailableStages` above rather than being fabricated into coverage.
    expect(parsed.data.result.rows.length).toBeGreaterThan(0);
    for (const row of parsed.data.result.rows) {
      expect(row.coverage).toBe("inventory_unavailable");
    }
  });

  it("keeps positive rows but marks a truncated query-page read partial", async () => {
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(
          keywords.map((keyword) => completeSample(keyword, "small.example")),
        ),
    );
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp,
        readCoverageQueries: () =>
          Promise.resolve({
            queryRows: [
              { query: "patient intake forms", impressions: 900, position: 3 },
            ],
            queryPageRows: [
              {
                query: "patient intake forms",
                page: "https://acme.example/patient-intake",
                impressions: 700,
                position: 2,
              },
            ],
            queryPaging: { pagesFetched: 1, truncated: false },
            queryPagePaging: { pagesFetched: 4, truncated: true },
          }),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toContain(
      "gsc_coverage_truncated",
    );
    expect(parsed.data.result.unavailableStages).not.toContain("gsc_coverage");
    expect(parsed.data.result.availability).toBe("partial");
    // Coverage changes the final disposition, not the evidence plan: v2 still
    // samples every candidate except explicit zero so the retained record is complete.
    expect(sampleSerp.mock.calls[0]?.[0].keywords).toContain(
      "patient intake forms",
    );
  });

  it("keeps a truncated query prefix and marks the run partial", async () => {
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        readCoverageQueries: () =>
          Promise.resolve({
            queryRows: [],
            queryPageRows: [],
            queryPaging: { pagesFetched: 4, truncated: true },
            queryPagePaging: { pagesFetched: 1, truncated: false },
          }),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toEqual([
      "gsc_coverage_truncated",
    ]);
    expect(parsed.data.result.availability).toBe("partial");
  });

  it("marks a legacy query-only coverage reader as truncated", async () => {
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ readCoverageQueries: () => Promise.resolve([]) }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toEqual([
      "gsc_coverage_truncated",
    ]);
    expect(parsed.data.result.availability).toBe("partial");
  });

  it("reads Search Console by property identifier, not by the site URL", async () => {
    // The shipped bug: the visitor's typed URL went straight to the Search
    // Console client, which addresses properties only. Every read was refused
    // and the coverage stage — the reason this tool asks for authorization at
    // all — was unavailable on every single run.
    const seen: string[] = [];
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        resolveGrant: () =>
          Promise.resolve({
            kind: "grant",
            accessToken: "ya29.test",
            properties: ["sc-domain:acme.example"],
            propertyTotal: 1,
          }),
        readCoverageQueries: ({ property }) => {
          seen.push(property);
          return Promise.resolve(cleanCoverageRead());
        },
      }),
    );

    expect(seen).toEqual(["sc-domain:acme.example"]);
  });

  it("reports coverage unread, and spends nothing on it, when the grant covers another site", async () => {
    // No property for this site means no queries we are entitled to read. The
    // honest answer is the unread state — not an empty sample, which would
    // read as "your site serves none of these".
    const readCoverageQueries = vi.fn(() =>
      Promise.resolve(cleanCoverageRead()),
    );
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        resolveGrant: () =>
          Promise.resolve({
            kind: "grant",
            accessToken: "ya29.test",
            properties: ["sc-domain:somebody-else.example"],
            propertyTotal: 1,
          }),
        readCoverageQueries,
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(readCoverageQueries).not.toHaveBeenCalled();
    expect(parsed.data.result.unavailableStages).toContain("gsc_coverage");
    for (const row of parsed.data.result.rows) {
      expect(row.coverage).toBe("inventory_unavailable");
    }
  });

  it("shows a GEO question on the page its proposition came from", async () => {
    // The GEO lane produced nothing at all on the first live run: 44 of 142
    // candidates were question-form, and every one was withheld for
    // `no_supporting_page`. Token overlap cannot carry a question — most of
    // its words are grammar — but the generator already said which
    // proposition each one came from, and every proposition carries the URL it
    // was read off.
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            ...DRAFTS,
            draft("can i submit an insurance claim the same day", {
              discoveryBasis: "site_proposition",
              questionForm: true,
              propositionIndex: 0,
            }),
          ]),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    const geo = parsed.data.result.rows.find((row) => row.lane === "geo");
    expect(geo?.keyword).toBe("can i submit an insurance claim the same day");
    expect(geo?.supportingPageUrl).toBe("https://acme.example/");
    // Attribution says where the claim came from. It is not evidence the site
    // ranks, and this legacy token carried no inventory to check independently.
    expect(geo?.coverage).toBe("inventory_unavailable");
  });

  it("does not use an invalid attribution as coverage evidence", async () => {
    // The generator is told every `site_proposition` item must carry a valid
    // index and every expansion item must carry none. An expansion candidate
    // arriving with one is the model contradicting its own instructions, and
    // honouring it would let a single inconsistent field put a GEO row in
    // front of the reader on the strength of nothing.
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            ...DRAFTS,
            draft("what does the pricing page say", {
              discoveryBasis: "traditional_expansion",
              questionForm: true,
              propositionIndex: 0,
            }),
          ]),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    const row = parsed.data.result.rows.find(
      (candidate) => candidate.keyword === "what does the pricing page say",
    );
    expect(row?.supportingPageUrl).toBeNull();
    expect(row?.signals.youngDomain.state).toBe("observed");
  });

  it("refuses an attributed page the crawl never reached", async () => {
    // The index arrives on this request while the pages were sealed on the
    // last one. An index pointing outside the crawl must resolve to nothing
    // rather than put a URL nobody fetched in front of the reader as a link.
    const response = await handleKeywordOpportunitiesRequest(
      body({
        contextToken: contextToken({
          propositions: [
            {
              statement: "Claimed off a page we never saw",
              sourceUrl: "https://acme.example/ghost",
            },
          ],
        }),
      }),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            ...DRAFTS,
            draft("what does the ghost page say", {
              discoveryBasis: "site_proposition",
              questionForm: true,
              propositionIndex: 0,
            }),
          ]),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    const row = parsed.data.result.rows.find(
      (candidate) => candidate.keyword === "what does the ghost page say",
    );
    expect(row?.supportingPageUrl).toBeNull();
    expect(row?.signals.youngDomain.state).toBe("observed");
  });

  it("matches a candidate against the crawled headings, not the title alone", async () => {
    // Titles are three or four words. The page-similarity half of coverage
    // reads whatever stage one sealed into the token, and sealing only the
    // title left it almost blind — the crawl had the headings all along. The
    // title here shares nothing with the candidate, so a match can only have
    // come from the heading.
    const response = await handleKeywordOpportunitiesRequest(
      body({
        contextToken: contextToken({
          pages: [
            {
              url: "https://acme.example/claims",
              title: "Acme",
              headings: ["Insurance claim tracking for clinics"],
            },
          ],
        }),
      }),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            ...DRAFTS,
            draft("claim tracking for clinics", { questionForm: true }),
          ]),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    const row = parsed.data.result.rows.find(
      (candidate) => candidate.lane === "geo",
    );
    expect(row?.coverage).toBe("related_coverage_unverified");
    expect(row?.supportingPageUrl).toBe("https://acme.example/claims");
  });

  it("still samples page one for terms whose coverage could not be checked", async () => {
    // The expensive stage keys off "not known to be served". An unread sample
    // must not be read as "covered", or a failed Search Console call would
    // silently empty the only table the tool produces.
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    );
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        readCoverageQueries: () => Promise.reject(new Error("403")),
        sampleSerp,
      }),
    );

    // Every priced candidate, named. "At least one was sampled" passed the
    // original broken implementation too — it classified everything as
    // not-observed, which was already eligible — and it would keep passing if
    // a subset were silently dropped.
    const sampled = sampleSerp.mock.calls[0]?.[0].keywords ?? [];
    expect([...sampled].sort()).toEqual(
      [...DRAFTS.map((candidate) => candidate.keyword)].sort(),
    );
  });

  it("samples a term whose only coverage signal is a lexical page match", async () => {
    // `related_coverage_unverified` is deliberately NOT "already covered", but
    // it used to be excluded from sampling — and an unsampled SEO row can
    // never be winnable, so it was withheld anyway. Title overlap was acting
    // as the hard filter `coverage.ts` promises it is not, and carrying
    // headings in the token makes that state far more common.
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    );
    const response = await handleKeywordOpportunitiesRequest(
      body({
        contextToken: contextToken({
          pages: [
            {
              url: "https://acme.example/claims",
              title: "Acme",
              headings: ["Insurance claim tracking"],
            },
          ],
        }),
      }),
      deps({ sampleSerp }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toContain(
      "insurance claim tracking",
    );
    const row = parsed.data.result.rows.find(
      (candidate) => candidate.keyword === "insurance claim tracking",
    );
    expect(row?.coverage).toBe("related_coverage_unverified");
    expect(row?.serp.verdict).toBe("winnable_evidence");
  });

  it("labels a sitemap slug match as possible without withholding or skipping SERP", async () => {
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    );
    const response = await handleKeywordOpportunitiesRequest(
      body({
        contextToken: contextToken({
          sitemapInventory: {
            ...COMPLETE_SITEMAP_INVENTORY,
            urls: ["https://acme.example/insurance-claim-tracking"],
          },
        }),
      }),
      deps({ sampleSerp }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;
    const row = parsed.data.result.rows.find(
      (candidate) => candidate.keyword === "insurance claim tracking",
    );

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toContain(
      "insurance claim tracking",
    );
    expect(row?.coverage).toBe("possible_existing_page");
    expect(row?.supportingPageUrl).toBe(
      "https://acme.example/insurance-claim-tracking",
    );
  });

  it("returns a hard source failure when the SERP seam throws a stage-wide authentication error", async () => {
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp: () =>
          Promise.reject(new SourceError("AUTH_REQUIRED", "bad credentials")),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
  });

  it("does not leave a budget-exhausted tail when every explicit-zero-exempt candidate was attempted", async () => {
    const many = Array.from({ length: 23 }, (_, i) =>
      draft(`dental billing variant ${String(i)}`),
    );
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ expandCandidates: () => Promise.resolve(many) }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(parsed.data.result.unavailableStages).not.toContain("serp_sample");
    expect(parsed.data.result.withheld.map((entry) => entry.reason)).not.toContain(
      "serp_sample_budget_exhausted",
    );
    expect(parsed.data.result.funnel["serpSampled"]).toBe(23);
  });

  it("does not resolve the grant for a request the gate turned away", async () => {
    // Resolving it costs two outbound Google calls against a shared OAuth
    // client and a per-project Search Console quota. Doing that before
    // admission puts the limiter behind the thing it limits.
    const resolveGrant = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        openGscGate: () =>
          Promise.resolve({ ok: false, response: refusal(429) }),
        resolveGrant,
      }),
    );

    expect(response.status).toBe(429);
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it("sends a lapsed authorization back to the consent screen instead of reporting a gap", async () => {
    // Coverage is what keeps the tool from recommending pages the site already
    // has. A visitor whose grant expired needs the route back, not a report
    // with one stage quietly missing.
    const validateVolumes = vi.fn();
    const release = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        openGscGate: () => Promise.resolve({ ok: true, release }),
        resolveGrant: () => Promise.resolve({ kind: "revoked" }),
        validateVolumes,
      }),
    );

    expect(response.status).toBe(401);
    expect(validateVolumes).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not consult the historical account daily budget breaker", async () => {
    const consumeDailyBudget = vi.fn(() =>
      Promise.resolve({ kind: "exhausted", retryAfterSeconds: 1800 } as const),
    );
    const dependencies = { ...deps(), consumeDailyBudget };
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(consumeDailyBudget).not.toHaveBeenCalled();
  });

  it("does not consult per-run aggregate cost admission before SERP sampling", async () => {
    const baseCosts = createKeywordCostAccumulator(0);
    const admitStage = vi.fn(baseCosts.admitStage);
    const costs = { ...baseCosts, admitStage };
    const sampleSerp = vi.fn(deps().sampleSerp);

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ costs, sampleSerp }),
    );

    expect(response.status).toBe(200);
    expect(sampleSerp).toHaveBeenCalledTimes(1);
    expect(admitStage).not.toHaveBeenCalled();
  });

  it("attempts all 150 deduplicated explicit-zero-exempt candidates in input order", async () => {
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    );
    const candidates = Array.from(
      { length: KEYWORD_CANDIDATE_CAP },
      (_unused, index) => draft(`billing term ${String(index)}`),
    );
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp,
        expandCandidates: () => Promise.resolve(candidates),
      }),
    );

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toEqual(
      candidates.map((candidate) => candidate.keyword),
    );
  });

  it("samples provider-no-data and already-covered terms but skips explicit zero", async () => {
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(keywords.map((keyword) => completeSample(keyword))),
    );

    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp,
        expandCandidates: () =>
          Promise.resolve([
            draft("dental billing software"),
            draft("clinic scheduling tool"),
            draft("patient intake forms"),
            draft("measured zero keyword"),
          ]),
        validateVolumes: ({ keywords }) =>
          Promise.resolve(
            keywords
              // The provider stays silent about this one, which is no-data
              // rather than zero demand.
              .filter((keyword) => keyword !== "clinic scheduling tool")
              .map((keyword) => ({
                keyword,
                volume: keyword === "measured zero keyword" ? 0 : 320,
                difficulty: 12,
                intent: "informational",
                serpFeatures: [],
              })),
          ),
        // Already served, strongly, by the site's own property.
        readCoverageQueries: () =>
          Promise.resolve(
            cleanCoverageRead([
              { query: "patient intake forms", impressions: 900, position: 3 },
            ]),
          ),
      }),
    );

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toEqual([
      "dental billing software",
      "clinic scheduling tool",
      "patient intake forms",
    ]);
  });

  it("keeps complete SERPs when one attempted keyword is unavailable and enriches only complete domains", async () => {
    const sampleSerp = vi.fn(() =>
      Promise.resolve([
        completeSample("complete alpha", "alpha.com"),
        {
          keyword: "failed beta",
          status: "unavailable" as const,
          failureReason: "transport_outcome_unknown" as const,
          observedAt: null,
          results: [],
          pageItemTypes: null,
          aiOverview: null,
          communityItems: null,
        },
        {
          ...completeSample("complete gamma", "alpha.com"),
          results: [
            completeSample("unused", "alpha.com").results[0]!,
            completeSample("unused", "gamma.com").results[0]!,
          ],
        },
      ]),
    );
    const resolveDomainRanks = vi.fn((domains: readonly string[]) =>
      Promise.resolve(
        new Map(domains.map((domain) => [domain, 100] as const)),
      ),
    );
    const resolveDomainTraffic = vi.fn(
      ({ domains }: { readonly domains: readonly string[] }) =>
        Promise.resolve(
          new Map(domains.map((domain) => [domain, 100] as const)),
        ),
    );
    const resolveDomainRegistrations = vi.fn((domains: readonly string[]) =>
      Promise.resolve(
        new Map(
          domains.map(
            (domain) => [domain, availableRegistration(domain)] as const,
          ),
        ),
      ),
    );

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            draft("complete alpha"),
            draft("failed beta"),
            draft("complete gamma"),
          ]),
        sampleSerp,
        resolveDomainRanks,
        resolveDomainTraffic,
        resolveDomainRegistrations,
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toContain(
      "serp_sample_partial",
    );
    expect(parsed.data.result.unavailableStages).not.toContain("serp_sample");
    expect(parsed.data.result.funnel["serpSampled"]).toBe(2);
    expect(parsed.data.result.incomplete).toEqual([
      expect.objectContaining({
        keyword: "failed beta",
        reason: "serp_evidence_unavailable",
        serp: expect.objectContaining({
          status: "unavailable",
          failureReason: "transport_outcome_unknown",
        }),
      }),
    ]);
    expect(parsed.data.result.rows.map((row) => row.keyword)).toEqual([
      "complete alpha",
      "complete gamma",
    ]);
    expect(parsed.data.result.rows[0]?.serp.organicResults[0]).toEqual({
      domain: "alpha.com",
      position: 3,
      title: "A useful answer",
      url: "https://alpha.com/answer",
    });
    expect(resolveDomainRanks.mock.calls[0]?.[0]).toEqual([
      "alpha.com",
      "gamma.com",
      "acme.example",
    ]);
    expect(resolveDomainTraffic.mock.calls[0]?.[0].domains).toEqual([
      "alpha.com",
      "gamma.com",
    ]);
    expect(resolveDomainRegistrations.mock.calls[0]?.[0]).toEqual([
      "alpha.com",
      "gamma.com",
    ]);
  });

  it("marks an all-unavailable SERP plan as a failed stage and skips every domain enrichment", async () => {
    const unavailable = (keyword: string): KeywordSerpSampleResult => ({
      keyword,
      status: "unavailable",
      failureReason: "provider_unavailable",
      observedAt: null,
      results: [],
      pageItemTypes: null,
      aiOverview: null,
      communityItems: null,
    });
    const resolveDomainRanks = vi.fn();
    const resolveDomainTraffic = vi.fn();
    const resolveDomainRegistrations = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([draft("failed alpha"), draft("failed beta")]),
        sampleSerp: ({ keywords }) =>
          Promise.resolve(keywords.map(unavailable)),
        resolveDomainRanks,
        resolveDomainTraffic,
        resolveDomainRegistrations,
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toContain("serp_sample");
    expect(parsed.data.result.unavailableStages).not.toContain(
      "serp_sample_partial",
    );
    expect(parsed.data.result.funnel["serpSampled"]).toBe(0);
    expect(parsed.data.result.incomplete.map((entry) => entry.keyword)).toEqual([
      "failed alpha",
      "failed beta",
    ]);
    expect(resolveDomainRanks).not.toHaveBeenCalled();
    expect(resolveDomainTraffic).not.toHaveBeenCalled();
    expect(resolveDomainRegistrations).not.toHaveBeenCalled();
  });

  it.each(["rank", "traffic", "registration"] as const)(
    "isolates a %s enrichment failure without discarding the completed SERP",
    async (failedStage) => {
      const resolveDomainRanks = vi.fn((domains: readonly string[]) =>
        failedStage === "rank"
          ? Promise.reject(new Error("rank unavailable"))
          : Promise.resolve(
              new Map(domains.map((domain) => [domain, 100] as const)),
            ),
      );
      const resolveDomainTraffic = vi.fn(
        ({ domains }: { readonly domains: readonly string[] }) =>
          failedStage === "traffic"
            ? Promise.reject(new Error("traffic unavailable"))
            : Promise.resolve(
                new Map(domains.map((domain) => [domain, 100] as const)),
              ),
      );
      const resolveDomainRegistrations = vi.fn(
        (domains: readonly string[]) =>
          failedStage === "registration"
            ? Promise.reject(new Error("registration unavailable"))
            : Promise.resolve(
                new Map(
                  domains.map(
                    (domain) =>
                      [domain, availableRegistration(domain)] as const,
                  ),
                ),
              ),
      );
      const response = await handleKeywordOpportunitiesRequest(
        body(),
        deps({
          expandCandidates: () => Promise.resolve([draft("isolated failure")]),
          resolveDomainRanks,
          resolveDomainTraffic,
          resolveDomainRegistrations,
        }),
      );
      const parsed = (await response.json()) as OpportunitiesBody;
      const incomplete = parsed.data.result.incomplete[0];

      expect(response.status).toBe(200);
      expect(incomplete?.serp.status).toBe("complete");
      expect(incomplete?.serp.organicResults).toHaveLength(1);
      expect(resolveDomainRanks).toHaveBeenCalledTimes(1);
      expect(resolveDomainTraffic).toHaveBeenCalledTimes(1);
      expect(resolveDomainRegistrations).toHaveBeenCalledTimes(1);
      if (failedStage === "registration") {
        expect(incomplete?.signals.youngDomain.state).toBe("unavailable");
        expect(incomplete?.signals.lowOrganicTrafficDomain.state).toBe(
          "observed",
        );
      } else {
        expect(incomplete?.signals.lowOrganicTrafficDomain.state).toBe(
          "unavailable",
        );
        expect(incomplete?.signals.youngDomain.state).toBe("observed");
      }
    },
  );

  it("does not turn provider rank zero into a v2 eligible decision", async () => {
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () => Promise.resolve([draft("rank zero candidate")]),
        resolveDomainRanks: (domains) =>
          Promise.resolve(new Map(domains.map((domain) => [domain, 0] as const))),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.rows).toEqual([]);
    expect(parsed.data.result.incomplete).toEqual([
      expect.objectContaining({
        keyword: "rank zero candidate",
        reason: "low_organic_traffic_signal_unavailable",
        serp: expect.objectContaining({
          status: "complete",
          verdict: "no_serp_evidence",
        }),
      }),
    ]);
  });

  it("carries the provider intent as its own fact", async () => {
    const response = await handleKeywordOpportunitiesRequest(body(), deps());
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(parsed.data.result.rows[0]?.validation.providerIntent).toBe(
      "informational",
    );
  });

  it("keeps provider intent beside a separately provenanced SERP interpretation and applies only the AI answer discount", async () => {
    const complete = {
      ...completeSample("comparison keyword"),
      pageItemTypes: ["ai_overview"],
      aiOverview: {
        markdown: "The overview fully answers the comparison.",
        isAsync: true,
        references: [],
      },
    } satisfies KeywordSerpSampleResult;
    const unavailable: KeywordSerpSampleResult = {
      keyword: "failed keyword",
      status: "unavailable",
      failureReason: "provider_unavailable",
      observedAt: null,
      results: [],
      pageItemTypes: null,
      aiOverview: null,
      communityItems: null,
    };
    const interpretSerpEvidence = vi.fn(
      (samples: readonly KeywordSerpInterpretationInput[]) =>
        Promise.resolve(
          samples.map((sample) => ({
            keyword: sample.keyword,
            availability: "available" as const,
            intent: "commercial" as const,
            aiOverviewAssessment: "complete" as const,
            reason:
              "The overview resolves the comparison without another click.",
            observedAt: sample.observedAt,
            modelId: "gpt-5.6-luna-response",
            promptVersion: "keyword_serp_interpretation.v1" as const,
          })),
        ),
    );

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([
            draft("comparison keyword"),
            draft("failed keyword"),
          ]),
        sampleSerp: () => Promise.resolve([complete, unavailable]),
        interpretSerpEvidence,
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;
    const row = parsed.data.result.rows.find(
      (entry) => entry.keyword === "comparison keyword",
    );

    expect(response.status).toBe(200);
    expect(interpretSerpEvidence).toHaveBeenCalledWith([
      {
        keyword: "comparison keyword",
        observedAt: COMPLETED_AT,
        organicResults: [
          {
            position: 3,
            title: "A useful answer",
            url: "https://small-blog.com/answer",
          },
        ],
        aiOverviewMarkdown: "The overview fully answers the comparison.",
      },
    ]);
    expect(row?.validation.providerIntent).toBe("informational");
    expect(row?.serpIntent).toEqual({
      intent: "commercial",
      source: "serp_top_ten_interpretation",
      observedAt: COMPLETED_AT,
      modelId: "gpt-5.6-luna-response",
      promptVersion: "keyword_serp_interpretation.v1",
    });
    expect(row?.aiOverview).toMatchObject({
      availability: "observed",
      loadedAsync: true,
      answerAssessment: "complete",
      reason: "The overview resolves the comparison without another click.",
      modelId: "gpt-5.6-luna-response",
      promptVersion: "keyword_serp_interpretation.v1",
    });
    expect(
      Object.prototype.hasOwnProperty.call(row?.aiOverview, "markdown"),
    ).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(
      "The overview fully answers the comparison.",
    );
    expect(row?.decision).toMatchObject({
      disposition: "eligible",
      discounts: ["ai_overview_answer_discount"],
    });
    expect(parsed.data.result.withheld).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain('"blogAgent"');
    expect(JSON.stringify(parsed)).not.toContain('"handoff"');
  });

  it("fails soft when SERP interpretation throws and preserves public provider facts in a 200 response", async () => {
    const complete = {
      ...completeSample("interpretation failure"),
      pageItemTypes: ["ai_overview"],
      aiOverview: {
        markdown: "Provider-retained AI Overview markdown.",
        isAsync: true,
        references: [],
      },
    } satisfies KeywordSerpSampleResult;

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.resolve([draft("interpretation failure")]),
        sampleSerp: () => Promise.resolve([complete]),
        interpretSerpEvidence: () =>
          Promise.reject(
            new KeywordLlmError(
              "not_configured",
              "configuration details must not escape",
            ),
          ),
      }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;
    const row = parsed.data.result.rows[0];

    expect(response.status).toBe(200);
    expect(row?.validation.providerIntent).toBe("informational");
    expect(row?.serp.status).toBe("complete");
    expect(row?.serp.organicResults).toHaveLength(1);
    expect(row?.serpIntent).toBeNull();
    expect(row?.aiOverview).toMatchObject({
      availability: "observed",
      loadedAsync: true,
      answerAssessment: "unavailable",
      reason: "interpretation_unavailable",
      modelId: null,
      promptVersion: null,
    });
    expect(
      Object.prototype.hasOwnProperty.call(row?.aiOverview, "markdown"),
    ).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(
      "Provider-retained AI Overview markdown.",
    );
    expect(logged.map((line) => JSON.parse(line))).toContainEqual({
      tool: "keyword_opportunity",
      stage: "serp_interpretation",
      failureReason: "not_configured",
    });
    expect(logged.join("\n")).not.toContain("configuration details");
  });

  it("returns the envelope under `data` with the run contract pinned exactly", async () => {
    const response = await handleKeywordOpportunitiesRequest(body(), deps());
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(Object.keys(parsed)).toEqual(["data"]);
    // Compared whole rather than field by field: a drifted contract most often
    // shows up as an ADDED field, and a per-field assertion is blind to that.
    expect(parsed.data.run).toEqual({
      tool: "keyword_opportunity_map",
      schemaVersion: "keyword_opportunity_map.v2",
      mode: "public_preview",
      scope: "site",
      persistence: "none",
      completedAt: COMPLETED_AT,
    });
    expect(parsed.data.result.availability).toBe("available");
  });

  it("releases the Search Console gate after a successful run", async () => {
    const release = vi.fn();
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({ openGscGate: () => Promise.resolve({ ok: true, release }) }),
    );

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases the Search Console gate when a stage throws", async () => {
    // The slot is shared by every public tool that reads Search Console for
    // this IP. Leaking it on the failing path locks the visitor out of all of
    // them, and the failing path is the one they retry.
    const release = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () => Promise.reject(new Error("generator down")),
        openGscGate: () => Promise.resolve({ ok: true, release }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("identifies a candidate-generation transport failure without blaming search data", async () => {
    const release = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        expandCandidates: () =>
          Promise.reject(
            new KeywordLlmError(
              "network_error",
              "LLM request did not reach the provider.",
            ),
          ),
        openGscGate: () => Promise.resolve({ ok: true, release }),
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_generation_unavailable" },
    });
    expect(logged.map((line) => JSON.parse(line))).toContainEqual({
      tool: "keyword_opportunity",
      stage: "expand_candidates",
      failureReason: "network_error",
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("ships no verdict vocabulary in the response the surface renders", async () => {
    // The tool records observations and names checks to run; it never grades a
    // term or diagnoses a site. Any of these words reaching the wire means a
    // judgement crept back in somewhere between the engine and the envelope,
    // and the surface would render it as authoritative.
    const response = await handleKeywordOpportunitiesRequest(body(), deps());
    const serialized = JSON.stringify(await response.json());

    for (const forbidden of [
      "score",
      "grade",
      "severity",
      "priority",
      "diagnosis",
      "remediation",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("keyword opportunity error envelopes", () => {
  it("answers every rejected request with a code and never a bare message", async () => {
    // The surface switches on the code. A response that carried only prose
    // would render as an unknown state, which is how a 400 becomes "something
    // went wrong" for the visitor and nothing at all for the operator.
    const responses = await Promise.all([
      handleKeywordContextRequest(request({}), deps()),
      handleKeywordOpportunitiesRequest(request({}, "opportunities"), deps()),
    ]);

    for (const response of responses) {
      const parsed = (await response.json()) as ErrorBody;
      expect(typeof parsed.error.code).toBe("string");
      expect(parsed.error.code).not.toBe("");
      expect(Object.keys(parsed)).toEqual(["error"]);
    }
  });
});
