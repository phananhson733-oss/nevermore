import { describe, expect, it } from "vitest";
import { SourceError, isTransient } from "../adapter.ts";
import type { DataForSeoFetch } from "./client.ts";
import {
  createDataForSeoKeywordMetricsClient,
  dataForSeoKeywordKey,
  DATAFORSEO_BULK_RANKS_LIVE_URL,
  DATAFORSEO_KEYWORD_OVERVIEW_LIVE_URL,
  DATAFORSEO_SERP_ORGANIC_LIVE_URL,
  MAX_DATAFORSEO_BULK_RANKS_BATCH,
  MAX_DATAFORSEO_KEYWORD_OVERVIEW_BATCH,
  MAX_DATAFORSEO_KEYWORD_OVERVIEW_KEYWORDS,
} from "./keyword-metrics.ts";

const CREDENTIALS = { login: "fixture-login", password: "fixture-password" };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
  readonly body: unknown;
}

interface RecordingFetch {
  readonly calls: readonly RecordedCall[];
  readonly fetchImpl: DataForSeoFetch;
}

/** Replays one queued payload per call so batching is observable. */
function recordingFetch(payloads: readonly unknown[]): RecordingFetch {
  const calls: RecordedCall[] = [];
  const queue = [...payloads];
  const fetchImpl: DataForSeoFetch = async (url, init) => {
    calls.push({
      url,
      init,
      body: JSON.parse(String(init?.body)) as unknown,
    });
    const payload = queue.length > 1 ? queue.shift() : queue[0];
    return jsonResponse(payload);
  };
  return { calls, fetchImpl };
}

function overviewEnvelope(
  items: readonly unknown[] | null,
  cost = 0.011,
): unknown {
  return {
    status_code: 20_000,
    status_message: "Ok.",
    cost,
    tasks: [
      {
        status_code: 20_000,
        status_message: "Ok.",
        cost,
        result: [{ items }],
      },
    ],
  };
}

function overviewItem(
  keyword: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    keyword,
    keyword_info: { search_volume: 320 },
    keyword_properties: { keyword_difficulty: 12 },
    search_intent_info: { main_intent: "informational" },
    serp_info: { serp_item_types: ["organic", "people_also_ask"] },
    ...overrides,
  };
}

function serpEnvelope(
  items: readonly unknown[] | null,
  itemTypes: readonly string[] | null = ["organic", "ai_overview"],
  cost = 0.002,
): unknown {
  return {
    status_code: 20_000,
    cost,
    tasks: [
      {
        status_code: 20_000,
        cost,
        result: [
          {
            ...(itemTypes === null ? {} : { item_types: itemTypes }),
            items,
          },
        ],
      },
    ],
  };
}

function organicItem(
  rankGroup: number,
  domain: string,
  extra: Readonly<Record<string, unknown>> = {},
): unknown {
  return { type: "organic", rank_group: rankGroup, domain, ...extra };
}

function bulkRanksEnvelope(
  items: readonly unknown[] | null,
  cost = 0.0004,
): unknown {
  return {
    status_code: 20_000,
    cost,
    tasks: [{ status_code: 20_000, cost, result: [{ items }] }],
  };
}

function clientFor(payloads: readonly unknown[]): {
  readonly client: ReturnType<typeof createDataForSeoKeywordMetricsClient>;
  readonly calls: readonly RecordedCall[];
} {
  const recorder = recordingFetch(payloads);
  return {
    client: createDataForSeoKeywordMetricsClient({
      ...CREDENTIALS,
      fetchImpl: recorder.fetchImpl,
    }),
    calls: recorder.calls,
  };
}

describe("createDataForSeoKeywordMetricsClient", () => {
  it("rejects blank credentials before any request is attempted", () => {
    expect(() =>
      createDataForSeoKeywordMetricsClient({ login: " ", password: "x" }),
    ).toThrow(SourceError);
    expect(() =>
      createDataForSeoKeywordMetricsClient({ login: "x", password: "" }),
    ).toThrow(/credentials are required/);
  });
});

