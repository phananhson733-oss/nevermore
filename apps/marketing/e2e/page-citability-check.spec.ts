// LOCAL, OFFLINE UI evidence only. Standard cases use deterministic HTML;
// the opt-in replay uses a previously captured real report. No live provider or target is read.
// Run with the existing credential-free Playwright server and an env -i runner.
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createTranslator } from "next-intl";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import type { CitabilityInput, CitabilityReport } from "../src/lib/geo-tools/citability-contract.ts";
import { parseCitabilityAiReview, type CitabilityAiReview } from "../src/lib/geo-tools/citability-ai-contract.ts";
import { measureCitabilityRender } from "../src/lib/geo-tools/citability-render.ts";
import { buildCitabilityReport } from "../src/lib/geo-tools/citability-rules.ts";

type Locale = "en" | "zh";
type Theme = "dark" | "light";
type Variant = "measured" | "unknown" | "partial" | "zero" | "complete";
type ToolReply = { readonly data: CitabilityReport } | { readonly error: { readonly code: "fetch_failed" } };
type AiReply = { readonly review: CitabilityAiReview } | { readonly error: { readonly code: string }; readonly outcomeUnknown?: boolean; readonly costUsd?: number | null; readonly providerTaskId?: string | null };
const ENDPOINT = "/api/tools/page-citability-check";
const AI_ENDPOINT = `${ENDPOINT}/ai-review`;
const PAGE_URL = "https://citability.fixture.test/agency-guide";
const QUESTION = "Which issue tracker is best for agencies?";
const NOW = "2026-08-31T10:00:00.000Z";
const SHELL_APIS = new Set([
  "GET /api/auth/session", "GET /api/auth/profile", "GET /api/auth/one-tap/nonce",
  "GET /api/credits/balance", "GET /api/credits/ledger", "POST /api/consent",
]);
const SHELL_EXTERNAL_HOSTS = new Set([
  "accounts.google.com", "www.googletagmanager.com", "www.google-analytics.com",
]);
const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};
const messages = (locale: Locale) => locale === "en" ? en : zh;
const translate = (locale: Locale) => {
  const t = createTranslator({ locale, messages: messages(locale).tools.pageCitability });
  return (key: string, values?: Readonly<Record<string, string | number>>) =>
    t(key as Parameters<typeof t>[0], values);
};

function fixture(variant: Variant, url = PAGE_URL, question: string | null = QUESTION): CitabilityReport {
  const head = `<head><link rel="canonical" href="${url}"></head>`;
  const renderedBody = `<main><h1>Issue tracker comparison for agencies</h1>
    <p>Linear is the best issue tracker for agencies with 5–20 people, according to the
    <a href="https://evidence.fixture.test/method">offline fixture method</a>.</p>
    <p>${"This is deterministic local fixture content, not a fetched public page. ".repeat(18)}</p>
    <table><tr><th>Tool</th><th>Strength</th></tr><tr><td>Linear</td><td>Speed</td></tr></table>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which issue tracker is best for agencies?","acceptedAnswer":{"@type":"Answer","text":"Linear is suitable for small agencies."}}]}</script></main>`;
  const rawHtml = `<!doctype html><html>${head}<body>${variant === "complete" ? renderedBody : variant === "zero" ? "" : "<main>Local fixture loading shell</main>"}</body></html>`;
  const bodyComplete = variant !== "partial";
  const render = measureCitabilityRender(
    { url, rawHtml, bodyComplete },
    variant === "unknown" ? null : `<html>${head}<body>${renderedBody}</body></html>`,
    { now: () => new Date(NOW), ...(variant === "unknown" ? { reason: "not_configured" as const } : {}) },
  );
  const input: CitabilityInput = {
    url, finalUrl: url, rawHtml, bodyComplete, render, targetQuestion: question,
    robots: variant === "unknown" ? { status: "unreachable", httpStatus: 503 } : {
      status: "ok", text: "User-agent: *\nAllow: /\n\nUser-agent: Google-Extended\nDisallow: /\n",
    },
    llmsTxt: { status: "absent", httpStatus: 404 },
  };
  return buildCitabilityReport(input, NOW);
}

