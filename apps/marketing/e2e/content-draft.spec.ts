// @input  -- the Content Draft Writer page served by the standalone build, every API stubbed
// @output -- proof the page refuses bare keywords, takes only a parsed brief, renders the draft
//            contract honestly, spends nothing it was not asked to, keeps no history, and receives
//            the brief tool's handoff across a real new tab
// @pos    -- the draft tool's end-to-end acceptance (handoff §8, tool two)

import { readFile } from "node:fs/promises";

import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import {
  CONTENT_BRIEF_HANDOFF_KEY,
  type ContentBrief,
  type DraftResult,
} from "@sf/public-tools/content-brief/contract";
import { draftFingerprint } from "@sf/public-tools/content-brief/canonical";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

const RUN_REQUEST = "POST /api/tools/content-draft/run";
const SECTION_REQUEST = "POST /api/tools/content-draft/section";
const BRIEF_RUN_REQUEST = "POST /api/tools/content-brief/run";
const SESSION_REQUEST = "GET /api/auth/session";
const WEBSITES_REQUEST = "GET /api/account/websites";
const KNOWN_SHELL_REQUESTS = new Set([
  "GET /api/auth/profile",
  "GET /api/auth/one-tap/nonce",
  "GET /api/credits/balance",
  "GET /api/credits/ledger",
]);
const RERUN_ID = "draft_01J6RERUN0000000000000002";

interface Guard {
  runRequests: Request[];
  sectionRequests: Request[];
  readonly unexpected: string[];
}

/**
 * Every `/api/**` call is answered here or aborted. Installed on the CONTEXT,
 * not the page, so a tab the page opens is covered too. The standalone server
 * runs under `env -i`, so a request that slipped through would fail anyway;
 * the guard turns that into an assertion instead of a silent 500.
 */
async function installGuard(
  page: Page,
  options: {
    readonly signedIn: boolean;
    readonly run?: (route: Route, request: Request) => Promise<void>;
    readonly section?: (route: Route, request: Request) => Promise<void>;
    readonly briefRun?: (route: Route, request: Request) => Promise<void>;
  },
): Promise<Guard> {
  const guard: Guard = { runRequests: [], sectionRequests: [], unexpected: [] };
  await page.context().route("**/api/**", async (route) => {
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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { websites: [] } }) });
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
    if (id === BRIEF_RUN_REQUEST && options.briefRun) {
      await options.briefRun(route, request);
      return;
    }
    if (!KNOWN_SHELL_REQUESTS.has(id) && id !== WEBSITES_REQUEST) {
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

/** A rerun reply derived from the request: new run id, `reran_from` = the request's previous_run_id, re-fingerprinted. */
function fulfillRerun(base: DraftResult) {
  return async (route: Route, request: Request): Promise<void> => {
    const body = request.postDataJSON() as { previous_run_id?: unknown };
    const reranFrom = typeof body.previous_run_id === "string" ? body.previous_run_id : null;
    const next: DraftResult = { ...base, run: { ...base.run, run_id: RERUN_ID, reran_from: reranFrom, fingerprint: "" } };
    const fingerprint = await draftFingerprint(next);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...next, run: { ...next.run, fingerprint } }),
    });
  };
}

async function pasteBrief(page: Page, brief: unknown): Promise<void> {
  await page.locator("[data-paste-brief]").fill(JSON.stringify(brief));
  await page.locator("[data-load-brief]").click();
  await expect(page.locator('[data-intake-phase="loaded"]')).toBeVisible();
}

