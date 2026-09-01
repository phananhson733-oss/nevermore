// LOCAL ONLY: SSR auth is fixture-injected for Visibility and Draft; this is not
// a real-login canary. The normal env-i server plus context-wide API/external
// guard ensures every provider/store operation below is an offline dependency.
// Run the runner under env -i too; only PATH, NODE_OPTIONS=--import=tsx and the
// dedicated MARKETING_E2E_PORT belong in its environment.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { parseDraftResult } from "@sf/public-tools/content-brief/parse-draft";
import type { GeoContentBrief } from "@sf/public-tools/content-brief/geo-contract";
import type { DraftResult } from "@sf/public-tools/content-brief/contract";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { createGeoChainFixture, GEO_CHAIN_ORIGIN, GEO_CHAIN_USER, type GeoChainFixture } from "./geo-chain-fixtures.ts";
import { installGeoChainGuard, type GeoChainGuard } from "./geo-chain-harness.ts";

type Locale = "en" | "zh";
const copy = (locale: Locale) => locale === "en" ? en.tools : zh.tools;
const apiCount = (guard: GeoChainGuard, path: string) => guard.requests.filter(request => request.id === `POST /api/tools/${path}`).length;
const fixtureKey = "cd".repeat(32);
let previousKey: string | undefined;
let browserBuildId = "";
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  // Report names only if misconfigured: never print a credential's value.
  const configured = ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY",
    "GEO_BRIEF_API_KEY", "CONTENT_DRAFT_API_KEY", "KEYWORD_LLM_API_KEY", "CITABILITY_RENDERER_TOKEN",
    "SUPABASE_SERVICE_ROLE_KEY"].filter(name => process.env[name] !== undefined);
  expect(configured).toEqual([]);
  previousKey = process.env["TOKEN_ENCRYPTION_KEY"]; process.env["TOKEN_ENCRYPTION_KEY"] = fixtureKey;
  browserBuildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim(); });