function aiFixture(report: CitabilityReport): CitabilityAiReview {
  const text = report.render.raw.text.slice(0, 360);
  return {
    schemaVersion: "citability-ai-review.v1", inputFingerprint: "b".repeat(64),
    rawSha256: report.render.rawSha256, finalUrl: report.finalUrl,
    targetQuestion: report.targetQuestion, capturedAt: NOW, observedAt: NOW,
    totalBodyChars: report.render.raw.text.length, includedBodyChars: text.length,
    coverage: text.length === report.render.raw.text.length ? "full" : "excerpt",
    excerpts: [{ id: "E1", text }], provider: "dataforseo", requestedModel: "gpt-4.1-mini",
    actualModel: "gpt-4.1-mini-2025-04-14", providerTaskId: "offline-browser-fixture",
    costUsd: null, inputTokens: null, outputTokens: null,
    factVerification: "not_performed", scope: "provided_excerpts", webSearch: false,
    assessmentKind: "model_assessment", summary: "Offline model fixture: supplied copy needs review; factual accuracy was not verified.",
    dimensions: [
      { id: "answer_relevance", verdict: "insufficient_evidence", reason: "The supplied excerpt does not establish relevance to the full question.", suggestion: null, evidenceIds: ["E1"] },
      { id: "answer_clarity", verdict: "needs_work", reason: "The excerpt describes a loading shell, not an answer.", suggestion: "Provide a readable answer in the original page response.", evidenceIds: ["E1"] },
      { id: "attribution_clarity", verdict: "insufficient_evidence", reason: "No source wording is available in the excerpt.", suggestion: null, evidenceIds: [] },
    ],
  };
}

interface Guard {
  readonly requests: { method: string; body: unknown }[];
  readonly aiRequests: { method: string; body: unknown }[];
  readonly blockedShell: string[];
  readonly blockedExternal: string[];
  readonly unexpected: string[];
  readonly pageErrors: string[];
}

