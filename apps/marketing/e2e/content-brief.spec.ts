// @input  -- the Content Brief Builder page served by the standalone build, every API stubbed
// @output -- v3 Artifact rendering, editing, confirmed export and guarded failure-recovery evidence
// @pos    -- Brief browser acceptance against a fresh credential-free standalone build

import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { fingerprintBriefV2, parseConfirmedBriefV2, parseContentBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { CONTENT_BRIEF_V3_SCHEMA } from "@sf/public-tools/content-brief/v2-contract";
import type { ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { createBriefV3Fixture } from "./content-brief-v3-fixtures.ts";
import { validContentBriefV2 as legacyBriefFixture } from "../src/components/tools/content-brief-v2-fixture.ts";
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from "../src/lib/theme.ts";

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
    readonly session?: (route: Route) => Promise<void>;
    readonly run?: (route: Route, request: Request) => Promise<void>;
  },
): Promise<Guard> {
  const guard: Guard = { runRequests: [], unexpected: [] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const id = `${request.method()} ${new URL(request.url()).pathname}`;
    if (id === "POST /api/consent") {
      await route.fulfill({ status: 204 });
      return;
    }
    if (id === SESSION_REQUEST) {
      if (options.session) {
        await options.session(route);
        return;
      }
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

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
    document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1);
}

async function expectReadableText(locator: Locator, text: string): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(text);
  expect(await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 0);
    return lines.length > 0 && lines.every((line) => {
      if (line.left < -1 || line.right > document.documentElement.clientWidth + 1) return false;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.overflowX === "hidden" || style.overflowX === "clip") {
          const bounds = ancestor.getBoundingClientRect();
          if (line.left < bounds.left - 1 || line.right > bounds.right + 1) return false;
        }
      }
      return true;
    });
  })).toBe(true);
}

function expectOneV3Run(guard: Guard): void {
  expect(guard.runRequests).toHaveLength(1);
  expect(guard.runRequests[0]?.postDataJSON()).toMatchObject({ response_schema: CONTENT_BRIEF_V3_SCHEMA });
  expect(guard.unexpected).toEqual([]);
}

async function resealFixture(brief: ContentBriefV2): Promise<ContentBriefV2> {
  const sealed = { ...brief, run: { ...brief.run, fingerprint: await fingerprintBriefV2(brief) } };
  const parsed = await parseContentBriefV2(sealed);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`Invalid rendering fixture: ${parsed.path}`);
  return parsed.value;
}