test.afterAll(async () => { if (previousKey === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"]; else process.env["TOKEN_ENCRYPTION_KEY"] = previousKey;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(browserBuildId); });

async function attachText(name: string, body: string, contentType: string): Promise<void> {
  const path = test.info().outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
  await test.info().attach(name, { path, contentType });
}

async function bytes(download: Download): Promise<string> {
  const path = await download.path();
  if (path === null) throw new Error("Isolated browser download has no path");
  const content = await readFile(path, "utf8");
  await test.info().attach(download.suggestedFilename(), { path,
    contentType: download.suggestedFilename().endsWith(".json") ? "application/json" : "text/markdown" });
  return content;
}

async function isolationEvidence(fixture: GeoChainFixture, guard: GeoChainGuard): Promise<void> {
  expect(guard.unexpected).toEqual([]);
  await attachText("offline-chain-evidence.json", JSON.stringify({
    scope: "local isolated UI and injected handler/provider/store fixtures; not production or real-login evidence",
    browserBuildId,
    gap: fixture.kind, authFixturePages: guard.ssrAuthFixtures, immutableSnapshot: fixture.frozen.snapshotId,
    immutableQuestionSet: fixture.frozen.questionSetHash, plannedProviderSlots: fixture.frozen.questionCount * 6,
    offlineProviderCalls: fixture.providerCalls, offlineAssemblyCalls: fixture.assemblyCalls,
    draftAuthorityVerifier: "verifyOwnedGeoBrief", draftAuthorityChecks: guard.authorityChecks,
    apiRequests: guard.requests.map(request => request.id), externalRequestsAborted: guard.blockedExternal,
    unexpected: guard.unexpected,
  }, null, 2), "application/json");
}

async function freezeAndRun(page: Page, locale: Locale, fixture: GeoChainFixture, guard: GeoChainGuard) {
  const messages = copy(locale);
  await page.goto(`/${locale}/account/websites/${fixture.website.websiteId}/geo`);
  await expect(page).toHaveURL(new RegExp(`/account/websites/${fixture.website.websiteId}#geo$`, "u"));
  const geo = page.locator("#geo");
  await expect(geo.getByRole("heading", { name: messages.geoKnowledgeBase.asset.inlineTitle, exact: true })).toBeVisible();
  await expect(geo.locator('[data-geo-profile-field="oneLinePositioning"] input, [data-geo-profile-field="oneLinePositioning"] textarea')).toHaveValue("Analytics for teams");
  await expect(geo.getByText(fixture.profile.reference.profileHash, { exact: false })).toBeVisible();
  expect(fixture.providerCalls).toBe(0);
  const freeze = page.getByRole("button", { name: messages.geoKnowledgeBase.freeze.action, exact: true });
  await expect(freeze).toBeEnabled();
  await freeze.click();
  await expect(page.getByText(fixture.frozen.questionSetHash, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: messages.geoKnowledgeBase.freeze.preview, exact: true }).click();
  await expect(page.getByText(fixture.question.text, { exact: true })).toBeVisible();
  const freezeCall = guard.requests.find(request => request.id === "POST /api/tools/geo-knowledge-base/freeze");
  expect(freezeCall?.body).toEqual({ kbId: fixture.frozen.kbId, baseVersion: 1, contextHash: fixture.context.contentHash });

  // Asset→tool navigation is explicit; only the immutable server selection is
  // reused. No test reads or seeds the browser's private handoff storage.
  await page.goto(`/${locale}/tools/ai-visibility-check`);
  await expect(page.locator("#visibility-version")).toBeVisible();
  await expect(page.locator("#visibility-version")).toHaveValue(fixture.frozen.snapshotId);
  await page.locator("#visibility-samples").selectOption("3");
  await page.getByRole("checkbox", { name: "Perplexity", exact: true }).check();
  expect(apiCount(guard, "ai-visibility-check/run")).toBe(0);
  expect(fixture.providerCalls).toBe(0);
  await page.getByRole("button", { name: messages.aiVisibility.form.start, exact: true }).click();
  await expect(page.getByRole("heading", { name: messages.aiVisibility.gaps.title, exact: true })).toBeVisible();
  expect(fixture.providerCalls).toBe(fixture.frozen.questionCount * 3 * 2);
  expect(apiCount(guard, "ai-visibility-check/run")).toBe(1);
  expect(apiCount(guard, "ai-visibility-check/run/status")).toBe(1);
  expect(guard.requests.find(request => request.id === "POST /api/tools/ai-visibility-check/run")?.body).toEqual({
    kbId: fixture.frozen.kbId, snapshotId: fixture.frozen.snapshotId, samplesPerQuestion: 3, engines: ["chatgpt", "perplexity"],
  });
  expect(guard.ssrAuthFixtures).toHaveLength(1);
  expect(guard.unexpected).toEqual([]);
  return page.locator("article").filter({ has: page.getByRole("heading", { name: fixture.question.text, exact: true }) });
}

test.describe("isolated GEO asset → shared content chain", () => {
  for (const [kind, locale] of [["A", "en"], ["D", "zh"]] as const) {
    test(`${locale}: frozen ${kind} evidence travels through Brief, the same Draft, and T2`, async ({ page, baseURL }) => {
      test.setTimeout(90_000);
      if (!baseURL) throw new Error("Local base URL required");
      const fixture = createGeoChainFixture(kind);
      const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
      const messages = copy(locale);
      const card = await freezeAndRun(page, locale, fixture, guard);

      if (kind === "D") {
        const consent = page.getByRole("region", { name: "Cookie consent", exact: true });
        if (await consent.isVisible()) {
          await consent.getByRole("button", { name: /^(Necessary only|仅必要)$/iu }).click();
          await expect(consent).toHaveCount(0);
        }
        const gapSummary = page.locator("[data-gap-summary]");
        await expect(gapSummary.locator("[data-gap-kind]")).toHaveCount(5);
        for (const gapKind of ["A", "B", "C", "D", "unattributed"] as const) {
          await expect(gapSummary.locator(`[data-gap-kind="${gapKind}"] dd`)).toHaveText(String(fixture.report!.gaps.filter(gap => gap.kind === gapKind).length));
        }
        const references = page.locator("[data-gap-references]");
        await expect(references).not.toHaveAttribute("open", "");
        const summaryPath = test.info().outputPath("gap-counts-zh.png");
        await gapSummary.screenshot({ path: summaryPath });
        await test.info().attach("gap-counts-zh.png", { path: summaryPath, contentType: "image/png" });
        await references.locator(":scope > summary").click();
        const referencePages = fixture.report!.siteEvidence!.references;
        await expect(references.locator("tbody tr")).toHaveCount(referencePages.length);
        for (const reference of referencePages) {
          const row = references.locator(`[data-reference-id="${reference.id}"]`);
          await expect(row).toBeVisible();
          await expect(row.locator("a").first()).toHaveAttribute("href", reference.url);
          await expect(row).toContainText(messages.aiVisibility.gaps.pageType[reference.pageType]);
          await expect(row).toContainText(messages.aiVisibility.gaps.presence[reference.ownPresence === null ? "unknown" : reference.ownPresence ? "present" : "absent"]);
          await expect(row).toContainText(new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(reference.fetchedAt)) + " UTC");
        }
        const referencesPath = test.info().outputPath("read-reference-pages-zh.png");
        await references.screenshot({ path: referencesPath });
        await test.info().attach("read-reference-pages-zh.png", { path: referencesPath, contentType: "image/png" });
      }

      const [runDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.aiVisibility.v2.exportJson, exact: true }).click()]);
      const imported = parseVisibilityImport(await bytes(runDownload));
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error("Actual run export failed strict parser");
      expect(imported.report.manifest.questionSetHash).toBe(fixture.frozen.questionSetHash);
      expect(imported.report.manifest.calls).toBe(fixture.providerCalls);
      expect(imported.report.manifest.engines.map(engine => engine.engine)).toEqual(["chatgpt", "perplexity"]);
      const [runMarkdown] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.aiVisibility.v2.exportMarkdown, exact: true }).click()]);
      const runMd = await bytes(runMarkdown);
      expect(runMd).toContain(fixture.frozen.questionSetHash);
      expect(runMd).toContain(fixture.frozen.snapshotId);

      await card.getByRole("link", { name: messages.aiVisibility.gaps.actions.brief, exact: true }).click();
      await expect(page.locator("[data-run-geo-brief]")).toBeVisible();
      expect(apiCount(guard, "geo-brief/run")).toBe(0);
      await page.locator("[data-run-geo-brief]").click();
      await expect(page.locator("[data-shared-geo-result]")).toBeVisible();
      expect(fixture.assemblyCalls).toBe(1);
      expect(fixture.providerCalls).toBe(fixture.frozen.questionCount * 6);
      const selection = guard.requests.find(request => request.id === "POST /api/tools/geo-brief/run")?.body;
      expect(selection).toEqual({ schema: "gengrowth.content_brief/v1.1", kbId: fixture.frozen.kbId,
        snapshotId: fixture.frozen.snapshotId, questionId: fixture.question.id, manualQuestion: null,
        runId: fixture.report!.manifest.runId, gapId: `gap-${fixture.question.id}` });
      const [briefDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.geoBrief.actions.downloadJson, exact: true }).click()]);
      const exportedBrief = JSON.parse(await bytes(briefDownload)) as GeoContentBrief;
      expect((await parseGeoContentBrief(exportedBrief)).ok).toBe(true);
      expect(exportedBrief.geo_origin.kb_ref.snapshot_id).toBe(fixture.frozen.snapshotId);
      expect(exportedBrief.geo_origin.promptset_ref.hash).toBe(fixture.frozen.questionSetHash);
      expect(exportedBrief.geo_origin.gap).toBe(kind);
      expect(exportedBrief.evidence.samples).toHaveLength(6);
      const [briefMdDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: messages.geoBrief.actions.downloadMarkdown, exact: true }).click()]);
      const briefMd = await bytes(briefMdDownload);
      expect(briefMd).toContain(fixture.frozen.questionSetHash);
      expect(briefMd).toContain(exportedBrief.evidence.facts[0]!.observed_at);

      const [draftPage] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-geo-to-draft]").click()]);
      await expect(draftPage.locator('[data-intake-phase="loaded"]')).toBeVisible();
      await expect(draftPage.locator("[data-brief-keyword]")).toHaveText(fixture.question.text);
      expect(apiCount(guard, "content-draft/run")).toBe(0);
      await draftPage.locator("[data-run-draft]").click();
      await expect(draftPage.locator("[data-content-draft-result]")).toBeVisible();
      expect(guard.drafts).toEqual([exportedBrief]);
      expect(guard.authorityChecks).toEqual([{ userId: GEO_CHAIN_USER, snapshotId: fixture.frozen.snapshotId, accepted: true }]);
      await expect(draftPage.locator('[data-sentence-sources="kb"]').first()).toBeVisible();
      const [draftDownload] = await Promise.all([draftPage.waitForEvent("download"), draftPage.locator("[data-export-json]").click()]);
      const exportedDraft = JSON.parse(await bytes(draftDownload)) as DraftResult;
      expect((await parseDraftResult(exportedDraft, exportedBrief)).ok).toBe(true);
      expect(JSON.stringify(exportedDraft)).toContain(fixture.frozen.questionSetHash);
      await draftPage.locator("[data-copy-markdown]").click();
      await expect.poll(() => guard.clipboard.length).toBe(1);
      expect(guard.clipboard[0]).toContain(fixture.frozen.questionSetHash);
      expect(guard.clipboard[0]).toContain(exportedBrief.evidence.facts[0]!.observed_at);
      await attachText("draft-copy.md", guard.clipboard[0]!, "text/markdown");

      await draftPage.locator("#content-draft-published-url").fill(`${GEO_CHAIN_ORIGIN}/`);
      const [t2Page] = await Promise.all([draftPage.waitForEvent("popup"), draftPage.locator("[data-open-on-page]").click()]);
      await expect(t2Page.locator("#citability-url")).toHaveValue(`${GEO_CHAIN_ORIGIN}/`);
      await expect(t2Page.locator("#citability-question")).toHaveValue(fixture.question.text);
      expect(apiCount(guard, "page-citability-check")).toBe(0);
      await t2Page.locator('section[aria-labelledby="citability-form"]').getByRole("button", { name: messages.pageCitability.actions.run, exact: true }).click();
      await expect(t2Page.locator("#citability-result")).toBeVisible();
      expect(guard.requests.find(request => request.id === "POST /api/tools/page-citability-check")?.body).toEqual({ url: `${GEO_CHAIN_ORIGIN}/`, question: fixture.question.text });
      expect(apiCount(guard, "page-citability-check")).toBe(1);
      await isolationEvidence(fixture, guard);
    });
  }

  test("en: B goes directly to T2 without any automatic request", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Local base URL required");
    const fixture = createGeoChainFixture("B");
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const card = await freezeAndRun(page, "en", fixture, guard);
    await expect(card.locator('a[href$="/tools/geo-brief"]')).toHaveCount(0);
    await card.getByRole("link", { name: en.tools.aiVisibility.gaps.actions.citability, exact: true }).click();
    await expect(page.locator("#citability-url")).toHaveValue(`${GEO_CHAIN_ORIGIN}/`);
    await expect(page.locator("#citability-question")).toHaveValue(fixture.question.text);
    expect(apiCount(guard, "page-citability-check")).toBe(0);
    expect(apiCount(guard, "geo-brief/run")).toBe(0);
    await isolationEvidence(fixture, guard);
  });

  test("zh: C exports evidence-backed third-party work and exposes no content-generation action", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Local base URL required");
    const fixture = createGeoChainFixture("C");
    const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
    const card = await freezeAndRun(page, "zh", fixture, guard);
    await expect(card.locator("a")).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: zh.tools.aiVisibility.gaps.actions.thirdParty, exact: true }).click()]);
    const markdown = await bytes(download);
    expect(markdown).toContain("https://publisher.test/best-tools");
    expect(markdown).toContain(fixture.question.text);
    expect(markdown).toContain(fixture.frozen.questionSetHash);
    expect(apiCount(guard, "geo-brief/run")).toBe(0);
    expect(apiCount(guard, "content-draft/run")).toBe(0);
    expect(apiCount(guard, "page-citability-check")).toBe(0);
    expect(fixture.assemblyCalls).toBe(0);
    await isolationEvidence(fixture, guard);
  });
});
