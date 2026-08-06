import { describe, expect, it, vi } from "vitest";
import { SourceError } from "../adapter.ts";
import { HttpDataForSeoClient, type DataForSeoFetch } from "./client.ts";

interface BacklinkSummaryRequest {
  readonly target: string;
}

interface BacklinkListRequest {
  readonly target: string;
  readonly limit: number;
}

interface BacklinkSummaryResponse {
  readonly summary: {
    readonly target: string;
    readonly firstSeen: string | null;
    readonly lostDate: string | null;
    readonly rank: number;
    readonly backlinks: number;
    readonly referringDomains: number;
    readonly referringMainDomains: number;
  };
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

interface BacklinkRowsResponse {
  readonly rows: readonly {
    readonly sourceDomain: string;
    readonly sourceUrl: string;
    readonly targetDomain: string;
    readonly targetUrl: string;
    readonly isNew: boolean;
    readonly isLost: boolean;
    readonly spamScore: number;
    readonly rank: number;
    readonly pageRank: number;
    readonly domainRank: number;
    readonly sourceStatusCode: number;
    readonly firstSeen: string | null;
    readonly previousSeen: string | null;
    readonly lastSeen: string | null;
    readonly attributes: readonly string[];
    readonly dofollow: boolean;
    readonly anchor: string | null;
    readonly linksCount: number;
    readonly isBroken: boolean;
    readonly targetStatusCode: number | null;
  }[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

interface ReferringDomainRowsResponse {
  readonly rows: readonly {
    readonly domain: string;
    readonly rank: number;
    readonly backlinks: number;
    readonly firstSeen: string | null;
    readonly lostDate: string | null;
    readonly spamScore: number;
  }[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

interface DomainPageRowsResponse {
  readonly rows: readonly {
    readonly pageUrl: string;
    readonly title: string | null;
    readonly statusCode: number | null;
    readonly rank: number;
    readonly backlinks: number;
    readonly referringDomains: number;
  }[];
  readonly totalCount: number;
  readonly itemsCount: number;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

interface BacklinksClientApi {
  backlinkSummary(
    request: BacklinkSummaryRequest,
    signal?: AbortSignal,
  ): Promise<BacklinkSummaryResponse>;
  backlinks(
    request: BacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<BacklinkRowsResponse>;
  referringDomains(
    request: BacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<ReferringDomainRowsResponse>;
  domainPages(
    request: BacklinkListRequest,
    signal?: AbortSignal,
  ): Promise<DomainPageRowsResponse>;
}

interface BacklinksClientModule {
  readonly DATAFORSEO_BACKLINK_SUMMARY_LIVE_URL?: unknown;
  readonly DATAFORSEO_BACKLINKS_LIVE_URL?: unknown;
  readonly DATAFORSEO_REFERRING_DOMAINS_LIVE_URL?: unknown;
  readonly DATAFORSEO_DOMAIN_PAGES_LIVE_URL?: unknown;
}

const SUMMARY_URL = "https://api.dataforseo.com/v3/backlinks/summary/live";
const BACKLINKS_URL = "https://api.dataforseo.com/v3/backlinks/backlinks/live";
const REFERRING_DOMAINS_URL =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";
const DOMAIN_PAGES_URL =
  "https://api.dataforseo.com/v3/backlinks/domain_pages/live";

function requireBacklinksClient(
  client: HttpDataForSeoClient,
): BacklinksClientApi {
  const candidate = client as unknown as Partial<BacklinksClientApi>;
  expect(typeof candidate.backlinkSummary).toBe("function");
  expect(typeof candidate.backlinks).toBe("function");
  expect(typeof candidate.referringDomains).toBe("function");
  expect(typeof candidate.domainPages).toBe("function");
  return candidate as BacklinksClientApi;
}

async function requireBacklinksClientModule(): Promise<BacklinksClientModule> {
  const candidate = (await import("./client.ts")) as BacklinksClientModule;
  expect(candidate.DATAFORSEO_BACKLINK_SUMMARY_LIVE_URL).toBe(SUMMARY_URL);
  expect(candidate.DATAFORSEO_BACKLINKS_LIVE_URL).toBe(BACKLINKS_URL);
  expect(candidate.DATAFORSEO_REFERRING_DOMAINS_LIVE_URL).toBe(
    REFERRING_DOMAINS_URL,
  );
  expect(candidate.DATAFORSEO_DOMAIN_PAGES_LIVE_URL).toBe(DOMAIN_PAGES_URL);
  return candidate;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function envelope(
  path: readonly string[],
  data: Record<string, unknown>,
  result: unknown,
  cost: number,
): unknown {
  return {
    version: "0.1.20260720",
    status_code: 20_000,
    status_message: "Ok.",
    time: "0.2100 sec.",
    cost,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        status_code: 20_000,
        status_message: "Ok.",
        time: "0.1900 sec.",
        cost,
        result_count: 1,
        path,
        data,
        result: [result],
      },
    ],
  };
}

const summaryResult = {
  target: "example.com",
  first_seen: "2024-01-02 03:04:05 +00:00",
  lost_date: null,
  rank: 74,
  backlinks: 12,
  backlinks_spam_score: 3,
  crawled_pages: 40,
  info: {
    server: "nginx",
    cms: null,
    platform_type: ["unknown"],
    ip_address: "203.0.113.8",
    country: "US",
    is_ip: false,
    target_spam_score: 2,
  },
  internal_links_count: 20,
  external_links_count: 8,
  broken_backlinks: 1,
  broken_pages: 1,
  referring_domains: 5,
  referring_domains_nofollow: 2,
  referring_main_domains: 4,
  referring_main_domains_nofollow: 1,
  referring_ips: 4,
  referring_subnets: 4,
  referring_pages: 7,
  referring_links_tld: { com: 7 },
  referring_links_types: { anchor: 12 },
  referring_links_attributes: { nofollow: 2 },
  referring_links_platform_types: { blogs: 3 },
  referring_links_semantic_locations: { article: 7 },
  referring_links_countries: { US: 5 },
  referring_pages_nofollow: 2,
};

const backlinkResult = {
  target: "example.com",
  mode: "as_is",
  total_count: 12,
  items_count: 1,
  search_after_token: "fixture-next-token",
  items: [
    {
      type: "backlink",
      domain_from: "referrer.test",
      url_from: "https://referrer.test/post",
      url_from_https: true,
      domain_to: "example.com",
      url_to: "https://example.com/guide",
      url_to_https: true,
      tld_from: "test",
      is_new: true,
      is_lost: false,
      backlink_spam_score: 2,
      rank: 66,
      page_from_rank: 61,
      domain_from_rank: 63,
      domain_from_platform_type: ["blogs"],
      domain_from_is_ip: false,
      domain_from_ip: "203.0.113.10",
      domain_from_country: "US",
      page_from_external_links: 8,
      page_from_internal_links: 11,
      page_from_size: 32000,
      page_from_encoding: "utf-8",
      page_from_language: "en",
      page_from_title: "A useful guide",
      page_from_status_code: 200,
      first_seen: "2026-07-01 00:00:00 +00:00",
      prev_seen: "2026-07-30 00:00:00 +00:00",
      last_seen: "2026-08-05 00:00:00 +00:00",
      item_type: "anchor",
      attributes: ["nofollow"],
      dofollow: false,
      original: true,
      alt: null,
      image_url: null,
      anchor: "GenGrowth guide",
      text_pre: "Read the",
      text_post: "today",
      semantic_location: "article",
      links_count: 1,
      group_count: 1,
      is_broken: false,
      url_to_status_code: 200,
      url_to_spam_score: 1,
      url_to_redirect_target: null,
      ranked_keywords_info: {
        page_from_keywords_count_top_3: 1,
        page_from_keywords_count_top_10: 4,
        page_from_keywords_count_top_100: 20,
      },
      is_indirect_link: false,
      indirect_link_path: null,
    },
  ],
};

const referringDomainsResult = {
  target: "example.com",
  total_count: 5,
  items_count: 1,
  items: [
    {
      type: "backlinks_referring_domain",
      domain: "referrer.test",
      rank: 63,
      backlinks: 3,
      first_seen: "2026-07-01 00:00:00 +00:00",
      lost_date: null,
      backlinks_spam_score: 2,
      broken_backlinks: 0,
      broken_pages: 0,
      referring_domains: 4,
      referring_domains_nofollow: 1,
      referring_main_domains: 4,
      referring_main_domains_nofollow: 1,
      referring_ips: 4,
      referring_subnets: 4,
      referring_pages: 6,
      referring_links_tld: { com: 6 },
      referring_links_types: { anchor: 3 },
      referring_links_attributes: { nofollow: 1 },
      referring_links_platform_types: { blogs: 3 },
      referring_links_semantic_locations: { article: 3 },
      referring_links_countries: { US: 3 },
      referring_pages_nofollow: 1,
    },
  ],
};

const domainPagesResult = {
  target: "example.com",
  total_count: 8,
  items_count: 1,
  items: [
    {
      type: "backlinks_domain_page",
      main_domain: "example.com",
      domain: "example.com",
      tld: "com",
      page: "https://example.com/guide",
      ip: "203.0.113.8",
      first_visited: "2026-06-01 00:00:00 +00:00",
      prev_visited: "2026-07-30 00:00:00 +00:00",
      fetch_time: "2026-08-05 00:00:00 +00:00",
      status_code: 200,
      location: null,
      size: 42000,
      encoded_size: 12000,
      content_encoding: "gzip",
      media_type: "text/html",
      server: "nginx",
      meta: {
        title: "Example guide",
        canonical: "https://example.com/guide",
        internal_links_count: 12,
        external_links_count: 4,
        images_count: 2,
        words_count: 900,
        page_spam_score: 1,
        social_media_tags: null,
        h1: ["Example guide"],
        h2: [],
        h3: [],
        images_alt: [],
        powered_by: [],
        language: "en",
        charset: "utf-8",
        platform_type: ["unknown"],
        technologies: null,
      },
      page_summary: {
        first_seen: "2024-01-02 03:04:05 +00:00",
        lost_date: null,
        rank: 55,
        backlinks: 7,
        backlinks_spam_score: 1,
        broken_backlinks: 0,
        broken_pages: 0,
        referring_domains: 3,
        referring_domains_nofollow: 1,
        referring_main_domains: 3,
        referring_main_domains_nofollow: 1,
        referring_ips: 3,
        referring_subnets: 3,
        referring_pages: 5,
        referring_links_tld: { com: 5 },
        referring_links_types: { anchor: 7 },
        referring_links_attributes: { nofollow: 1 },
        referring_links_platform_types: { blogs: 2 },
        referring_links_semantic_locations: { article: 5 },
        referring_links_countries: { US: 4 },
        referring_pages_nofollow: 1,
      },
    },
  ],
};

describe("HttpDataForSeoClient Backlinks live API", () => {
  it("uses the four official live endpoints, Basic Auth, one_hundred rank scale, live-only scope, and bounded tasks", async () => {
    await requireBacklinksClientModule();
    const captured = new Map<string, RequestInit>();
    const fetchImpl: DataForSeoFetch = async (url, init) => {
      captured.set(url, init ?? {});
      switch (url) {
        case SUMMARY_URL:
          return jsonResponse(
            envelope(
              ["v3", "backlinks", "summary", "live"],
              { api: "backlinks", function: "summary" },
              summaryResult,
              0.02,
            ),
          );
        case BACKLINKS_URL:
          return jsonResponse(
            envelope(
              ["v3", "backlinks", "backlinks", "live"],
              { api: "backlinks", function: "backlinks" },
              backlinkResult,
              0.03,
            ),
          );
        case REFERRING_DOMAINS_URL:
          return jsonResponse(
            envelope(
              ["v3", "backlinks", "referring_domains", "live"],
              { api: "backlinks", function: "referring_domains" },
              referringDomainsResult,
              0.04,
            ),
          );
        case DOMAIN_PAGES_URL:
          return jsonResponse(
            envelope(
              ["v3", "backlinks", "domain_pages", "live"],
              { api: "backlinks", function: "domain_pages" },
              domainPagesResult,
              0.05,
            ),
          );
        default:
          throw new Error(`Unexpected fixture URL: ${url}`);
      }
    };
    const client = requireBacklinksClient(
      new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl,
      }),
    );

    const [summary, backlinks, domains, pages] = await Promise.all([
      client.backlinkSummary({ target: "example.com" }),
      client.backlinks({ target: "example.com", limit: 500 }),
      client.referringDomains({ target: "example.com", limit: 100 }),
      client.domainPages({ target: "example.com", limit: 500 }),
    ]);

    const expectedAuthorization = `Basic ${Buffer.from(
      "fixture-login:fixture-password",
    ).toString("base64")}`;
    for (const init of captured.values()) {
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        expectedAuthorization,
      );
    }
    expect(JSON.parse(String(captured.get(SUMMARY_URL)?.body))).toEqual([
      {
        target: "example.com",
        include_subdomains: true,
        include_indirect_links: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        rank_scale: "one_hundred",
      },
    ]);
    expect(JSON.parse(String(captured.get(BACKLINKS_URL)?.body))).toEqual([
      {
        target: "example.com",
        mode: "as_is",
        limit: 500,
        include_subdomains: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        rank_scale: "one_hundred",
      },
    ]);
    expect(
      JSON.parse(String(captured.get(REFERRING_DOMAINS_URL)?.body)),
    ).toEqual([
      {
        target: "example.com",
        limit: 100,
        offset: 0,
        include_subdomains: true,
        include_indirect_links: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        rank_scale: "one_hundred",
      },
    ]);
    expect(JSON.parse(String(captured.get(DOMAIN_PAGES_URL)?.body))).toEqual([
      {
        target: "example.com",
        limit: 500,
        offset: 0,
        include_subdomains: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        rank_scale: "one_hundred",
      },
    ]);

    expect(summary).toMatchObject({
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
    });
    expect(backlinks).toMatchObject({
      rows: [
        {
          sourceDomain: "referrer.test",
          sourceUrl: "https://referrer.test/post",
          targetDomain: "example.com",
          targetUrl: "https://example.com/guide",
          isNew: true,
          isLost: false,
          spamScore: 2,
          rank: 66,
          pageRank: 61,
          domainRank: 63,
          sourceStatusCode: 200,
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
    });
    expect(domains).toMatchObject({
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
    });
    expect(pages).toMatchObject({
      rows: [
        {
          pageUrl: "https://example.com/guide",
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
    });
    expect(JSON.stringify([summary, backlinks, domains, pages])).not.toContain(
      "fixture-password",
    );
    expect(JSON.stringify([summary, backlinks, domains, pages])).not.toContain(
      expectedAuthorization,
    );
  });

  it.each([
    ["backlinks"],
    ["referringDomains"],
    ["domainPages"],
  ] as const)("rejects an over-1000 %s limit before spending", async (method) => {
    const fetchImpl = vi.fn<DataForSeoFetch>();
    const client = requireBacklinksClient(
      new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl,
      }),
    );

    const error = await client[method]({
      target: "example.com",
      limit: 1_001,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["backlinkSummary"],
    ["backlinks"],
    ["referringDomains"],
    ["domainPages"],
  ] as const)("maps a failed %s task without leaking provider prose", async (method) => {
    const fetchImpl = vi.fn<DataForSeoFetch>(async () =>
      jsonResponse({
        version: "0.1.20260720",
        status_code: 20_000,
        status_message: "Ok.",
        time: "0.1000 sec.",
        cost: 0,
        tasks_count: 1,
        tasks_error: 1,
        tasks: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            status_code: 40_204,
            status_message: "provider-secret-prose",
            time: "0.0900 sec.",
            cost: 0,
            result_count: 0,
            path: ["v3", "backlinks", "fixture", "live"],
            data: {},
            result: null,
          },
        ],
      }),
    );
    const client = requireBacklinksClient(
      new HttpDataForSeoClient({
        login: "fixture-login",
        password: "fixture-password",
        fetchImpl,
      }),
    );
    const request =
      method === "backlinkSummary"
        ? { target: "example.com" }
        : { target: "example.com", limit: 100 };

    const error = await client[method](request as BacklinkListRequest).catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code: "PERMISSION_DENIED" });
    expect((error as Error).message).not.toContain("provider-secret-prose");
    expect((error as Error).message).not.toContain("fixture-password");
  });
});