async function runDraft(page: Page, brief: ContentBrief): Promise<void> {
  await page.goto("/en/tools/content-draft");
  await pasteBrief(page, brief);
  await page.locator("[data-run-draft]").click();
  await expect(page.locator("[data-content-draft-result]")).toBeVisible();
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
    await runDraft(page, brief);

    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "available");
    await expect(page.locator("[data-draft-doc]")).toBeVisible();
    await expect(page.locator("[data-verify-list]")).toBeVisible();
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", result.run.mode);
    expect(await page.locator("[data-claim-underline]").count()).toBeGreaterThan(0);
    expect(await page.locator("[data-claim-mark]").count()).toBe(await page.locator("[data-claim-underline]").count());

    expect(guard.runRequests).toHaveLength(1);
    const body = guard.runRequests[0]?.postDataJSON() as {
      brief: { run: { fingerprint: string } };
      section_ids: string[];
      settings: Record<string, string>;
    };
    expect(Object.keys(body).sort()).toEqual(["brief", "section_ids", "settings"]);
    expect(body.brief.run.fingerprint).toBe(brief.run.fingerprint);
    expect(body.section_ids).toEqual(brief.draft_readiness.writable);
    expect(body.settings).toEqual({ tone: "explanatory", person: "second", product_mention: "gap_only" });
    expect(guard.unexpected).toEqual([]);
  });

  test("an unavailable coverage check renders as unavailable, never as a count (item 27)", async ({ page }) => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { coverage: "unavailable" });
    await installGuard(page, { signedIn: true, run: fulfillJson(result) });
    await runDraft(page, brief);
    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "unavailable");
    await expect(page.locator("[data-coverage-figure]")).toHaveCount(0);
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", "degraded");
  });

  test("rerunning one section sends the exact body, replaces the whole result, names the run it replaced, and exports a valid fingerprint (items 28, 30)", async ({ page }) => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief, { failSection: "O2" });
    const guard = await installGuard(page, {
      signedIn: true,
      run: fulfillJson(first),
      section: fulfillRerun(await draftResultFixture(brief)),
    });
    await runDraft(page, brief);
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "failed");
    await page.locator('[data-rerun-section="O2"]').click();
    await expect(page.locator("[data-reran-from]")).toHaveAttribute("data-reran-from", first.run.run_id);
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "ok");
    await expect(page.locator("[data-reruns-used]")).toContainText("1");

    expect(guard.sectionRequests).toHaveLength(1);
    const body = guard.sectionRequests[0]?.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["brief", "previous_run_id", "section_id", "sections", "settings"]);
    expect(body["section_id"]).toBe("O2");
    expect(body["previous_run_id"]).toBe(first.run.run_id);
    expect(body["settings"]).toEqual(first.settings);
    expect(body["sections"]).toEqual(first.sections);

    // The exported file is the replaced result, and its fingerprint recomputes.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-export-json]").click(),
    ]);
    const path = await download.path();
    if (path === null) throw new Error("download has no path");
    const exported = JSON.parse(await readFile(path, "utf8")) as DraftResult;
    expect(exported.run.run_id).toBe(RERUN_ID);
    expect(exported.run.reran_from).toBe(first.run.run_id);
    expect(await draftFingerprint(exported)).toBe(exported.run.fingerprint);
    await expect(page.locator('[data-fingerprint="draft"]')).toHaveText(exported.run.fingerprint);
    expect(exported.sections.map((section) => section.h2)).toEqual(
      await page.locator("[data-section-h2]").allInnerTexts(),
    );
  });

  test("the On-Page handoff appears only with a published URL and opens with rel=opener (item 29)", async ({ page }) => {
    const brief = await draftBrief();
    await installGuard(page, { signedIn: true, run: fulfillJson(await draftResultFixture(brief)) });
    await runDraft(page, brief);
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
    await runDraft(page, brief);
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

test.describe("brief → draft handoff across a real new tab", () => {
  async function openBriefResult(page: Page, brief: ContentBrief): Promise<void> {
    await page.goto("/en/tools/content-brief");
    await page.locator('input[name="primary"]').fill(brief.keyword.primary);
    await page.locator("[data-run-brief]").click();
    await expect(page.locator("[data-generate-draft]")).toBeVisible();
  }

  test('a left click on "Generate draft" opens the draft tool with this brief and clears the opener\'s copy (item 32 kept)', async ({ page }) => {
    const brief = await draftBrief();
    const guard = await installGuard(page, { signedIn: true, briefRun: fulfillJson(brief) });
    await openBriefResult(page, brief);

    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator("[data-generate-draft]").click(),
    ]);
    await popup.waitForLoadState();
    await expect(popup.locator('[data-brief-source="handoff"]')).toBeVisible();
    await expect(popup.locator("[data-brief-fingerprint]")).toHaveText(brief.run.fingerprint);
    await expect(popup.locator("form[data-content-draft-form]")).toBeVisible();
    expect(popup.url()).not.toContain(brief.run.fingerprint);

    // Consumed once in the new tab, and the opener's copy went with it.
    const key = CONTENT_BRIEF_HANDOFF_KEY;
    expect(await popup.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
    expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
    expect(guard.unexpected).toEqual([]);
  });

  /**
   * A middle click writes the handoff on mousedown, before the browser creates
   * the tab -- but Chromium opens a middle-click tab with no opener and, in
   * current builds, without a copy of session storage, so the destination
   * cannot receive it. This case pins what the page CAN do (the write) and
   * what the browser then does (an empty draft page), rather than claiming a
   * receipt that does not happen.
   */
  test('a middle click on "Generate draft" writes the handoff, though Chromium gives the new tab no session storage', async ({ page }) => {
    const brief = await draftBrief();
    await installGuard(page, { signedIn: true, briefRun: fulfillJson(brief) });
    await openBriefResult(page, brief);

    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator("[data-generate-draft]").click({ button: "middle" }),
    ]);
    // A background tab reports about:blank until its navigation commits.
    await popup.waitForURL("**/tools/content-draft");
    await popup.waitForLoadState();
    // The opener staged the handoff on mousedown; nothing consumed it.
    const key = CONTENT_BRIEF_HANDOFF_KEY;
    const staged = await page.evaluate((k) => sessionStorage.getItem(k), key);
    expect(staged).not.toBeNull();
    expect((JSON.parse(staged ?? "null") as { brief: ContentBrief }).brief.run.fingerprint).toBe(brief.run.fingerprint);
    await expect(popup.locator('[data-intake-phase="empty"]')).toBeVisible();
    expect(await popup.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  });
});