describe("keywordOverview", () => {
  it("sends the measured request shape and keeps Basic Auth in the header", async () => {
    const { client, calls } = clientFor([
      overviewEnvelope([overviewItem("crm for agencies")]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["CRM for agencies"],
      locationCode: 2840,
      languageCode: "EN",
    });

    expect(calls[0]?.url).toBe(DATAFORSEO_KEYWORD_OVERVIEW_LIVE_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("fixture-login:fixture-password").toString("base64")}`,
    );
    expect(calls[0]?.body).toEqual([
      {
        keywords: ["CRM for agencies"],
        location_code: 2840,
        language_code: "en",
        include_serp_info: true,
      },
    ]);
    expect(result.rows).toEqual([
      {
        keyword: "crm for agencies",
        searchVolume: 320,
        keywordDifficulty: 12,
        mainIntent: "informational",
        serpItemTypes: ["organic", "people_also_ask"],
      },
    ]);
    expect(result.missingKeywords).toEqual([]);
    expect(result.costUsd).toBe(0.011);
    expect(result.batchCount).toBe(1);
    expect(result.providerStatusCodes).toEqual([20_000]);
    expect(result.taskStatusCodes).toEqual([20_000]);
  });

  it("reports keywords the provider silently dropped, in the caller's spelling", async () => {
    const { client } = clientFor([
      overviewEnvelope([overviewItem("crm for agencies")]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["CRM for agencies", "Agency Billing Software", "no data term"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.missingKeywords).toEqual([
      "Agency Billing Software",
      "no data term",
    ]);
  });

  it("does not call a returned keyword missing when only casing or spacing differ", async () => {
    const { client } = clientFor([
      overviewEnvelope([overviewItem("crm for agencies")]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["  CRM   For Agencies "],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.missingKeywords).toEqual([]);
    expect(dataForSeoKeywordKey("  CRM   For Agencies ")).toBe(
      "crm for agencies",
    );
  });

  it("keeps an explicit zero volume apart from an absent one", async () => {
    const { client } = clientFor([
      overviewEnvelope([
        overviewItem("measured zero", { keyword_info: { search_volume: 0 } }),
        overviewItem("null volume", { keyword_info: { search_volume: null } }),
        overviewItem("no keyword_info", { keyword_info: null }),
      ]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["measured zero", "null volume", "no keyword_info"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows.map((row) => row.searchVolume)).toEqual([0, null, null]);
  });

  it("returns null rather than an empty list when the provider sent no SERP snapshot", async () => {
    const { client } = clientFor([
      overviewEnvelope([
        overviewItem("no serp info", {
          serp_info: null,
          keyword_properties: null,
          search_intent_info: null,
        }),
        overviewItem("serp info without types", { serp_info: {} }),
      ]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["no serp info", "serp info without types"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows[0]).toEqual({
      keyword: "no serp info",
      searchVolume: 320,
      keywordDifficulty: null,
      mainIntent: null,
      serpItemTypes: null,
    });
    expect(result.rows[1]?.serpItemTypes).toBeNull();
  });

  it("splits past the 700-keyword batch ceiling and sums cost across batches", async () => {
    const keywords = Array.from(
      { length: MAX_DATAFORSEO_KEYWORD_OVERVIEW_BATCH + 1 },
      (_value, index) => `term ${index}`,
    );
    const { client, calls } = clientFor([
      overviewEnvelope([overviewItem("term 0")], 0.7),
      overviewEnvelope([overviewItem("term 700")], 0.001),
    ]);

    const result = await client.keywordOverview({
      keywords,
      locationCode: 2840,
      languageCode: "en",
    });

    expect(calls).toHaveLength(2);
    expect(
      (calls[0]?.body as [{ keywords: string[] }])[0].keywords,
    ).toHaveLength(MAX_DATAFORSEO_KEYWORD_OVERVIEW_BATCH);
    expect((calls[1]?.body as [{ keywords: string[] }])[0].keywords).toEqual([
      "term 700",
    ]);
    expect(result.batchCount).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.701, 6);
    expect(result.rows).toHaveLength(2);
    expect(result.missingKeywords).toHaveLength(keywords.length - 2);
    expect(result.providerStatusCodes).toEqual([20_000, 20_000]);
  });

  it("deduplicates the requested list before spending a batch on it", async () => {
    const { client, calls } = clientFor([
      overviewEnvelope([overviewItem("crm for agencies")]),
    ]);

    const result = await client.keywordOverview({
      keywords: ["crm for agencies", "CRM FOR AGENCIES"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect((calls[0]?.body as [{ keywords: string[] }])[0].keywords).toEqual([
      "crm for agencies",
    ]);
    expect(result.missingKeywords).toEqual([]);
  });

  it("treats a no-results envelope as total silence while still billing it", async () => {
    const { client } = clientFor([
      {
        status_code: 40_102,
        status_message: "No Search Results.",
        cost: 0.004,
      },
    ]);

    const result = await client.keywordOverview({
      keywords: ["obscure term"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toEqual([]);
    expect(result.missingKeywords).toEqual(["obscure term"]);
    expect(result.costUsd).toBe(0.004);
    expect(result.taskStatusCodes).toEqual([40_102]);
  });

  it("accepts an omitted or null items array as an empty answer", async () => {
    const { client } = clientFor([overviewEnvelope(null)]);

    const result = await client.keywordOverview({
      keywords: ["nothing"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toEqual([]);
    expect(result.missingKeywords).toEqual(["nothing"]);
  });

  it("accepts a task that omitted its result entirely", async () => {
    const { client } = clientFor([
      {
        status_code: 20_000,
        cost: 0.001,
        tasks: [{ status_code: 20_000, cost: 0.001, result: null }],
      },
    ]);

    const result = await client.keywordOverview({
      keywords: ["nothing"],
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toEqual([]);
    expect(result.costUsd).toBe(0.001);
  });

  it("rejects an unusable request before any HTTP call", async () => {
    const { client, calls } = clientFor([overviewEnvelope([])]);
    const base = { locationCode: 2840, languageCode: "en" } as const;

    await expect(
      client.keywordOverview({ ...base, keywords: [] }),
    ).rejects.toThrow(/1 to 5000 distinct terms/);
    await expect(
      client.keywordOverview({ ...base, keywords: ["ok", "  "] }),
    ).rejects.toThrow(/non-empty strings/);
    await expect(
      client.keywordOverview({
        ...base,
        keywords: Array.from(
          { length: MAX_DATAFORSEO_KEYWORD_OVERVIEW_KEYWORDS + 1 },
          (_value, index) => `term ${index}`,
        ),
      }),
    ).rejects.toThrow(/distinct terms/);
    await expect(
      client.keywordOverview({
        keywords: ["ok"],
        locationCode: 0,
        languageCode: "en",
      }),
    ).rejects.toThrow(/locationCode must be a positive integer/);
    await expect(
      client.keywordOverview({
        keywords: ["ok"],
        locationCode: 2840,
        languageCode: "english",
      }),
    ).rejects.toThrow(/languageCode must be a primary language code/);
    expect(calls).toHaveLength(0);
  });

  it("fails loudly on malformed items instead of guessing", async () => {
    const cases: readonly [unknown, RegExp][] = [
      [overviewEnvelope([{ keyword: "" }]), /did not contain a keyword/],
      [
        overviewEnvelope([
          overviewItem("x", {
            search_intent_info: { main_intent: "shopping" },
          }),
        ]),
        /supported intent/,
      ],
      [
        overviewEnvelope([
          overviewItem("x", { keyword_info: { search_volume: -3 } }),
        ]),
        /non-negative number/,
      ],
      [
        overviewEnvelope([
          overviewItem("x", {
            keyword_properties: { keyword_difficulty: 140 },
          }),
        ]),
        /integer from 0 to 100/,
      ],
      [
        overviewEnvelope([
          overviewItem("x", {
            keyword_properties: { keyword_difficulty: "12" },
          }),
        ]),
        /integer from 0 to 100/,
      ],
      [
        overviewEnvelope([
          overviewItem("x", { serp_info: { serp_item_types: [""] } }),
        ]),
        /non-empty string/,
      ],
      [
        overviewEnvelope([
          overviewItem("x", { serp_info: { serp_item_types: "organic" } }),
        ]),
        /was not an array/,
      ],
      [overviewEnvelope(["not an object"]), /was not an object/],
      [{ status_code: 20_000, cost: 0.1, tasks: [] }, /exactly one task/],
      [{ status_code: 20_000, cost: "free", tasks: [] }, /non-negative number/],
      [{ cost: 0.1, tasks: [] }, /valid status code/],
      ["not an envelope", /was not an object/],
    ];

    for (const [payload, message] of cases) {
      const { client } = clientFor([payload]);
      await expect(
        client.keywordOverview({
          keywords: ["x"],
          locationCode: 2840,
          languageCode: "en",
        }),
      ).rejects.toThrow(message);
    }
  });
});

describe("serpOrganic", () => {
  it("asks for one desktop page and keeps only organic results", async () => {
    const { client, calls } = clientFor([
      serpEnvelope([
        { type: "ai_overview", rank_group: 1 },
        organicItem(1, "www.Strong.com", {
          title: "Strong result",
          url: "https://www.strong.com/crm",
        }),
        { type: "people_also_ask", rank_group: 2 },
        organicItem(2, "weak-blog.io"),
      ]),
    ]);

    const result = await client.serpOrganic({
      keyword: " crm for agencies ",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(calls[0]?.url).toBe(DATAFORSEO_SERP_ORGANIC_LIVE_URL);
    expect(calls[0]?.body).toEqual([
      {
        keyword: "crm for agencies",
        location_code: 2840,
        language_code: "en",
        device: "desktop",
        depth: 10,
      },
    ]);
    expect(result).toEqual({
      keyword: "crm for agencies",
      rows: [
        {
          rankGroup: 1,
          domain: "strong.com",
          sitelinkCount: 0,
          title: "Strong result",
          url: "https://www.strong.com/crm",
        },
        {
          rankGroup: 2,
          domain: "weak-blog.io",
          sitelinkCount: 0,
          title: null,
          url: null,
        },
      ],
      itemTypes: ["organic", "ai_overview"],
      aiOverview: {
        markdown: null,
        isAsync: null,
        references: [],
      },
      communityItems: [],
      unresolvedItemCount: 0,
      costUsd: 0.002,
      providerStatusCode: 20_000,
      taskStatusCode: 20_000,
    });
  });

  it("carries the sitelinks a result shows, and zero for one described without them", async () => {
    const { client } = clientFor([
      serpEnvelope([
        organicItem(1, "brand.com", {
          url: "https://brand.com/",
          links: [{ title: "Pricing" }, { title: "Docs" }, { title: "Blog" }],
        }),
        organicItem(2, "small.io"),
      ]),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows[0]).toEqual({
      rankGroup: 1,
      domain: "brand.com",
      sitelinkCount: 3,
      title: null,
      url: "https://brand.com/",
    });
    // A result the provider described without a links array and one that truly
    // shows no sitelinks are the same shape on the wire, so both read zero.
    expect(result.rows[1]?.sitelinkCount).toBe(0);
  });

  it("truncates to the requested depth even when the provider over-delivers", async () => {
    const items = Array.from({ length: 14 }, (_value, index) =>
      organicItem(index + 1, `site-${index}.com`),
    );
    const { client, calls } = clientFor([serpEnvelope(items)]);

    const tenDeep = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });
    expect(tenDeep.rows).toHaveLength(10);
    expect(tenDeep.rows.at(-1)?.domain).toBe("site-9.com");

    const threeDeep = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
      depth: 3,
    });
    expect((calls[1]?.body as [{ depth: number }])[0].depth).toBe(3);
    expect(threeDeep.rows).toHaveLength(3);
  });

  it("counts organic items whose rank or host was unusable", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          organicItem(1, "good.com"),
          { type: "organic", rank_group: 2, domain: "not a host" },
          { type: "organic", rank_group: 0, domain: "zero-rank.com" },
          { type: "organic", domain: "no-rank.com" },
        ],
        null,
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toEqual([
      {
        rankGroup: 1,
        domain: "good.com",
        sitelinkCount: 0,
        title: null,
        url: null,
      },
    ]);
    expect(result.unresolvedItemCount).toBe(3);
    expect(result.itemTypes).toBeNull();
    expect(result.aiOverview).toBeNull();
    expect(result.communityItems).toBeNull();
  });

  it("returns an empty sample rather than inventing one when the SERP is missing", async () => {
    const { client } = clientFor([serpEnvelope(null, null)]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows).toEqual([]);
    expect(result.itemTypes).toBeNull();
    expect(result.aiOverview).toBeNull();
    expect(result.communityItems).toBeNull();
    expect(result.costUsd).toBe(0.002);
  });

  it("loads async AI Overview content and preserves bounded community evidence", async () => {
    const { client, calls } = clientFor([
      serpEnvelope(
        [
          organicItem(1, "publisher.test", {
            title: "A practical CRM guide",
            url: "https://publisher.test/crm-guide",
          }),
          {
            type: "ai_overview",
            rank_group: 1,
            rank_absolute: 1,
            asynchronous_ai_overview: true,
            markdown:
              "\n## Short answer\nUse a CRM that matches the workflow.\n",
            references: [
              {
                type: "ai_overview_reference",
                source: "Reference publisher",
                domain: "www.reference.test",
                title: "Reference page",
                url: "https://reference.test/source",
              },
              {
                type: "ai_overview_reference",
                title: null,
                url: null,
              },
            ],
          },
          {
            type: "discussions_and_forums",
            rank_group: 1,
            rank_absolute: 5,
            items: [
              {
                type: "discussions_and_forums_element",
                title: "Operators discuss agency CRMs",
                url: "https://forum.test/thread",
                domain: "www.forum.test",
              },
            ],
          },
          {
            type: "video",
            rank_group: 1,
            rank_absolute: 7,
            items: [
              {
                type: "video_element",
                title: "CRM walkthrough",
                url: "https://video.test/watch",
                domain: "video.test",
              },
            ],
          },
          {
            type: "twitter",
            rank_group: 1,
            rank_absolute: 8,
            items: [
              {
                type: "twitter_element",
                tweet: "A field report",
                url: "https://x.com/operator/status/1",
              },
            ],
          },
          {
            type: "forum",
            rank_group: 4,
            title: "Legacy forum result",
            url: "https://legacy-forum.test/topic",
            domain: "legacy-forum.test",
          },
        ],
        [
          "organic",
          "ai_overview",
          "discussions_and_forums",
          "video",
          "twitter",
          "forum",
        ],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "agency crm",
      locationCode: 2840,
      languageCode: "en",
      loadAsyncAiOverview: true,
    });

    expect(calls[0]?.body).toEqual([
      {
        keyword: "agency crm",
        location_code: 2840,
        language_code: "en",
        device: "desktop",
        depth: 10,
        load_async_ai_overview: true,
      },
    ]);
    expect(result.rows).toEqual([
      {
        rankGroup: 1,
        domain: "publisher.test",
        sitelinkCount: 0,
        title: "A practical CRM guide",
        url: "https://publisher.test/crm-guide",
      },
    ]);
    expect(result.aiOverview).toEqual({
      markdown: "\n## Short answer\nUse a CRM that matches the workflow.\n",
      isAsync: true,
      references: [
        {
          source: "Reference publisher",
          domain: "reference.test",
          title: "Reference page",
          url: "https://reference.test/source",
        },
      ],
    });
    expect(result.communityItems).toEqual([
      {
        type: "discussions_and_forums",
        position: 5,
        title: "Operators discuss agency CRMs",
        url: "https://forum.test/thread",
        domain: "forum.test",
      },
      {
        type: "video",
        position: 7,
        title: "CRM walkthrough",
        url: "https://video.test/watch",
        domain: "video.test",
      },
      {
        type: "twitter",
        position: 8,
        title: null,
        url: "https://x.com/operator/status/1",
        domain: null,
      },
      {
        type: "forum",
        position: 4,
        title: "Legacy forum result",
        url: "https://legacy-forum.test/topic",
        domain: "legacy-forum.test",
      },
    ]);
  });

  it("reads references that are present only on nested AI Overview items", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "ai_overview",
            items: [
              {
                type: "ai_overview_element",
                references: [
                  {
                    title: "Nested reference",
                    url: "https://nested.test/source",
                  },
                ],
              },
              {
                type: "ai_overview_expanded_element",
                references: [
                  {
                    title: "Expanded reference",
                    url: "https://expanded.test/source",
                  },
                ],
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.aiOverview?.references).toEqual([
      {
        source: null,
        domain: null,
        title: "Nested reference",
        url: "https://nested.test/source",
      },
      {
        source: null,
        domain: null,
        title: "Expanded reference",
        url: "https://expanded.test/source",
      },
    ]);
  });

  it("retains source-only and domain-only AI Overview references", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "ai_overview",
            references: [
              {
                source: "Source identity",
                domain: null,
                title: null,
                url: null,
              },
              {
                source: null,
                domain: "bücher.test",
                title: null,
                url: null,
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.aiOverview?.references).toEqual([
      {
        source: "Source identity",
        domain: null,
        title: null,
        url: null,
      },
      {
        source: null,
        domain: "xn--bcher-kva.test",
        title: null,
        url: null,
      },
    ]);
  });

  it("deduplicates AI Overview references in top-level then nested order", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "ai_overview",
            references: [
              {
                title: "Top shared",
                url: "https://shared.test/source",
              },
              {
                domain: "www.domain.test",
                source: "Domain first",
                title: "Domain top",
                url: null,
              },
              {
                domain: null,
                source: "Source identity",
                title: "Source top",
                url: null,
              },
              {
                domain: null,
                source: null,
                title: "Top only",
                url: null,
              },
            ],
            items: [
              {
                type: "ai_overview_element",
                references: [
                  {
                    title: "Nested duplicate title",
                    url: "https://shared.test/source",
                  },
                  {
                    domain: "domain.test",
                    source: "Different source",
                    title: "Domain nested duplicate",
                    url: null,
                  },
                  {
                    domain: null,
                    source: "Source identity",
                    title: "Source nested duplicate",
                    url: null,
                  },
                  {
                    domain: null,
                    source: null,
                    title: "Top only",
                    url: null,
                  },
                  {
                    title: "Nested only",
                    url: "https://nested.test/source",
                  },
                ],
              },
              {
                type: "ai_overview_expanded_element",
                references: [
                  {
                    title: "Expanded only",
                    url: "https://expanded.test/source",
                  },
                ],
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.aiOverview?.references).toEqual([
      {
        source: null,
        domain: null,
        title: "Top shared",
        url: "https://shared.test/source",
      },
      {
        source: "Domain first",
        domain: "domain.test",
        title: "Domain top",
        url: null,
      },
      {
        source: "Source identity",
        domain: null,
        title: "Source top",
        url: null,
      },
      { source: null, domain: null, title: "Top only", url: null },
      {
        source: null,
        domain: null,
        title: "Nested only",
        url: "https://nested.test/source",
      },
      {
        source: null,
        domain: null,
        title: "Expanded only",
        url: "https://expanded.test/source",
      },
    ]);
  });

  it("accepts valid Unicode community hostnames via URL normalization", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: [
              {
                type: "discussions_and_forums_element",
                title: "International forum",
                url: null,
                domain: "bücher.test",
              },
            ],
          },
        ],
        ["discussions_and_forums"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.communityItems?.[0]?.domain).toBe("xn--bcher-kva.test");
  });

  it("keeps absent, null, and blank optional community domains as null", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: [
              {
                type: "discussions_and_forums_element",
                url: "https://forum.test/absent",
              },
              {
                type: "discussions_and_forums_element",
                url: "https://forum.test/null",
                domain: null,
              },
              {
                type: "discussions_and_forums_element",
                url: "https://forum.test/blank",
                domain: "   ",
              },
            ],
          },
        ],
        ["discussions_and_forums"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.communityItems?.map((item) => item.domain)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("counts title and markdown caps in Unicode code points", async () => {
    const title = "😀".repeat(512);
    const markdown = "😀".repeat(65_536);
    const source = "😀".repeat(512);
    const { client } = clientFor([
      serpEnvelope(
        [
          organicItem(1, "publisher.test", { title }),
          {
            type: "ai_overview",
            markdown,
            references: [{ source, title: null, url: null, domain: null }],
          },
        ],
        ["organic", "ai_overview"],
      ),
    ]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
    });

    expect(result.rows[0]?.title).toBe(title);
    expect(result.aiOverview?.markdown).toBe(markdown);
    expect(result.aiOverview?.references[0]?.source).toBe(source);
  });

  it("omits the paid request flag unless the caller explicitly enables it", async () => {
    const { client, calls } = clientFor([serpEnvelope([], [])]);

    const result = await client.serpOrganic({
      keyword: "crm",
      locationCode: 2840,
      languageCode: "en",
      loadAsyncAiOverview: false,
    });

    expect(calls[0]?.body).toEqual([
      {
        keyword: "crm",
        location_code: 2840,
        language_code: "en",
        device: "desktop",
        depth: 10,
      },
    ]);
    expect(result.aiOverview).toBeNull();
    expect(result.communityItems).toEqual([]);
  });

  it("fails closed on a present invalid community domain", async () => {
    const { client } = clientFor([
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: [
              {
                type: "discussions_and_forums_element",
                title: "Thread",
                url: null,
                domain: "not a host",
              },
            ],
          },
        ],
        ["discussions_and_forums"],
      ),
    ]);

    await expect(
      client.serpOrganic({
        keyword: "crm",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toThrow(/domain/);
  });

  it("fails closed on malformed present SERP evidence fields", async () => {
    const cases: readonly unknown[] = [
      serpEnvelope(
        [{ type: "ai_overview", markdown: 12 }],
        ["ai_overview"],
      ),
      serpEnvelope(
        [{ type: "ai_overview", asynchronous_ai_overview: "true" }],
        ["ai_overview"],
      ),
      serpEnvelope(
        [{ type: "ai_overview", references: "reference" }],
        ["ai_overview"],
      ),
      serpEnvelope(
        [
          {
            type: "ai_overview",
            items: [
              {
                type: "ai_overview_element",
                references: "reference",
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
      serpEnvelope(
        [
          {
            type: "ai_overview",
            references: [
              {
                source: "Reference",
                domain: "not a host",
                title: null,
                url: null,
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
      serpEnvelope(
        [organicItem(1, "publisher.test", { title: 123 })],
        ["organic"],
      ),
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: "thread",
          },
        ],
        ["discussions_and_forums"],
      ),
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: [
              {
                type: "unexpected_community_element",
                title: "Thread",
                url: "https://forum.test/thread",
                domain: "forum.test",
              },
            ],
          },
        ],
        ["discussions_and_forums"],
      ),
    ];

    for (const payload of cases) {
      const { client } = clientFor([payload]);
      await expect(
        client.serpOrganic({
          keyword: "crm",
          locationCode: 2840,
          languageCode: "en",
        }),
      ).rejects.toThrow();
    }
  });

  it("fails closed when remote text or evidence arrays exceed parser bounds", async () => {
    const oversizedTitle = "😀".repeat(513);
    const oversizedUrl = `https://example.test/${"u".repeat(2_048)}`;
    const oversizedMarkdown = "😀".repeat(65_537);
    const oversizedSource = "😀".repeat(513);
    const tooManyReferences = Array.from({ length: 101 }, () => ({
      type: "ai_overview_reference",
      title: "Reference",
      url: "https://reference.test/",
    }));
    const tooManyCommunityItems = Array.from({ length: 101 }, () => ({
      type: "discussions_and_forums_element",
      title: "Thread",
      url: "https://forum.test/thread",
      domain: "forum.test",
    }));
    const maximumReferences = Array.from({ length: 100 }, (_value, index) => ({
      type: "ai_overview_reference",
      title: `Top ${index}`,
      url: `https://reference.test/${index}`,
    }));
    const cases: readonly unknown[] = [
      serpEnvelope(
        [organicItem(1, "publisher.test", { title: oversizedTitle })],
        ["organic"],
      ),
      serpEnvelope(
        [organicItem(1, "publisher.test", { url: oversizedUrl })],
        ["organic"],
      ),
      serpEnvelope(
        [{ type: "ai_overview", markdown: oversizedMarkdown }],
        ["ai_overview"],
      ),
      serpEnvelope(
        [
          {
            type: "ai_overview",
            references: [
              {
                source: oversizedSource,
                domain: null,
                title: null,
                url: null,
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
      serpEnvelope(
        [{ type: "ai_overview", references: tooManyReferences }],
        ["ai_overview"],
      ),
      serpEnvelope(
        [
          {
            type: "ai_overview",
            references: maximumReferences,
            items: [
              {
                type: "ai_overview_element",
                references: [
                  {
                    title: "Nested overflow",
                    url: "https://nested.test/overflow",
                  },
                ],
              },
            ],
          },
        ],
        ["ai_overview"],
      ),
      serpEnvelope(
        [
          {
            type: "discussions_and_forums",
            rank_absolute: 4,
            items: tooManyCommunityItems,
          },
        ],
        ["discussions_and_forums"],
      ),
    ];

    for (const payload of cases) {
      const { client } = clientFor([payload]);
      await expect(
        client.serpOrganic({
          keyword: "crm",
          locationCode: 2840,
          languageCode: "en",
        }),
      ).rejects.toThrow(/exceeded|characters|items/);
    }
  });

  it("rejects an unusable SERP request", async () => {
    const { client, calls } = clientFor([serpEnvelope([])]);

    await expect(
      client.serpOrganic({
        keyword: " ",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toThrow(/keyword must be a non-empty string/);
    await expect(
      client.serpOrganic({
        keyword: "crm",
        locationCode: 2840,
        languageCode: "en",
        depth: 101,
      }),
    ).rejects.toThrow(/depth must be an integer from 1 to 100/);
    expect(calls).toHaveLength(0);
  });

  it("fails on a result whose items are not an array", async () => {
    const { client } = clientFor([
      {
        status_code: 20_000,
        cost: 0.002,
        tasks: [
          { status_code: 20_000, cost: 0.002, result: [{ items: "organic" }] },
        ],
      },
    ]);

    await expect(
      client.serpOrganic({
        keyword: "crm",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toThrow(/result items was not an array/);
  });

  it("fails on a task result that is not an array", async () => {
    const { client } = clientFor([
      {
        status_code: 20_000,
        cost: 0.002,
        tasks: [{ status_code: 20_000, cost: 0.002, result: { items: [] } }],
      },
    ]);

    await expect(
      client.serpOrganic({
        keyword: "crm",
        locationCode: 2840,
        languageCode: "en",
      }),
    ).rejects.toThrow(/task result was not an array/);
  });
});

describe("bulkRanks", () => {
  it("resolves sampled domains and names the ones that came back empty", async () => {
    const { client, calls } = clientFor([
      bulkRanksEnvelope([
        { target: "strong.com", rank: 812 },
        { target: "weak-blog.io", rank: 0 },
        { target: "not a host", rank: 500 },
        { target: "broken-rank.com", rank: null },
      ]),
    ]);

    const result = await client.bulkRanks({
      targets: [
        "www.Strong.com",
        "weak-blog.io",
        "missing.com",
        "broken-rank.com",
      ],
    });

    expect(calls[0]?.url).toBe(DATAFORSEO_BULK_RANKS_LIVE_URL);
    expect(calls[0]?.body).toEqual([
      {
        targets: [
          "strong.com",
          "weak-blog.io",
          "missing.com",
          "broken-rank.com",
        ],
      },
    ]);
    expect(result.rows).toEqual([
      { target: "strong.com", rank: 812 },
      { target: "weak-blog.io", rank: 0 },
    ]);
    expect(result.unresolvedTargets).toEqual([
      "missing.com",
      "broken-rank.com",
    ]);
    expect(result.costUsd).toBe(0.0004);
    expect(result.batchCount).toBe(1);
  });

  it("splits past the 1000-target ceiling and sums cost", async () => {
    const targets = Array.from(
      { length: MAX_DATAFORSEO_BULK_RANKS_BATCH + 1 },
      (_value, index) => `site-${index}.com`,
    );
    const { client, calls } = clientFor([
      bulkRanksEnvelope([{ target: "site-0.com", rank: 10 }], 0.002),
      bulkRanksEnvelope([{ target: "site-1000.com", rank: 20 }], 0.001),
    ]);

    const result = await client.bulkRanks({ targets });

    expect(calls).toHaveLength(2);
    expect((calls[0]?.body as [{ targets: string[] }])[0].targets).toHaveLength(
      MAX_DATAFORSEO_BULK_RANKS_BATCH,
    );
    expect((calls[1]?.body as [{ targets: string[] }])[0].targets).toEqual([
      "site-1000.com",
    ]);
    expect(result.batchCount).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.003, 6);
    expect(result.rows).toHaveLength(2);
    expect(result.unresolvedTargets).toHaveLength(targets.length - 2);
  });

  it("deduplicates targets that differ only by www or casing", async () => {
    const { client, calls } = clientFor([
      bulkRanksEnvelope([{ target: "strong.com", rank: 700 }]),
    ]);

    const result = await client.bulkRanks({
      targets: ["Strong.com", "www.strong.com"],
    });

    expect((calls[0]?.body as [{ targets: string[] }])[0].targets).toEqual([
      "strong.com",
    ]);
    expect(result.unresolvedTargets).toEqual([]);
  });

  it("rejects targets that are not hostnames", async () => {
    const { client, calls } = clientFor([bulkRanksEnvelope([])]);

    await expect(client.bulkRanks({ targets: [] })).rejects.toThrow(
      /1 to 10000 distinct hostnames/,
    );
    await expect(
      client.bulkRanks({ targets: ["https://example.com/path"] }),
    ).rejects.toThrow(/valid public hostnames/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a rank outside the provider's own scale", async () => {
    const { client } = clientFor([
      bulkRanksEnvelope([{ target: "strong.com", rank: 1_001 }]),
    ]);

    await expect(client.bulkRanks({ targets: ["strong.com"] })).rejects.toThrow(
      /integer from 0 to 1000/,
    );
  });
});

describe("error mapping", () => {
  const request = {
    keywords: ["x"],
    locationCode: 2840,
    languageCode: "en",
  } as const;

  async function codeFor(fetchImpl: DataForSeoFetch): Promise<string> {
    const client = createDataForSeoKeywordMetricsClient({
      ...CREDENTIALS,
      fetchImpl,
    });
    try {
      await client.keywordOverview(request);
    } catch (error) {
      return (error as SourceError).code;
    }
    throw new Error("expected the request to fail");
  }

  it("maps HTTP failures the way the rest of the DataForSEO seam does", async () => {
    const statuses: readonly [number, string][] = [
      [401, "AUTH_REQUIRED"],
      [402, "QUOTA_EXCEEDED"],
      [403, "PERMISSION_DENIED"],
      [404, "INVALID_CONFIGURATION"],
      [408, "TIMEOUT"],
      [429, "RATE_LIMITED"],
      [500, "UNAVAILABLE"],
      [418, "INVALID_RESPONSE"],
    ];
    for (const [status, code] of statuses) {
      expect(await codeFor(async () => jsonResponse({}, status))).toBe(code);
    }
  });

  it("treats 40203 account cost limit as a non-retryable quota failure", async () => {
    const code = await codeFor(async () =>
      jsonResponse({ status_code: 40_203, cost: 0, tasks: [] }),
    );

    expect(code).toBe("QUOTA_EXCEEDED");
    expect(isTransient("QUOTA_EXCEEDED")).toBe(false);
  });

  it("maps task-level provider statuses", async () => {
    const cases: readonly [number, string][] = [
      [40_100, "AUTH_REQUIRED"],
      [40_204, "PERMISSION_DENIED"],
      [40_202, "RATE_LIMITED"],
      [40_103, "UNAVAILABLE"],
      [50_000, "UNAVAILABLE"],
      [40_501, "INVALID_CONFIGURATION"],
      [10_000, "INVALID_RESPONSE"],
    ];
    for (const [status, code] of cases) {
      const payload = {
        status_code: 20_000,
        cost: 0.01,
        tasks: [{ status_code: status, cost: 0.01 }],
      };
      expect(await codeFor(async () => jsonResponse(payload))).toBe(code);
    }
  });

  it("maps a transport failure and an abort apart", async () => {
    expect(
      await codeFor(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("NETWORK_ERROR");
    expect(
      await codeFor(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    ).toBe("TIMEOUT");
  });

  it("stops before the request when the caller already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createDataForSeoKeywordMetricsClient({
      ...CREDENTIALS,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return jsonResponse(overviewEnvelope([]));
      },
    });

    await expect(client.keywordOverview(request)).rejects.toThrow(
      /aborted or timed out/,
    );
  });
});
