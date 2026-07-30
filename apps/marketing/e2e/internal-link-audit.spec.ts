import { expect, test } from "@playwright/test";

test("runs the English no-network demo and exposes actionable graph details", async ({
  page,
}) => {
  await page.goto("/en/tools/internal-link-audit");

  await expect(
    page.getByRole("heading", { level: 1, name: "Internal Link Audit" }),
  ).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This milestone uses a fixed 42-page sample. The production free-crawl limit is not set yet, so we do not invent one here.",
    ),
  ).toBeVisible();

  const runtimeRequests: string[] = [];
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    const isNextPrefetch =
      request.method() === "GET" &&
      requestUrl.origin === "http://127.0.0.1:3001" &&
      !requestUrl.pathname.startsWith("/api/");
    if (
      ["fetch", "xhr"].includes(request.resourceType()) &&
      !isNextPrefetch
    ) {
      runtimeRequests.push(request.url());
    }
  });

  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Start demo crawl" }).click();
  await expect(page.getByTestId("internal-link-progress")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Two orphan pages deserve attention before the deeper cluster gaps",
    }),
  ).toBeVisible();

  expect(runtimeRequests).toEqual([]);
  await expect(page.getByText("GG-DEMO-P02-20260730")).toBeVisible();
  await expect(
    page.getByText(
      "10 graph nodes · sample totals 42 pages / 118 links · no real crawl",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Every metric below comes from petwise.example, a fictional 42-page sample — not from the site you entered.",
    ),
  ).toBeVisible();

  const detail = page.getByTestId("internal-link-node-detail");
  await expect(detail.getByText("/app-setup-guide", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deep pages" }).click();
  await expect(
    page.getByRole("button", { name: "Deep pages" }),
  ).toHaveAttribute("aria-pressed", "true");

  const multiCatNode = page.getByTestId("internal-link-node-multi-cat");
  await multiCatNode.focus();
  await multiCatNode.press("Enter");
  await expect(detail.getByText("/multi-cat-guide", { exact: true })).toBeVisible();
  await expect(detail.getByText("feeding two cats", { exact: true })).toBeVisible();

  await page.getByTestId("internal-link-finding-broken-setup").click();
  await expect(detail.getByText("/old-feeder-setup", { exact: true })).toBeVisible();
  await expect(
    detail.getByText("No network request was made; the 404 is fixed demo data."),
  ).toBeVisible();
});

test("renders localized schema, tools-index entry, and a 390px layout", async ({
  page,
  request,
}) => {
  await page.goto("/en/tools/internal-link-audit");

  await expect(page).toHaveTitle(
    "Free Internal Link Audit — Find Broken Links & Orphan Pages",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://gengrowth.ai/en/tools/internal-link-audit",
  );
  await expect(
    page.locator('link[rel="alternate"][hreflang="zh"]'),
  ).toHaveAttribute(
    "href",
    "https://gengrowth.ai/zh/tools/internal-link-audit",
  );
  await expect(
    page.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute(
    "href",
    "https://gengrowth.ai/en/tools/internal-link-audit",
  );

  const schemaTypes = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts
        .map((script) => JSON.parse(script.textContent ?? "{}"))
        .map((value) => value["@type"]),
    );
  expect(schemaTypes).toEqual(
    expect.arrayContaining([
      "BreadcrumbList",
      "HowTo",
      "FAQPage",
      "SoftwareApplication",
    ]),
  );
  const softwareSchema = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts
        .map((script) => JSON.parse(script.textContent ?? "{}"))
        .find((value) => value["@type"] === "SoftwareApplication"),
    );
  expect(softwareSchema.description).toContain("fixed-data demonstration");
  expect(softwareSchema.featureList).toContain("No live website crawl");

  await page.goto("/en/tools");
  await expect(
    page.getByRole("heading", { level: 3, name: "Internal Link Audit" }),
  ).toBeVisible();

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain(
    "https://gengrowth.ai/en/tools/internal-link-audit",
  );
  expect(sitemapBody).toContain(
    "https://gengrowth.ai/zh/tools/internal-link-audit",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/tools/internal-link-audit");
  await expect(
    page.getByRole("heading", { level: 1, name: "内链审计" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始演示抓取" }),
  ).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toBeVisible();

  const initialOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(initialOverflow).toBe(false);

  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始演示抓取" }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "先处理两个有明确来源页的孤岛，再修复更深层的簇内缺口",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("internal-link-graph")).toBeVisible();

  const resultOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(resultOverflow).toBe(false);
});
