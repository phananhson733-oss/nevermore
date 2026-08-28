import { expect, test, type Page } from "@playwright/test";

import { AGENT_PROFILE_REFRESH_FIELD_PATHS } from "../src/lib/agents/profile-refresh-contract";

import {
  agentEnvelope,
  type AgentKind,
} from "./fixtures/agent-envelope";

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
      schemaVersion: "agent_profile_refresh.v1",
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
        fieldsAvailable: 22,
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
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
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
  ).toContainText("22");
  await expect(
    page.locator('[data-profile-refresh-count="applied"]'),
  ).toContainText("11");
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
  ).toContainText("12");
  await expect(
    page.locator('[data-profile-refresh-count="retained"]'),
  ).toContainText("10");

  await expect(
    page.locator('[data-profile-refresh-source-preview] a'),
  ).toHaveCount(3);
  const sourceDetails = page.locator(
    "details[data-profile-refresh-source-details]",
  );
  await expect(sourceDetails).not.toHaveAttribute("open", "");
  await sourceDetails.locator("summary").click();
  await expect(
    sourceDetails.locator('[data-profile-refresh-source]').last(),
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
  await candidate
    .locator('[data-profile-competitor-action="direct"]')
    .click();
  await expect(candidate).toContainText("Manually adjusted · direct competitor");
  await expect(
    page.locator('[data-profile-competitor-count="confirmed"]'),
  ).toContainText("2");
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
        targetQuery: "",
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
  await expect(page.getByRole("heading", { name: "Sign in to GenGrowth" })).toBeVisible();
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
  await expect(results.getByText("Pages inspected")).toBeVisible();
  await expect(page.getByTestId("agent-diagnosis")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-D")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("diagnosis-scope-page").click();
  await expect(page.getByText("9 groups · 49 checks")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("diagnosis-group-3").click();
  await page.getByTestId("diagnosis-check-3.4").click();
  await expect(page.getByTestId("diagnosis-heading-preset")).toContainText(
    "H2 3–6",
  );
  await expect(page.locator('[data-testid^="diagnosis-policy-"]')).toHaveCount(
    0,
  );
  await expect(page.locator("[data-policy-threshold]")).toHaveCount(0);
  await expect(page.locator("[data-policy-weight]")).toHaveCount(0);
  await expect(page.locator("[data-policy-action]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "No evidence-backed recommendation is available",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("agent-recommendation-row")).toHaveCount(0);
  await expect(page.getByTestId("agent-selected-solution")).toHaveCount(0);
});

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
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await input.fill("astrologywiki.com");
  await completeRequiredProfileContext(page, "zh", "技术 SEO 审计");
  await page.getByRole("button", { name: "接受上下文并运行" }).click();
  await expect(page.getByTestId("agent-results-tech")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-C")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "暂无有证据支持的建议" }),
  ).toBeVisible();
  await expect(page.getByTestId("agent-selected-solution")).toHaveCount(0);
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
  await expect(primary.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(primary.getByText("Agents", { exact: true })).toBeVisible();
  await expect(primary.getByRole("link", { name: "Blog", exact: true })).toHaveAttribute(
    "href",
    "/blog",
  );
  await expect(primary.getByText("Resources", { exact: true })).toBeVisible();
  await expect(primary.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute(
    "href",
    "/pricing",
  );
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
  await expect(page.getByRole("link", { name: "Browse Tools" })).toHaveAttribute(
    "href",
    "/tools",
  );
});
