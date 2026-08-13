import { expect, test, type Page } from "@playwright/test";

type AgentKind = "seo" | "tech";

function agentEnvelope(agent: AgentKind) {
  const isSeo = agent === "seo";
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
        targetUrl: "https://acme.com/",
        siteOrigin: "https://acme.com",
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
        records: [
          isSeo
            ? {
                id: "title_missing",
                category: "metadata",
                state: "observed",
                unit: "pages",
                tested: 3,
                affected: 1,
                observations: [
                  {
                    url: "https://acme.com/about",
                    values: [{ label: "title", value: null }],
                  },
                ],
                limitation: null,
              }
            : {
                id: "non_2xx_final_status",
                category: "crawl",
                state: "observed",
                unit: "pages",
                tested: 3,
                affected: 1,
                observations: [
                  {
                    url: "https://acme.com/old",
                    values: [
                      { label: "initial_status", value: 404 },
                      { label: "final_status", value: 404 },
                    ],
                  },
                ],
                limitation: null,
              },
        ],
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
  await page.getByLabel("Website host or URL").fill("acme.com/docs");
  await page.getByRole("button", { name: "Run Agent" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to GenGrowth" })).toBeVisible();
  expect(auditPosts).toBe(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v1"),
    ),
  ).toContain("acme.com/docs");
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
  await page.getByLabel("Website host or URL").fill("acme.com");
  await page.getByRole("button", { name: "Run Agent" }).click();

  const results = page.getByTestId("agent-results-seo");
  await expect(results).toBeVisible();
  await expect(results.getByText("Pages inspected")).toBeVisible();
  await expect(page.getByTestId("agent-opportunity-title_missing")).toBeVisible();
  await expect(page.getByTestId("agent-selected-solution")).toContainText(
    "Adaptable preview · not applied",
  );
  await expect(page.getByText(/Health score/i)).toHaveCount(0);
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
      "gengrowth:agent-intent:seo:v1",
      JSON.stringify({
        agent: "seo",
        url: "seo-only.example",
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1_000,
      }),
    );
  });
  await page.goto("/zh/agents/tech");

  const input = page.getByLabel("网站主机名或 URL");
  await expect(input).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await input.fill("acme.com");
  await page.getByRole("button", { name: "运行 Agent" }).click();
  await expect(page.getByTestId("agent-results-tech")).toBeVisible();
  await expect(page.getByTestId("agent-opportunity-non_2xx_final_status")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("gengrowth:agent-intent:seo:v1"),
    ),
  ).toContain("seo-only.example");
});

test("homepage chooses an exact Agent and retired audit pages redirect", async ({
  page,
}) => {
  await mockSession(page, false);

  await page.goto("/");
  await page.getByLabel("Website host or URL").fill("acme.com");
  await page.getByRole("button", { name: "Run Tech Agent" }).click();
  await expect(page).toHaveURL(/\/agents\/tech$/);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.goto("/tools/seo-audit");
  await expect(page).toHaveURL(/\/agents\/seo$/);
  await page.goto("/zh/tools/internal-link-audit");
  await expect(page).toHaveURL(/\/zh\/agents\/tech$/);
});
