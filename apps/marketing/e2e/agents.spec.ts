import { expect, test, type Page } from "@playwright/test";

import {
  AGENT_PROFILE_REFRESH_FIELD_PATHS,
  AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
} from "../src/lib/agents/profile-refresh-contract";

import { agentEnvelope, type AgentKind } from "./fixtures/agent-envelope";

function profileRefreshEnvelope(agent: AgentKind) {
  const sourceUrls = Array.from(
    { length: 14 },
    (_, index) => `https://astrologywiki.com/source-${index + 1}`,
  );
  const listFields = new Set([
    "coreFeatures",
    "categories",
    "trustSignals",
    "icpInterests",
    "useCases",
    "outcomes",
    "barriers",
    "qualificationSignals",
    "disqualifiers",
  ]);
  return {
    data: {
      schemaVersion: AGENT_PROFILE_REFRESH_SCHEMA_VERSION,
      agent,
      request: {
        submittedUrl: "astrologywiki.com",
        normalizedUrl: "https://astrologywiki.com/",
        targetHost: "astrologywiki.com",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
      },
      availability: "available",
      observedAt: "2026-08-13T10:00:00.000Z",
      cache: {
        status: "fresh",
        capturedAt: "2026-08-13T10:00:00.000Z",
      },
      diagnostics: {
        resolvedOrigin: "https://astrologywiki.com",
        pagesFetched: 14,
        productPagesFetched: 3,
        stopReason: "max_urls",
        contextSufficient: true,
        sourceUrls,
        fieldsAvailable: AGENT_PROFILE_REFRESH_FIELD_PATHS.length,
        fieldsMissing: 0,
      },
      fields: AGENT_PROFILE_REFRESH_FIELD_PATHS.map((path) => ({
        path,
        state: "available",
        value: listFields.has(path) ? [`Live ${path}`] : `Live ${path}`,
        derivation: "inferred",
        confidence: "medium",
        source: "public_page",
        limitation: null,
        evidenceUrls: [sourceUrls[0]],
      })),
    },
  } as const;
}

function profileSearchEnvelope(agent: AgentKind) {
  return {
    data: {
      schemaVersion: "agent_profile_search.v1",
      agent,
      targetHost: "astrologywiki.com",
      availability: "available",
      method: "serp_competitors",
      market: {
        code: "US",
        locationCode: 2840,
        languageCode: "en",
      },
      observedAt: "2026-08-13T10:01:00.000Z",
      rows: [
        {
          kind: "profile_seed_serp_competitor",
          domain: "astro-seek.com",
          averagePosition: 5.4,
          medianPosition: 4.2,
          rating: 0.73,
          organicEstimatedTrafficVolume: 12_400,
          keywordsCount: 18,
          visibility: 0.41,
          relevantSerpItems: 6,
        },
        {
          kind: "profile_seed_serp_competitor",
          domain: "astro.com",
          averagePosition: 9.1,
          medianPosition: 8.3,
          rating: 0.52,
          organicEstimatedTrafficVolume: 8_900,
          keywordsCount: 11,
          visibility: 0.28,
          relevantSerpItems: 4,
        },
      ],
    },
  } as const;
}

async function mockSession(page: Page, signedIn: boolean): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ signedIn }),
    });
  });
  await page.route("**/api/auth/one-tap/nonce", async (route) => {
    await route.fulfill({ status: 503, body: "" });
  });
  if (signedIn) {
    await page.route("**/api/auth/profile", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            email: "agent-e2e@example.test",
            displayName: "Agent E2E",
            avatarUrl: null,
          },
        }),
      });
    });
    await page.route("**/api/credits/balance", async (route) => {
      await route.fulfill({ status: 503, body: "" });
    });
    await page.route("**/api/account/websites", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { websites: [] } }),
      });
    });
  }
}

async function completeRequiredProfileContext(
  page: Page,
  locale: "en" | "zh",
  targetQuery?: string,
): Promise<void> {
  const chinese = locale === "zh";
  await page
    .getByLabel(
      chinese ? "目标市场 / 国家（ISO-2）" : "Target market / country (ISO-2)",
    )
    .fill(chinese ? "CN" : "US");
  await page
    .getByLabel(chinese ? "目标语言（BCP 47）" : "Target language (BCP 47)")
    .fill(chinese ? "zh-CN" : "en-US");
  if (targetQuery !== undefined) {
    await page
      .getByRole("button", {
        name: chinese ? "检查并调整" : "Review & adjust",
      })
      .click();
    await page
      .getByLabel(chinese ? "目标查询" : "Target query")
      .fill(targetQuery);
  }
}