async function installGuard(context: BrowserContext, page: Page, baseURL: string, replies: readonly ToolReply[], aiReplies: readonly AiReply[] = []): Promise<Guard> {
  const origin = new URL(baseURL).origin;
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  const guard: Guard = { requests: [], aiRequests: [], blockedShell: [], blockedExternal: [], unexpected: [], pageErrors: [] };
  page.on("pageerror", error => guard.pageErrors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      guard.blockedExternal.push(request.url());
      if (!SHELL_EXTERNAL_HOSTS.has(url.hostname)) guard.unexpected.push(`external ${request.url()}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const id = `${request.method()} ${url.pathname}`;
    if (url.pathname === AI_ENDPOINT && request.method() === "POST") {
      guard.aiRequests.push({ method: request.method(), body: request.postDataJSON() });
      const reply = aiReplies[guard.aiRequests.length - 1];
      if (!reply) {
        guard.unexpected.push(`Unexpected AI request ${guard.aiRequests.length}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({ status: "error" in reply ? 502 : 200, contentType: "application/json", body: JSON.stringify(reply) });
      return;
    }
    if (url.pathname !== ENDPOINT || request.method() !== "POST") {
      if (SHELL_APIS.has(id)) guard.blockedShell.push(id);
      else guard.unexpected.push(id);
      await route.abort("blockedbyclient");
      return;
    }
    guard.requests.push({ method: request.method(), body: request.postDataJSON() });
    const reply = replies[guard.requests.length - 1];
    if (!reply) {
      guard.unexpected.push(`Unexpected tool request ${guard.requests.length}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.fulfill({ status: "error" in reply ? 502 : 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
  return guard;
}

let buildId = "";
test.use({ actionTimeout: 15_000, serviceWorkers: "block" });
test.beforeAll(async () => {
  // Print names, never values, if a runner accidentally inherited credentials.
  const configured = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY",
    "GEO_BRIEF_API_KEY", "CONTENT_DRAFT_API_KEY", "KEYWORD_LLM_API_KEY", "CITABILITY_RENDERER_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY"].filter(name => process.env[name] !== undefined);
  expect(configured).toEqual([]);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId);
});

async function openInput(page: Page, locale: Locale, theme: Theme): Promise<void> {
  await page.goto(`/${locale}/tools/page-citability-check`);
  await expect(page.getByRole("heading", { name: messages(locale).tools.pageCitability.title, exact: true })).toBeVisible();
  const consentBanner = page.getByRole("region", { name: "Cookie consent", exact: true });
  await expect(consentBanner).toBeVisible();
  await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname === "/api/consent" && request.method() === "POST"),
    consentBanner.getByRole("button", { name: messages(locale).cookie.necessaryOnly, exact: true }).click(),
  ]);
  await expect(consentBanner).toHaveCount(0);
  // Exercise the real shell control in every matrix cell. No theme attribute,
  // style, localStorage, or production code is injected by this fixture.
  await page.getByRole("button", { name: messages(locale).common.switchToLight, exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  if (theme === "dark") {
    await page.getByRole("button", { name: messages(locale).common.switchToDark, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
  await expect(page.getByTestId("citability-view-input")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("citability-view-result")).toBeDisabled();
  await expect(page.locator('section[aria-labelledby="citability-form"]')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="citability-result"]')).toHaveCount(0);
}

async function fillInput(page: Page, url = PAGE_URL, question = QUESTION): Promise<void> {
  await page.locator("#citability-url").fill(url);
  await page.locator("#citability-question").fill(question);
}

async function run(page: Page, locale: Locale, again = false): Promise<void> {
  await page.getByRole("button", { name: messages(locale).tools.pageCitability.actions[again ? "again" : "run"], exact: true }).click();
}

async function assertReport(page: Page, locale: Locale, report: CitabilityReport): Promise<void> {
  const t = translate(locale);
  await expect(page.getByTestId("citability-view-result")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("citability-view-input")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('section[aria-labelledby="citability-form"]')).toHaveCount(0);
  const result = page.locator('section[aria-labelledby="citability-result"]');
  await expect(result).toBeVisible();
  const conclusion = page.getByTestId("citability-conclusion");
  await expect(conclusion).toHaveAttribute("data-verdict", report.conclusion.verdict);
  await expect(conclusion).toHaveAttribute("data-coverage", report.conclusion.coverage);
  await expect(conclusion.locator("h3")).toHaveCSS("font-size", "16px");
  for (const id of report.conclusion.priorityCheckIds) {
    await expect(conclusion.locator(`a[href="#citability-rule-${id}"]`)).toBeVisible();
  }
  await expect(page.getByTestId("citability-ai-review")).toBeVisible();
  // A font size on a parent does not override the global p element recipe.
  // Check the computed result, not merely the presence of a container class.
  const summaryLines = [
    t("summary.counted", { passed: report.summary.passed, counted: report.summary.counted }),
    t("summary.rows", { total: report.summary.total, weighted: report.summary.counted + report.summary.fetchError + report.summary.notApplicable, notApplicable: report.summary.notApplicable, fetchError: report.summary.fetchError, denominator: report.summary.counted }),
    t("summary.advisoryNote"),
  ];
  for (const line of summaryLines) {
    await expect(result.getByText(line, { exact: true })).toHaveCSS("font-size", "12px");
  }
  for (const [id, value] of [["passed", report.summary.passed], ["failed", report.summary.failed], ["fetch-error", report.summary.fetchError]] as const) {
    await expect(page.getByTestId(`citability-metric-${id}`).locator("dd")).toHaveText(String(value));
  }
  const ratio = page.getByTestId("citability-metric-ratio").locator("dd");
  await expect(ratio).toHaveText(report.render.rawToRenderedRatio === null ? /^(Unknown|未知)$/ : report.render.rawToRenderedRatio.toFixed(2));
  await expect(result.locator('[id^="citability-rule-"]')).toHaveCount(14);
  for (const section of ["readable", "extractable"] as const) {
    const stage = page.getByTestId(`citability-stage-${section}`);
    await expect(stage).toBeVisible();
    await expect(stage.locator('[id^="citability-rule-"]')).toHaveCount(report.checks.filter(check => check.section === section).length);
  }
  for (const check of report.checks) {
    const row = result.locator(`[id="citability-rule-${check.ruleId}"]`);
    await expect(row).toContainText(t(`rules.${check.ruleId}`));
    await expect(row.getByText(t(`states.${check.state}`), { exact: true })).toBeVisible();
    const measuredValues = check.measured.key === "ssr.renderUnavailable"
      ? { ...check.measured.values, reason: t(`render.reasons.${String(check.measured.values?.["reason"])}`) }
      : check.measured.values;
    await expect(row).toContainText(t(`details.${check.measured.key}`, measuredValues));
    if (check.fix) await expect(row).toContainText(t(`fixes.${check.fix.key}`, check.fix.values));
    if (check.kind === "heuristic") await expect(row).toContainText(t("kinds.heuristic"));
    if (check.weight === "advisory") await expect(row).toContainText(t("weights.advisory"));
  }
  const causes = page.getByTestId("citability-root-causes");
  await expect(causes).toBeVisible();
  for (const paragraph of await causes.locator(":scope > ul > li > div > p").all()) {
    await expect(paragraph).toHaveCSS("font-size", "12.5px");
  }
  await expect(result.locator('[id^="citability-rule-"] > div > p').first()).toHaveCSS("font-size", "13px");
  for (const cause of report.rootCauses) {
    await expect(causes).toContainText(t(`causes.groups.${cause.id}`));
    await expect(causes).toContainText(t(`causes.basis.${cause.basis}`));
    for (const id of cause.checkIds) await expect(causes.locator(`a[href="#citability-rule-${id}"]`)).toBeVisible();
  }
  const evidence = page.getByTestId("citability-evidence");
  await expect(evidence).toHaveJSProperty("tagName", "DETAILS");
  await expect(evidence).toHaveJSProperty("open", false);
  await expect(page.getByTestId("citability-render-status")).not.toBeVisible();
  expect(await evidence.evaluate(element => {
    const stage = document.querySelector('[data-testid="citability-stage-extractable"]');
    return stage !== null && Boolean(stage.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width + 1);
}

async function screenshot(page: Page, name: string): Promise<void> {
  await expect(page.getByRole("region", { name: "Cookie consent", exact: true })).toHaveCount(0);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
  if (name === "result") {
    const result = page.locator('section[aria-labelledby="citability-result"]');
    // A tall locator screenshot can put the sticky site header over the first
    // metrics. Scroll normally and capture the visible result below the header.
    await result.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 100));
    const box = await result.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("Result screenshot requires a visible region and viewport");
    const sectionPath = test.info().outputPath("result-top.png");
    await page.screenshot({ path: sectionPath, clip: { ...box, height: Math.min(box.height, viewport.height - box.y) }, animations: "disabled" });
    await test.info().attach("result-top", { path: sectionPath, contentType: "image/png" });
  }
}

async function isolationEvidence(guard: Guard, report: CitabilityReport): Promise<void> {
  expect(guard.unexpected).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.blockedShell.filter(id => id === "POST /api/consent")).toHaveLength(1);
  const path = test.info().outputPath("offline-citability-evidence.json");
  await writeFile(path, JSON.stringify({
    scope: "local production-build UI with deterministic rule/render fixtures; not live fetch, provider, login, or production evidence",
    buildId, test: test.info().title, fixtureSource: "buildCitabilityReport + measureCitabilityRender", report, ...guard,
  }, null, 2), "utf8");
  await test.info().attach("offline-citability-evidence", { path, contentType: "application/json" });
}

for (const locale of ["en", "zh"] as const) {
  for (const theme of ["dark", "light"] as const) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      test(`${locale} ${theme} ${viewportName}: Artifact input/result structure with real rule-built facts`, async ({ page, context, baseURL }) => {
        const report = fixture("measured");
        const guard = await installGuard(context, page, baseURL!, [{ data: report }]);
        await page.setViewportSize(viewport);
        await openInput(page, locale, theme);
        await fillInput(page);
        expect(guard.requests).toHaveLength(0);
        await assertNoHorizontalOverflow(page);
        await screenshot(page, "input");
        if (locale === "en" && theme === "dark" && viewportName === "desktop") {
          await page.locator("#citability-question").press("Enter");
        } else {
          await run(page, locale);
        }
        await assertReport(page, locale, report);
        expect(guard.aiRequests).toEqual([]);
        expect(guard.requests).toEqual([{ method: "POST", body: { url: PAGE_URL, question: QUESTION } }]);
        await assertNoHorizontalOverflow(page);
        await screenshot(page, "result");

        await page.getByTestId("citability-view-input").click();
        await expect(page.locator("#citability-url")).toHaveValue(PAGE_URL);
        await expect(page.locator("#citability-question")).toHaveValue(QUESTION);
        await expect(page.locator('section[aria-labelledby="citability-result"]')).toHaveCount(0);
        await page.getByTestId("citability-view-result").click();
        await assertReport(page, locale, report);
        const evidence = page.getByTestId("citability-evidence");
        await evidence.locator(":scope > summary").click();
        await expect(page.getByTestId("citability-render-status")).toHaveAttribute("data-status", "measured");
        await expect(evidence).toContainText(translate(locale)("limitsTitle"));
        if (locale === "zh" && theme === "dark" && viewportName === "desktop") {
          const ruleId = report.rootCauses[0]!.checkIds[0]!;
          await page.getByTestId("citability-root-causes").locator(`a[href="#citability-rule-${ruleId}"]`).click();
          expect(new URL(page.url()).hash).toBe(`#citability-rule-${ruleId}`);
          await expect(page.locator(`[id="citability-rule-${ruleId}"]`)).toBeInViewport();
          await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
          await page.getByRole("button", { name: messages(locale).tools.pageCitability.actions.copy, exact: true }).click();
          await expect(page.getByRole("button", { name: messages(locale).tools.pageCitability.actions.copied, exact: true })).toBeVisible();
          const copied = await page.evaluate(() => navigator.clipboard.readText());
          expect(copied).toContain(report.finalUrl);
          expect(copied).toContain(report.targetQuestion!);
          expect(copied).toContain(translate(locale)("causes.title"));
          expect(copied).toContain(translate(locale)("conclusion.title"));
        }
        await assertNoHorizontalOverflow(page);
        expect(guard.requests).toHaveLength(1);
        expect(guard.aiRequests).toEqual([]);
        await isolationEvidence(guard, report);
      });
    }
  }
}

