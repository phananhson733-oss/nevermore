import { expect, test } from "@playwright/test";

const mockedPayload = {
  data: {
    run: {
      tool: "seo_audit",
      schemaVersion: "1.0.0",
      mode: "public_preview",
      scope: "single_raw_page_and_standard_support_files",
      persistence: "none",
      completedAt: "2026-07-30T10:00:00.000Z",
    },
    result: {
      targetUrl: "https://acme.com/",
      finalUrl: "https://www.acme.com/",
      score: 75,
      measuredChecks: 2,
      totalChecks: 3,
      measuredWeight: 6,
      totalWeight: 8,
      coveragePercent: 75,
      priorities: [
        {
          id: "sitemap",
          module: "crawlability",
          status: "warning",
          severity: "high",
          weight: 2,
          evidence: [
            {
              label: "resource_state",
              value: "missing",
              source: "sitemap_xml",
            },
          ],
          limitation: "standard_path_only",
        },
        {
          id: "canonical",
          module: "technical",
          status: "fail",
          severity: "high",
          weight: 3,
          evidence: [
            {
              label: "canonical_url",
              value: "https://acme.com/",
              source: "submitted_page_static",
            },
          ],
          limitation: null,
        },
        {
          id: "title",
          module: "on_page",
          status: "warning",
          severity: "high",
          weight: 3,
          evidence: [
            {
              label: "title_length",
              value: 18,
              source: "submitted_page_static",
            },
          ],
          limitation: null,
        },
        {
          id: "internal_links",
          module: "content",
          status: "warning",
          severity: "medium",
          weight: 2,
          evidence: [
            {
              label: "static_internal_links",
              value: 1,
              source: "submitted_page_static",
            },
          ],
          limitation: null,
        },
      ],
      modules: [
        {
          id: "crawlability",
          score: 75,
          measuredChecks: 2,
          totalChecks: 3,
          measuredWeight: 6,
          totalWeight: 8,
          coveragePercent: 75,
          checks: [
            {
              id: "page_status",
              module: "crawlability",
              status: "pass",
              severity: "critical",
              weight: 4,
              evidence: [
                {
                  label: "status_code",
                  value: 200,
                  source: "submitted_page_static",
                },
              ],
              limitation: null,
            },
            {
              id: "sitemap",
              module: "crawlability",
              status: "warning",
              severity: "high",
              weight: 2,
              evidence: [
                {
                  label: "resource_state",
                  value: "missing",
                  source: "sitemap_xml",
                },
              ],
              limitation: "standard_path_only",
            },
            {
              id: "json_ld",
              module: "structured_data",
              status: "unverified",
              severity: "medium",
              weight: 2,
              evidence: [
                {
                  label: "json_ld_blocks",
                  value: 0,
                  source: "submitted_page_static",
                },
              ],
              limitation: "static_html_cannot_prove_rendered_absence",
            },
          ],
        },
        {
          id: "technical",
          score: null,
          measuredChecks: 0,
          totalChecks: 0,
          measuredWeight: 0,
          totalWeight: 0,
          coveragePercent: 0,
          checks: [],
        },
        {
          id: "on_page",
          score: null,
          measuredChecks: 0,
          totalChecks: 0,
          measuredWeight: 0,
          totalWeight: 0,
          coveragePercent: 0,
          checks: [],
        },
        {
          id: "content",
          score: null,
          measuredChecks: 0,
          totalChecks: 0,
          measuredWeight: 0,
          totalWeight: 0,
          coveragePercent: 0,
          checks: [],
        },
        {
          id: "structured_data",
          score: null,
          measuredChecks: 0,
          totalChecks: 0,
          measuredWeight: 0,
          totalWeight: 0,
          coveragePercent: 0,
          checks: [],
        },
      ],
    },
  },
};