test("profile diagnosis runs only from URL, market, language, and the explicit top action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, true);
  const profileRequests: Array<{
    readonly method: string;
    readonly body: unknown;
  }> = [];
  const searchRequests: Array<{
    readonly method: string;
    readonly body: unknown;
  }> = [];
  let auditPosts = 0;

  await page.route("**/api/agents/seo/profile-refresh", async (route) => {
    profileRequests.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profileRefreshEnvelope("seo")),
    });
  });
  await page.route("**/api/agents/seo/audit", async (route) => {
    auditPosts += 1;
    await route.fulfill({ status: 500, body: "unexpected" });
  });
  await page.route("**/api/agents/seo/profile-search", async (route) => {
    searchRequests.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profileSearchEnvelope("seo")),
    });
  });

  await page.goto("/agents/seo");
  const url = page.getByLabel("Target URL");
  const market = page.getByLabel("Target market / country (ISO-2)");
  const language = page.getByLabel("Target language (BCP 47)");
  const run = page.getByRole("button", { name: "Run profile diagnosis" });

  await url.fill("astrologywiki.com");
  await market.fill("US");
  await language.fill("en-US");
  await expect(run).toBeEnabled();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  expect(profileRequests).toHaveLength(0);
  expect(auditPosts).toBe(0);

  const controls = [url, market, language, run];
  const boxes = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]?.y).toBeLessThan(boxes[1]?.y ?? 0);
  expect(boxes[1]?.y).toBeLessThan(boxes[2]?.y ?? 0);
  expect(boxes[2]?.y).toBeLessThan(boxes[3]?.y ?? 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await run.click();

  await expect(
    page.getByText("Public-page profile draft is ready"),
  ).toBeVisible();
  await expect(page.getByText("Fresh result")).toBeVisible();
  await expect(
    page.locator('[data-profile-refresh-metric="pages"]'),
  ).toContainText("14");
  await expect(
    page.locator('[data-profile-refresh-count="found"]'),
  ).toContainText(String(AGENT_PROFILE_REFRESH_FIELD_PATHS.length));
  await expect(
    page.locator('[data-profile-refresh-count="applied"]'),
  ).toContainText("12");
  await expect(
    page.locator('[data-profile-refresh-count="retained"]'),
  ).toContainText("11");
  await expect(
    page.locator('[data-profile-refresh-count="unavailable"]'),
  ).toContainText("0");
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "AstrologyWiki",
  );
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "Software as a service (SaaS)",
  );
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "$41.99 / year",
  );
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "Swiss Ephemeris",
  );
  await expect(page.locator('[data-profile-card="icp"]')).toHaveCount(0);
  const productNameProposal = page.locator(
    '[data-profile-refresh-proposal="productName"]',
  );
  await expect(productNameProposal).toContainText("Live productName");
  await page
    .getByRole("button", {
      name: "Use the live suggestion for Product name",
    })
    .click();
  await expect(page.locator('[data-profile-card="product"]')).toContainText(
    "Live productName",
  );
  await expect(
    page.locator('[data-profile-refresh-count="applied"]'),
  ).toContainText("13");
  await expect(
    page.locator('[data-profile-refresh-count="retained"]'),
  ).toContainText("10");

  await expect(
    page.locator("[data-profile-refresh-source-preview] a"),
  ).toHaveCount(3);
  const sourceDetails = page.locator(
    "details[data-profile-refresh-source-details]",
  );
  await expect(sourceDetails).not.toHaveAttribute("open", "");
  await sourceDetails.locator("summary").click();
  await expect(
    sourceDetails.locator("[data-profile-refresh-source]").last(),
  ).toHaveAttribute("href", "https://astrologywiki.com/source-14");
  await expect(
    page.locator('[data-profile-competitor-count="provider"]'),
  ).toContainText("2");
  const candidate = page.locator(
    '[data-profile-competitor-candidate="astro-seek.com"]',
  );
  await expect(candidate).toContainText(
    "System suggestion · indirect alternative",
  );
  await expect(candidate).toContainText("Product Profile seed SERP evidence");
  await expect(candidate).toContainText("18");
  await expect(candidate).toContainText("12,400");
  await expect(
    candidate.locator('[data-profile-competitor-action="indirect"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await candidate.locator('[data-profile-competitor-action="direct"]').click();
  await expect(candidate).toContainText(
    "Manually adjusted · direct competitor",
  );
  await expect(
    page.locator('[data-profile-competitor-count="confirmed"]'),
  ).toContainText("1");
  await expect(page.locator('[data-profile-card="competitor"]')).toContainText(
    "astro-seek.com",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  expect(profileRequests).toEqual([
    {
      method: "POST",
      body: {
        url: "astrologywiki.com",
        marketCode: "US",
        languageTag: "en-US",
        outputLocale: "en",
        mode: "prefer_cache",
      },
    },
  ]);
  expect(searchRequests).toEqual([
    {
      method: "POST",
      body: {
        url: "astrologywiki.com",
        marketCode: "US",
        languageTag: "en-US",
        targetQuery: "Live targetQuery",
        productProfileSearchSeeds: [
          "AstrologyWiki",
          "Astrology tool",
          "Self-discovery platform",
          "A free birth-chart and self-exploration web app combining astrology with modern psychology.",
          "Free natal chart calculator",
        ],
      },
    },
  ]);
  expect(auditPosts).toBe(0);
});

test("signed-out SEO submission opens registration without an audit POST", async ({
  page,
}) => {
  await mockSession(page, false);
  let auditPosts = 0;
  await page.route("**/api/agents/seo/audit", async (route) => {
    auditPosts += 1;
    await route.fulfill({ status: 500, body: "unexpected" });
  });

  await page.goto("/agents/seo");
  await page.getByLabel("Target URL").fill("astrologywiki.com/docs");
  await completeRequiredProfileContext(page, "en");
  await page.getByRole("button", { name: "Accept context & run" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to GenGrowth" }),
  ).toBeVisible();
  expect(auditPosts).toBe(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v3"),
    ),
  ).toContain('"purpose":"run_confirmed_profile"');
});

test("signed-in SEO run renders bounded evidence and a truthful recommendation boundary", async ({
  page,
}) => {
  await mockSession(page, true);
  await page.route("**/api/agents/seo/audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agentEnvelope("seo")),
    });
  });

  await page.goto("/agents/seo");
  await page.getByLabel("Target URL").fill("astrologywiki.com");
  await completeRequiredProfileContext(page, "en", "technical seo audit");
  await page.getByRole("button", { name: "Accept context & run" }).click();

  const results = page.getByTestId("agent-results-seo");
  await expect(results).toBeVisible();
  const captureDetail = results.locator("[data-capture-detail]");
  await captureDetail.locator("summary").click();
  await expect(
    captureDetail.getByText("Pages inspected", { exact: true }),
  ).toBeVisible();
  // One list, site-wide and page-level together; the scope switch and the
  // group ledger it lived in are gone.
  await expect(page.locator('[data-testid^="diagnosis-scope-"]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-testid^="diagnosis-group-"]')).toHaveCount(
    0,
  );
  await expect(page.locator('[data-issue-row^="seo:site:"]').first()).toBeVisible();
  await expect(page.locator('[data-issue-row^="seo:page:"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="diagnosis-policy-"]')).toHaveCount(
    0,
  );
  await expect(page.locator("[data-policy-threshold]")).toHaveCount(0);
  await expect(page.locator("[data-policy-weight]")).toHaveCount(0);
  await expect(page.locator("[data-policy-action]")).toHaveCount(0);
  const accordion = page.getByTestId("agent-issue-accordion");
  await expect(accordion).toBeVisible();

  // Every issue starts closed; the reader chooses what to open.
  await expect(page.locator("[data-issue-detail]")).toHaveCount(0);
  const rows = page.locator("[data-issue-row]");
  expect(await rows.count()).toBeGreaterThan(0);

  await rows.first().locator("summary").click();
  await expect(page.locator("[data-issue-detail]")).toHaveCount(1);
  await expect(page.locator("[data-issue-detail]").first()).toContainText(
    "technical seo audit",
  );
  await expect(page.locator("[data-issue-copy]").first()).toBeVisible();

  // Comparing two findings at once is the whole point of the accordion.
  await page.getByRole("button", { name: "Collapse all" }).click();
  const siteRows = page.locator("[data-issue-row]");
  expect(await siteRows.count()).toBeGreaterThan(1);
  await expect(page.locator("[data-issue-detail]")).toHaveCount(0);

  await siteRows.first().locator("summary").click();
  await siteRows.nth(1).locator("summary").click();
  await expect(page.locator("[data-issue-detail]")).toHaveCount(2);

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.locator("[data-issue-detail]")).toHaveCount(0);
});