async function downloadConfirmed(page: Page) {
  const pending = page.waitForEvent("download");
  await page.locator("[data-download-confirmed-json]").click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^content-brief-confirmed-r\d+-[a-f0-9]{12}\.json$/u);
  const stream = await download.createReadStream();
  if (stream === null) throw new Error("The confirmed JSON download has no readable body");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const wire = Buffer.concat(chunks).toString("utf8");
  const parsed = await parseConfirmedBriefV2(JSON.parse(wire) as unknown);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`The downloaded confirmed Brief failed parsing: ${parsed.path}`);
  expect(wire).toBe(JSON.stringify(parsed.value));
  return parsed.value;
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

  test("a deferred signed-out session restores usable settings after the sign-in dialog closes", async ({ page }) => {
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
    const guard = await installGuard(page, {
      signedIn: false,
      session: async (route) => {
        await sessionGate;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ signedIn: false }),
        });
      },
    });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    const settings = page.locator("details[data-brief-settings]");
    const submit = settings.locator("[data-run-brief]");
    await expect(submit).toBeDisabled();
    await settings.locator(":scope > summary").click();
    await expect(settings).toHaveJSProperty("open", false);

    releaseSession();
    const dialog = page.getByRole("dialog", { name: "Sign in to GenGrowth" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(settings).toHaveJSProperty("open", true);
    const primary = settings.locator('input[name="primary"]');
    await expect(primary).toBeVisible();
    await expect(primary).toBeEditable();
    await expect(primary).toHaveValue("brew coffee");
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("closing the mobile sign-in dialog returns focus to the menu trigger", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/tools/content-brief");

    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.click();

    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await mobileNav.getByRole("button", { name: "Sign in", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "Sign in to GenGrowth" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(menu).toBeFocused();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("does not focus the mobile menu trigger after it becomes hidden", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/tools/content-brief");

    const menu = page.locator('button[aria-label="Open menu"]');
    await menu.click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);

    const dialog = page.getByRole("dialog", { name: "Sign in to GenGrowth" });
    await expect(dialog).toBeVisible();
    await menu.evaluate((element) => {
      const button = element as HTMLButtonElement;
      const focus = button.focus.bind(button);
      button.focus = (options?: FocusOptions): void => {
        button.dataset.focusAttempts = String(Number(button.dataset.focusAttempts ?? "0") + 1);
        focus(options);
      };
    });

    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(menu).toBeHidden();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(menu).not.toHaveAttribute("data-focus-attempts", /.+/u);
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("does not focus the mobile menu trigger after it becomes disabled", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/en/tools/content-brief");

    const menu = page.locator('button[aria-label="Open menu"]');
    await menu.click();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(page.locator('[data-slot="sheet-content"]')).toHaveCount(0);

    const dialog = page.getByRole("dialog", { name: "Sign in to GenGrowth" });
    await expect(dialog).toBeVisible();
    await menu.evaluate((element) => {
      const button = element as HTMLButtonElement;
      const focus = button.focus.bind(button);
      button.focus = (options?: FocusOptions): void => {
        button.dataset.focusAttempts = String(Number(button.dataset.focusAttempts ?? "0") + 1);
        focus(options);
      };
      button.disabled = true;
    });

    await expect(menu).toBeDisabled();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(menu).not.toHaveAttribute("data-focus-attempts", /.+/u);
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("a run without Search Console renders an undecidable verdict, never 'create'", async ({ page }) => {
    const brief = await createBriefV3Fixture({ action: "undecidable" });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);

    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    const verdict = result.locator("[data-verdict-title]");
    await expect(verdict).toHaveText("Page action needs your decision");
    const verdictText = await verdict.innerText();
    expect(verdictText.toLowerCase()).not.toContain("create");
    expect(verdictText).not.toContain("新建");
    await expect(result.locator("[data-resolve-create]")).not.toBeChecked();
    await expect(result.locator("[data-confirm-brief]")).toBeDisabled();
    await expect(result.locator("[data-download-confirmed-json]")).toBeDisabled();
    await result.locator("[data-resolve-create]").check();
    await expect(result.locator("[data-confirm-brief]")).toBeEnabled();
    await result.locator("[data-confirm-brief]").click();
    await expect(result.locator("[data-download-confirmed-json]")).toBeEnabled();
    const confirmed = await downloadConfirmed(page);
    expect(confirmed.resolution).toBe("create_despite_uncertainty");
    expect(confirmed.brief.generated?.page_plan.action).toBe("undecidable");
    await result.locator("[data-resolve-create]").uncheck();
    await expect(result.locator("[data-confirmed-summary]")).toHaveCount(0);
    await expect(result.locator("[data-confirm-brief]")).toBeDisabled();
    await expect(result.locator("[data-download-confirmed-json]")).toBeDisabled();

    expectOneV3Run(guard);
    const body = guard.runRequests[0]?.postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ primary: brief.context.input.primary, market: "US", language: "en" });
    expect(body["gsc_property"]).toBeUndefined();
    expect(guard.unexpected).toEqual([]);
  });

  test("a model-unavailable v3 result keeps visible cause, observed business fields and explicit settings recovery", async ({ page }) => {
    const brief = await createBriefV3Fixture({ unavailable: true, action: "update" });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    await expect(result.locator('[data-source-summary-item="serp"]')).toContainText("10/10");
    await expect(result.locator('[data-source-summary-item="paa"]')).toContainText("2/2");
    await expect(result.locator('[data-source-summary-item="competitors"]')).toContainText("1/1");
    await expect(result.locator('[data-source-summary-item="profile"] [data-read-status]')).toHaveAttribute("data-read-status", "not_used");
    await expect(result.locator("[data-run-collected]")).toBeVisible();
    await expect(result.locator("[data-run-timing]")).toContainText("4.2s / 45s");
    await expect(result.locator("[data-generation-cause]")).toHaveText("Brief generation timed out");
    await expect(result.locator('[data-field-card="length"]')).toContainText("P25");
    await expect(result.locator('[data-field-card="length"]')).toContainText("P75");
    await expect(result.locator("[data-observed-formats]")).toContainText("SERP title + URL heuristic");
    await expect(result.locator('[data-gsc-match="G1"]')).toBeVisible();
    await expect(result.locator('[data-owned-candidate="T1"]')).toBeVisible();
    await expect(result.locator('[data-raw-paa="A1"]')).toHaveText(/Why is reporting delayed\?/u);
    await expect(result.locator("[data-question-row], [data-verdict-card], [data-outline]")).toHaveCount(0);
    await expect(result.locator("[data-no-outline]")).toBeVisible();
    await expect(result.locator("[data-confirmation-bar]")).toHaveCount(0);
    await expect(result.locator("details[data-run-details]")).toHaveJSProperty("open", false);
    await result.locator("[data-run-details] > summary").click();
    expect(JSON.parse(await result.locator("[data-run-ledger]").innerText())).toEqual(brief.run);
    expect(JSON.parse(await result.locator("[data-evidence-ledger]").innerText())).toEqual(brief.context);
    const recovery = result.locator("[data-return-to-settings]");
    await expect(result.locator("[data-recovery-boundary]")).toContainText("new full run");
    await recovery.focus();
    await recovery.press("Enter");
    const settings = page.locator("[data-brief-settings]");
    const primary = settings.locator('input[name="primary"]');
    await expect(settings).toHaveJSProperty("open", true);
    await expect(primary).toBeFocused();
    await primary.fill("my unsent newer keyword");
    await settings.locator(":scope > summary").click();
    await recovery.click();
    await expect(primary).toHaveValue("my unsent newer keyword");
    await expect(primary).toBeFocused();
    await expect(result.locator("[data-brief-header] h3")).toHaveText(brief.context.input.primary);
    expectOneV3Run(guard);
  });

  test("a historical v2 receipt still confirms without inventing SERP source rows", async ({ page }) => {
    const brief = await legacyBriefFixture();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    await expect(page.locator("[data-observed-formats]")).toContainText("URL-only heuristic");
    await page.locator("[data-confirm-brief]").click();
    await expect(page.locator("[data-download-confirmed-json]")).toBeEnabled();
    const confirmed = await downloadConfirmed(page);
    expect(confirmed.schema).toBe("gengrowth.confirmed_brief/v2");
    expect(confirmed.brief.context).not.toHaveProperty("serp");
    expectOneV3Run(guard);
  });

  test("partial source coverage does not relabel successful v3 generation as a failed model", async ({ page }) => {
    const base = await createBriefV3Fixture();
    const brief = await resealFixture({ ...base, context: { ...base.context, serp: { ...base.context.serp!, read: { status: "partial", requested: 10, returned: 10, unresolved: 1 } } },
      run: { ...base.run, reads: base.run.reads.map((read) => read.source === "serp" ? { ...read, status: "partial" } : read.source === "competitors" ? { ...read, status: "partial", attempted: 3 } : read) } });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    await expect(page.locator("[data-generation-status]")).toHaveText("Ready for review");
    await expect(page.locator("[data-read-coverage-status]")).toHaveText("Limited evidence");
    await expect(page.locator('[data-source-summary-item="competitors"]')).toContainText("1/3");
    await expect(page.locator("[data-serp-format-coverage]")).toContainText("1 unresolved");
    await expect(page.locator('[data-question-row="Q1"] [data-covered-by]')).toContainText("1/1");
    await expect(page.locator("[data-generation-failure]")).toHaveCount(0);
    await expect(page.locator("[data-confirm-brief]")).toBeEnabled();
    expectOneV3Run(guard);
  });

  test("keyboard submission focuses the fixture result and reopening settings does not submit or change its frozen keyword", async ({ page }) => {
    const brief = await createBriefV3Fixture();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    const settings = page.locator("details[data-brief-settings]");
    await expect(settings).toHaveJSProperty("open", true);
    const primary = settings.locator('input[name="primary"]');
    await primary.fill(brief.context.input.primary);
    await primary.press("Enter");
    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("role", "region");
    await expect(result).toHaveAttribute("tabindex", "-1");
    await expect(result).toHaveAccessibleName(`Content brief result for ${brief.context.input.primary}`);
    await expect(result).toBeFocused();
    const outline = await result.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Tab");
    const pageEvidence = result.locator("details[data-page-evidence]");
    await expect(pageEvidence.locator(":scope > summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pageEvidence).toHaveJSProperty("open", true);
    await page.keyboard.press("Space");
    await expect(pageEvidence).toHaveJSProperty("open", false);
    await page.keyboard.press("Tab");
    const intentDetails = result.locator('[data-field-details="intent"]');
    await expect(intentDetails.locator(":scope > summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(intentDetails.locator("[data-field-rationale]")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(intentDetails).toHaveJSProperty("open", false);
    await page.keyboard.press("Tab");
    const formatEvidence = result.locator("[data-observed-formats] details");
    await expect(formatEvidence.locator(":scope > summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(formatEvidence).toHaveJSProperty("open", true);
    await expect(formatEvidence.locator('[data-format-source="S9"]')).toContainText("javascript:fixtureOnly()");
    await expect(formatEvidence.locator('[data-format-source="S9"] a, [data-format-source="S10"] a')).toHaveCount(0);
    await page.keyboard.press("Space");
    await expect(formatEvidence).toHaveJSProperty("open", false);
    await page.keyboard.press("Tab");
    const lengthDetails = result.locator('[data-field-details="length"]');
    await expect(lengthDetails.locator(":scope > summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(lengthDetails.locator("[data-quantile-method]")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(lengthDetails).toHaveJSProperty("open", false);
    await page.keyboard.press("Tab");
    await expect(result.locator('[data-question-row="Q1"] details > summary')).toBeFocused();
    const header = page.locator("[data-brief-header]");
    await expect(header).toBeVisible();
    await expect(settings).toHaveJSProperty("open", false);
    await expect(page.locator('input[name="primary"]')).toBeHidden();
    expect(guard.runRequests).toHaveLength(1);

    const summary = settings.locator(":scope > summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(settings).toHaveJSProperty("open", true);
    await expect(page.locator('input[name="primary"]')).toHaveValue(brief.context.input.primary);
    await page.locator('input[name="primary"]').fill("a different draft keyword");
    await summary.focus();
    await summary.press("Space");
    await expect(settings).toHaveJSProperty("open", false);
    await expect(header.getByRole("heading").first()).toHaveText(brief.context.input.primary);
    expectOneV3Run(guard);
  });

  test("a failed rerun retains the previous confirmed result and its exact downloadable revision", async ({ page }) => {
    const brief = await createBriefV3Fixture();
    let runs = 0;
    const guard = await installGuard(page, { signedIn: true, run: async (route) => {
      runs += 1;
      if (runs === 1) return fulfillBrief(brief)(route);
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited" } }) });
    } });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    await expect(page.locator("[data-confirm-brief]")).toBeEnabled();
    await page.locator("[data-confirm-brief]").click();
    await expect(page.locator("[data-download-confirmed-json]")).toBeEnabled();
    const first = await downloadConfirmed(page);
    await page.locator("[data-brief-settings] > summary").click();
    await submitKeyword(page, "a new keyword");
    await expect(page.locator('[data-error-code="rate_limited"]')).toBeVisible();
    await expect(page.locator("[data-previous-brief]")).toBeVisible();
    await expect(page.locator("[data-brief-header] h3")).toHaveText(brief.context.input.primary);
    await expect(page.locator("[data-download-confirmed-json]")).toBeEnabled();
    const retained = await downloadConfirmed(page);
    expect(retained).toEqual(first);
    expect(guard.runRequests).toHaveLength(2);
    expect(guard.unexpected).toEqual([]);
  });

  test("heading edits and section order produce a stable exact confirmed revision, then editing invalidates old exports", async ({ page }) => {
    const brief = await createBriefV3Fixture();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    const originalQuestions = await result.locator("[data-must-answer-q]").allTextContents();
    await expect(result.locator("[data-download-confirmed-json]")).toBeDisabled();
    await result.locator('[data-outline-h2="O1"]').fill("Check when reporting data was collected");
    const h3Editor = result.locator('details[data-h3-editor="O1"]');
    await expect(h3Editor).toHaveJSProperty("open", false);
    await expect(h3Editor.locator(":scope > summary")).toContainText("Collection timing");
    await h3Editor.locator(":scope > summary").click();
    await result.locator('[data-outline-h3="O1"]').fill("Collection date\nLast update date");
    await result.locator('[data-move-up="O2"]').click();
    expect(await result.locator("[data-outline-section]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-outline-section")))).toEqual(["O2", "O1"]);
    await expect(result.locator('[data-outline-section="O1"] [data-outline-answers]')).toContainText("Q1");
    await expect(result.locator('[data-outline-section="O2"] [data-outline-answers]')).toContainText("Q2");
    expect(await result.locator("[data-must-answer-q]").allTextContents()).toEqual(originalQuestions);

    await result.locator("[data-confirm-brief]").click();
    await expect(result.locator("[data-confirmed-summary]")).toContainText("Revision 1 confirmed");
    await expect(result.locator("[data-confirm-brief]")).toBeDisabled();
    await expect(result.locator("[data-copy-confirmed-json]")).toBeEnabled();
    const confirmed = await downloadConfirmed(page);
    expect(confirmed.schema).toBe("gengrowth.confirmed_brief/v3");
    expect(confirmed.revision).toBe(1);
    expect(confirmed.resolution).toBe("accept_recommendation");
    expect(confirmed.brief).toEqual(brief);
    expect(confirmed.outline).toEqual([
      { id: "O2", h2: "Verify reporting dates", h3: [], answers: ["Q2"] },
      { id: "O1", h2: "Check when reporting data was collected", h3: ["Collection date", "Last update date"], answers: ["Q1"] },
    ]);
    expect(await downloadConfirmed(page)).toEqual(confirmed);
    await result.locator("[data-confirmed-summary] details > summary").click();
    await expect(result.locator("[data-confirmed-fingerprint]")).toHaveText(confirmed.fingerprint);
    expect(JSON.parse(await result.locator("[data-confirmed-json]").innerText())).toEqual(confirmed);

    await result.locator('[data-outline-h2="O1"]').fill("Compare reporting collection and update dates");
    await expect(result.locator("[data-confirmed-summary]")).toHaveCount(0);
    await expect(result.locator("[data-download-confirmed-json]")).toBeDisabled();
    await expect(result.locator("[data-copy-confirmed-json]")).toBeDisabled();
    await expect(result.locator("[data-confirm-brief]")).toBeEnabled();
    await result.locator("[data-confirm-brief]").click();
    await expect(result.locator("[data-confirmed-summary]")).toContainText("Revision 2 confirmed");
    const next = await downloadConfirmed(page);
    expect(next.revision).toBe(2);
    expect(next.fingerprint).not.toBe(confirmed.fingerprint);
    expect(next.outline.map(({ id, answers }) => ({ id, answers }))).toEqual(confirmed.outline.map(({ id, answers }) => ({ id, answers })));
    expect(next.brief).toEqual(brief);
    expectOneV3Run(guard);
  });

  test("an update recommendation exposes the actual target and source-bound rewrite instructions in the confirmed export", async ({ page }) => {
    const brief = await createBriefV3Fixture({ action: "update" });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    const result = page.locator("[data-content-brief-result]");
    await expect(result.locator("[data-verdict-title]")).toHaveText("Rewrite the existing page");
    await expect(result.locator("[data-target-page]")).toHaveAttribute("href", "https://owned.example/reporting");
    await expect(result.locator("[data-target-page]")).toHaveText("https://owned.example/reporting");
    await expect(result.locator("[data-plan-step]")).toHaveCount(1);
    await expect(result.locator("[data-plan-step]")).toContainText("Clarify collection and update dates in the existing explanation.");
    await expect(result.locator("[data-plan-step]")).toContainText("U2");
    await expect(result.locator("[data-plan-step]")).toContainText("Q1");
    await expect(result.locator("[data-resolve-create]")).toHaveCount(0);
    await result.locator("[data-confirm-brief]").click();
    await expect(result.locator("[data-download-confirmed-json]")).toBeEnabled();
    const confirmed = await downloadConfirmed(page);
    expect(confirmed.resolution).toBe("accept_recommendation");
    expect(confirmed.brief.generated?.page_plan).toEqual(brief.generated?.page_plan);
    expect(confirmed.brief.context.candidates).toEqual([{ id: "T1", url: "https://owned.example/reporting", match_refs: ["G1"], read: "observed" }]);
    expectOneV3Run(guard);
  });

  test("one PAA-only question remains writable but shows zero competitor coverage and no invented factual evidence", async ({ page }) => {
    const brief = await createBriefV3Fixture({ count: 1, paaOnly: true });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    const result = page.locator("[data-content-brief-result]");
    await expect(result.locator("[data-question-row]")).toHaveCount(1);
    await expect(result.locator("[data-covered-by]")).toContainText("0 pages");
    await expect(result.locator("[data-covered-by]")).not.toContainText("0/0");
    await expect(result.locator("[data-paa-boundary]")).toContainText("not factual support");
    await expect(result.locator("[data-outline-section]")).toHaveCount(1);
    await result.locator("[data-question-row] details > summary").click();
    await expect(result.locator("[data-question-row] details")).toContainText("PAA · A1");
    await expect(result.locator("[data-question-row] blockquote")).toHaveCount(0);
    await result.locator("[data-confirm-brief]").click();
    await expect(result.locator("[data-download-confirmed-json]")).toBeEnabled();
    const confirmed = await downloadConfirmed(page);
    expect(confirmed.brief.context.research.pages).toEqual([]);
    expect(confirmed.brief.context.facts).toEqual([]);
    expect(confirmed.brief.context.research.units.every((unit) => unit.kind === "paa")).toBe(true);
    expect(confirmed.brief.generated?.research.questions).toEqual([{ id: "Q1", anchor: "U1", q: "Why is reporting delayed?", source_refs: ["U1"], covered_by: 0, paa_refs: ["A1"] }]);
    expectOneV3Run(guard);
  });

  test("a valid empty-question result does not invent an outline or expose confirmation exports", async ({ page }) => {
    const brief = await createBriefV3Fixture({ count: 0 });
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    await expect(result.locator("[data-no-outline]")).toBeVisible();
    await expect(result.locator("[data-question-row]")).toHaveCount(0);
    await expect(result.locator("[data-outline]")).toHaveCount(0);
    await expect(result.locator("[data-confirmation-bar]")).toHaveCount(0);
    expectOneV3Run(guard);
  });

  for (const failure of ["malformed", "fingerprint"] as const) {
    test(`a ${failure} HTTP 200 is rejected without rendering a result`, async ({ page }) => {
      const base = await createBriefV3Fixture();
      const response = failure === "malformed" ? { schema: CONTENT_BRIEF_V3_SCHEMA }
        : { ...base, run: { ...base.run, fingerprint: "f".repeat(64) } };
      const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(response) });
      await page.goto("/en/tools/content-brief");
      await submitKeyword(page, base.context.input.primary);
      await expect(page.locator('[data-error-code="unknown"]')).toBeVisible();
      await expect(page.locator("details[data-brief-settings]")).toHaveJSProperty("open", true);
      await expect(page.locator("[data-run-brief]")).toBeEnabled();
      await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
      await expect(page.locator("[data-download-confirmed-json]")).toHaveCount(0);
      expectOneV3Run(guard);
    });
  }

  const visualCases = [{ width: 1280, height: 900 }, { width: 390, height: 844 }].flatMap((viewport) =>
    (["en", "zh"] as const).flatMap((locale) =>
      ["light", "dark"].map((theme) => ({ viewport, locale, theme })),
    ),
  );
  for (const { viewport, locale, theme } of visualCases) {
    test(`fixture editorial result stays readable at ${viewport.width}px in ${locale} ${theme} with keyboard-accessible details`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: THEME_STORAGE_KEY,
        value: theme,
      });
      const base = await createBriefV3Fixture({ locale });
      const llm = base.run.llm;
      if (llm.status !== "complete") {
        throw new Error("The rendering fixture must include a complete model receipt");
      }
      // Long values remain inside the real contract and are re-fingerprinted and parsed.
      const property = "sc-domain:editorial-research-observation-fixture.reporting-deliverability.example";
      const model = `fixture-editorial-brief-${"model".repeat(16)}`;
      const brief = await resealFixture({
        ...base,
        context: { ...base.context, gsc: { ...base.context.gsc, property } },
        run: { ...base.run, llm: { ...llm, model_id: model } },
      });
      const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
      await page.goto(`/${locale}/tools/content-brief`);
      const cookieBanner = page.getByRole("region", { name: "Cookie consent", exact: true });
      await cookieBanner.getByRole("button", { name: locale === "zh" ? "仅必要" : "Necessary Only", exact: true }).click();
      await expect(cookieBanner).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute(THEME_ATTRIBUTE, theme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await page.locator('select[name="language"]').selectOption(locale);
      await submitKeyword(page, brief.context.input.primary);
      const result = page.locator("[data-content-brief-result]");
      await expect(result).toBeVisible();
      await expect(result.locator("[data-run-collected]")).toBeVisible();
      await expect(result.locator("[data-run-timing]")).toContainText("4.2s / 45s");
      await expect(result.locator("[data-generation-status]")).toHaveText(locale === "zh" ? "待你审阅" : "Ready for review");
      await expect(result.locator("[data-read-coverage-status]")).toHaveText(locale === "zh" ? "已请求的来源读取完成" : "Requested reads complete");
      await expect(result.locator("[data-length-quantiles]")).toBeVisible();
      await expect(result.locator("[data-observed-formats]")).toContainText(locale === "zh" ? "SERP 标题 + URL" : "SERP title + URL");
      const fields = result.locator("[data-field-cards]");
      if (viewport.width >= 1000) {
        const height = await fields.evaluate(element => element.getBoundingClientRect().height);
        expect(height, "The default three-field row must stay compact").toBeLessThanOrEqual(380);
      }
      for (const field of ["intent", "format", "length"]) await expect(fields.locator(`[data-field-details="${field}"]`)).toHaveJSProperty("open", false);
      await expect(fields.locator("[data-format-method]")).toBeHidden();
      await expect(fields.locator("[data-format-boundary]")).toBeHidden();
      await expect(fields.locator("[data-quantile-method]")).toBeHidden();
      await expect(fields.locator("[data-serp-format-coverage]")).toBeVisible();
      await expect(fields.locator('[data-format-count="unknown"]')).toBeVisible();
      await expect(fields.locator("[data-length-sample]")).toBeVisible();
      await expect(fields.locator("[data-length-boundary]")).toBeVisible();
      await expect(result.locator('[data-question-row="Q1"] [data-covered-by]')).toContainText("1/1");
      await expect(result.locator('[data-question-row="Q1"] [data-question-coverage-bar]')).toBeVisible();
      await expect(result.locator('[data-question-row="Q1"] [data-source-layer="third"]')).toBeVisible();
      await expect(result.locator('[data-outline-question="Q1"]')).toBeVisible();
      const header = result.locator("[data-brief-header]").getByRole("heading").first();
      await expect(header).toHaveText(brief.context.input.primary);
      await expect(header).toHaveCSS("font-size", "26px");
      await expect(result.locator("[data-must-answer-q]").first()).toHaveCSS("font-size", "13px");
      const verdictSize = await result.locator("[data-verdict-title]").evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      );
      expect(verdictSize).toBeGreaterThanOrEqual(26);
      expect(verdictSize).toBeLessThanOrEqual(30);

      const sectionOrder = [
        "[data-brief-header]", "[data-source-summary]", "[data-verdict-card]", "[data-field-cards]",
        "[data-must-answer]", "[data-outline]", "[data-gap-angle]", '[data-links-card="internal_links"]',
        '[data-links-card="do_not_cover"]', "[data-confirmation-bar]", "[data-run-details]", "[data-wont-say]",
      ];
      expect(await result.locator(sectionOrder.join(",")).evaluateAll(
        (elements, selectors) => elements.map((element) => selectors.find((selector) => element.matches(selector))),
        sectionOrder,
      )).toEqual(sectionOrder);
      await expect(page.locator("details[data-brief-settings]")).toHaveJSProperty("open", false);
      await expect(page.locator('input[name="primary"]')).toBeHidden();
      await expect(result.locator("[data-source-summary-item]")).toHaveCount(6);
      await expect(result.locator('[data-source-summary-item="serp"]')).toContainText("10/10");
      await expect(result.locator('[data-source-summary-item="paa"]')).toContainText("2/2");
      await expect(result.locator('[data-source-summary-item="competitors"]')).toContainText("1/1");
      const descriptions = result.locator("[data-verdict-card] p, [data-field-cards] p, [data-outline] > p, [data-confirmation-bar] > p");
      expect(await descriptions.count()).toBeGreaterThan(0);
      expect(await descriptions.evaluateAll((elements) => elements.every((element) => Number.parseFloat(getComputedStyle(element).fontSize) <= 13.5))).toBe(true);
      await expectNoHorizontalOverflow(page);
      const detailAttributes = ["data-run-details", "data-wont-say"];
      for (const attribute of detailAttributes) {
        await expect(result.locator(`details[${attribute}]`)).toHaveJSProperty("open", false);
      }
      for (const details of await result.locator("[data-question-row] details").all()) {
        await expect(details).toHaveJSProperty("open", false);
      }
      for (const details of await result.locator("details[data-h3-editor]").all()) {
        await expect(details).toHaveJSProperty("open", false);
      }
      await expect(result.locator('[data-h3-editor="O1"] > summary')).toContainText(locale === "zh" ? "采集时间" : "Collection timing");
      await expect(result.locator("[data-run-ledger]")).toBeHidden();
      await expect(result.locator("[data-evidence-ledger]")).toBeHidden();
      await expect(result.locator("[data-wont-say] p")).toBeHidden();
      await result.screenshot({
        path: testInfo.outputPath(`content-brief-editorial-${viewport.width}-${locale}-${theme}.png`),
        animations: "disabled",
      });

      for (const attribute of detailAttributes) {
        const details = result.locator(`details[${attribute}]`);
        const summary = details.locator(":scope > summary");
        await summary.focus();
        await summary.press("Enter");
        await expect(details).toHaveJSProperty("open", true);
        await summary.press("Space");
        await expect(details).toHaveJSProperty("open", false);
        await summary.press("Enter");
        await expect(details).toHaveJSProperty("open", true);
      }
      await expect(result.locator("[data-wont-say] p")).toBeVisible();
      await expect(result.locator("[data-wont-say] p")).toHaveText(/\S/u);
      expect(JSON.parse(await result.locator("[data-run-ledger]").innerText())).toEqual(brief.run);
      expect(JSON.parse(await result.locator("[data-evidence-ledger]").innerText())).toEqual(brief.context);
      await expectReadableText(result.locator("[data-gsc-window]"), property);
      await expectReadableText(result.locator("[data-run-details] dd").filter({ hasText: model }), model);
      await expectReadableText(result.locator("[data-run-fingerprint]"), brief.run.fingerprint);
      await expectNoHorizontalOverflow(page);
      expectOneV3Run(guard);
      expect(guard.runRequests[0]?.postDataJSON()).toMatchObject({ primary: brief.context.input.primary, language: locale });
    });
  }

  for (const scenario of [
    { locale: "en", theme: "light", viewport: { width: 1280, height: 900 }, reason: "provider_error", cause: "The generation provider returned an error" },
    { locale: "zh", theme: "dark", viewport: { width: 390, height: 844 }, reason: "timeout", cause: "Brief 模型生成超时" },
  ] as const) {
    test(`${scenario.locale} ${scenario.theme} failure screenshot retains observations before raw JSON`, async ({ page }, testInfo) => {
      await page.setViewportSize(scenario.viewport);
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: THEME_STORAGE_KEY, value: scenario.theme });
      const base = await createBriefV3Fixture({ locale: scenario.locale, action: "update", unavailable: true });
      if (base.run.llm.status !== "unavailable") throw new Error("Expected synthetic unavailable generation");
      const brief = await resealFixture({ ...base, run: { ...base.run, elapsed_ms: 38400, llm: { ...base.run.llm, reason: scenario.reason } } });
      const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
      await page.goto(`/${scenario.locale}/tools/content-brief`);
      const banner = page.getByRole("region", { name: "Cookie consent", exact: true });
      await banner.getByRole("button", { name: scenario.locale === "zh" ? "仅必要" : "Necessary Only", exact: true }).click();
      await page.locator('select[name="language"]').selectOption(scenario.locale);
      await submitKeyword(page, brief.context.input.primary);
      const result = page.locator("[data-content-brief-result]");
      await expect(result.locator("[data-generation-cause]")).toHaveText(scenario.cause);
      await expect(result.locator("[data-run-timing]")).toContainText("38.4s / 45s");
      await expect(result.locator("[data-run-ledger]")).toBeHidden();
      await expect(result.locator("[data-observed-formats]")).toBeVisible();
      await expect(result.locator("[data-length-quantiles]")).toBeVisible();
      await expect(result.locator('[data-gsc-match="G1"], [data-owned-candidate="T1"]')).toHaveCount(2);
      await expect(result.locator('[data-raw-paa="A1"]')).toBeVisible();
      await expect(result.locator("[data-question-row], [data-outline], [data-verdict-card], [data-confirmation-bar]")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator("html")).toHaveAttribute(THEME_ATTRIBUTE, scenario.theme);
      await result.screenshot({ path: testInfo.outputPath(`content-brief-v3-failure-${scenario.locale}-${scenario.theme}.png`), animations: "disabled" });
      expectOneV3Run(guard);
    });
  }

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
    expectOneV3Run(guard);
  });

  test("a deferred rate-limit error reopens settings closed during the run without submitting again", async ({ page }) => {
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const guard = await installGuard(page, {
      signedIn: true,
      run: async (route) => {
        await responseGate;
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
    const settings = page.locator("details[data-brief-settings]");
    const submit = settings.locator("[data-run-brief]");
    await expect(submit).toBeDisabled();
    await expect.poll(() => guard.runRequests.length).toBe(1);
    await settings.locator(":scope > summary").click();
    await expect(settings).toHaveJSProperty("open", false);

    releaseResponse();
    await expect(settings).toHaveJSProperty("open", true);
    await expect(settings.locator('[data-error-code="rate_limited"]')).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
    expectOneV3Run(guard);
  });

  test("a deferred network failure reopens closed settings without submitting a second run", async ({ page }) => {
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
    const guard = await installGuard(page, {
      signedIn: true,
      run: async (route) => { await responseGate; await route.abort("failed"); },
    });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page);
    const settings = page.locator("details[data-brief-settings]");
    await expect(settings.locator("[data-run-brief]")).toBeDisabled();
    await expect.poll(() => guard.runRequests.length).toBe(1);
    await settings.locator(":scope > summary").click();
    await expect(settings).toHaveJSProperty("open", false);
    releaseResponse();
    await expect(settings).toHaveJSProperty("open", true);
    await expect(settings.locator('[data-error-code="unknown"]')).toBeVisible();
    await expect(settings.locator('input[name="primary"]')).toHaveValue("brew coffee");
    await expect(settings.locator('input[name="primary"]')).toBeEditable();
    await expect(settings.locator("[data-run-brief]")).toBeEnabled();
    await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
    expectOneV3Run(guard);
  });

  test("reloading the page clears the report; nothing is kept server-side", async ({ page }) => {
    const brief = await createBriefV3Fixture();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    await submitKeyword(page, brief.context.input.primary);
    await expect(page.locator("[data-content-brief-result]")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-content-brief-result]")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
    expect(page.url()).not.toContain("reporting");
    expectOneV3Run(guard);
  });

  test("the formal name is the same string on the Chinese and English hub cards", async ({ page }) => {
    const guard = await installGuard(page, { signedIn: false });
    for (const locale of ["zh", "en"]) {
      await page.goto(`/${locale}/tools`);
      const card = page.locator('a[href$="/tools/content-brief"]').first();
      await expect(card).toBeVisible();
      await expect(card).toContainText("Content Brief Builder");
      await expect(card).toHaveAccessibleName("Content Brief Builder");
    }
    await page.goto("/zh/tools/content-brief");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('input[name="primary"]')).toBeVisible();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });
});
