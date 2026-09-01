// LOCAL ONLY: actual knowledge/Brief handlers and browser controls, synthetic
// owner-bound storage, offline model response. Not login or production proof.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { geoFingerprint, parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { GEO_CONTENT_BRIEF_SCHEMA } from "@sf/public-tools/content-brief/geo-contract";
import { sharedGeoBriefJson } from "../src/lib/geo-tools/brief-shared-export.ts";
import { GEO_GAP_HANDOFF_KEY, writeGeoGapHandoff } from "../src/lib/geo-tools/gap-handoff.ts";
import { GEO_BRIEF_RETURN_KEY, GEO_KNOWLEDGE_REPAIR_KEY } from "../src/lib/geo-tools/brief-knowledge-handoff.ts";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { installGeoChainGuard, type GeoChainGuard } from "./geo-chain-harness.ts";
import { CLEAN_QUESTION, MIXED_QUESTION } from "./geo-brief-quality-fixtures.ts";
import { createGeoBriefRepairFixture, REPAIRED_SNAPSHOT, REPAIR_FACT } from "./geo-brief-repair-fixtures.ts";
import { GEO_CHAIN_RUN } from "./geo-chain-fixtures.ts";

type Locale = "en" | "zh";
type RepairFixture = ReturnType<typeof createGeoBriefRepairFixture>;
const messages = (locale: Locale) => locale === "en" ? en : zh;
const bodies = (guard: GeoChainGuard, path: string) => guard.requests.filter(request => request.id === `POST /api/tools/${path}`).map(request => request.body);
const exactSelector = (state: RepairFixture, snapshotId = state.original.snapshotId) => ({ schema: GEO_CONTENT_BRIEF_SCHEMA, kbId: state.original.kbId, snapshotId });
let previousKey: string | undefined;
let browserBuildId = "";

test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  expect(["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "GEO_BRIEF_API_KEY",
    "CONTENT_DRAFT_API_KEY", "KEYWORD_LLM_API_KEY", "CITABILITY_RENDERER_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]
    .filter(name => process.env[name] !== undefined)).toEqual([]);
  previousKey = process.env["TOKEN_ENCRYPTION_KEY"];
  process.env["TOKEN_ENCRYPTION_KEY"] = "cd".repeat(32);
  browserBuildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  if (previousKey === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"];
  else process.env["TOKEN_ENCRYPTION_KEY"] = previousKey;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(browserBuildId);
});

async function openOldBrief(page: Page, locale: Locale, state: RepairFixture, guard: GeoChainGuard) {
  await page.goto(`/${locale}/tools/geo-brief`);
  await page.getByRole("button", { name: messages(locale).cookie.necessaryOnly, exact: true }).click();
  await page.locator("[data-load-geo-brief]").click();
  await expect(page.locator("#geo-brief-question option:checked")).toHaveText(MIXED_QUESTION);
  await expect(page.locator("[data-run-geo-brief]")).toBeDisabled();
  const notice = page.locator("[data-geo-workspace] aside").first();
  await expect(notice).toContainText(messages(locale).tools.geoBrief.artifact.noticeBody);
  expect(await notice.innerText()).not.toMatch(/\b[A-D]\b|A\s*\/\s*B\s*\/\s*C\s*\/\s*D/);
  expect(bodies(guard, "geo-brief/load")).toEqual([{}, exactSelector(state)]);
}

async function openRepair(page: Page, reason: "question" | "facts") {
  const link = page.locator(`[data-geo-knowledge-repair="${reason}"]`).first();
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "opener");
  await expect(link).toHaveAttribute("href", /\/tools\/geo-knowledge-base\?repair=brief$/);
  const [editor] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  await editor.waitForURL(/\/tools\/geo-knowledge-base\?repair=brief$/);
  return editor;
}