test("SEO run options stay frozen from confirmation to audit POST across mobile and desktop", async ({
  page,
}) => {
  await mockSession(page, true);
  const auditBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/agents/seo/audit", async (route) => {
    auditBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const envelope = agentEnvelope("seo");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...envelope.data,
          result: {
            ...envelope.data.result,
            crawlTier: "full-site",
            keyPages: [
              {
                url: "https://astrologywiki.com/",
                title: "AstrologyWiki",
                metaDescription: null,
                depth: 0,
                inboundLinks: 0,
                reason: "home",
              },
              {
                url: "https://astrologywiki.com/about",
                title: "About AstrologyWiki",
                metaDescription: null,
                depth: 1,
                inboundLinks: 1,
                reason: "full-site",
              },
            ],
            keyPageSelection: {
              omittedUrls: [],
              manualUnavailableUrls: [],
            },
          },
        },
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents/seo");
  await page.getByLabel("Target URL").fill("astrologywiki.com");
  await completeRequiredProfileContext(page, "en");

  const runOptions = page.locator('[data-agent-run-options="seo"]');
  const tier = page.locator("[data-agent-run-tier]");
  const extraPages = page.locator("[data-agent-run-extra-pages]");
  await expect(runOptions).toBeVisible();
  await expect(tier).toHaveValue("key-pages");
  await expect(runOptions).toContainText("depth 2");
  await extraPages.fill(
    [
      "https://astrologywiki.com/pricing",
      "https://astrologywiki.com/tools/chart",
    ].join("\n"),
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await tier.selectOption("full-site");
  await expect(tier).toHaveValue("full-site");
  await expect(runOptions).toContainText("depth 6");
  await page.setViewportSize({ width: 1440, height: 960 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.getByRole("button", { name: "Accept context & run" }).click();
  const results = page.getByTestId("agent-results-seo");
  await expect(results).toBeVisible();
  await expect(results.locator("[data-capture-summary]")).toContainText(
    "evaluable collected pages",
  );
  await expect(results.locator("[data-capture-summary]")).not.toContainText(
    "key pages",
  );
  expect(auditBodies).toEqual([
    expect.objectContaining({
      tier: "full-site",
      extraKeyPages: [
        "https://astrologywiki.com/pricing",
        "https://astrologywiki.com/tools/chart",
      ],
    }),
  ]);
});

for (const locale of ["en", "zh"] as const) {
  test(`full-site exclusions explain the scope and require confirmation to rerun (${locale})`, async ({ page }) => {
    await mockSession(page, true);
    await page.setViewportSize(locale === "zh" ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    const auditBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/agents/seo/audit", async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      auditBodies.push(input);
      const envelope = agentEnvelope("seo");
      await route.fulfill({ json: {
        data: {
          ...envelope.data,
          result: {
            ...envelope.data.result,
            crawlTier: input.tier,
            records: envelope.data.result.records.map((record) =>
              input.tier === "key-pages" && ["sitemap_page_without_observed_inlink", "internal_target_http_error", "page_without_any_discovery_path"].includes(record.id)
                ? { ...record, state: "unverified", tested: 0, affected: 0, observations: [], limitation: "full_site_only" }
                : record),
          },
        },
      } });
    });
    await page.goto(locale === "zh" ? "/zh/agents/seo" : "/agents/seo");
    await page.getByLabel(locale === "zh" ? "目标 URL" : "Target URL", { exact: true }).fill("astrologywiki.com");
    await completeRequiredProfileContext(page, locale);
    await page.locator('[data-profile-action="confirm"]').click();
    const results = page.getByTestId("agent-results-seo");
    await expect(results).toBeVisible();
    await results.getByTestId("agent-issues-excluded").locator("summary").click();
    for (const id of ["C1", "C2", "C5"]) {
      await expect(results.locator(`[data-quiet-issue="seo:site:${id}"]`)).toContainText(
        locale === "zh" ? "关键页档不执行此项，需要全站抓取。" : "Not run in the key-pages scope; requires full-site crawling.",
      );
    }
    await results.locator("[data-choose-full-site]").click();
    await expect(page.locator("[data-agent-run-tier]")).toHaveValue("full-site");
    await expect(page.locator("[data-agent-run-tier]")).toBeFocused();
    await expect(results).toHaveCount(0);
    expect(auditBodies).toHaveLength(1);
    await page.locator('[data-profile-action="confirm"]').click();
    await expect(results).toBeVisible();
    expect(auditBodies.map((input) => input.tier)).toEqual(["key-pages", "full-site"]);
    await expect(results.locator("[data-choose-full-site]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
  });
}

test("Chinese Tech page ignores the SEO intent and owns an independent run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, true);
  await page.route("**/api/agents/tech/audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agentEnvelope("tech")),
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.setItem(
      "gengrowth:agent-intent:seo:v3",
      JSON.stringify({
        agent: "seo",
        purpose: "prepare_profile",
        url: "seo-only.example",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1_000,
      }),
    );
  });
  await page.goto("/zh/agents/tech");

  const input = page.getByLabel("目标 URL");
  await expect(input).toHaveValue("");
  await expect(page.locator('[data-agent-run-options="tech"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await input.fill("astrologywiki.com");
  await completeRequiredProfileContext(page, "zh", "技术 SEO 审计");
  await page.getByRole("button", { name: "接受上下文并运行" }).click();
  await expect(page.getByTestId("agent-results-tech")).toBeVisible();
  await expect(page.locator('[data-testid^="diagnosis-group-"]')).toHaveCount(
    0,
  );
  await expect(page.getByTestId("agent-issue-accordion")).toBeVisible();
  await page.getByRole("button", { name: "展开当前筛选" }).click();

  const details = page.locator("[data-issue-detail]");
  expect(await details.count()).toBeGreaterThan(0);
  await expect(details.first()).toContainText("站点");

  // Every row this fixture produces is source-gated. A gated check reached no
  // verdict, so it names the source that would answer it and is given no
  // repair preview at all.
  await expect(
    page.locator('[data-issue-lane="investigation"]').first(),
  ).toBeVisible();
  await expect(details.first()).toContainText("需要的数据来源");
  await expect(page.locator("[data-issue-preview-shape]")).toHaveCount(0);

  // Expanding is where a 390px layout actually breaks: the detail carries
  // URLs, code previews, and evidence rows that a narrow column has to hold.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v3"),
    ),
  ).toContain("seo-only.example");
});

test("retired SEO Audit redirects to SEO Agent", async ({ page }) => {
  await mockSession(page, false);

  await page.goto("/tools/seo-audit");
  await expect(page).toHaveURL(/\/agents\/seo$/);
});

test("primary IA groups Tools under Resources without changing its URL", async ({
  page,
}) => {
  await mockSession(page, false);

  await page.goto("/");
  const primary = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    primary.getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("href", "/");
  await expect(primary.getByText("Agents", { exact: true })).toBeVisible();
  await expect(
    primary.getByRole("link", { name: "Blog", exact: true }),
  ).toHaveAttribute("href", "/blog");
  await expect(primary.getByText("Resources", { exact: true })).toBeVisible();
  await expect(
    primary.getByRole("link", { name: "Pricing", exact: true }),
  ).toHaveAttribute("href", "/pricing");
  await expect(primary.getByRole("link", { name: /Tools/ })).toHaveCount(0);

  await primary.getByText("Resources", { exact: true }).click();
  const tools = page.getByRole("link", { name: /Tools/ }).first();
  await expect(tools).toHaveAttribute("href", "/tools");
  await tools.click();
  await expect(page).toHaveURL(/\/tools$/);

  await page.goto("/resources");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Turn growth methods into reusable resources",
  );
  const resourceIndex = page.getByRole("navigation", {
    name: "Prompts · Tools · Skills · Docs",
  });
  await expect(resourceIndex.locator('a[href="/prompts"]')).toHaveCount(1);
  await expect(resourceIndex.locator('a[href="/tools"]')).toHaveCount(1);
  await expect(resourceIndex.locator('a[href="/skills"]')).toHaveCount(1);
  await expect(resourceIndex.locator('a[href="#docs"]')).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Browse Tools" }),
  ).toHaveAttribute("href", "/tools");
});
