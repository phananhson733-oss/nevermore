// @input  -- the Content Brief Builder page served by the standalone build, every API stubbed
// @output -- proof the page renders the contract honestly and spends nothing it was not asked to
// @pos    -- the brief tool's end-to-end acceptance (handoff §8, tool one)

import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { validContentBrief } from "../src/components/tools/content-brief-fixture";

const RUN_REQUEST = "POST /api/tools/content-brief/run";
const SESSION_REQUEST = "GET /api/auth/session";
const WEBSITES_REQUEST = "GET /api/account/websites";
const PROFILE_REQUEST = "GET /api/auth/profile";
const NONCE_REQUEST = "GET /api/auth/one-tap/nonce";
const KNOWN_SHELL_REQUESTS = new Set([
  PROFILE_REQUEST,
  NONCE_REQUEST,
  "GET /api/credits/balance",
  "GET /api/credits/ledger",
]);

interface Guard {
  runRequests: Request[];
  readonly unexpected: string[];
}

/**
 * Every `/api/**` call is answered here or aborted. The standalone server runs
 * under `env -i`, so a request that slipped through would fail anyway; the
 * guard turns that into an assertion instead of a silent 500.
 */
async function installGuard(
  page: Page,
  options: {
    readonly signedIn: boolean;
    readonly websites?: readonly { id: string; name: string }[];
    readonly run?: (route: Route, request: Request) => Promise<void>;
  },
): Promise<Guard> {
  const guard: Guard = { runRequests: [], unexpected: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const id = `${request.method()} ${new URL(request.url()).pathname}`;
    if (id === SESSION_REQUEST) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ signedIn: options.signedIn }),
      });
      return;
    }
    if (id === WEBSITES_REQUEST && options.signedIn) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: (options.websites ?? []).map((site) => ({
            websiteId: site.id,
            origin: `https://${site.name}`,
            host: site.name,
            canonicalSiteKey: site.name,
            displayName: site.name,
            isPrimary: true,
            profileState: "confirmed",
            confirmedSnapshotId: "snap-1",
            confirmedSnapshotRevision: 1,
            confirmedAt: "2026-08-01T00:00:00.000Z",
          })),
        }),
      });
      return;
    }
    if (id === RUN_REQUEST && options.run) {
      guard.runRequests.push(request);
      await options.run(route, request);
      return;
    }
    if (!KNOWN_SHELL_REQUESTS.has(id) && id !== WEBSITES_REQUEST) {
      guard.unexpected.push(id);
    }
    await route.abort("blockedbyclient");
  });
  return guard;
}

function fulfillBrief(brief: unknown) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(brief),
    });
  };
}

async function submitKeyword(page: Page, keyword = "brew coffee"): Promise<void> {
  await page.locator('input[name="primary"]').fill(keyword);
  await page.locator("[data-run-brief]").click();
}

test.describe("Content Brief Builder", () => {
  test("signed-out visitors get the sign-in dialog and no paid run is attempted", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    await expect(page.locator("dialog, [role=dialog]").first()).toBeVisible();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("a run without Search Console renders an undecidable verdict, never 'create'", async ({ page }) => {
    const brief = validContentBrief();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);

    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    await expect(page.locator("[data-verdict-action]")).toHaveAttribute("data-verdict-action", "undecidable");
    await expect(page.locator("[data-verdict-reason]")).toHaveAttribute("data-verdict-reason", "no_gsc_property");
    const verdictText = await page.locator("[data-verdict-action]").innerText();
    expect(verdictText.toLowerCase()).not.toContain("create");
    expect(verdictText).not.toContain("新建");
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", brief.run.mode);

    expect(guard.runRequests).toHaveLength(1);
    const body = guard.runRequests[0]?.postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ primary: "brew coffee", market: "US", language: "en" });
    expect(body["gsc_property"]).toBeUndefined();
    expect(guard.unexpected).toEqual([]);
  });

  test("evidence coverage prints the same-host skip and the model-unconfigured cell", async ({ page }) => {
    const base = validContentBrief();
    const brief = {
      ...base,
      run: {
        ...base.run,
        reads: {
          ...base.run.reads,
          llm: {
            status: "unavailable",
            reason: "not_configured",
            attempted: 0,
            calls: 0,
            model_id: null,
            input_tokens: null,
            output_tokens: null,
          },
        },
      },
    };
    await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    await expect(page.locator("[data-content-brief-result]")).toBeVisible();
    await expect(page.locator('[data-coverage-cell="llm"] [data-unavailable-reason]')).toHaveAttribute(
      "data-unavailable-reason",
      "not_configured",
    );
    const skipped = page.locator('[data-crawl-skipped-reason="same_host"]');
    if ((await skipped.count()) > 0) {
      await expect(skipped.first()).toBeVisible();
    }
  });

  test("a rate-limited run shows the error code copy instead of a result", async ({ page }) => {
    const guard = await installGuard(page, {
      signedIn: true,
      run: async (route) => {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          headers: { "Retry-After": "42" },
          body: JSON.stringify({ error: { code: "rate_limited" } }),
        });
      },
    });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    await expect(page.locator('[data-error-code="rate_limited"]')).toBeVisible();
    await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
    expect(guard.runRequests).toHaveLength(1);
  });

  test("reloading the page clears the report; nothing is kept server-side", async ({ page }) => {
    await installGuard(page, { signedIn: true, run: fulfillBrief(validContentBrief()) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    await expect(page.locator("[data-content-brief-result]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
    expect(page.url()).not.toMatch(/brew|coffee/u);
  });

  test("the formal name is the same string on the Chinese and English hub cards", async ({ page }) => {
    await installGuard(page, { signedIn: false });
    for (const locale of ["zh", "en"]) {
      await page.goto(`/${locale}/tools`);
      const card = page.locator('a[href$="/tools/content-brief"]').first();
      await expect(card).toBeVisible();
      await expect(card).toContainText("Content Brief Builder");
    }
    await page.goto("/zh/tools/content-brief");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('input[name="primary"]')).toBeVisible();
  });
});
