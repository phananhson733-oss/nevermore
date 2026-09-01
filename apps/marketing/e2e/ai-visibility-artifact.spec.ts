// Local isolated UI acceptance, not authentication or production-provider E2E.
// The runner and Next server must use env -i; the context guard blocks all
// external requests and invokes actual handlers with offline account/store seams.
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { ARTIFACT_CURRENT_RUN, ARTIFACT_PREVIOUS_RUN, ARTIFACT_LEGACY_RUN, ARTIFACT_UNKNOWN_RUN, ARTIFACT_UNREADY_SITE, createVisibilityArtifactFixture, type VisibilityArtifactFixture } from "./ai-visibility-artifact-fixtures.ts";
import { installVisibilityArtifactGuard, type VisibilityArtifactGuard } from "./ai-visibility-artifact-harness.ts";

type Locale = "en" | "zh";
const copy = (locale: Locale) => (locale === "en" ? en : zh).tools.aiVisibility;
let buildId = "", previousKey: string | undefined;
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  const forbidden = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "GEO_BRIEF_API_KEY", "CONTENT_DRAFT_API_KEY", "KEYWORD_LLM_API_KEY", "CITABILITY_RENDERER_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"].filter(name => process.env[name] !== undefined);
  expect(forbidden).toEqual([]);
  previousKey = process.env["TOKEN_ENCRYPTION_KEY"];
  process.env["TOKEN_ENCRYPTION_KEY"] = "cd".repeat(32);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  if (previousKey === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"]; else process.env["TOKEN_ENCRYPTION_KEY"] = previousKey;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId);
});

