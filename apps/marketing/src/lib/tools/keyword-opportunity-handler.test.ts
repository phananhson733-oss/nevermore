import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KeywordOpportunityProviderRow } from "@sf/public-tools";
import { open, seal } from "../auth/sealed-cookie.ts";
import { createKeywordCostAccumulator } from "./keyword-cost-guard.ts";
import {
  handleKeywordContextRequest,
  handleKeywordOpportunitiesRequest,
  KEYWORD_CANDIDATE_CAP,
  KEYWORD_CONTEXT_TTL_SECONDS,
  KEYWORD_SERP_SAMPLE_CAP,
  type KeywordCandidateDraft,
  type KeywordContextToken,
  type KeywordOpportunityDependencies,
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
  { url: "https://acme.example/", title: "Overview" },
  { url: "https://acme.example/pricing", title: "Pricing" },
  { url: "https://acme.example/docs", title: "Docs" },
] as const;

const CRAWL = {
  pages: PAGES.map((page, index) => ({
    ...page,
    headings: [],
    text: "",
    score: 10 - index,
  })),
  pagesFetched: 3,
  productPagesFetched: 1,
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
  stopReason: "budget_reached",
  seeds: [],
  sub: SUB,
};

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
    // The breaker and the accumulator default to "budget is fine, nothing
    // spent yet"; the cases that care override them.
    consumeDailyBudget: () =>
      Promise.resolve({ kind: "allowed", runsToday: 1 }),
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
      Promise.resolve(
        keywords.map((keyword) => ({
          keyword,
          domains: ["small-blog.example"],
        })),
      ),
    // 40 is below the weak-domain ceiling, so the default page one reads as
    // one a new site has already been let into.
    resolveDomainRanks: (domains) =>
      Promise.resolve(
        new Map<string, number>(domains.map((domain) => [domain, 40] as const)),
      ),
    readCoverageQueries: () => Promise.resolve([]),
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
        readonly serp: { readonly verdict: string };
      }[];
      readonly withheld: readonly {
        readonly keyword: string;
        readonly reason: string;
      }[];
      readonly funnel: Record<string, number>;
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
  });

  it("calls nothing winnable when page one was never sampled", async () => {
    // The regression that misled this team four times: falling back to the
    // difficulty score when the SERP sample is missing. A score models how
    // hard a term looks; it cannot say who actually holds page one.
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ sampleSerp: () => Promise.reject(new Error("provider 500")) }),
    );
    const parsed = (await response.json()) as OpportunitiesBody;

    expect(response.status).toBe(200);
    expect(parsed.data.result.unavailableStages).toContain("serp_sample");
    expect(parsed.data.result.funnel["winnableEvidence"]).toBe(0);
    expect(parsed.data.result.rows).toEqual([]);
    // And the withheld reason is the true one — nobody looked, rather than the
    // page came back contested. Only the first is worth re-running.
    expect(parsed.data.result.withheld.map((entry) => entry.reason)).toEqual(
      DRAFTS.map(() => "serp_sample_budget_exhausted"),
    );
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

  it("refuses the whole run once the account's daily budget is spent, before paying for anything", async () => {
    // The breaker guards a prepaid balance the paid analysis pipeline also
    // spends from, so an exhausted day must stop the run at the door rather
    // than let it buy one more report. 503 with Retry-After, and not one
    // provider call.
    const validateVolumes = vi.fn();
    const expandCandidates = vi.fn();
    const release = vi.fn();
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        consumeDailyBudget: () =>
          Promise.resolve({ kind: "exhausted", retryAfterSeconds: 1800 }),
        openGscGate: () => Promise.resolve({ ok: true, release }),
        expandCandidates,
        validateVolumes,
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1800");
    await expect(response.json()).resolves.toEqual({
      error: { code: "keyword_source_unavailable" },
    });
    expect(expandCandidates).not.toHaveBeenCalled();
    expect(validateVolumes).not.toHaveBeenCalled();
    // The admission slot is handed back; a refused run must not leave this IP
    // wedged for the rest of the isolate's life.
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("treats a counter that cannot answer exactly like an exhausted day", async () => {
    // Fail closed. A paid endpoint with no working limiter is an open tap, and
    // a tool that is briefly unavailable is the cheaper failure.
    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        consumeDailyBudget: () =>
          Promise.resolve({ kind: "unavailable", reason: "quota store down" }),
      }),
    );

    expect(response.status).toBe(503);
  });

  it("degrades to partial when the per-run ceiling cannot fit page-one sampling", async () => {
    // The earlier stages are billed whether or not sampling happens, so the
    // ceiling must cut the optional stage and keep the run — throwing here
    // would discard work that was already paid for. And the result has to say
    // the stage was cut: a run that came in cheap because it was truncated
    // looks identical in the totals to a genuinely cheap one.
    const sampleSerp = vi.fn();
    const costs = createKeywordCostAccumulator();
    // Book the ceiling as already spent, which is what a long expansion does.
    costs.record("keyword_overview", 0.25);

    const response = await handleKeywordOpportunitiesRequest(
      body(),
      deps({ costs, sampleSerp }),
    );

    expect(response.status).toBe(200);
    expect(sampleSerp).not.toHaveBeenCalled();
    const parsed = (await response.json()) as OpportunitiesBody;
    expect(parsed.data.result.unavailableStages).toContain(
      "serp_sample_cost_capped",
    );
    expect(parsed.data.result.availability).not.toBe("available");
    expect(costs.capped()).toBe(true);
  });

  it("samples no more pages of results than the run's cap", async () => {
    // The more expensive driver per unit, so the cap is enforced even though
    // the survivor count is already bounded by the candidate cap above it.
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(
          keywords.map((keyword) => ({ keyword, domains: ["small.example"] })),
        ),
    );
    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp,
        expandCandidates: () =>
          Promise.resolve(
            Array.from({ length: KEYWORD_SERP_SAMPLE_CAP + 5 }, (_u, index) =>
              draft(`billing term ${index}`),
            ),
          ),
      }),
    );

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toHaveLength(
      KEYWORD_SERP_SAMPLE_CAP,
    );
  });

  it("spends the last sample slots on proposition terms even when they look hard", async () => {
    // The proposition lane is the scarce output — 19 priced terms against 343
    // expansion ones in the spike — so a cap that sorted on difficulty alone
    // would cut exactly the rows nothing else in the product can produce.
    const expansion = Array.from(
      { length: KEYWORD_SERP_SAMPLE_CAP },
      (_unused, index) => draft(`billing term ${index}`),
    );
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(
          keywords.map((keyword) => ({ keyword, domains: ["small.example"] })),
        ),
    );

    await handleKeywordOpportunitiesRequest(
      body(),
      deps({
        sampleSerp,
        expandCandidates: () =>
          Promise.resolve([
            ...expansion,
            draft("clinic scheduling tool", {
              discoveryBasis: "site_proposition",
              propositionIndex: 0,
            }),
          ]),
        // The proposition term is the hardest of the lot; every expansion term
        // is trivially easy. Difficulty alone would put it last.
        validateVolumes: ({ keywords }) =>
          Promise.resolve(
            keywords.map((keyword) => ({
              keyword,
              volume: 320,
              difficulty: keyword === "clinic scheduling tool" ? 95 : 5,
              intent: "informational",
              serpFeatures: [],
            })),
          ),
      }),
    );

    const sampled = sampleSerp.mock.calls[0]?.[0].keywords ?? [];
    expect(sampled[0]).toBe("clinic scheduling tool");
    // Twenty-one survivors into twenty slots: the tail the reader would have
    // looked at last is what gets cut.
    expect(sampled).toHaveLength(KEYWORD_SERP_SAMPLE_CAP);
    expect(sampled).not.toContain(
      `billing term ${KEYWORD_SERP_SAMPLE_CAP - 1}`,
    );
  });

  it("samples only terms with measured demand that Search Console has not seen", async () => {
    // Both exclusions are cost decisions with a reason. A term the provider
    // has no volume for cannot be judged on demand anyway, and a term the site
    // already ranks for is not an opening — paying to look at either one takes
    // budget from a term that is.
    const sampleSerp = vi.fn(
      ({ keywords }: { readonly keywords: readonly string[] }) =>
        Promise.resolve(
          keywords.map((keyword) => ({ keyword, domains: ["small.example"] })),
        ),
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
          ]),
        validateVolumes: ({ keywords }) =>
          Promise.resolve(
            keywords
              // The provider stays silent about this one, which is no-data
              // rather than zero demand.
              .filter((keyword) => keyword !== "clinic scheduling tool")
              .map((keyword) => ({
                keyword,
                volume: 320,
                difficulty: 12,
                intent: "informational",
                serpFeatures: [],
              })),
          ),
        // Already served, strongly, by the site's own property.
        readCoverageQueries: () =>
          Promise.resolve([
            { query: "patient intake forms", impressions: 900, position: 3 },
          ]),
      }),
    );

    expect(sampleSerp.mock.calls[0]?.[0].keywords).toEqual([
      "dental billing software",
    ]);
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
      schemaVersion: "keyword_opportunity_map.v1",
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
