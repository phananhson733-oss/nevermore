import { expect, test } from "@playwright/test";

const pages = [
  {
    url: "https://acme.com/",
    subjectUrl: "https://acme.com/",
    finalUrl: "https://acme.com/",
    depth: 0,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html; charset=utf-8",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: "https://acme.com/",
    title: "Acme",
    metaDescription: "Acme public site",
    h1Count: 1,
    headingsCount: 3,
    wordCount: 420,
    inboundLinks: 0,
    outboundLinks: 2,
    sitemapMember: true,
    jsonLdTypes: ["Organization"],
    jsonLdErrorCount: 0,
  },
  {
    url: "https://acme.com/about",
    subjectUrl: "https://acme.com/about",
    finalUrl: "https://acme.com/about",
    depth: 1,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: "https://acme.com/about",
    title: "Repeated title",
    metaDescription: null,
    h1Count: 1,
    headingsCount: 2,
    wordCount: 210,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
  },
  {
    url: "https://acme.com/team",
    subjectUrl: "https://acme.com/team",
    finalUrl: "https://acme.com/team",
    depth: 2,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: "https://acme.com/team",
    title: "Repeated title",
    metaDescription: null,
    h1Count: 2,
    headingsCount: 4,
    wordCount: 180,
    inboundLinks: 1,
    outboundLinks: 0,
    sitemapMember: true,
    jsonLdTypes: ["AboutPage"],
    jsonLdErrorCount: 0,
  },
] as const;

const mockedPayload = {
  data: {
    run: {
      tool: "seo_audit",
      schemaVersion: "seo_audit.sitewide.v3",
      mode: "public_preview",
      scope: "discoverable_same_origin_static_html_audit",
      persistence: "none",
      completedAt: "2026-07-30T10:00:00.000Z",
    },
    result: {
      targetUrl: "https://acme.com/",
      siteOrigin: "https://acme.com",
      scannedAt: "2026-07-30T10:00:00.000Z",
      coverage: {
        availability: "partial",
        pagesInspected: 3,
        linksObserved: 3,
        sitemapUrlsObserved: 18,
        urlsSkipped: 1,
        urlsBlocked: 0,
        urlsDisallowed: 2,
        urlsErrored: 0,
        stopReason: "max_urls",
      },
      siteResources: {
        robotsFetched: true,
        robotsGroupsObserved: 1,
        sitemapReferencesObserved: 1,
        sitemapFetched: true,
      },
      records: [
        {
          id: "robots_resource",
          category: "crawl",
          state: "observed",
          unit: "site_resource",
          tested: 1,
          affected: 1,
          observations: [
            {
              url: "https://acme.com/robots.txt",
              values: [
                { label: "fetched", value: true },
                { label: "groups_observed", value: 1 },
                { label: "sitemap_references", value: 1 },
              ],
            },
          ],
          limitation: null,
        },
        {
          id: "title_duplicate",
          category: "metadata",
          state: "observed",
          unit: "pages",
          tested: 3,
          affected: 2,
          observations: [
            {
              url: "https://acme.com/about",
              values: [
                { label: "title", value: "Repeated title" },
                { label: "matching_pages", value: 2 },
              ],
            },
            {
              url: "https://acme.com/team",
              values: [
                { label: "title", value: "Repeated title" },
                { label: "matching_pages", value: 2 },
              ],
            },
          ],
          limitation: "normalised_text_match_within_inspected_pages",
        },
        {
          id: "internal_target_http_error",
          category: "links",
          state: "not_observed",
          unit: "link_targets",
          tested: 2,
          affected: 0,
          observations: [],
          limitation: "uncollected_link_targets_not_classified",
        },
      ],
      pages,
    },
  },
};

test("renders the bilingual site-wide shell and an audit-only multi-page report", async ({
  page,
}) => {
  await page.goto("/en/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Free site-wide SEO audit",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No account or normal-use run-count limit, and no fixed page product quota. The synchronous crawler collects as many public same-origin static pages as the current run can safely cover and respects robots.txt.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start the audit" }),
  ).toHaveAttribute("href", "#seo-audit-tool");
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "What the audit records",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "How every record remains traceable",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Not measured by this public synchronous audit",
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
    page.getByRole("link", { name: "Run an internal link audit" }),
  ).toHaveAttribute("href", "/en/tools/internal-link-audit");
  await expect(
    page.getByRole("link", { name: "Read the evidence-first method" }),
  ).toHaveAttribute("href", "/en/blog/evidence-first-growth-experiments");

  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedPayload),
    });
  });
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free audit" }).click();

  const results = page.getByTestId("seo-audit-results");
  await expect(results).toBeVisible();
  await expect(results.getByText("Partial coverage")).toBeVisible();
  await expect(
    results
      .getByText("Pages inspected", { exact: true })
      .locator("..")
      .getByText("3", { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText(
      "The crawler stopped at the synchronous page-safety boundary. Every record below describes only the pages that were inspected.",
    ),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid^="seo-audit-record-"]'),
  ).toHaveCount(3);

  const duplicateRecord = page.getByTestId(
    "seo-audit-record-title_duplicate",
  );
  await duplicateRecord
    .getByText("Repeated title text", { exact: true })
    .click();
  await expect(
    duplicateRecord.getByText("2 observed / 3 tested pages"),
  ).toBeVisible();
  await expect(
    duplicateRecord.getByText("https://acme.com/about", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 3,
      name: "Inspected-page inventory",
    }),
  ).toBeVisible();
  const pageInventoryToggle = page.getByTestId("seo-audit-pages-toggle");
  await expect(page.getByTestId("seo-audit-page-row")).toHaveCount(0);
  await expect(pageInventoryToggle).toContainText("Show 3 pages");
  await pageInventoryToggle.click();
  await expect(page.getByTestId("seo-audit-page-row")).toHaveCount(3);
  await expect(pageInventoryToggle).toContainText(
    "Collapse page inventory",
  );
  await pageInventoryToggle.click();
  await expect(page.getByTestId("seo-audit-page-row")).toHaveCount(0);

  await expect(results.getByText("What to fix")).toHaveCount(0);
  await expect(results.getByText("Recommendation")).toHaveCount(0);
  await expect(results.getByText("Health score")).toHaveCount(0);

  await page.goto("/zh/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "免费全站 SEO 审计",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始免费审计" }),
  ).toBeVisible();
});

test("keeps a long multi-page audit record contained on a mobile viewport", async ({
  page,
}) => {
  const longUrl =
    "https://acme.com/research/technical-seo/very-long-audit-path-that-must-stay-inside-the-scroll-container?campaign=public-sitewide-audit&source=experience-tool";
  const mobilePayload = {
    data: {
      ...mockedPayload.data,
      result: {
        ...mockedPayload.data.result,
        pages: [
          {
            ...pages[0],
            url: longUrl,
            subjectUrl: longUrl,
            finalUrl: longUrl,
          },
        ],
        coverage: {
          ...mockedPayload.data.result.coverage,
          availability: "available",
          pagesInspected: 1,
          stopReason: null,
        },
      },
    },
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mobilePayload),
    });
  });

  await page.goto("/en/tools/seo-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free audit" }).click();

  await expect(page.getByTestId("seo-audit-results")).toBeVisible();
  await expect(page.getByTestId("seo-audit-page-row")).toHaveCount(0);
  await page.getByTestId("seo-audit-pages-toggle").click();
  await expect(page.getByText(longUrl, { exact: true })).toBeVisible();
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