test("renders the bilingual tool shell and an evidence-led mocked report", async ({
  page,
}) => {
  await page.goto("/en/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "See the SEO signals search engines can actually read",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Checks one page plus robots.txt and sitemap.xml. No login, persistence, or full-site crawl.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Run free check" }),
  ).toHaveAttribute("href", "#seo-audit-tool");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "What each part of the health map tells you",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Use this as a first, evidence-led pass",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "How the health map reaches a finding",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "What this preview will not tell you",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Frequently asked questions",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: /\?$/ }),
  ).toHaveCount(8);
  const faqSchema = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts
        .map((script) => JSON.parse(script.textContent ?? "{}"))
        .find((value) => value["@type"] === "FAQPage"),
    );
  expect(faqSchema.mainEntity).toHaveLength(8);
  await expect(
    page.getByRole("link", { name: "Open Internal Link Audit" }),
  ).toHaveAttribute("href", "/en/tools/internal-link-audit");
  await expect(
    page.getByRole("link", { name: "Read the programmatic SEO guide" }),
  ).toHaveAttribute("href", "/en/blog/programmatic-seo-at-scale");

  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedPayload),
    });
  });
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free check" }).click();

  await expect(
    page.getByRole("heading", { level: 2, name: "What to fix first" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Start with XML sitemap. This run measured 75% of the weighted evidence.",
    ),
  ).toBeVisible();
  await expect(page.getByText("75", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("75% weighted coverage · 2 / 3 checks measured"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "A summary of measured signals — not a ranking or full-site score.",
    ),
  ).toBeVisible();

  const priority = page.getByTestId("seo-audit-priority-1");
  await expect(priority.getByText("XML sitemap", { exact: true })).toBeVisible();
  await expect(priority.getByText("High severity")).toBeVisible();
  await expect(
    priority.getByText(
      "Publish a valid XML sitemap at /sitemap.xml containing canonical, indexable URLs.",
    ),
  ).toBeVisible();
  await expect(
    priority.getByText(
      "Publish the change, rerun this URL, and compare the same observed evidence.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid^="seo-audit-priority-"]'),
  ).toHaveCount(3);
  await expect(
    page
      .getByTestId("seo-audit-priorities")
      .getByText("Static internal discovery", { exact: true }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Single-page signal map",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid^="seo-audit-module-"]'),
  ).toHaveCount(5);
  const crawlability = page.getByTestId(
    "seo-audit-module-crawlability",
  );
  await expect(crawlability.getByText("75% coverage")).toBeVisible();
  await crawlability
    .getByText("Crawlability & indexation", { exact: true })
    .click();
  const sitemapCheck = crawlability.getByTestId("seo-audit-check-sitemap");
  await sitemapCheck.getByText("XML sitemap", { exact: true }).click();
  await expect(
    sitemapCheck.getByText("Standard sitemap.xml path"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Only /sitemap.xml was checked. Another sitemap may be declared elsewhere.",
    ),
  ).toBeVisible();
  await expect(sitemapCheck.getByText("How to verify")).toBeVisible();

  await page.goto("/zh/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "看清搜索引擎真正能读取的 SEO 信号",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "免费检测" })).toBeVisible();
});

test("keeps incomplete results honest and readable on a mobile viewport", async ({
  page,
}) => {
  const longFinalUrl =
    "https://www.acme.com/research/technical-seo/very-long-diagnostic-path-that-must-wrap-without-expanding-the-mobile-viewport?campaign=public-audit-preview&source=experience-tool";
  const incompletePayload = {
    data: {
      ...mockedPayload.data,
      result: {
        ...mockedPayload.data.result,
        finalUrl: longFinalUrl,
        score: null,
        priorities: [],
      },
    },
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(incompletePayload),
    });
  });

  await page.goto("/en/tools/seo-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free check" }).click();

  const summary = page.getByTestId("seo-audit-summary");
  await expect(
    summary.getByText(
      "No measured fail or warning signals surfaced in this preview. This run measured 75% of the weighted evidence.",
    ),
  ).toBeVisible();
  await expect(summary.getByText("--", { exact: true })).toBeVisible();
  await expect(summary.getByText(longFinalUrl, { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "No measured fail or warning signals surfaced. Review coverage and unverified evidence before treating the page as healthy.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid^="seo-audit-priority-"]'),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("seo-audit-module-crawlability")
      .getByText("Not verified · 1"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("rejects malformed requests without making an outbound scan", async ({
  request,
}) => {
  const unsupported = await request.post("/api/tools/seo-audit", {
    headers: { "content-type": "text/plain" },
    data: "{}",
  });
  expect(unsupported.status()).toBe(415);
  expect(await unsupported.json()).toEqual({
    error: { code: "unsupported_media_type" },
  });

  const privateTarget = await request.post("/api/tools/seo-audit", {
    data: { url: "http://127.0.0.1/admin" },
  });
  expect(privateTarget.status()).toBe(400);
  expect(await privateTarget.json()).toEqual({
    error: { code: "invalid_url" },
  });
});
