// LOCAL ONLY: production-built UI with the real load/assembly handlers and
// deterministic offline account, frozen-store and provider dependencies.
// No real login, remote store, live provider or production claim is made here.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../src/lib/geo-tools/brief-shared-export.ts";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { createGeoChainFixture, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";
import { installGeoChainGuard, type GeoChainGuard } from "./geo-chain-harness.ts";

const apiCount = (guard: GeoChainGuard, path: string) => guard.requests.filter(request => request.id === `POST /api/tools/${path}`).length;
let previousKey: string | undefined;
let browserBuildId = "";
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  // Only credential names may be reported by this tripwire, never values.
  const configured = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY",
    "GEO_BRIEF_API_KEY", "CONTENT_DRAFT_API_KEY", "KEYWORD_LLM_API_KEY", "CITABILITY_RENDERER_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY"].filter(name => process.env[name] !== undefined);
  expect(configured).toEqual([]);
  previousKey = process.env["TOKEN_ENCRYPTION_KEY"];
  process.env["TOKEN_ENCRYPTION_KEY"] = "cd".repeat(32);
  browserBuildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  if (previousKey === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"];
  else process.env["TOKEN_ENCRYPTION_KEY"] = previousKey;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(browserBuildId);
});

async function downloadedText(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("Local browser download has no path");
  await test.info().attach(download.suggestedFilename(), { path,
    contentType: download.suggestedFilename().endsWith(".json") ? "application/json" : "text/markdown" });
  return readFile(path, "utf8");
}

async function attachJson(name: string, value: unknown): Promise<void> {
  const path = test.info().outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
  await test.info().attach(name, { path, contentType: "application/json" });
}

async function screenshot(page: Page, name: string, locale: "en" | "zh", theme: "light" | "dark"): Promise<void> {
  // Inspect visible layout only; no browser session or private storage reads.
  await page.evaluate(() => window.scrollTo(0, 0));
  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if ((currentTheme === "light" ? "light" : "dark") !== theme) {
    const common = locale === "en" ? en.common : zh.common;
    await page.getByRole("button", { name: theme === "light" ? common.switchToLight : common.switchToDark, exact: true }).click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const workspace = page.locator("[data-geo-workspace]");
  const themedName = `${name}-${theme}`;
  const path = test.info().outputPath(`${themedName}.png`);
  // Finish the site's finite color transitions so theme screenshots capture
  // settled colors, including the related-tool cards outside the workspace.
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(themedName, { path, contentType: "image/png" });
  const layout = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const workspace = getComputedStyle(document.querySelector("[data-geo-workspace]")!);
    const resultElement = document.querySelector("[data-shared-geo-result]");
    const result = resultElement ? getComputedStyle(resultElement) : null;
    return { viewport: window.innerWidth, document: document.documentElement.scrollWidth,
    theme: document.documentElement.getAttribute("data-theme"),
    colors: { rootBackgroundToken: root.getPropertyValue("--sc-bg").trim(),
      workspaceBackgroundToken: workspace.getPropertyValue("--sc-bg").trim(),
      rootTextToken: root.getPropertyValue("--sc-text-primary").trim(),
      workspaceTextToken: workspace.getPropertyValue("--sc-text-primary").trim(),
      rootColorScheme: root.colorScheme, workspaceColorScheme: workspace.colorScheme,
      bodyBackground: body.backgroundColor, workspaceBackground: workspace.backgroundColor,
      bodyColor: body.color, workspaceColor: workspace.color,
      resultBackground: result?.backgroundColor ?? null, resultColor: result?.color ?? null },
    overflow: [...document.querySelectorAll<HTMLElement>("[data-geo-workspace], [data-geo-workspace] *")].flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > window.innerWidth + 1
        ? [{ tag: element.tagName, className: element.className, right: box.right, width: box.width,
          text: element.textContent?.trim().slice(0, 100) }] : [];
    }).slice(0, 20) }; });
  await attachJson(`${themedName}-layout.json`, layout);
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.colors.rootBackgroundToken).not.toBe("");
  expect(layout.colors.workspaceBackgroundToken).toBe(layout.colors.rootBackgroundToken);
  expect(layout.colors.workspaceTextToken).toBe(layout.colors.rootTextToken);
  await expect(workspace).toHaveCSS("background-color", layout.colors.bodyBackground);
  await expect(workspace).toHaveCSS("color", layout.colors.bodyColor);
  if (layout.colors.resultBackground !== null) {
    await expect(page.locator("[data-shared-geo-result]")).toHaveCSS("background-color", layout.colors.bodyBackground);
    await expect(page.locator("[data-shared-geo-result]")).toHaveCSS("color", layout.colors.bodyColor);
  }
  expect(layout.colors.workspaceColorScheme).toBe(layout.colors.rootColorScheme);
  expect(layout.colors.rootColorScheme).toBe(theme);
  expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function freezeOffline(fixture: GeoChainFixture): Promise<void> {
  const outcome = await fixture.kbDependencies.freeze({ userId: GEO_CHAIN_USER, kbId: fixture.frozen.kbId,
    baseVersion: 1, questionSet: fixture.frozen.questionSet, context: fixture.context });
  expect(outcome.kind).toBe("ok");
}