for (const variant of ["unknown", "partial", "zero"] as const) {
  test(`${variant}: preserves unavailable, incomplete, and genuine zero distinctions`, async ({ page, context, baseURL }) => {
    const report = fixture(variant, PAGE_URL, null);
    const guard = await installGuard(context, page, baseURL!, [{ data: report }]);
    await page.setViewportSize(VIEWPORTS.mobile);
    await openInput(page, "zh", "light");
    await fillInput(page, PAGE_URL, "");
    await run(page, "zh");
    await assertReport(page, "zh", report);
    expect(guard.requests).toEqual([{ method: "POST", body: { url: PAGE_URL } }]);
    const evidence = page.getByTestId("citability-evidence");
    await evidence.locator(":scope > summary").click();
    await expect(page.getByTestId("citability-render-status")).toHaveAttribute("data-status", report.render.status);
    if (variant === "zero") {
      expect(report.render.rawToRenderedRatio).toBe(0);
      await expect(page.getByTestId("citability-metric-ratio").locator("dd")).toHaveText("0.00");
      await expect(page.getByTestId("citability-render-ratio")).toContainText("0%");
    } else {
      expect(report.render.rawToRenderedRatio).toBeNull();
      expect(report.summary.fetchError).toBeGreaterThan(0);
      await expect(page.getByTestId("citability-render-ratio")).toHaveCount(0);
      await expect(evidence).toContainText(translate("zh")("render.ratioUnknown"));
    }
    await assertNoHorizontalOverflow(page);
    await screenshot(page, variant);
    await isolationEvidence(guard, report);
  });
}

