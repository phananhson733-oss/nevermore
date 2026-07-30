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
              id: "homepage_status",
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

  await page.route("**/api/tools/seo-audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockedPayload),
    });
  });
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run free check" }).click();

  await expect(page.getByText("Measured page health")).toBeVisible();
  await expect(page.getByText("75", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("75% weighted coverage · 2 / 3 checks measured"),
  ).toBeVisible();
  await page.getByText("XML sitemap", { exact: true }).last().click();
  await expect(page.getByText("Standard sitemap.xml path")).toBeVisible();
  await expect(
    page.getByText(
      "Only /sitemap.xml was checked. Another sitemap may be declared elsewhere.",
    ),
  ).toBeVisible();

  await page.goto("/zh/tools/seo-audit");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "看清搜索引擎真正能读取的 SEO 信号",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "免费检测" })).toBeVisible();
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
