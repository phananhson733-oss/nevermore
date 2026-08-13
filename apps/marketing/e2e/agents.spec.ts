import { expect, test, type Page } from "@playwright/test";

type AgentKind = "seo" | "tech";

const RECORD_CATEGORIES = {
  robots_resource: "crawl",
  sitemap_resource: "crawl",
  non_2xx_final_status: "crawl",
  redirect_chain: "crawl",
  http_url: "crawl",
  noindex_directive: "indexability",
  canonical_missing: "indexability",
  canonical_differs: "indexability",
  title_missing: "metadata",
  title_duplicate: "metadata",
  meta_description_missing: "metadata",
  meta_description_duplicate: "metadata",
  h1_missing: "structure",
  multiple_h1: "structure",
  sitemap_page_without_observed_inlink: "links",
  internal_target_http_error: "links",
  json_ld_parse_error: "structured_data",
} as const;

function agentEnvelope(agent: AgentKind) {
  const observedId =
    agent === "seo" ? "title_missing" : "non_2xx_final_status";
  return {
    data: {
      run: {
        agent,
        mode: "authenticated_agent",
        persistence: "none",
        source: {
          tool: "seo_audit",
          schemaVersion: "seo_audit.sitewide.v3",
          completedAt: "2026-08-12T10:00:00.000Z",
          cache: { status: "miss", capturedAt: null },
        },
      },
      result: {
        targetUrl: "https://astrologywiki.com/",
        siteOrigin: "https://astrologywiki.com",
        scannedAt: "2026-08-12T10:00:00.000Z",
        coverage: {
          availability: "partial",
          pagesInspected: 3,
          linksObserved: 7,
          sitemapUrlsObserved: 5,
          urlsSkipped: 1,
          urlsBlocked: 0,
          urlsDisallowed: 0,
          urlsErrored: 1,
          stopReason: "max_urls",
        },
        siteResources: {
          robotsFetched: true,
          robotsGroupsObserved: 1,
          sitemapReferencesObserved: 1,
          sitemapFetched: true,
        },
        records: Object.entries(RECORD_CATEGORIES).map(([id, category]) => {
          const observed = id === observedId;
          const siteResource =
            id === "robots_resource" || id === "sitemap_resource";
          return {
            id,
            category,
            state: observed ? "observed" : "not_observed",
            unit: siteResource
              ? "site_resource"
              : id === "internal_target_http_error"
                ? "link_targets"
                : "pages",
            tested: siteResource ? 1 : 3,
            affected: observed ? 1 : 0,
            observations: observed
              ? [
                  {
                    url:
                      agent === "seo"
                        ? "https://astrologywiki.com/about"
                        : "https://astrologywiki.com/old",
                    values:
                      agent === "seo"
                        ? [{ label: "title", value: null }]
                        : [
                            { label: "initial_status", value: 404 },
                            { label: "final_status", value: 404 },
                          ],
                  },
                ]
              : [],
            limitation: null,
          };
        }),
      },
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
}

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
  await page.getByRole("button", { name: "Accept context & run" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to GenGrowth" })).toBeVisible();
  expect(auditPosts).toBe(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v2"),
    ),
  ).toContain('"purpose":"run_confirmed_profile"');
});

test("signed-in SEO run renders bounded evidence, reach, and selected solution", async ({
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
  await page.getByRole("button", { name: "Review & adjust" }).click();
  await page.getByLabel("Target query").fill("technical seo audit");
  await page.getByRole("button", { name: "Accept context & run" }).click();

  const results = page.getByTestId("agent-results-seo");
  await expect(results).toBeVisible();
  await expect(results.getByText("Pages inspected")).toBeVisible();
  await expect(page.getByTestId("agent-diagnosis")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-E")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("diagnosis-scope-page").click();
  await expect(page.getByText("9 groups · 50 checks")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-9")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("diagnosis-group-3").click();
  await page.getByTestId("diagnosis-check-3.4").click();
  await page.locator('[data-policy-threshold="3.4"]').fill("Local H2 range 2–7");
  await page.locator('[data-policy-action="save"]').click();
  await expect(page.getByText("Local H2 range 2–7")).toBeVisible();
  await expect(page.getByText(/new real run is required/i)).toBeVisible();
  await page.locator('[data-policy-action="reset-scope"]').click();
  await expect(page.getByText("Local H2 range 2–7")).toHaveCount(0);
  await expect(page.getByTestId("agent-recommendation-row")).toBeVisible();
  await expect(page.getByTestId("agent-selected-solution")).toContainText(
    "SEO Agent decision",
  );
  await expect(page.getByTestId("agent-selected-solution")).toContainText(
    "technical seo audit",
  );
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
      "gengrowth:agent-intent:seo:v2",
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
  await page.getByRole("button", { name: "接受上下文并运行" }).click();
  await expect(page.getByTestId("agent-results-tech")).toBeVisible();
  await expect(page.getByTestId("diagnosis-group-A")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("agent-selected-solution")).toContainText(
    "HTTP/1.1 200 OK",
  );
  await expect(page.getByTestId("agent-selected-solution")).not.toContainText(
    "SEO Agent decision",
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v2"),
    ),
  ).toContain("seo-only.example");
});

test("homepage chooses an exact Agent and retired audit pages redirect", async ({
  page,
}) => {
  await mockSession(page, false);

  await page.goto("/");
  const homepageUrl = page.getByLabel("Website host or URL");
  const techButton = page.getByRole("button", { name: "Run Tech Agent" });
  await homepageUrl.fill("acme.com");
  await expect(homepageUrl).toHaveValue("acme.com");
  await expect(techButton).toBeEnabled();
  await techButton.click();
  await expect(page).toHaveURL(/\/agents\/tech$/);
  await expect(page.getByLabel("Target URL")).toHaveValue("acme.com");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/tools/seo-audit");
  await expect(page).toHaveURL(/\/agents\/seo$/);
  await page.goto("/zh/tools/internal-link-audit");
  await expect(page).toHaveURL(/\/zh\/agents\/tech$/);
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
  await expect(page.locator('a[href="#prompts"]')).toHaveCount(1);
  await expect(page.locator('a[href="#tools"]')).toHaveCount(1);
  await expect(page.locator('a[href="#skills"]')).toHaveCount(1);
  await expect(page.locator('a[href="#docs"]')).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Browse Tools" })).toHaveAttribute(
    "href",
    "/tools",
  );
});