test("failed rerun invalidates the previous result and an explicit retry replaces its identity", async ({ page, context, baseURL }) => {
  const report = fixture("measured");
  const nextUrl = "https://citability.fixture.test/revised-guide";
  const nextQuestion = "Which issue tracker is best for small agencies?";
  const nextReport = fixture("complete", nextUrl, nextQuestion);
  const guard = await installGuard(context, page, baseURL!, [{ data: report }, { error: { code: "fetch_failed" } }, { data: nextReport }]);
  await openInput(page, "en", "dark");
  await fillInput(page);
  await run(page, "en");
  await assertReport(page, "en", report);
  await page.getByTestId("citability-view-input").click();
  await fillInput(page, nextUrl, nextQuestion);
  await page.getByTestId("citability-view-result").click();
  await assertReport(page, "en", report);
  expect(guard.requests).toHaveLength(1);
  await page.getByTestId("citability-view-input").click();
  await run(page, "en", true);
  await expect(page.locator('section[aria-labelledby="citability-form"]').getByRole("alert")).toContainText(messages("en").tools.pageCitability.errors.fetch_failed);
  await expect(page.getByTestId("citability-view-result")).toBeDisabled();
  await expect(page.locator('section[aria-labelledby="citability-result"]')).toHaveCount(0);
  await expect(page.locator("#citability-url")).toHaveValue(nextUrl);
  await expect(page.locator("#citability-question")).toHaveValue(nextQuestion);
  await screenshot(page, "failed-rerun");
  expect(guard.requests).toHaveLength(2);
  await run(page, "en");
  await assertReport(page, "en", nextReport);
  expect(nextReport.summary.passed).toBeGreaterThan(report.summary.passed);
  expect(guard.requests).toEqual([
    { method: "POST", body: { url: PAGE_URL, question: QUESTION } },
    { method: "POST", body: { url: nextUrl, question: nextQuestion } },
    { method: "POST", body: { url: nextUrl, question: nextQuestion } },
  ]);
  await isolationEvidence(guard, nextReport);
});