async function setup(page: Page, baseURL: string | undefined, outcome: "ok" | "partial" | "insufficient" = "ok") {
  if (!baseURL) throw new Error("Loopback baseURL required");
  const fixture = await createVisibilityArtifactFixture(outcome);
  const guard = await installVisibilityArtifactGuard(page.context(), baseURL, fixture);
  return { fixture, guard, initialCalls: fixture.chain.providerCalls };
}
async function assertNoRun(fixture: VisibilityArtifactFixture, guard: VisibilityArtifactGuard, initialCalls: number) {
  expect(guard.starts).toBe(0); expect(guard.quotaCalls).toBe(0);
  expect(fixture.chain.providerCalls).toBe(initialCalls);
  expect(guard.requests.filter(row => row.id === "POST /api/tools/ai-visibility-check/run")).toEqual([]);
  expect(guard.unexpected).toEqual([]);
  expect(guard.localeErrors).toEqual([]);
}
async function screenshot(page: Page, name: string) {
  const banner = page.getByRole("region", { name: "Cookie consent", exact: true });
  if (await banner.isVisible()) {
    await banner.getByRole("button", { name: /^(Necessary only|仅必要)$/iu }).click();
    await expect(banner).toHaveCount(0);
  }
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const path = test.info().outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
  const viewportName = name.replace(/\.png$/u, "-viewport.png");
  const viewportPath = test.info().outputPath(viewportName);
  await page.screenshot({ path: viewportPath });
  await test.info().attach(viewportName, { path: viewportPath, contentType: "image/png" });
}
async function downloaded(download: Download) {
  const path = await download.path();
  if (!path) throw new Error("Local download bytes unavailable");
  const text = await readFile(path, "utf8");
  await test.info().attach(download.suggestedFilename(), { path, contentType: download.suggestedFilename().endsWith("json") ? "application/json" : "text/markdown" });
  return { path, text };
}
async function openRun(page: Page, runId: string) {
  await page.locator(`[data-run-id="${runId}"]`).click();
  await expect(page.locator('[role="tab"][data-view="result"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#visibility-result-panel")).toBeVisible();
}
async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

test.describe("AI Visibility Artifact acceptance", () => {
  for (const locale of ["en", "zh"] as const) for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
    test(`${locale} ${theme} ${width}: complete sources, four metrics first, tabs and durable reopening`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 1000 });
      const { fixture, guard, initialCalls } = await setup(page, baseURL);
      await page.goto(`/${locale}/tools/ai-visibility-check`);
      await expect(page.locator("#visibility-website option")).toHaveCount(2);
      // The test-only Flight auth replacement remounts the SSR tree. Exercise
      // the real theme control after that remount, not an artificial init hook.
      const common = (locale === "en" ? en : zh).common;
      await page.getByRole("button", { name: common.switchToLight, exact: true }).click();
      if (theme === "dark") await page.getByRole("button", { name: common.switchToDark, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("#visibility-website")).toHaveValue(fixture.chain.website.websiteId);
      await expect(page.locator("#visibility-version")).toHaveValue(fixture.chain.frozen.snapshotId);
      const profile = page.locator('[data-source="current-profile"]');
      await profile.locator(":scope > summary").click();
      await expect(profile).toContainText(fixture.chain.profile.reference.profileHash);
      expect(await profile.locator("[data-profile-field]").count()).toBe(Object.keys(fixture.chain.website.currentConfirmedSnapshot!.profile).length - 2);
      await profile.locator(":scope > summary").click();
      const frozen = page.locator('[data-source="frozen"]');
      await frozen.locator(":scope > summary").click();
      await expect(frozen).toContainText(fixture.chain.frozen.snapshotId);
      await expect(frozen).toContainText(fixture.chain.frozen.questionSetHash);
      await frozen.locator(":scope > summary").click();
      const questions = page.locator('[data-source="questions"]');
      await questions.locator(":scope > summary").click();
      await expect(questions.getByText(fixture.firstQuestion.text, { exact: true })).toBeVisible();
      await questions.locator(":scope > summary").click();
      await noPageOverflow(page);
      await screenshot(page, `input-${locale}-${theme}-${width}.png`);
      await openRun(page, ARTIFACT_CURRENT_RUN);
      const report = page.locator('[data-visibility-report="marketing-geo-visibility.v2"]');
      await expect(report.locator("[data-metric]")).toHaveCount(4);
      await expect(page.locator("#visibility-input-panel")).toHaveCount(0);
      await expect(report.locator('[data-section="metadata"]')).not.toHaveAttribute("open", "");
      const order = await report.locator("[data-section]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-section")));
      expect(order[0]).toBe("metrics");
      expect(order.indexOf("metrics")).toBeLessThan(order.indexOf("engines"));
      expect(order.indexOf("engines")).toBeLessThan(order.indexOf("metadata"));
      if (width === 1440) {
        const tops = await report.locator("[data-metric]").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
      }
      await noPageOverflow(page);
      await screenshot(page, `result-${locale}-${theme}-${width}.png`);
      await page.locator('[role="tab"][data-view="input"]').click();
      await expect(page.locator("#visibility-website")).toHaveValue(fixture.chain.website.websiteId);
      await page.locator('[role="tab"][data-view="result"]').click();
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`run=${ARTIFACT_CURRENT_RUN}`));
      await expect(page.locator('[data-visibility-report="marketing-geo-visibility.v2"] [data-metric]')).toHaveCount(4);
      await assertNoRun(fixture, guard, initialCalls);
      await writeFile(test.info().outputPath("isolation.json"), JSON.stringify({ buildId, scope: "local injected account/store/provider fixtures", requests: guard.requests, starts: guard.starts, quotaCalls: guard.quotaCalls, offlineSetupProviderCalls: initialCalls, offlineCallsAfterRead: fixture.chain.providerCalls, blockedExternal: guard.blockedExternal }, null, 2));
    });
  }

  test("zh: actual answer evidence, omitted mention, clickable sources and export/import bytes", async ({ page, baseURL }) => {
    const { fixture, guard, initialCalls } = await setup(page, baseURL);
    await page.goto(`/zh/tools/ai-visibility-check?run=${ARTIFACT_CURRENT_RUN}`);
    const report = page.locator('[data-visibility-report="marketing-geo-visibility.v2"]');
    await expect(report).toBeVisible();
    await report.locator('[data-section="questions"] details').first().locator(":scope > summary").click();
    const sample = report.locator(`[data-sample="${fixture.firstQuestion.samples[0]!.slotId}"]`);
    await expect(sample).toContainText("提及摘录已省略，实际提及记录仍保留。");
    await expect(sample).toContainText(fixture.firstQuestion.samples[0]!.answerExcerpt!);
    await expect(sample).not.toContainText(zh.tools.aiVisibility.questions.noExcerpt);
    const citation = sample.getByRole("link", { name: "publisher.test/best-tools", exact: true });
    await expect(citation).toHaveAttribute("href", "https://publisher.test/best-tools");
    await expect(citation).toHaveAttribute("rel", /noopener/);
    await report.locator('[data-section="sources"] details').first().locator(":scope > summary").click();
    await expect(report.locator('[data-section="sources"] a[href="https://publisher.test/best-tools"]')).toBeVisible();
    await screenshot(page, "expanded-answer-and-sources-zh.png");
    const [json] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: copy("zh").v2.exportJson, exact: true }).click()]);
    const current = await downloaded(json), imported = parseVisibilityImport(current.text);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.report.questions[0]!.samples[0]).toMatchObject({ mentioned: true, excerpt: null, excerptOmitted: true });
    const [md] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: copy("zh").v2.exportMarkdown, exact: true }).click()]);
    const markdown = (await downloaded(md)).text;
    expect(markdown).toContain(fixture.chain.frozen.questionSetHash);
    expect(markdown).toContain(ARTIFACT_CURRENT_RUN);
    await openRun(page, ARTIFACT_PREVIOUS_RUN);
    const [base] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: copy("zh").v2.exportJson, exact: true }).click()]);
    const previous = await downloaded(base);
    await page.locator("details").filter({ has: page.locator('input[type="file"]') }).locator(":scope > summary").click();
    await page.locator('input[type="file"]').nth(0).setInputFiles(previous.path);
    await page.locator('input[type="file"]').nth(1).setInputFiles(current.path);
    await page.getByRole("button", { name: copy("zh").v2.compare, exact: true }).click();
    await expect(page.locator('[data-section="comparison"]')).toBeVisible();
    await assertNoRun(fixture, guard, initialCalls);
  });

  test("en: V1 summary remains summary-only and unknown history never triggers a paid run", async ({ page, baseURL }) => {
    const { fixture, guard, initialCalls } = await setup(page, baseURL);
    await page.goto(`/en/tools/ai-visibility-check?run=${ARTIFACT_LEGACY_RUN}`);
    const summary = page.locator('[data-visibility-report="historical-summary"]');
    await expect(summary).toBeVisible();
    await expect(summary.locator("[data-metric]")).toHaveCount(4);
    await expect(summary.locator('[data-section="engines"]')).toHaveCount(0);
    await summary.locator('[data-section="questions"] details').first().locator(":scope > summary").click();
    await expect(summary.locator("[data-sample]")).toHaveCount(0);
    await expect(summary.getByRole("button", { name: copy("en").v2.exportJson, exact: true })).toHaveCount(0);
    await screenshot(page, "historical-v1-summary-en.png");
    await page.goto(`/en/tools/ai-visibility-check?run=${ARTIFACT_UNKNOWN_RUN}`);
    await expect(page.getByTestId("visibility-history-error")).toBeVisible();
    await expect(page.locator("[data-visibility-report]")).toHaveCount(0);
    await assertNoRun(fixture, guard, initialCalls);
  });

  for (const outcome of ["partial", "insufficient"] as const) {
    test(`en: ${outcome} answers retain evidence and respect conclusion gates`, async ({ page, baseURL }) => {
      const { fixture, guard, initialCalls } = await setup(page, baseURL, outcome);
      expect(fixture.current.manifest.status).toBe(outcome);
      await page.goto(`/en/tools/ai-visibility-check?run=${ARTIFACT_CURRENT_RUN}`);
      const report = page.locator('[data-visibility-report="marketing-geo-visibility.v2"]');
      await expect(report).toBeVisible();
      if (outcome === "partial") {
        await expect(report.locator("[data-metric]")).toHaveCount(4);
        await expect(report.locator('[data-section="layers"]')).toBeVisible();
        const failedEngine = report.locator('[data-section="engines"] tbody tr').filter({ hasText: "Perplexity" });
        await expect(failedEngine).toContainText(en.tools.aiVisibility.report.insufficient);
        await expect(failedEngine).toContainText(en.tools.aiVisibility.report.notEnough);
      } else {
        await expect(report.locator('[data-section="metrics"], [data-section="layers"], [data-section="gaps"], [data-section="comparison"]')).toHaveCount(0);
        await expect(report.getByRole("heading", { name: en.tools.aiVisibility.results.withheldTitle, exact: true })).toBeVisible();
      }
      const failed = fixture.current.questions[0]!.samples.find(sample => sample.status === "timeout")!;
      await report.locator('[data-section="questions"] details').first().locator(":scope > summary").click();
      await expect(report.locator(`[data-sample="${failed.slotId}"]`)).toContainText(en.tools.aiVisibility.questions.sampleNoAnswer);
      const [download] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: en.tools.aiVisibility.v2.exportJson, exact: true }).click()]);
      const exported = parseVisibilityImport((await downloaded(download)).text);
      expect(exported.ok).toBe(true);
      if (exported.ok) {
        expect(exported.report.manifest.status).toBe(outcome);
        expect(exported.report.questions.flatMap(question => question.samples).filter(sample => sample.status === "timeout").length).toBeGreaterThan(0);
      }
      await screenshot(page, `${outcome}-evidence-en.png`);
      await assertNoRun(fixture, guard, initialCalls);
    });
  }

  test("zh: input/result tabs preserve keyboard focus without restarting archived work", async ({ page, baseURL }) => {
    const { fixture, guard, initialCalls } = await setup(page, baseURL);
    await page.goto(`/zh/tools/ai-visibility-check?run=${ARTIFACT_CURRENT_RUN}`);
    const result = page.locator('[role="tab"][data-view="result"]');
    const input = page.locator('[role="tab"][data-view="input"]');
    await expect(result).toHaveAttribute("aria-selected", "true");
    await result.focus(); await result.press("Home");
    await expect(input).toBeFocused(); await expect(input).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#visibility-input-panel")).toBeVisible();
    await input.press("End");
    await expect(result).toBeFocused(); await expect(result).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#visibility-result-panel")).toBeVisible();
    await assertNoRun(fixture, guard, initialCalls);
  });

  test("en: unready website stays selectable and cannot run; explicit run is recoverable once", async ({ page, baseURL }) => {
    const { fixture, guard, initialCalls } = await setup(page, baseURL);
    await page.goto("/en/tools/ai-visibility-check");
    await page.locator("#visibility-website").selectOption(ARTIFACT_UNREADY_SITE);
    await expect(page.getByRole("button", { name: copy("en").form.start, exact: true })).toBeDisabled();
    await expect(page.locator(`a[href="/account/websites/${ARTIFACT_UNREADY_SITE}/geo"]`).first()).toBeVisible();
    await assertNoRun(fixture, guard, initialCalls);
    await page.locator("#visibility-website").selectOption(fixture.chain.website.websiteId);
    await page.locator("#visibility-samples").selectOption("3");
    await page.getByRole("checkbox", { name: "Perplexity", exact: true }).check();
    await page.getByRole("button", { name: copy("en").form.start, exact: true }).click();
    await expect(page.getByRole("heading", { name: copy("en").running.title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy("en").form.starting, exact: true })).toHaveCount(0);
    await expect(page.locator('[data-visibility-report="marketing-geo-visibility.v2"]')).toBeVisible();
    expect(guard.starts).toBe(1); expect(guard.quotaCalls).toBe(1);
    expect(guard.requests.find(row => row.id === "POST /api/tools/ai-visibility-check/run")?.body).toEqual({
      kbId: fixture.chain.frozen.kbId, snapshotId: fixture.chain.frozen.snapshotId,
      samplesPerQuestion: 3, engines: ["chatgpt", "perplexity"],
    });
    const total = fixture.chain.providerCalls;
    expect(total - initialCalls).toBe(fixture.chain.frozen.questionCount * 6);
    await page.reload();
    await expect(page.locator('[data-visibility-report="marketing-geo-visibility.v2"]')).toBeVisible();
    expect(guard.starts).toBe(1); expect(fixture.chain.providerCalls).toBe(total);
    expect(guard.unexpected).toEqual([]);
    expect(guard.localeErrors).toEqual([]);
  });
});
