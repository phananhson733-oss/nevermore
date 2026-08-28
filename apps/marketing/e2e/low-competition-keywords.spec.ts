import { expect, test, type Page, type Route } from "@playwright/test";

import { seal } from "../src/lib/auth/sealed-cookie";

const TEST_COOKIE_KEY = "cd".repeat(32);
process.env.TOKEN_ENCRYPTION_KEY = TEST_COOKIE_KEY;
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.MARKETING_E2E_PORT ?? "3001"}`;

const CONTEXT_API = "POST /api/tools/hidden-keywords/context";
const OPPORTUNITIES_API = "POST /api/tools/hidden-keywords/opportunities";
const STATUS_API =
  "POST /api/tools/hidden-keywords/opportunities/status";
const KNOWN_SHELL_REQUESTS = new Set([
  "GET /api/auth/profile",
  "GET /api/auth/session",
  "GET /api/credits/balance",
  "GET /api/credits/ledger",
]);

const contextResponse = {
  data: {
    contextToken: "test-context-token",
    propositions: [
      {
        statement: "Appointment automation for independent clinics",
        sourceUrl: "https://acme.test/product",
      },
    ],
    pagesFetched: 3,
    productPagesFetched: 1,
    selection: {
      eligibleCandidates: 12,
      excludedCandidates: 4,
      attemptedCandidates: 2,
      truncatedCandidates: 10,
    },
    stopReason: "max_urls",
    contextSufficient: true,
  },
};

const eligibleRow = {
  keyword: "clinic appointment automation",
  lane: "seo",
  discoveryBasis: "site_proposition",
  questionForm: false,
  propositionIndex: 0,
  validation: {
    availability: "available",
    volume: 320,
    difficulty: 14,
    providerIntent: "commercial",
    intent: "commercial",
    serpFeatures: [],
  },
  serp: {
    status: "complete",
    failureReason: null,
    observedAt: "2026-08-28T00:00:00.000Z",
    organicResults: [],
    verdict: "winnable_evidence",
    weakestTopTenDomainRank: 40,
    weakestTopTenDomain: "small.test",
    weakestTopTenPosition: 3,
    topTenDomains: ["small.test"],
    topTenDomainRanks: [40],
    pageOneItemTypes: [],
    isEstimate: false,
  },
  serpIntent: null,
  signals: {
    youngDomain: {
      state: "observed",
      observation: {
        domain: "young.test",
        registrationDate: "2026-01-01T00:00:00.000Z",
        observedAt: "2026-08-28T00:00:00.000Z",
        ageMonths: 7,
      },
    },
    lowOrganicTrafficDomain: {
      state: "unavailable",
      observation: null,
      reason: "domain_traffic_evidence_incomplete",
    },
    communityResult: { state: "not_observed", observation: null },
  },
  aiOverview: null,
  decision: {
    disposition: "eligible",
    basis: "positive_signal_observed",
    positiveSignals: ["young_domain"],
    discounts: [],
  },
  coverage: "not_observed_in_bounded_inventory",
  supportingPage: {
    availability: "available",
    source: "llm_proposition_source",
    url: "https://acme.test/product",
  },
  supportingPageUrl: "https://acme.test/product",
  nextChecks: ["read_page_one_intent", "judge_commercial_fit"],
  clusterId: "cluster-1",
};

const incompleteRow = {
  keyword: "clinic workflow question",
  lane: "geo",
  discoveryBasis: "site_proposition",
  validation: {
    availability: "provider_no_data",
    volume: null,
    difficulty: null,
    providerIntent: null,
    intent: null,
    serpFeatures: [],
  },
  coverage: "inventory_unavailable",
  supportingPage: { availability: "unavailable", source: null, url: null },
  supportingPageUrl: null,
  serp: {
    status: "unavailable",
    failureReason: "provider_unavailable",
    observedAt: null,
    organicResults: [],
    verdict: "no_serp_evidence",
    weakestTopTenDomainRank: null,
    weakestTopTenDomain: null,
    weakestTopTenPosition: null,
    topTenDomains: [],
    topTenDomainRanks: [],
    pageOneItemTypes: null,
    isEstimate: false,
  },
  serpIntent: null,
  signals: {
    youngDomain: {
      state: "unavailable",
      observation: null,
      reason: "serp_unavailable",
    },
    lowOrganicTrafficDomain: {
      state: "unavailable",
      observation: null,
      reason: "serp_unavailable",
    },
    communityResult: {
      state: "unavailable",
      observation: null,
      reason: "serp_unavailable",
    },
  },
  aiOverview: null,
  reason: "serp_evidence_unavailable",
  decision: {
    disposition: "incomplete",
    basis: "serp_evidence_unavailable",
    positiveSignals: [],
    discounts: [],
  },
};

const baseResult = {
  availability: "partial",
  marketCode: "US",
  languageCode: "en",
  context: {
    siteUrl: "https://acme.test/",
    pagesFetched: 3,
    productPagesFetched: 1,
    selection: contextResponse.data.selection,
    propositions: contextResponse.data.propositions,
    contextSufficient: true,
    stopReason: "max_urls",
  },
  rows: [eligibleRow],
  withheld: [
    {
      keyword: "zero-volume clinic phrase",
      discoveryBasis: "traditional_expansion",
      reason: "volume_priced_at_zero",
    },
  ],
  incomplete: [incompleteRow],
  clusters: [],
  funnel: {
    generated: 3,
    deduplicated: 3,
    providerReturned: 2,
    volumePositive: 1,
    explicitZero: 1,
    providerNoData: 1,
    alreadyCovered: 0,
    serpSampled: 1,
    winnableEvidence: 1,
    shown: 1,
  },
  process: {
    validation: {
      requested: 3,
      available: 1,
      explicitZero: 1,
      providerNoData: 1,
      accounted: true,
    },
    serp: {
      planned: 2,
      dispatched: 2,
      completed: 1,
      failed: 1,
      legacyStatusUnreported: 0,
      failureReasons: {
        provider_unavailable: 1,
        provider_no_data: 0,
        transport_outcome_unknown: 0,
        budget_exhausted: 0,
        unreported: 0,
      },
      accounted: true,
    },
    decisions: {
      eligible: 1,
      withheld: 1,
      incomplete: 1,
      positiveWithUnavailableSignals: 1,
      withheldReasons: {
        volume_priced_at_zero: 1,
        volume_not_returned: 0,
        already_covered: 0,
        page_one_contested: 0,
        page_one_ranks_unresolved: 0,
        serp_sample_budget_exhausted: 0,
        serp_sample_unavailable: 0,
        no_supporting_page: 0,
        all_signals_not_observed: 0,
      },
      incompleteReasons: {
        serp_evidence_unavailable: 1,
        young_domain_signal_unavailable: 0,
        low_organic_traffic_signal_unavailable: 0,
        community_result_signal_unavailable: 0,
      },
      accounted: true,
    },
    supportingPages: {
      sources: {
        gsc_observed_query_page: 0,
        lexical_page_match: 0,
        inventory_url_match: 0,
        llm_proposition_source: 1,
      },
      sourceUnreported: 0,
      unavailable: 2,
      accounted: true,
    },
    signalStates: [],
    legacyWithoutSignals: 0,
    thresholds: {
      policyVersion: "keyword_opportunity_thresholds.v1",
      youngDomainMonths: 24,
      siteDomainRank: 40,
      siteRankTier: "rank_1_200",
      lowOrganicTrafficThreshold: 5000,
    },
    durationsMs: {
      total: null,
      validation: 11,
      coverage: 13,
      serpSampling: 17,
      serpInterpretation: 19,
      domainEnrichment: 23,
      report: null,
    },
  },
  unavailableStages: ["serp_sample_partial"],
  nextStepSuggestions: ["rerun_when_stage_recovers"],
};

const opportunitiesResponse = {
  data: {
    run: {
      tool: "keyword_opportunity_map",
      schemaVersion: "keyword_opportunity_map.v3",
      mode: "public_preview",
      scope: "site",
      persistence: "none",
      completedAt: "2026-08-28T00:00:00.000Z",
    },
    result: baseResult,
  },
};

interface GuardEvidence {
  contextPosts: number;
  opportunityPosts: number;
  statusPosts: number;
  readonly unexpected: string[];
  readonly externalRequests: string[];
}

async function connect(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "gg_id",
      value: seal("gg_id", { sub: "e2e-user" }, 3_600),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "gg_sites",
      value: seal(
        "gg_sites",
        { properties: ["sc-domain:acme.test"], total: 1 },
        3_600,
      ),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function installGuard(
  page: Page,
  opportunityHandler: (route: Route) => Promise<void> = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opportunitiesResponse),
    });
  },
  statusHandler: (route: Route) => Promise<void> = async (route) => {
    await route.abort("blockedbyclient");
  },
): Promise<GuardEvidence> {
  const evidence: GuardEvidence = {
    contextPosts: 0,
    opportunityPosts: 0,
    statusPosts: 0,
    unexpected: [],
    externalRequests: [],
  };
  // Default-deny every browser request outside the isolated standalone server.
  // Registered before the API route so local API requests fall through to the
  // more specific mock below; all other local assets continue normally.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === LOCAL_ORIGIN) {
      await route.fallback();
      return;
    }
    evidence.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LOCAL_ORIGIN) {
      evidence.externalRequests.push(
        `${request.method()} ${url.origin}${url.pathname}`,
      );
      await route.abort("blockedbyclient");
      return;
    }
    const id = `${request.method()} ${url.pathname}`;
    if (id === CONTEXT_API) {
      evidence.contextPosts += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(contextResponse),
      });
      return;
    }
    if (id === OPPORTUNITIES_API) {
      evidence.opportunityPosts += 1;
      await opportunityHandler(route);
      return;
    }
    if (id === STATUS_API) {
      evidence.statusPosts += 1;
      await statusHandler(route);
      return;
    }
    if (!KNOWN_SHELL_REQUESTS.has(id)) evidence.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  return evidence;
}

async function readAndConfirm(page: Page): Promise<void> {
  await page.goto("/tools/low-competition-keywords");
  await page.getByLabel("Site to read").fill("https://acme.test");
  await page.getByRole("button", { name: "Read my site" }).click();
  await expect(
    page.getByText("Appointment automation for independent clinics"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The 20-page context limit was reached; later eligible pages were not read",
    ),
  ).toBeVisible();
}

test("keeps the legacy synchronous completion path compatible", async ({
  page,
}) => {
  await connect(page);
  const evidence = await installGuard(page);
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();

  await expect(page.getByText("clinic appointment automation")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Detection incomplete/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Excluded/ })).toBeVisible();
  await page.locator("details[data-screening-process] summary").click();
  await expect(page.getByText("Run ledger")).toBeVisible();
  await expect(page.getByText("Candidate source page").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export audit JSON" }),
  ).toBeVisible();
  expect(evidence.contextPosts).toBe(1);
  expect(evidence.opportunityPosts).toBe(1);
  expect(evidence.unexpected).toEqual([]);
  expect(evidence.externalRequests).toEqual([]);
});

test("requires a fresh context after an authority-bearing input changes", async ({
  page,
}) => {
  await connect(page);
  const evidence = await installGuard(page);
  await readAndConfirm(page);

  await page.getByLabel("Site to read").fill("https://different.test");

  await expect(
    page.getByRole("heading", { name: "What we read off your site" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Run the opportunity map" }),
  ).toHaveCount(0);
  expect(evidence.contextPosts).toBe(1);
  expect(evidence.opportunityPosts).toBe(0);
  expect(evidence.externalRequests).toEqual([]);
});

test("tracks a durable 202 run through running to completed", async ({
  page,
}) => {
  await connect(page);
  let statusReads = 0;
  const evidence = await installGuard(
    page,
    async (route) => {
      const request = route.request();
      expect(request.headers()["x-keyword-workflow-version"]).toBe(
        "keyword_workflow.v1",
      );
      expect(request.postDataJSON()).toMatchObject({
        contextToken: "test-context-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: { "Retry-After": "1" },
        body: JSON.stringify({
          data: { status: "running", runToken: "sealed-run" },
        }),
      });
    },
    async (route) => {
      statusReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        ...(statusReads === 1 ? { headers: { "Retry-After": "1" } } : {}),
        body: JSON.stringify(
          statusReads === 1
            ? { data: { status: "running", runToken: "sealed-run" } }
            : { data: { status: "completed", result: baseResult } },
        ),
      });
    },
  );
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();

  await expect(page.getByText("clinic appointment automation")).toBeVisible();
  expect(evidence.opportunityPosts).toBe(1);
  expect(evidence.statusPosts).toBe(2);
  expect(evidence.unexpected).toEqual([]);
  expect(evidence.externalRequests).toEqual([]);
});

test("restores the same durable run after a page reload", async ({ page }) => {
  await connect(page);
  let statusReads = 0;
  const evidence = await installGuard(
    page,
    async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          data: { status: "running", runToken: "sealed-run" },
        }),
      });
    },
    async (route) => {
      statusReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        ...(statusReads === 1 ? { headers: { "Retry-After": "10" } } : {}),
        body: JSON.stringify(
          statusReads === 1
            ? { data: { status: "running", runToken: "sealed-run" } }
            : { data: { status: "completed", result: baseResult } },
        ),
      });
    },
  );
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();
  await expect.poll(() => evidence.statusPosts).toBe(1);

  await page.reload();

  await expect(page.getByText("clinic appointment automation")).toBeVisible();
  expect(evidence.opportunityPosts).toBe(1);
  expect(evidence.statusPosts).toBe(2);
  expect(evidence.externalRequests).toEqual([]);
});

test("adopts a duplicate owner's sealed token and continues polling", async ({
  page,
}) => {
  await connect(page);
  let statusReads = 0;
  const evidence = await installGuard(
    page,
    async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          data: { status: "running", runToken: "duplicate-token" },
        }),
      });
    },
    async (route) => {
      statusReads += 1;
      const posted = route.request().postDataJSON() as { runToken?: string };
      if (statusReads === 1) {
        expect(posted.runToken).toBe("duplicate-token");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { status: "redirect", runToken: "owner-token" },
          }),
        });
        return;
      }
      expect(posted.runToken).toBe("owner-token");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { status: "completed", result: baseResult },
        }),
      });
    },
  );
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();

  await expect(page.getByText("clinic appointment automation")).toBeVisible();
  expect(evidence.statusPosts).toBe(2);
  expect(evidence.externalRequests).toEqual([]);
});

test("keeps a partial empty run distinct from a completed negative", async ({
  page,
}) => {
  await connect(page);
  const evidence = await installGuard(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...opportunitiesResponse.data,
          result: {
            ...baseResult,
            rows: [],
            withheld: [],
            incomplete: [],
            unavailableStages: ["serp_sample"],
            process: undefined,
          },
        },
      }),
    });
  });
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();

  await expect(
    page.getByText(/some candidates were never judged at all/),
  ).toBeVisible();
  expect(evidence.externalRequests).toEqual([]);
});

test("keeps the confirmed context after an opportunities error", async ({
  page,
}) => {
  await connect(page);
  const evidence = await installGuard(page, async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "keyword_source_unavailable" },
      }),
    });
  });
  await readAndConfirm(page);
  await page.getByRole("button", { name: "Run the opportunity map" }).click();

  await expect(
    page.getByRole("heading", { name: "What we read off your site" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run the opportunity map" }),
  ).toBeVisible();
  expect(evidence.externalRequests).toEqual([]);
});