for (const [locale, viewport, kind] of [["en", "desktop", "A"], ["zh", "desktop", "D"], ["en", "mobile", "A"], ["zh", "mobile", "D"]] as const) {
  test(`${locale} ${viewport}: Artifact input, owned ${kind} results and exact exports`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Local base URL required");
    await page.setViewportSize(viewport === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const fixture = createGeoChainFixture(kind);
    await freezeOffline(fixture);
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const pageErrors: { url: string; message: string }[] = [];
    page.on("pageerror", error => pageErrors.push({ url: page.url(), message: error.message }));
    const messages = locale === "en" ? en.tools : zh.tools;
    const roleQuestion = fixture.frozen.questionSet.questions.find(question => question.roleId !== null);
    const role = fixture.frozen.payload.roles.find(role => role.id === roleQuestion?.roleId);
    if (!roleQuestion || !role) throw new Error("Frozen fixture needs a role-bearing question");

    // The free entrance loads actual projected role/version metadata. It does
    // not infer a gap or make a provider call merely by loading the page.
    await page.goto(`/${locale}/tools/geo-brief`);
    await page.getByRole("button", { name: locale === "en" ? en.cookie.necessaryOnly : zh.cookie.necessaryOnly, exact: true }).click();
    await expect(page.getByRole("region", { name: "Cookie consent", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-geo-view="result"]')).toBeDisabled();
    await page.locator("[data-load-geo-brief]").click();
    await expect(page.locator("#geo-brief-version")).toHaveValue(fixture.frozen.snapshotId);
    await page.locator("#geo-brief-question").selectOption(roleQuestion.id);
    if (viewport === "mobile") {
      await expect(page.locator("[data-geo-question-preview]")).toBeVisible();
      await expect(page.locator("[data-geo-question-preview]")).toHaveText(roleQuestion.text);
    }
    await expect(page.locator("[data-geo-role]")).toContainText(role.label);
    await expect(page.locator("[data-geo-role]")).toContainText(role.segment);
    await expect(page.locator("[data-geo-gap]")).toHaveText(messages.geoBrief.artifact.noGap);
    await expect(page.locator("[data-geo-input-evidence]")).toContainText(messages.geoBrief.quality.inputFacts.replace("{count}", "1"));
    await expect(page.locator("[data-geo-input-evidence]")).not.toContainText(messages.geoBrief.quality.inputNoProfile);
    // List metadata alone is not evidence of a successful exact-context read.
    const expectedFreeLoads = [{}, { schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId, snapshotId: fixture.frozen.snapshotId }];
    expect(guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/load").map(request => request.body)).toEqual(expectedFreeLoads);
    const exactReferences = page.locator("details").filter({ has: page.getByText(fixture.frozen.questionSet.registryVersion, { exact: true }) });
    await expect(exactReferences).not.toHaveAttribute("open");
    await exactReferences.locator("summary").click();
    await expect(exactReferences.getByText(fixture.frozen.questionSet.registryVersion, { exact: true })).toBeVisible();
    expect(JSON.parse(await exactReferences.locator("[data-geo-source-summary]").innerText())).toMatchObject({ snapshotFacts: fixture.frozen.payload.facts.length, profileAttached: true, usableFacts: 1 });
    await exactReferences.locator("summary").click();
    expect(apiCount(guard, "geo-brief/run")).toBe(0);
    expect(fixture.providerCalls).toBe(0);
    expect(fixture.assemblyCalls).toBe(0);
    await screenshot(page, `${locale}-${viewport}-frozen-input`, locale, "light");
    await screenshot(page, `${locale}-${viewport}-frozen-input`, locale, "dark");
    expect(guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/load").map(request => request.body)).toEqual(expectedFreeLoads);
    expect(apiCount(guard, "geo-brief/run")).toBe(0);
    expect(fixture.assemblyCalls).toBe(0);
    expect(pageErrors).toEqual([]);

    // Enter via the actual Visibility gap action, which writes its own single-
    // use selector handoff. The test never seeds or reads that private storage.
    await page.goto(`/${locale}/tools/ai-visibility-check`);
    await expect(page.locator("#visibility-version")).toHaveValue(fixture.frozen.snapshotId);
    await page.locator("#visibility-samples").selectOption("3");
    await page.getByRole("checkbox", { name: "Perplexity", exact: true }).check();
    await page.getByRole("button", { name: messages.aiVisibility.form.start, exact: true }).click();
    await expect(page.getByRole("heading", { name: messages.aiVisibility.gaps.title, exact: true })).toBeVisible();
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: fixture.question.text, exact: true }) });
    await card.getByRole("link", { name: messages.aiVisibility.gaps.actions.brief, exact: true }).click();
    await expect(page.locator("#geo-brief-question")).toHaveValue(fixture.question.id);
    if (viewport === "mobile") {
      await expect(page.locator("[data-geo-question-preview]")).toBeVisible();
      await expect(page.locator("[data-geo-question-preview]")).toHaveText(fixture.question.text);
    }
    await expect(page.locator("[data-geo-gap]")).toContainText(kind);
    expect(apiCount(guard, "geo-brief/run")).toBe(0);
    expect(fixture.assemblyCalls).toBe(0);
    const providerCalls = fixture.providerCalls;
    expect(providerCalls).toBe(fixture.frozen.questionCount * 6);
    const handoffLoad = guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/load").at(-1);
    expect(handoffLoad?.body).toEqual({ schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId,
      snapshotId: fixture.frozen.snapshotId, questionId: fixture.question.id,
      runId: fixture.report!.manifest.runId, gapId: `gap-${fixture.question.id}` });
    await screenshot(page, `${locale}-${viewport}-gap-input`, locale, "light");

    await page.locator("[data-run-geo-brief]").click();
    const result = page.locator("[data-shared-geo-result]");
    await expect(result).toBeVisible();
    await expect(page.locator('[data-geo-view="result"]')).toHaveAttribute("aria-pressed", "true");
    for (const section of ["geo_origin", "lead_answer", "must_answer", "fact_table", "outline"]) {
      await expect(result.locator(`[data-brief-section="${section}"]`)).toBeVisible();
    }
    await expect(result.locator('[data-brief-section="must_answer"] table')).toBeVisible();
    await expect(result.locator('[data-brief-section="fact_table"] table')).toBeVisible();
    await expect(result.locator('[data-brief-section="geo_origin"]')).toContainText(messages.geoBrief.quality.origin.visibility);
    await expect(result.locator('[data-must-answer="Q1"] [data-source="kb"]')).toHaveText(messages.geoBrief.quality.openingFrozen);
    // Primary result prose matches the 14px input; it is not drawn as an input.
    const opening = result.locator('[data-brief-section="lead_answer"] dd').first().locator("p").first();
    await expect(page.locator('[data-geo-view="input"]')).toBeEnabled();
    await expect(opening).toHaveCSS("font-size", "14px");
    await expect(opening).toHaveCSS("border-top-width", "0px");
    await expect(opening).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const primaryText = await result.innerText();
    expect(primaryText).not.toMatch(/geo_origin|required_entities|must_answer|fact_table|intent_derived|insufficient_evidence|geo_not_serp/);
    await expect(result.locator("[data-geo-technical] pre")).not.toBeVisible();
    expect(fixture.assemblyCalls).toBe(1);
    expect(fixture.providerCalls).toBe(providerCalls);
    const unchangedResult = await result.innerText();
    await screenshot(page, `${locale}-${viewport}-result`, locale, "light");
    await screenshot(page, `${locale}-${viewport}-result`, locale, "dark");
    expect(await result.innerText()).toBe(unchangedResult);
    expect(apiCount(guard, "geo-brief/run")).toBe(1);
    expect(fixture.assemblyCalls).toBe(1);
    expect(fixture.providerCalls).toBe(providerCalls);

    const [jsonDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.geoBrief.actions.downloadJson, exact: true }).click()]);
    const json = await downloadedText(jsonDownload);
    const parsed = await parseGeoContentBrief(JSON.parse(json));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Export failed the shared Brief strict parser");
    const brief = parsed.value;
    expect(json).toBe(sharedGeoBriefJson(brief));
    expect(brief.geo_origin.gap).toBe(kind);
    expect(brief.geo_origin.kb_ref.snapshot_id).toBe(fixture.frozen.snapshotId);
    expect(brief.geo_origin.promptset_ref.hash).toBe(fixture.frozen.questionSetHash);
    expect(guard.briefs).toEqual([brief]);
    await expect(result.locator('[data-brief-section="must_answer"] tbody tr')).toHaveCount(brief.must_answer.items.length);
    await expect(result.locator('[data-brief-section="fact_table"] tbody tr')).toHaveCount(brief.fact_table.length);
    const [mdDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.geoBrief.actions.downloadMarkdown, exact: true }).click()]);
    const markdown = await downloadedText(mdDownload);
    expect(markdown).toBe(sharedGeoBriefMarkdown(brief));
    await page.locator("[data-copy-geo-brief]").click();
    await expect.poll(() => guard.clipboard.length).toBe(1);
    expect(guard.clipboard[0]).toBe(markdown);

    // View switches keep the same result and never make another paid request.
    await page.locator('[data-geo-view="input"]').click();
    await expect(result).toHaveCount(0);
    await page.locator('[data-geo-view="result"]').click();
    await expect(result).toBeVisible();
    expect(apiCount(guard, "geo-brief/run")).toBe(1);
    expect(fixture.assemblyCalls).toBe(1);
    await page.locator('[data-geo-view="input"]').click();
    await page.locator("#geo-brief-question").selectOption(roleQuestion.id);
    await expect(page.locator('[data-geo-view="result"]')).toBeDisabled();
    await expect(result).toHaveCount(0);
    await expect(page.locator("[data-geo-role]")).toContainText(role.label);
    await expect(page.locator("[data-geo-gap]")).toHaveText(messages.geoBrief.artifact.noGap);
    // Returning to the original question cannot resurrect its old run context.
    await page.locator("#geo-brief-question").selectOption(fixture.question.id);
    await page.locator("[data-run-geo-brief]").click();
    await expect(result).toBeVisible();
    const changedRun = guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/run").at(-1);
    expect(changedRun?.body).toMatchObject({ questionId: fixture.question.id, runId: null, gapId: null });
    expect(fixture.providerCalls).toBe(providerCalls);
    expect(fixture.assemblyCalls).toBe(2);
    await page.locator('[data-geo-view="input"]').click();
    await page.locator("#geo-brief-question").selectOption("");
    await expect(page.locator("[data-geo-question-preview]")).toHaveCount(0);
    await expect(page.locator('[data-geo-view="result"]')).toBeDisabled();
    await expect(page.locator("[data-run-geo-brief]")).toBeDisabled();
    await expect(page.locator("[data-geo-role]")).not.toContainText(role.label);
    // The existing Visibility-only Flight auth fixture changes signed-out SSR
    // props and causes a known hydration retry. It is not a production finding
    // and must never exempt any Brief error or any other React/runtime error.
    const fixtureHydrationErrors = pageErrors.filter(error => guard.ssrAuthFixtures.includes(new URL(error.url).pathname)
      && new URL(error.url).pathname.endsWith("/tools/ai-visibility-check")
      && error.message.startsWith("Minified React error #418;"));
    const unexpectedPageErrors = pageErrors.filter(error => !fixtureHydrationErrors.includes(error));
    await attachJson("page-errors.json", { pageErrors, fixtureHydrationErrors, unexpectedPageErrors });
    expect(fixtureHydrationErrors.length).toBeLessThanOrEqual(1);
    expect(unexpectedPageErrors).toEqual([]);
    expect(guard.unexpected).toEqual([]);
    await attachJson("offline-artifact-evidence.json", {
      scope: "local built UI with offline handlers/providers/stores; not production or real-login evidence",
      browserBuildId, locale, viewport, themesVerified: ["light", "dark"], gap: kind, snapshotId: fixture.frozen.snapshotId,
      questionSetHash: fixture.frozen.questionSetHash, offlineProviderCalls: fixture.providerCalls,
      offlineAssemblyCalls: fixture.assemblyCalls, apiRequests: guard.requests.map(request => request.id),
      externalRequestsAborted: guard.blockedExternal, unexpected: guard.unexpected, pageErrors,
      fixtureHydrationErrors, unexpectedPageErrors,
    });
  });
}
