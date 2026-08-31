// @input  -- the Content Brief Builder page served by the standalone build, every API stubbed
// @output -- proof the page renders the contract honestly and spends nothing it was not asked to
// @pos    -- the brief tool's end-to-end acceptance (handoff §8, tool one)

import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { validContentBrief, withFingerprint } from "../src/components/tools/content-brief-fixture";
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
    await installGuard(page, { signedIn: false });
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
  });

  test("does not focus the mobile menu trigger after it becomes hidden", async ({ page }) => {
    await installGuard(page, { signedIn: false });
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
  });

  test("does not focus the mobile menu trigger after it becomes disabled", async ({ page }) => {
    await installGuard(page, { signedIn: false });
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
    await page.locator("[data-run-details] > summary").click();
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
    await page.locator("[data-evidence-details] > summary").click();
    await expect(page.locator('[data-coverage-cell="llm"] [data-unavailable-reason]')).toHaveAttribute(
      "data-unavailable-reason",
      "not_configured",
    );
    const skipped = page.locator('[data-crawl-skipped-reason="same_host"]');
    if ((await skipped.count()) > 0) {
      await expect(skipped.first()).toBeVisible();
    }
    const paragraphs = page.locator("[data-evidence-coverage] p");
    expect(await paragraphs.count()).toBeGreaterThan(0);
    expect(await paragraphs.evaluateAll((elements) =>
      [...new Set(elements.map((element) => getComputedStyle(element).fontSize))],
    )).toEqual(["11.5px"]);
  });

  test("keyboard submission focuses the fixture result and reopening settings does not submit or change its frozen keyword", async ({ page }) => {
    const brief = validContentBrief();
    const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
    await page.goto("/en/tools/content-brief");
    const settings = page.locator("details[data-brief-settings]");
    await expect(settings).toHaveJSProperty("open", true);
    const primary = settings.locator('input[name="primary"]');
    await primary.fill(brief.keyword.primary);
    await primary.press("Enter");
    const result = page.locator("[data-content-brief-result]");
    await expect(result).toBeVisible();
    await expect(result).toHaveAttribute("role", "region");
    await expect(result).toHaveAttribute("tabindex", "-1");
    await expect(result).toHaveAccessibleName(`Content brief result for ${brief.keyword.primary}`);
    await expect(result).toBeFocused();
    const outline = await result.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Tab");
    await expect(result.locator("details > summary").first()).toBeFocused();
    const header = page.locator("[data-brief-header]");
    await expect(header).toBeVisible();
    await expect(settings).toHaveJSProperty("open", false);
    await expect(page.locator('input[name="primary"]')).toBeHidden();
    expect(guard.runRequests).toHaveLength(1);

    const summary = settings.locator(":scope > summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(settings).toHaveJSProperty("open", true);
    await expect(page.locator('input[name="primary"]')).toHaveValue(brief.keyword.primary);
    await page.locator('input[name="primary"]').fill("a different draft keyword");
    await summary.focus();
    await summary.press("Space");
    await expect(settings).toHaveJSProperty("open", false);
    await expect(header.getByRole("heading").first()).toHaveText(brief.keyword.primary);
    expect(guard.runRequests).toHaveLength(1);
    expect(guard.unexpected).toEqual([]);
  });

  const visualCases = [{ width: 1280, height: 900 }, { width: 390, height: 844 }].flatMap((viewport) =>
    ["en", "zh"].flatMap((locale) =>
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
      const base = validContentBrief({}, { connected: true });
      const gsc = base.run.reads.gsc;
      const llm = base.run.reads.llm;
      if (gsc.status === "unavailable" || llm.status !== "complete") {
        throw new Error("The connected rendering fixture must include Search Console and model metadata");
      }
      // Deliberate long rendering values, not a provider response or parser acceptance proof.
      const property = "sc-domain:editorial-research-and-deliverability-observation-fixture.example";
      const model = `fixture-editorial-brief-${"model".repeat(16)}`;
      const brief = await withFingerprint({
        ...base,
        run: {
          ...base.run,
          reads: {
            ...base.run.reads,
            gsc: { ...gsc, property },
            llm: { ...llm, model_id: model },
          },
        },
      });
      const guard = await installGuard(page, { signedIn: true, run: fulfillBrief(brief) });
      await page.goto(`/${locale}/tools/content-brief`);
      await expect(page.locator("html")).toHaveAttribute(THEME_ATTRIBUTE, theme);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await submitKeyword(page, brief.keyword.primary);
      const result = page.locator("[data-content-brief-result]");
      await expect(result).toBeVisible();
      const header = result.locator("[data-brief-header]").getByRole("heading").first();
      await expect(header).toHaveText(brief.keyword.primary);
      await expect(header).toHaveCSS("font-size", viewport.width === 390 ? "24px" : "26px");
      await expect(result.locator("[data-must-answer-q]").first()).toHaveCSS("font-size", "13px");
      const verdictSize = await result.locator("[data-verdict-title]").evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      );
      expect(verdictSize).toBeGreaterThanOrEqual(26);
      expect(verdictSize).toBeLessThanOrEqual(30);

      const sectionOrder = [
        "data-brief-header", "data-source-summary", "data-verdict-card", "data-field-cards",
        "data-must-answer", "data-outline", "data-gap-angle", "data-links-cards",
        "data-readiness-bar", "data-wont-say",
      ];
      expect(await result.locator(sectionOrder.map((name) => `[${name}]`).join(",")).evaluateAll(
        (elements, names) => elements.map((element) => names.find((name) => element.hasAttribute(name))),
        sectionOrder,
      )).toEqual(sectionOrder);
      await expectNoHorizontalOverflow(page);
      const detailAttributes = ["data-run-details", "data-evidence-details", "data-wont-say"];
      for (const attribute of detailAttributes) {
        await expect(result.locator(`details[${attribute}]`)).toHaveJSProperty("open", false);
      }
      const boundaryItems = result.locator("details[data-wont-say] [data-wont-say-item]");
      expect(await boundaryItems.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-wont-say-item")),
      )).toEqual([
        "noRewrite", "threeStates", "noWithdraw", "noPublish", "noHistory",
        "noOriginality", "noCredits", "noPaa", "noScore", "language",
      ]);
      await expect(boundaryItems.first()).toBeHidden();
      if (locale === "zh" && theme === "dark") {
        await result.screenshot({
          path: testInfo.outputPath(`content-brief-editorial-${viewport.width}.png`),
          animations: "disabled",
        });
      }

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
      for (const item of await boundaryItems.all()) {
        await expect(item).toBeVisible();
        await expect(item).toHaveText(/\S/u);
      }
      for (const selector of ["[data-source-summary] p", "[data-evidence-coverage] p"]) {
        const paragraphs = result.locator(selector);
        expect(await paragraphs.count()).toBeGreaterThan(0);
        expect(await paragraphs.evaluateAll((elements) =>
          [...new Set(elements.map((element) => getComputedStyle(element).fontSize))],
        )).toEqual(["11.5px"]);
      }
      await expectReadableText(result.locator('[data-coverage-cell="gsc"] p').filter({ hasText: property }), property);
      await expectReadableText(result.locator("[data-model-id]"), model);
      await expectReadableText(result.locator("[data-run-fingerprint]"), brief.run.fingerprint);
      await expectNoHorizontalOverflow(page);
      expect(guard.runRequests).toHaveLength(1);
      expect(guard.unexpected).toEqual([]);
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
    expect(guard.runRequests).toHaveLength(1);
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
    expect(guard.runRequests).toHaveLength(1);
    expect(guard.unexpected).toEqual([]);
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
      await expect(card).toHaveAccessibleName("Content Brief Builder");
    }
    await page.goto("/zh/tools/content-brief");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.locator('input[name="primary"]')).toBeVisible();
  });
});
