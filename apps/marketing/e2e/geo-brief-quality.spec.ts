// LOCAL ONLY: actual load, Brief, ownership, Draft and parser handlers with
// synthetic immutable stores and offline providers. This is not real login,
// production data, or a paid-provider canary.
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { parseDraftResult } from "@sf/public-tools/content-brief/parse-draft";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import { sharedGeoBriefJson, sharedGeoBriefMarkdown } from "../src/lib/geo-tools/brief-shared-export.ts";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { installGeoChainGuard, type GeoChainGuard } from "./geo-chain-harness.ts";
import { createGeoBriefQualityFixture, CLEAN_QUESTION, MIXED_QUESTION } from "./geo-brief-quality-fixtures.ts";
import { GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";

type Locale = "en" | "zh";
const messages = (locale: Locale) => locale === "en" ? en.tools : zh.tools;
const loads = (guard: GeoChainGuard) => guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/load").map(request => request.body);
const runs = (guard: GeoChainGuard) => guard.requests.filter(request => request.id === "POST /api/tools/geo-brief/run");
const selector = (fixture: GeoChainFixture) => ({ schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId, snapshotId: fixture.frozen.snapshotId });
let previousKey: string | undefined;
let browserBuildId = "";

test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
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

async function downloadedText(download: Download) {
  const path = await download.path();
  if (path === null) throw new Error("Local download missing");
  await test.info().attach(download.suggestedFilename(), { path, contentType: download.suggestedFilename().endsWith(".json") ? "application/json" : "text/markdown" });
  return readFile(path, "utf8");
}

async function openInput(page: Page, locale: Locale) {
  await page.goto(`/${locale}/tools/geo-brief`);
  await page.getByRole("button", { name: locale === "en" ? en.cookie.necessaryOnly : zh.cookie.necessaryOnly, exact: true }).click();
  await page.locator("[data-load-geo-brief]").click();
}

async function screenshot(page: Page, locale: Locale, label: string) {
  const common = locale === "en" ? en.common : zh.common;
  for (const theme of ["light", "dark"] as const) {
    const currentTheme = await page.locator("html").getAttribute("data-theme");
    if (currentTheme !== theme) await page.getByRole("button", { name: theme === "light" ? common.switchToLight : common.switchToDark, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    const path = test.info().outputPath(`${locale}-${label}-${theme}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await test.info().attach(`${locale}-${label}-${theme}`, { path, contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
}

async function isolationEvidence(fixture: GeoChainFixture, guard: GeoChainGuard) {
  expect(guard.unexpected).toEqual([]);
  expect(fixture.providerCalls).toBe(0);
  await test.info().attach("offline-quality-evidence.json", { body: JSON.stringify({
    scope: "local build, synthetic historical snapshot, actual handlers and offline dependencies",
    browserBuildId, snapshot: fixture.frozen.snapshotId, payloadHash: fixture.frozen.contentHash,
    questionSetHash: fixture.frozen.questionSetHash, requests: guard.requests,
    offlineAssemblyCalls: fixture.assemblyCalls, providerCalls: fixture.providerCalls,
    authorityChecks: guard.authorityChecks, blockedExternal: guard.blockedExternal, unexpected: guard.unexpected,
  }, null, 2), contentType: "application/json" });
}

for (const locale of ["en", "zh"] as const) {
  test(`${locale}: exact historical mixed-language question stays readable and cannot generate`, async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Local base URL required");
    await page.setViewportSize(locale === "zh" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const fixture = createGeoBriefQualityFixture("mixed_legacy");
    const original = JSON.stringify(fixture.frozen);
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const copy = messages(locale).geoBrief;
    await openInput(page, locale);
    await expect(page.locator("#geo-brief-question option:checked")).toHaveText(MIXED_QUESTION);
    await expect(page.getByText(copy.quality.needsRevisionInput, { exact: true })).toBeVisible();
    await expect(page.locator("[data-run-geo-brief]")).toBeDisabled();
    await expect(page.locator("[data-geo-input-evidence]")).toContainText(copy.quality.inputNoProfile);
    expect(loads(guard)).toEqual([{}, selector(fixture)]);
    await screenshot(page, locale, "historical-question-needs-review");
    expect(runs(guard)).toEqual([]);
    expect(fixture.assemblyCalls).toBe(0);
    expect(JSON.stringify(fixture.frozen)).toBe(original);
    await isolationEvidence(fixture, guard);
  });

  test(`${locale}: zero facts are structure-only, source wording is exact, and old JSON survives Draft`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Local base URL required");
    await page.setViewportSize(locale === "zh" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const fixture = createGeoBriefQualityFixture("no_facts");
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const copy = messages(locale).geoBrief;
    await openInput(page, locale);
    const evidence = page.locator("[data-geo-input-evidence]");
    await expect(evidence).toContainText(copy.quality.inputFacts.replace("{count}", "0"));
    await expect(evidence).toContainText(copy.quality.inputNoFacts);
    await expect(evidence).toContainText(copy.quality.inputNoProfile);
    await expect(evidence).toContainText(copy.quality.inputNoRun);
    await expect(page.locator("[data-geo-role]")).toHaveCount(0);
    await expect(page.locator("[data-run-geo-brief]")).toHaveText(copy.quality.generateStructure);
    await expect(page.locator("#geo-brief-question")).toHaveCSS("font-size", "14px");
    expect(loads(guard)).toEqual([{}, selector(fixture)]);
    expect(fixture.assemblyCalls).toBe(0);
    await screenshot(page, locale, "zero-facts-input");
    await page.locator("[data-run-geo-brief]").click();
    const result = page.locator("[data-shared-geo-result]");
    await expect(result.locator('[data-brief-quality="structure_only"]')).toBeVisible();
    await expect(result.locator('[data-brief-section="geo_origin"]')).toContainText(copy.quality.origin.frozen_question);
    await expect(result.locator('[data-must-answer="Q1"] [data-source="kb"]')).toHaveText(copy.quality.openingFrozen);
    await expect(result.locator('[data-brief-section="fact_table"] table')).toHaveCount(0);
    await expect(result.locator('[data-brief-section="fact_table"]')).toContainText(copy.artifact.emptyFacts);
    await expect(result.locator("[data-geo-to-draft]")).toHaveText(copy.quality.structureDraft);
    await expect(result.locator('[data-geo-knowledge-repair="facts"]').first()).toBeVisible();
    const opening = result.locator('[data-brief-section="lead_answer"] dd').first().locator("p").first();
    await expect(opening).toHaveCSS("font-size", "14px");
    await expect(opening).toHaveCSS("border-top-width", "0px");
    const visibleText = await result.innerText();
    expect(visibleText).not.toMatch(/(?:\d+ writable sections?|\d+ 段可写)|geo_origin|required_entities|must_answer|fact_table|intent_derived|insufficient_evidence|geo_not_serp/);
    await expect(result.locator("[data-geo-technical] pre")).not.toBeVisible();
    await screenshot(page, locale, "zero-facts-result");

    const [download] = await Promise.all([page.waitForEvent("download"), result.getByRole("button", { name: copy.actions.downloadJson, exact: true }).click()]);
    const json = await downloadedText(download);
    const frozenBrief = guard.briefs[0]!;
    expect(json).toBe(sharedGeoBriefJson(frozenBrief));
    expect((await parseGeoContentBrief(JSON.parse(json))).ok).toBe(true);
    expect(frozenBrief.geo_origin.question.text).toBe(CLEAN_QUESTION);
    expect(frozenBrief.geo_origin.profile_ref).toBeNull();
    expect(frozenBrief.fact_table).toEqual([]);
    expect(frozenBrief.draft_readiness.gaps).toContain("missing_facts");
    await page.locator("[data-copy-geo-brief]").click();
    await expect.poll(() => guard.clipboard.length).toBe(1);
    expect(guard.clipboard[0]).toBe(sharedGeoBriefMarkdown(frozenBrief));
    await result.locator("[data-geo-technical] summary").click();
    await expect(result.locator("[data-geo-technical] pre")).toHaveText(JSON.stringify(frozenBrief, null, 2));
    await result.locator("[data-geo-technical] summary").click();

    // Typing is a distinct origin; it must not borrow the frozen Q1 source.
    await page.locator('[data-geo-view="input"]').click();
    await page.locator("#geo-brief-question").selectOption("");
    const typedQuestion = "How can readers compare astrology tools?";
    await page.locator("#geo-brief-manual").fill(typedQuestion);
    await page.locator("[data-run-geo-brief]").click();
    await expect(result.locator('[data-brief-section="geo_origin"]')).toContainText(copy.quality.origin.typed_question);
    await expect(result.locator('[data-must-answer="Q1"] [data-source="user_input"]')).toHaveText(copy.quality.openingManual);
    expect(guard.briefs).toHaveLength(2);
    expect(fixture.assemblyCalls).toBe(2);
    const typedBrief = guard.briefs[1]!;
    expect(runs(guard).at(-1)?.body).toEqual({ ...selector(fixture), questionId: null, manualQuestion: typedQuestion, runId: null, gapId: null });
    const [draftPage] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-geo-to-draft]").click()]);
    await expect(draftPage.locator('[data-intake-phase="loaded"]')).toBeVisible();
    await expect(draftPage.locator('[data-geo-evidence-status="structure_only"]')).toHaveText(messages(locale).contentDraft.intake.geoStructureOnly);
    await expect(draftPage.locator("[data-brief-writable]")).toHaveCount(0);
    await expect(draftPage.locator("[data-brief-fingerprint]")).toHaveText(typedBrief.run.fingerprint);

    // Historical v1.1 omitted missing_facts for an empty table. Its exact
    // fingerprint and readiness remain unchanged through import and generation.
    const historical: GeoContentBrief = structuredClone(typedBrief);
    historical.draft_readiness.gaps = [];
    historical.run.fingerprint = await geoFingerprint(historical);
    const originalHistorical = JSON.stringify(historical);
    expect((await parseGeoContentBrief(historical)).ok).toBe(true);
    await draftPage.locator("[data-replace-brief]").click();
    await draftPage.locator("[data-paste-brief]").fill(originalHistorical);
    await draftPage.locator("[data-load-brief]").click();
    await expect(draftPage.locator('[data-geo-evidence-status="structure_only"]')).toBeVisible();
    await expect(draftPage.locator("[data-brief-fingerprint]")).toHaveText(historical.run.fingerprint);
    await expect(draftPage.locator("[data-brief-writable]")).toHaveCount(0);
    await draftPage.locator("[data-run-draft]").click();
    await expect(draftPage.locator("[data-content-draft-result]")).toBeVisible();
    expect(guard.drafts).toEqual([historical]);
    expect(JSON.stringify(guard.drafts[0])).toBe(originalHistorical);
    expect(guard.authorityChecks).toEqual([{ userId: GEO_CHAIN_USER, snapshotId: fixture.frozen.snapshotId, accepted: true }]);
    await expect(draftPage.locator('[data-sentence][data-claim="gap"]')).toHaveCount(1);
    await expect(draftPage.locator('[data-sentence][data-claim="bound"]')).toHaveCount(0);
    const [draftDownload] = await Promise.all([draftPage.waitForEvent("download"), draftPage.locator("[data-export-json]").click()]);
    expect((await parseDraftResult(JSON.parse(await downloadedText(draftDownload)), historical)).ok).toBe(true);
    await isolationEvidence(fixture, guard);
  });

  test(`${locale}: exact context outage remains unavailable and retry never invents zero facts`, async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Local base URL required");
    const fixture = createGeoBriefQualityFixture("context_outage");
    expect(fixture.frozen.payload.facts.length).toBeGreaterThan(0);
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const copy = messages(locale).geoBrief;
    await openInput(page, locale);
    const storeError = page.locator("[data-geo-workspace]").getByRole("alert").filter({ hasText: copy.errors.store_unavailable });
    await expect(storeError).toHaveText(copy.errors.store_unavailable);
    await expect(page.locator("[data-geo-input-evidence]")).toHaveCount(0);
    await expect(page.locator("[data-run-geo-brief]")).toBeDisabled();
    await expect(page.getByText(copy.quality.inputFacts.replace("{count}", "0"), { exact: true })).toHaveCount(0);
    expect(loads(guard)).toEqual([{}, selector(fixture)]);
    await page.getByRole("button", { name: copy.quality.retryRead, exact: true }).click();
    await expect(storeError).toHaveText(copy.errors.store_unavailable);
    expect(loads(guard)).toEqual([{}, selector(fixture), selector(fixture)]);
    expect(runs(guard)).toEqual([]);
    expect(fixture.assemblyCalls).toBe(0);
    await isolationEvidence(fixture, guard);
  });
}
