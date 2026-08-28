// @input  -- the Content Draft Writer page served by the standalone build, every API stubbed
// @output -- proof the page refuses bare keywords, takes only a parsed brief, renders the draft
//            contract honestly, spends nothing it was not asked to, and keeps no history
// @pos    -- the draft tool's end-to-end acceptance (handoff §8, tool two)

import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import type { DraftResult } from "@sf/public-tools/content-brief/contract";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

const RUN_REQUEST = "POST /api/tools/content-draft/run";
const SECTION_REQUEST = "POST /api/tools/content-draft/section";
const SESSION_REQUEST = "GET /api/auth/session";
const KNOWN_SHELL_REQUESTS = new Set([
  "GET /api/auth/profile",
  "GET /api/auth/one-tap/nonce",
  "GET /api/credits/balance",
  "GET /api/credits/ledger",
]);

interface Guard {
  runRequests: Request[];
  sectionRequests: Request[];
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
    readonly run?: (route: Route, request: Request) => Promise<void>;
    readonly section?: (route: Route, request: Request) => Promise<void>;
  },
): Promise<Guard> {
  const guard: Guard = { runRequests: [], sectionRequests: [], unexpected: [] };
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
    if (id === RUN_REQUEST && options.run) {
      guard.runRequests.push(request);
      await options.run(route, request);
      return;
    }
    if (id === SECTION_REQUEST && options.section) {
      guard.sectionRequests.push(request);
      await options.section(route, request);
      return;
    }
    if (!KNOWN_SHELL_REQUESTS.has(id)) {
      guard.unexpected.push(id);
    }
    await route.abort("blockedbyclient");
  });
  return guard;
}

function fulfillJson(body: unknown) {
  return async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  };
}

async function pasteBrief(page: Page, brief: unknown): Promise<void> {
  await page.locator("[data-paste-brief]").fill(JSON.stringify(brief));
  await page.locator("[data-load-brief]").click();
  await expect(page.locator('[data-intake-phase="loaded"]')).toBeVisible();
}

test.describe("Content Draft Writer", () => {
  test("opens on the empty state and refuses a bare keyword (item 20)", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    await page.goto("/en/tools/content-draft");
    await expect(page.locator("[data-empty-state]")).toContainText("does not accept a bare keyword");
    await expect(page.locator("form[data-content-draft-form]")).toHaveCount(0);
    await page.goto("/zh/tools/content-draft");
    await expect(page.locator("[data-empty-state]")).toContainText("不接受裸关键词");
    expect(guard.unexpected).toEqual([]);
  });

  test("a pasted brief with a bad reference is refused before the form appears (item 21)", async ({ page }) => {
    const brief = await draftBrief();
    if (brief.outline.status !== "available") throw new Error("fixture outline unavailable");
    const [first, ...rest] = brief.outline.items;
    const broken = {
      ...brief,
      outline: { status: "available", items: [{ ...first, answers: ["Q99"] }, ...rest] },
    };
    await installGuard(page, { signedIn: true });
    await page.goto("/en/tools/content-draft");
    await page.locator("[data-paste-brief]").fill(JSON.stringify(broken));
    await page.locator("[data-load-brief]").click();
    await expect(page.locator("[data-intake-rejected]")).toBeVisible();
    await expect(page.locator("form[data-content-draft-form]")).toHaveCount(0);
  });

  test("signed-out visitors get the sign-in dialog and no paid run is attempted (item 17)", async ({ page }) => {
    const brief = await draftBrief();
    const guard = await installGuard(page, { signedIn: false });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();
    await expect(page.locator("dialog, [role=dialog]").first()).toBeVisible();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("a signed-in run posts the brief and renders coverage, the document and the verify list", async ({ page }) => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief);
    const guard = await installGuard(page, { signedIn: true, run: fulfillJson(result) });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();

    await expect(page.locator("[data-content-draft-result]")).toBeVisible();
    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "available");
    await expect(page.locator("[data-draft-doc]")).toBeVisible();
    await expect(page.locator("[data-verify-list]")).toBeVisible();
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", result.run.mode);
    expect(await page.locator("[data-claim-underline]").count()).toBeGreaterThan(0);

    expect(guard.runRequests).toHaveLength(1);
    const body = guard.runRequests[0]?.postDataJSON() as {
      brief: { run: { fingerprint: string } };
      section_ids: string[];
      settings: Record<string, string>;
    };
    expect(body.brief.run.fingerprint).toBe(brief.run.fingerprint);
    expect(body.section_ids).toEqual(brief.draft_readiness.writable);
    expect(body.settings).toEqual({ tone: "explanatory", person: "second", product_mention: "gap_only" });
    expect(guard.unexpected).toEqual([]);
  });

  test("an unavailable coverage check renders as unavailable, never as a count (item 27)", async ({ page }) => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { coverage: "unavailable" });
    await installGuard(page, { signedIn: true, run: fulfillJson(result) });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();
    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "unavailable");
    await expect(page.locator("[data-coverage-figure]")).toHaveCount(0);
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", "degraded");
  });

  test("rerunning one section replaces the whole result and names the run it replaced (item 28)", async ({ page }) => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief, { failSection: "O2" });
    const replacement: DraftResult = {
      ...(await draftResultFixture(brief)),
      run: { ...(await draftResultFixture(brief)).run, run_id: "draft_01J6RERUN0000000000000002", reran_from: first.run.run_id },
    };
    const guard = await installGuard(page, {
      signedIn: true,
      run: fulfillJson(first),
      section: fulfillJson(replacement),
    });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "failed");
    await page.locator('[data-rerun-section="O2"]').click();
    await expect(page.locator("[data-reran-from]")).toHaveAttribute("data-reran-from", first.run.run_id);
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "ok");
    expect(guard.sectionRequests).toHaveLength(1);
    const body = guard.sectionRequests[0]?.postDataJSON() as { section_id: string; sections: unknown[] };
    expect(body.section_id).toBe("O2");
    expect(body.sections).toHaveLength(first.sections.length);
  });

  test("the On-Page handoff appears only with a published URL and opens with rel=opener (item 29)", async ({ page }) => {
    const brief = await draftBrief();
    await installGuard(page, { signedIn: true, run: fulfillJson(await draftResultFixture(brief)) });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();
    await expect(page.locator("[data-handoff-bar]")).toBeVisible();
    await expect(page.locator("[data-open-on-page]")).toHaveCount(0);
    await page.locator("#content-draft-published-url").fill("https://acme.example/blog/email-warmup-guide");
    const link = page.locator("[data-open-on-page]");
    await expect(link).toBeVisible();
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("opener");
  });

  test("reloading the page clears the draft and the brief; nothing is kept server-side (item 32)", async ({ page }) => {
    const brief = await draftBrief();
    await installGuard(page, { signedIn: true, run: fulfillJson(await draftResultFixture(brief)) });
    await page.goto("/en/tools/content-draft");
    await pasteBrief(page, brief);
    await page.locator("[data-run-draft]").click();
    await expect(page.locator("[data-content-draft-result]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-content-draft-result]")).toHaveCount(0);
    await expect(page.locator('[data-intake-phase="empty"]')).toBeVisible();
    expect(page.url()).not.toMatch(/warmup/u);
  });

  test("the formal name is the same string on the Chinese and English hub cards", async ({ page }) => {
    await installGuard(page, { signedIn: false });
    for (const locale of ["zh", "en"]) {
      await page.goto(`/${locale}/tools`);
      const card = page.locator('a[href$="/tools/content-draft"]').first();
      await expect(card).toBeVisible();
      await expect(card).toContainText("Content Draft Writer");
    }
  });
});
