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
import { SECTION_ENDPOINT_BUDGET_MS } from "@sf/public-tools/content-brief/constants";
import { draftFingerprint } from "@sf/public-tools/content-brief/canonical";
import {
  DRAFT_FIXTURE_RERUN_ID,
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";
import { confirmedDraftV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { TOOL_HANDOFF_KEY } from "../src/lib/tools/tool-handoff";
import { fulfillJson, installDraftApiGuard as installGuard, openConfirmedBriefV2 } from "./content-draft-e2e-helpers";

/**
 * A rerun reply with the section endpoint's semantics, derived from the
 * request: `reran_from` = `previous.run.run_id`, the rewritten section = its
 * section_id, one-call llm aggregate, the section budget, real fingerprint.
 */
function fulfillRerun(brief: ContentBrief, options: { readonly coverage?: "unavailable" } = {}) {
  return async (route: Route, request: Request): Promise<void> => {
    const body = request.postDataJSON() as { previous?: { run?: { run_id?: unknown } }; section_id?: unknown };
    const previousRunId = typeof body.previous?.run?.run_id === "string" ? body.previous.run.run_id : "";
    const sectionId = typeof body.section_id === "string" ? body.section_id : "";
    const next = await draftResultFixture(brief, { ...options, rerun: { previousRunId, sectionId } });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
  };
}

async function coverageOnScreen(page: Page): Promise<{ status: string | null; covered: string; partial: string; none: string; total: string }> {
  const card = page.locator("[data-coverage-card]");
  const status = await card.getAttribute("data-field-status");
  const figure = (name: string) => card.locator(`[data-coverage-figure="${name}"]`).locator("div").first().innerText();
  return status === "available"
    ? { status, covered: await figure("covered"), partial: await figure("partial"), none: await figure("none"), total: await card.locator("[data-coverage-total]").innerText() }
    : { status, covered: "", partial: "", none: "", total: "" };
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
    // Every sentence carries a screen-reader mark, connective ones included.
    expect(await page.locator("[data-claim-mark]").count()).toBe(await page.locator("[data-sentence]").count());

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

  test("rerunning one section sends the exact body, replaces the whole result with the section endpoint's shape, and the export matches every coverage figure (items 28, 30)", async ({ page }) => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief, { failSection: "O2" });
    if (first.coverage.status !== "available") throw new Error("fixture coverage unavailable");
    const guard = await installGuard(page, {
      signedIn: true,
      run: fulfillJson(first),
      section: fulfillRerun(brief),
    });
    await runDraft(page, brief);
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "failed");
    const before = await coverageOnScreen(page);
    expect(before).toEqual({
      status: "available",
      covered: String(first.coverage.covered),
      partial: String(first.coverage.partial),
      none: String(first.coverage.none),
      total: await page.locator("[data-coverage-total]").innerText(),
    });
    expect(await page.locator('[data-coverage-item][data-coverage-cause="section_failed"]').count()).toBe(1);

    await page.locator('[data-rerun-section="O2"]').click();
    await expect(page.locator("[data-reran-from]")).toHaveAttribute("data-reran-from", first.run.run_id);
    await expect(page.locator('[data-draft-section="O2"]')).toHaveAttribute("data-section-status", "ok");
    await expect(page.locator("[data-reruns-used]")).toContainText("1");

    expect(guard.sectionRequests).toHaveLength(1);
    const body = guard.sectionRequests[0]?.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["brief", "previous", "section_id"]);
    expect(body["section_id"]).toBe("O2");
    expect((body["brief"] as ContentBrief).run.fingerprint).toBe(brief.run.fingerprint);
    // The whole previous result, verbatim; the server takes settings, sections and the run id from it.
    expect(body["previous"]).toEqual(first);

    // The exported file is the replaced result: the section endpoint's run
    // shape, a fingerprint that recomputes, and coverage figures that changed
    // with the rewritten section and match the screen one by one.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-export-json]").click(),
    ]);
    const path = await download.path();
    if (path === null) throw new Error("download has no path");
    const exported = JSON.parse(await readFile(path, "utf8")) as DraftResult;
    expect(exported.run.run_id).toBe(DRAFT_FIXTURE_RERUN_ID);
    expect(exported.run.reran_from).toBe(first.run.run_id);
    expect(exported.run.budget_ms).toBe(SECTION_ENDPOINT_BUDGET_MS);
    expect(exported.run.reads.llm_sections.status).toBe("complete");
    expect(exported.run.reads.sections).toEqual({ requested: exported.sections.length, ok: exported.sections.length, failed: 0, skipped: 0 });
    expect(await draftFingerprint(exported)).toBe(exported.run.fingerprint);
    await expect(page.locator('[data-fingerprint="draft"]')).toHaveText(exported.run.fingerprint);
    if (exported.coverage.status !== "available") throw new Error("rerun coverage unavailable");
    const after = await coverageOnScreen(page);
    expect(after).toEqual({
      status: "available",
      covered: String(exported.coverage.covered),
      partial: String(exported.coverage.partial),
      none: String(exported.coverage.none),
      total: await page.locator("[data-coverage-total]").innerText(),
    });
    expect(after.none).not.toBe(before.none);
    expect(exported.coverage.none).toBeLessThan(first.coverage.none);
    expect(await page.locator('[data-coverage-item][data-coverage-cause="section_failed"]').count()).toBe(0);
    for (const item of exported.coverage.items) {
      await expect(page.locator(`[data-coverage-item="${item.question_id}"]`)).toHaveAttribute("data-coverage-status", item.status);
    }
    expect(exported.sections.map((section) => section.h2)).toEqual(
      await page.locator("[data-section-h2]").allInnerTexts(),
    );
  });

  test("a rerun whose coverage check fails replaces an available coverage card with the unavailable one", async ({ page }) => {
    const brief = await draftBrief();
    const first = await draftResultFixture(brief);
    await installGuard(page, {
      signedIn: true,
      run: fulfillJson(first),
      section: fulfillRerun(brief, { coverage: "unavailable" }),
    });
    await runDraft(page, brief);
    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "available");
    await page.locator('[data-rerun-section="O1"]').click();
    await expect(page.locator("[data-reran-from]")).toHaveAttribute("data-reran-from", first.run.run_id);
    await expect(page.locator("[data-coverage-card]")).toHaveAttribute("data-field-status", "unavailable");
    await expect(page.locator("[data-coverage-figure]")).toHaveCount(0);
    await expect(page.locator("[data-run-mode]").first()).toHaveAttribute("data-run-mode", "degraded");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("[data-export-json]").click()]);
    const path = await download.path();
    if (path === null) throw new Error("download has no path");
    const exported = JSON.parse(await readFile(path, "utf8")) as DraftResult;
    expect(exported.coverage.status).toBe("unavailable");
    expect(exported.run.mode).toBe("degraded");
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
  /**
   * The standalone server has no Supabase, so the popup is server-rendered as
   * signed out. That is the hero-CTA path of the second review: the draft
   * page must NOT consume the handoff before the sign-in reload — it peeks,
   * says a brief is waiting, and leaves both copies in place. The take-and-
   * clear-opener path needs a server-authenticated render and is pinned in
   * content-draft-tool.test.tsx instead.
   */
  test('a left click on "Generate draft" carries the brief into a real new tab, which keeps it for the sign-in reload', async ({ page }) => {
    const { brief } = await confirmedDraftV2Fixture();
    const guard = await installGuard(page, { signedIn: true, briefRun: fulfillJson(brief) });
    const confirmed = await openConfirmedBriefV2(page, brief);

    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator("[data-generate-draft]").click(),
    ]);
    await popup.waitForURL("**/tools/content-draft");
    await popup.waitForLoadState();
    await expect(popup.locator("[data-handoff-pending]")).toBeVisible();
    await expect(popup.locator('[data-intake-phase="empty"]')).toBeVisible();
    expect(popup.url()).not.toContain(brief.run.fingerprint);

    // The new tab received its own copy and consumed nothing; the opener keeps its copy too.
    const key = CONTENT_BRIEF_HANDOFF_KEY;
    const received = await popup.evaluate((k) => sessionStorage.getItem(k), key);
    expect(received).not.toBeNull();
    const envelope = JSON.parse(received ?? "null") as { version: number; brief: ConfirmedBriefV2 };
    expect(envelope.version).toBe(2);
    expect(envelope.brief).toEqual(confirmed);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBe(received);
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
    const { brief } = await confirmedDraftV2Fixture();
    await installGuard(page, { signedIn: true, briefRun: fulfillJson(brief) });
    const confirmed = await openConfirmedBriefV2(page, brief);

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
    const envelope = JSON.parse(staged ?? "null") as { version: number; brief: ConfirmedBriefV2 };
    expect(envelope.version).toBe(2);
    expect(envelope.brief).toEqual(confirmed);
    await expect(popup.locator('[data-intake-phase="empty"]')).toBeVisible();
    expect(await popup.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  });

  test("the published URL hands the page, keyword and market to the On-Page SEO Checker in a real new tab", async ({ page }) => {
    const brief = await draftBrief();
    const guard = await installGuard(page, { signedIn: true, run: fulfillJson(await draftResultFixture(brief)) });
    await runDraft(page, brief);
    const published = "https://acme.example/blog/email-warmup-guide";
    await page.locator("#content-draft-published-url").fill(published);
    const [popup] = await Promise.all([
      page.context().waitForEvent("page"),
      page.locator("[data-open-on-page]").click(),
    ]);
    await popup.waitForURL("**/tools/on-page-seo-check");
    await popup.waitForLoadState();
    await expect(popup.locator("#onpage-url")).toHaveValue(published);
    await expect(popup.locator("#onpage-query")).toHaveValue(brief.keyword.primary);
    await expect(popup.locator("#onpage-country")).toHaveValue(brief.keyword.market);
    await expect(popup.locator("#onpage-language")).toHaveValue(brief.keyword.language);
    // No property travelled, so nothing is preselected anywhere on the page.
    expect(await popup.locator("select").evaluateAll((nodes) => nodes.map((node) => (node as HTMLSelectElement).value))).not.toContain(
      expect.stringMatching(/^sc-domain:|^https?:\/\//),
    );
    // Consumed once in the checker's tab; nothing private in its URL.
    expect(await popup.evaluate((k) => sessionStorage.getItem(k), TOOL_HANDOFF_KEY)).toBeNull();
    expect(popup.url()).not.toContain("acme.example");
    expect(popup.url()).not.toContain(brief.run.fingerprint);
    expect(guard.runRequests).toHaveLength(1);
  });
});