async function screenshot(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const path = test.info().outputPath(`${label}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(label, { path, contentType: "image/png" });
}

async function evidence(state: RepairFixture, guard: GeoChainGuard) {
  expect(guard.unexpected).toEqual([]);
  expect(state.fixture.providerCalls).toBe(0);
  expect(state.operations.urlLoads).toBe(0);
  expect(state.operations.imports).toBe(0);
  expect(state.operations.runEvidenceReads).toBe(0);
  await test.info().attach("offline-repair-evidence.json", { body: JSON.stringify({
    scope: "local build, real handlers, synthetic owner/CAS store, offline model; not production or login proof",
    browserBuildId, originalSnapshot: state.original.snapshotId, snapshot: state.fixture.frozen.snapshotId,
    payloadHash: state.fixture.frozen.contentHash, questionSetHash: state.fixture.frozen.questionSetHash,
    operations: state.operations, requests: guard.requests, offlineAssemblyCalls: state.fixture.assemblyCalls,
    providerCalls: state.fixture.providerCalls, ssrAuthFixtures: guard.ssrAuthFixtures,
    blockedExternal: guard.blockedExternal, unexpected: guard.unexpected,
  }, null, 2), contentType: "application/json" });
}

for (const locale of ["en", "zh"] as const) {
  test(`${locale}: repair the existing knowledge, explicitly freeze and return to generate from the new snapshot`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Local base URL required");
    await page.setViewportSize(locale === "zh" ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const state = createGeoBriefRepairFixture();
    const originalBytes = JSON.stringify(state.original);
    const guard = await installGeoChainGuard(page.context(), baseURL, state.fixture);
    const copy = messages(locale).tools;
    await openOldBrief(page, locale, state, guard);
    const manualQuestion = locale === "zh" ? "How can beginners compare astrology tools?" : null;
    if (manualQuestion !== null) {
      await page.locator("#geo-brief-question").selectOption("");
      await page.locator("#geo-brief-manual").fill(manualQuestion);
    }

    // A stale old-run pointer can coexist in tab storage. Returning from
    // repair must discard it, never relink observations from the old snapshot.
    const storage = new Map<string, string>();
    expect(writeGeoGapHandoff({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }, {
      destination: "geo-brief", runId: GEO_CHAIN_RUN, kbId: state.original.kbId, snapshotId: state.original.snapshotId,
      questionId: state.fixture.question.id, gapId: `gap-${state.fixture.question.id}`, pageUrl: null, questionText: null,
    })).toBe(true);
    await page.evaluate(([key, value]) => sessionStorage.setItem(key!, value!), [GEO_GAP_HANDOFF_KEY, storage.get(GEO_GAP_HANDOFF_KEY)!]);
    const editor = await openRepair(page, manualQuestion === null ? "question" : "facts");
    await expect(editor.locator("section").filter({ has: editor.locator("#kb-repair-category") }).getByLabel(copy.geoKnowledgeBase.asset.matchingOverride, { exact: true })).toHaveValue("AstrologyWiki");
    await expect(editor.locator("[data-geo-knowledge-repair]")).toContainText(state.fixture.website.host);
    await expect(editor.locator("[data-geo-knowledge-repair]")).toContainText(manualQuestion ?? MIXED_QUESTION);
    await expect(editor.locator("#kb-site-url")).toHaveCount(0);
    expect(bodies(guard, "geo-knowledge-base/load")).toEqual([{ kbId: state.original.kbId }]);
    expect(bodies(guard, "geo-knowledge-base/draft")).toEqual([]);
    expect(bodies(guard, "geo-knowledge-base/freeze")).toEqual([]);
    expect(bodies(guard, "geo-brief/run")).toEqual([]);
    const returnLink = editor.locator("[data-geo-brief-return]");
    await expect(returnLink).toHaveAttribute("aria-disabled", "true");
    expect(await editor.evaluate(key => sessionStorage.getItem(key), GEO_KNOWLEDGE_REPAIR_KEY)).toBeNull();

    const categoryInput = editor.getByLabel(copy.geoKnowledgeBase.repair.primaryCategory, { exact: true });
    await categoryInput.fill("astrology");
    await editor.getByRole("button", { name: copy.geoKnowledgeBase.facts.add, exact: true }).click();
    await editor.getByLabel(copy.geoKnowledgeBase.facts.keyLabel, { exact: true }).fill(REPAIR_FACT.key);
    await editor.getByLabel(copy.geoKnowledgeBase.facts.valueLabel, { exact: true }).fill(REPAIR_FACT.value);
    await editor.getByLabel(copy.geoKnowledgeBase.facts.sourceLabel, { exact: true }).fill(REPAIR_FACT.sourceUrl);
    await editor.getByLabel(copy.geoKnowledgeBase.facts.observedLabel, { exact: true }).fill(REPAIR_FACT.observedAt);
    await expect(returnLink).toHaveAttribute("aria-disabled", "true");
    await expect(returnLink).not.toHaveAttribute("href");
    await expect(editor.getByRole("button", { name: copy.geoKnowledgeBase.freeze.action, exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: copy.geoKnowledgeBase.draft.save, exact: true }).click();
    await expect(editor.getByRole("button", { name: copy.geoKnowledgeBase.freeze.action, exact: true })).toBeEnabled();
    await expect(returnLink).toHaveAttribute("aria-disabled", "true");
    expect(state.operations.saves).toBe(1);
    expect(state.fixture.payload.categoryTerms).toEqual(["astrology", ...state.original.payload.categoryTerms.slice(1)]);
    expect(state.fixture.payload.facts).toEqual([REPAIR_FACT]);
    expect(state.fixture.frozen.snapshotId).toBe(state.original.snapshotId);

    await editor.getByRole("button", { name: copy.geoKnowledgeBase.freeze.action, exact: true }).click();
    await expect(returnLink).toHaveAttribute("aria-disabled", "false");
    expect(state.operations.freezes).toBe(1);
    expect(state.fixture.frozen.snapshotId).toBe(REPAIRED_SNAPSHOT);
    expect(state.fixture.frozen.contentHash).not.toBe(state.original.contentHash);
    expect(state.fixture.frozen.questionSetHash).not.toBe(state.original.questionSetHash);
    expect(JSON.stringify(state.original)).toBe(originalBytes);
    expect(bodies(guard, "geo-brief/run")).toEqual([]);
    await screenshot(editor, `${locale}-knowledge-repaired-and-frozen`);
    await Promise.all([editor.waitForURL(/\/tools\/geo-brief\?resume=knowledge$/), returnLink.click()]);
    await expect(editor.getByRole("status").filter({ hasText: copy.geoBrief.quality.returnReady.replace("{revision}", "2") })).toBeVisible();
    await expect(editor.locator("[data-geo-input-evidence]")).toContainText(copy.geoBrief.quality.inputFacts.replace("{count}", "1"));
    await expect(editor.locator("[data-geo-input-evidence]")).toContainText(copy.geoBrief.quality.inputNoRun);
    await expect(editor.locator("#geo-brief-question")).toHaveValue(manualQuestion === null ? state.fixture.question.id : "");
    if (manualQuestion === null) await expect(editor.locator("#geo-brief-question option:checked")).toHaveText(CLEAN_QUESTION);
    else await expect(editor.locator("#geo-brief-manual")).toHaveValue(manualQuestion);
    expect(bodies(guard, "geo-brief/load")).toEqual([{}, exactSelector(state), exactSelector(state, REPAIRED_SNAPSHOT)]);
    expect(await editor.evaluate(keys => keys.map(key => sessionStorage.getItem(key)), [GEO_BRIEF_RETURN_KEY, GEO_GAP_HANDOFF_KEY])).toEqual([null, null]);
    expect(state.fixture.assemblyCalls).toBe(0);
    expect(bodies(guard, "geo-brief/run")).toEqual([]);
    await expect(editor.locator("[data-run-geo-brief]")).toBeEnabled();
    await editor.locator("[data-run-geo-brief]").click();
    await expect(editor.locator("[data-shared-geo-result]")).toBeVisible();
    await expect(editor.locator('[data-brief-section="fact_table"]')).toContainText(REPAIR_FACT.value);
    expect(bodies(guard, "geo-brief/run")).toEqual([{ ...exactSelector(state, REPAIRED_SNAPSHOT),
      questionId: manualQuestion === null ? state.fixture.question.id : null, manualQuestion, runId: null, gapId: null }]);
    expect(state.fixture.assemblyCalls).toBe(1);
    const brief = guard.briefs[0]!;
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
    expect(brief.run.fingerprint).toBe(await geoFingerprint(brief));
    expect(brief.geo_origin.kb_ref.snapshot_id).toBe(REPAIRED_SNAPSHOT);
    expect(brief.geo_origin.question.text).toBe(manualQuestion ?? CLEAN_QUESTION);
    expect(brief.geo_origin.run_ref).toBeNull();
    expect(brief.evidence.samples).toEqual([]);
    expect(brief.evidence.facts).toEqual([expect.objectContaining({ source: "kb", text: REPAIR_FACT.value, url: REPAIR_FACT.sourceUrl, observed_at: REPAIR_FACT.observedAt })]);
    expect(brief.draft_readiness.gaps).not.toContain("missing_facts");
    const [download] = await Promise.all([editor.waitForEvent("download"), editor.getByRole("button", { name: copy.geoBrief.actions.downloadJson, exact: true }).click()]);
    const path = await download.path();
    if (!path) throw new Error("Local Brief export missing");
    expect(await readFile(path, "utf8")).toBe(sharedGeoBriefJson(brief));
    await test.info().attach("repaired-brief.json", { path, contentType: "application/json" });
    await screenshot(editor, `${locale}-repaired-brief-result`);
    await evidence(state, guard);
  });
}

test("repair read failure retries the same existing knowledge without offering a create form", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Local base URL required");
  const state = createGeoBriefRepairFixture({ failFirstRead: true });
  const guard = await installGeoChainGuard(page.context(), baseURL, state.fixture);
  await openOldBrief(page, "en", state, guard);
  const editor = await openRepair(page, "question");
  await expect(editor.locator("[data-geo-knowledge-repair]")).toContainText(en.tools.geoKnowledgeBase.repair.loadError);
  await expect(editor.locator("#kb-site-url")).toHaveCount(0);
  expect(bodies(guard, "geo-knowledge-base/load")).toEqual([{ kbId: state.original.kbId }]);
  await editor.getByRole("button", { name: en.tools.geoKnowledgeBase.repair.retry, exact: true }).click();
  await expect(editor.locator("section").filter({ has: editor.locator("#kb-repair-category") }).getByLabel(en.tools.geoKnowledgeBase.asset.matchingOverride, { exact: true })).toHaveValue("AstrologyWiki");
  await expect(editor.locator("#kb-site-url")).toHaveCount(0);
  expect(bodies(guard, "geo-knowledge-base/load")).toEqual([{ kbId: state.original.kbId }, { kbId: state.original.kbId }]);
  expect(state.operations).toEqual({ existingReads: 2, urlLoads: 0, saves: 0, freezes: 0, imports: 0, runEvidenceReads: 0 });
  expect(bodies(guard, "geo-brief/run")).toEqual([]);
  expect(state.fixture.assemblyCalls).toBe(0);
  await evidence(state, guard);
});
