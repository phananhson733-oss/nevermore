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
  await page.goto("/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Free site-wide SEO audit",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No account and no sign-up. One run collects up to about 950 public same-origin static pages — the crawler paces itself to at least 250 ms between requests and stops at four minutes — and fewer if your robots.txt asks for a slower rate. Larger sites return partial coverage, labelled as such.",
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
  ).toHaveAttribute("href", "/tools/internal-link-audit");
  await expect(
    page.getByRole("link", { name: "Read the evidence-first method" }),
  ).toHaveAttribute("href", "/blog/evidence-first-growth-experiments");

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
  await expect(page.locator('[data-testid^="seo-audit-record-"]')).toHaveCount(
    3,
  );

  const duplicateRecord = page.getByTestId("seo-audit-record-title_duplicate");
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
    duplicateRecord.getByText(
      "Duplicate groups use case-insensitive, whitespace-normalised text and include only inspected pages.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await duplicateRecord
    .getByRole("button", { name: "Evidence boundary (1)" })
    .click();
  await expect(
    page
      .getByRole("tooltip")
      .getByText(
        "Duplicate groups use case-insensitive, whitespace-normalised text and include only inspected pages.",
        { exact: true },
      ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
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
  await expect(pageInventoryToggle).toContainText("Collapse page inventory");
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

  await page.goto("/tools/seo-audit");
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

/**
 * The measured production run sat on "Auditing the site…" for 2.5 minutes with
 * no progress element, no spinner and no animation. This drives the real
 * client parser against a genuinely chunked NDJSON body, so a change that
 * withholds every line until the crawl finishes — which passes every unit test
 * and does nothing in production — fails here instead.
 */
test("narrates the crawl, says when it ends, then replaces the panel with the report", async ({
  page,
}) => {
  await page.addInitScript((payload) => {
    // Record every distinct panel text as it happens. Asserting on the live
    // DOM instead would race a panel that is deliberately short-lived, and a
    // flaky assertion here would be the first thing someone deletes.
    const recorder = window as unknown as { __panelStates: string[] };
    recorder.__panelStates = [];
    const record = (): void => {
      const text =
        document.querySelector('[data-testid="seo-audit-progress"]')
          ?.textContent ?? "";
      if (text && recorder.__panelStates.at(-1) !== text) {
        recorder.__panelStates.push(text);
      }
    };
    const observe = (): void => {
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    };
    if (document.body) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });

    const lines = [
      JSON.stringify({ progress: { pagesCrawled: 0, requestsSent: 1 } }),
      JSON.stringify({ progress: { pagesCrawled: 3, requestsSent: 37 } }),
      // The crawl has returned; the report is built, serialized and cached
      // after this line and before the terminal one.
      JSON.stringify({ stage: "building_report" }),
      JSON.stringify(payload),
    ].map((line) => `${line}\n`);
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!url.includes("/api/tools/seo-audit")) {
        return originalFetch(input, init);
      }
      const encoder = new TextEncoder();
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index >= lines.length) {
            controller.close();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
          controller.enqueue(encoder.encode(lines[index] ?? ""));
          index += 1;
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    };
  }, mockedPayload);

  await page.goto("/tools/seo-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free audit" }).click();

  const panel = page.getByTestId("seo-audit-progress");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("seo-audit-results")).toBeVisible({
    timeout: 15_000,
  });
  // The panel is destroyed on completion, so it can never narrate a finished run.
  await expect(panel).toHaveCount(0);

  const states = await page.evaluate(
    () => (window as unknown as { __panelStates: string[] }).__panelStates,
  );
  const firstMatching = (needle: string): number =>
    states.findIndex((state) => state.includes(needle));

  // The panel exists only because the crawl reported something, so its first
  // state already carries that first observation.
  expect(states[0]).toContain("No page crawled yet");
  expect(states[0]).toContain("1 request sent by the crawl");
  // Every figure is one the crawl reported, in the order it reported it, each
  // rendered before the report arrived.
  expect(firstMatching("3 pages crawled so far")).toBeGreaterThan(0);
  expect(firstMatching("37 requests sent by the crawl")).toBe(
    firstMatching("3 pages crawled so far"),
  );

  // Elapsed seconds are the caller's own measurement and are always on screen.
  // Asserting a particular reading would race the stream's own timing, and a
  // flaky assertion here would be the first thing someone deletes.
  for (const state of states) expect(state).toMatch(/\d+s elapsed/);

  // While the crawl is running the panel says so, and carries the caveats that
  // belong to a running crawl.
  const crawling =
    states.find((state) => state.includes("Crawl in progress")) ?? "";
  expect(crawling).toContain(
    "The page count is the figure the finished report gives as Pages inspected. Requests run ahead of it: they include robots.txt, sitemap files, and every redirect.",
  );
  expect(crawling).toContain("there is no percentage to show");
  expect(crawling).toContain("The crawl itself stops after four minutes");

  /**
   * The window this test was extended for: `crawlSite` has returned and the
   * report is being built, serialized and cached. The page count is frozen and
   * the clock is still running, and the panel used to call all of that a crawl.
   */
  const lastState = states.at(-1) ?? "";
  expect(lastState).toContain("Crawl finished, building the report");
  expect(lastState).not.toContain("Crawl in progress");
  expect(lastState).toContain("3 pages crawled");
  expect(lastState).not.toContain("so far");
  expect(lastState).toContain("Nothing more is being fetched from the site");
  for (const state of states) expect(state).not.toContain("%");
});

/**
 * A cache hit and every gate refusal answer without crawling anything, and
 * they send no progress line. The panel asserts a crawl is running, so it must
 * not appear for them — the recorder proves it never appeared at all, which
 * polling the live DOM after the fact cannot.
 */
test("never claims a crawl for an answer that ran none", async ({ page }) => {
  await page.addInitScript(() => {
    const recorder = window as unknown as { __panelStates: string[] };
    recorder.__panelStates = [];
    const record = (): void => {
      const text =
        document.querySelector('[data-testid="seo-audit-progress"]')
          ?.textContent ?? "";
      if (text && recorder.__panelStates.at(-1) !== text) {
        recorder.__panelStates.push(text);
      }
    };
    const observe = (): void => {
      new MutationObserver(record).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    };
    if (document.body) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  });
  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-crawl-cache": "hit" },
      body: JSON.stringify(mockedPayload),
    });
  });

  await page.goto("/tools/seo-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free audit" }).click();

  await expect(page.getByTestId("seo-audit-results")).toBeVisible();
  const states = await page.evaluate(
    () => (window as unknown as { __panelStates: string[] }).__panelStates,
  );
  expect(states).toEqual([]);
});

test("asks the endpoint for the progress stream and renders a terminal-only body", async ({
  page,
}) => {
  let accept: string | undefined;
  await page.route("**/api/tools/seo-audit", async (route) => {
    accept = route.request().headers()["accept"];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify(mockedPayload)}\n`,
    });
  });

  await page.goto("/tools/seo-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free audit" }).click();

  await expect(page.getByTestId("seo-audit-results")).toBeVisible();
  expect(accept).toContain("application/x-ndjson");
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