test("AI review is explicit, snapshot-bound and separate from measured conclusions", async ({ page, context, baseURL }) => {
  const report = fixture("measured");
  const review = aiFixture(report);
  const guard = await installGuard(context, page, baseURL!, [{ data: report }], [{ review }]);
  await openInput(page, "en", "light");
  await fillInput(page);
  await run(page, "en");
  await assertReport(page, "en", report);
  expect(guard.aiRequests).toEqual([]);
  await page.getByTestId("citability-ai-run").click();
  await expect(page.getByTestId("citability-ai-result")).toContainText(review.summary);
  expect(guard.aiRequests).toEqual([{ method: "POST", body: { url: report.finalUrl, question: QUESTION, rawSha256: report.render.rawSha256 } }]);
  await expect(page.getByTestId("citability-ai-result")).toContainText(review.actualModel);
  await page.getByTestId("citability-ai-result").locator('a[href="#citability-ai-evidence-E1"]').first().click();
  await expect(page.locator("#citability-ai-evidence-E1")).toBeInViewport();
  await expect(page.getByTestId("citability-conclusion")).toHaveAttribute("data-verdict", report.conclusion.verdict);
  await expect(page.getByTestId("citability-metric-failed").locator("dd")).toHaveText(String(report.summary.failed));
  await page.getByTestId("citability-view-input").click();
  await page.getByTestId("citability-view-result").click();
  await expect(page.getByTestId("citability-ai-result")).toContainText(review.summary);
  expect(guard.requests).toHaveLength(1);
  expect(guard.aiRequests).toHaveLength(1);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  await page.getByRole("button", { name: messages("en").tools.pageCitability.actions.copy, exact: true }).click();
  await expect(page.getByRole("button", { name: messages("en").tools.pageCitability.actions.copied, exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(review.summary);
  expect(copied).toContain(review.providerTaskId);
  expect(copied).toContain(translate("en")("conclusion.title"));
  await assertNoHorizontalOverflow(page);
  await screenshot(page, "ai-review");
  await isolationEvidence(guard, report);
});

for (const code of ["provider_timeout", "FUNCTION_INVOCATION_TIMEOUT"] as const) {
test(`${code}: an unknown AI outcome does not auto-retry or alter the measured report`, async ({ page, context, baseURL }) => {
  const report = fixture("unknown");
  const guard = await installGuard(context, page, baseURL!, [{ data: report }], [{ error: { code }, ...(code === "provider_timeout" ? { outcomeUnknown: true } : {}), costUsd: null, providerTaskId: null }]);
  await page.setViewportSize(VIEWPORTS.mobile);
  await openInput(page, "zh", "dark");
  await fillInput(page);
  await run(page, "zh");
  await page.getByTestId("citability-ai-run").click();
  await expect(page.getByTestId("citability-ai-error")).toBeVisible();
  await expect(page.getByTestId("citability-ai-run")).toBeDisabled();
  await expect(page.getByTestId("citability-ai-result")).toHaveCount(0);
  await expect(page.getByTestId("citability-conclusion")).toHaveAttribute("data-coverage", "partial");
  await page.getByTestId("citability-view-input").click();
  await page.getByTestId("citability-view-result").click();
  expect(guard.aiRequests).toHaveLength(1);
  await expect(page.getByTestId("citability-ai-error")).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await screenshot(page, "ai-unknown-outcome");
  await isolationEvidence(guard, report);
});
}

test("the actual credential-free AI route fails closed before fetching or spending", async ({ request, baseURL }) => {
  // This request is intentionally NOT fulfilled by installGuard. The real
  // standalone route runs with the config's env-i server and no auth/provider
  // configuration, so it must refuse at verified authentication.
  const response = await request.post(AI_ENDPOINT, {
    headers: { Origin: baseURL! },
    data: { url: "https://gengrowth.ai/", rawSha256: "f".repeat(64) },
  });
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: { code: "auth_unavailable" } });
});

test("manual real-capture replay preserves measured evidence in the final browser UI", async ({ page, context, baseURL }) => {
  const capturePath = process.env.CITABILITY_CAPTURE_REPORT;
  test.skip(!capturePath, "Requires an explicitly selected previously captured real report; never fetches a target automatically.");
  const capture = JSON.parse(await readFile(capturePath!, "utf8")) as { httpStatus: number; report: { data: CitabilityReport } };
  expect(capture.httpStatus).toBe(200);
  const report = capture.report.data;
  expect(report.render.status).toBe("measured");
  expect(report.render.raw.complete).toBe(true);
  expect(report.render.rendered?.complete).toBe(true);
  const guard = await installGuard(context, page, baseURL!, [capture.report]);
  await openInput(page, "zh", "light");
  await fillInput(page, report.url, report.targetQuestion ?? "");
  await run(page, "zh");
  await assertReport(page, "zh", report);
  await screenshot(page, "result");
  const evidence = page.getByTestId("citability-evidence");
  await evidence.locator(":scope > summary").click();
  await expect(page.getByTestId("citability-render-status")).toHaveAttribute("data-status", "measured");
  await expect(page.getByTestId("citability-render-raw")).toHaveText(report.render.raw.text);
  await expect(page.getByTestId("citability-render-rendered")).toHaveText(report.render.rendered!.text);
  await assertNoHorizontalOverflow(page);
  expect(guard.aiRequests).toEqual([]);
  expect(guard.unexpected).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  const path = test.info().outputPath("real-capture-result.png");
  await page.locator('section[aria-labelledby="citability-result"]').screenshot({ path });
  await test.info().attach("real-capture-result", { path, contentType: "image/png" });
});

test("manual real AI receipt replay retains scope, cost and independent measured findings", async ({ page, context, baseURL }) => {
  const reportPath = process.env.CITABILITY_AI_CAPTURE_REPORT;
  const reviewPath = process.env.CITABILITY_AI_CAPTURE_REVIEW;
  test.skip(!reportPath || !reviewPath, "Requires an explicitly selected real capture and paid-provider receipt; never starts a live provider call.");
  const capture = JSON.parse(await readFile(reportPath!, "utf8")) as { httpStatus: number; aiSnapshotMatches: boolean; report: { data: CitabilityReport } };
  const paid = JSON.parse(await readFile(reviewPath!, "utf8"));
  const review = parseCitabilityAiReview(paid.review);
  expect(capture.httpStatus).toBe(200);
  expect(capture.aiSnapshotMatches).toBe(true);
  expect(paid.outcome).toBe("passed");
  if (!review) throw new Error("Recorded real review does not meet the current strict contract");
  const report = capture.report.data;
  expect([review.finalUrl, review.targetQuestion, review.rawSha256]).toEqual([report.finalUrl, report.targetQuestion, report.render.rawSha256]);
  const guard = await installGuard(context, page, baseURL!, [capture.report], [{ review }]);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await openInput(page, "zh", "light");
  await fillInput(page, report.url, report.targetQuestion ?? "");
  await run(page, "zh");
  await assertReport(page, "zh", report);
  await page.getByTestId("citability-ai-run").click();
  const result = page.getByTestId("citability-ai-result");
  await expect(result).toContainText(review.summary);
  await expect(result).toContainText(review.actualModel);
  await expect(result).toContainText(review.providerTaskId);
  await expect(result.locator("[data-ai-dimension]")).toHaveCount(3);
  await expect(page.getByTestId("citability-conclusion")).toHaveAttribute("data-verdict", report.conclusion.verdict);
  await expect(page.getByTestId("citability-metric-failed").locator("dd")).toHaveText(String(report.summary.failed));
  await assertNoHorizontalOverflow(page);
  expect(guard.requests).toHaveLength(1);
  expect(guard.aiRequests).toHaveLength(1);
  expect(guard.unexpected).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  await result.locator('a[href="#citability-ai-evidence-E1"]').first().click();
  await expect(page.locator("#citability-ai-evidence-E1")).toBeInViewport();
  await result.locator("details > summary").click();
  const card = page.getByTestId("citability-ai-review");
  await card.evaluate(element => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 100));
  const box = await card.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("Real AI screenshot requires a visible card");
  const path = test.info().outputPath("real-ai-result.png");
  await page.screenshot({ path, clip: { ...box, height: Math.min(box.height, viewport.height - box.y) }, animations: "disabled" });
  await test.info().attach("real-ai-result", { path, contentType: "image/png" });
});
