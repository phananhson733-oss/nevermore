// OFFLINE E2E: current one-click V2 UI over real handlers, parsers,
// preparation and store adapters; account/provider/SQL transports are sealed
// in-memory fixtures, so this is browser evidence rather than production E2E.
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { parseAnyGeoPreparedCandidate, type GeoPreparedCandidateV2 } from "../src/lib/geo-tools/kb-prepared-contract.ts";
import { parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { countGeoCitationQuestions } from "../src/lib/geo-tools/kb-consumer-projection.ts";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { parseDraftResult } from "@sf/public-tools/content-brief/parse-draft";
import { createGeoKbV2Fixture, type GeoKbV2Fixture } from "./geo-kb-v2-fixtures.ts";
import { installGeoKbV2Guard, type GeoKbV2Guard } from "./geo-kb-v2-harness.ts";

let buildId = "";
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  // Inspect names only, never developer/provider credential values.
  expect(Object.keys(process.env).filter(name => /^(DATAFORSEO_|OPENAI_|AZURE_OPENAI_|GEO_BRIEF_|SUPABASE_SERVICE_ROLE_KEY$|DATABASE_URL$|TOKEN_ENCRYPTION_KEY$)/u.test(name))).toEqual([]);
  process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId);
});

async function open(page: Page, fixture: GeoKbV2Fixture, locale: "en" | "zh" = "en") {
  await page.goto(`/${locale}/account/websites/${fixture.website.websiteId}/geo`);
  await expect(page).toHaveURL(new RegExp(`/account/websites/${fixture.website.websiteId}#geo$`, "u"));
  const editor = page.locator("[data-geo-kb-v2]");
  await expect(editor).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  return editor;
}

async function downloaded(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error("Missing local download");
  await test.info().attach(download.suggestedFilename(), { path, contentType: "application/json" });
  return readFile(path, "utf8");
}

function v2Candidate(fixture: GeoKbV2Fixture): GeoPreparedCandidateV2 {
  const parsed = parseAnyGeoPreparedCandidate(fixture.currentCandidate);
  if (parsed.schemaVersion !== "marketing-geo-prepared-candidate.v2") throw new Error("Expected current knowledge candidate V2");
  return parsed;
}

async function assertCustomerPrivacy(page: Page, fixture: GeoKbV2Fixture, candidate: GeoPreparedCandidateV2) {
  const frozen = fixture.currentFrozen;
  if (frozen === null) throw new Error("Missing frozen knowledge fixture");
  const html = await page.locator("[data-geo-kb-v2]").evaluate(node => node.outerHTML);
  const internal = new Set([
    frozen.snapshotId, frozen.contentHash, frozen.questionSetHash,
    candidate.candidateId, candidate.kbId, candidate.candidateHash, candidate.baseDraftHash, candidate.profileCopyHash,
    candidate.context.candidateId, candidate.context.contentHash, candidate.context.payloadHash, candidate.context.questionSetHash,
    candidate.knowledgeGeneration.generationId, candidate.knowledgeGeneration.inputHash, candidate.knowledgeGeneration.synthesisInputHash,
    candidate.knowledgeGeneration.evidenceContentHash, candidate.knowledgeGeneration.packHash, candidate.knowledgeGeneration.sourceCatalogueHash,
    candidate.knowledgePack.contentHash, candidate.knowledgePack.meta.generatedAt,
    ...candidate.sourceReceiptRefs.flatMap(ref => [ref.receiptId, ref.contentHash]),
    ...candidate.knowledgePack.sourceCatalogue.flatMap(source => [source.id, source.bodyHash]),
    ...candidate.context.evidenceCatalog.map(item => item.id),
    ...candidate.questionSet.entityCatalog.map(item => item.id),
    ...candidate.questionSet.questions.flatMap(question => [question.id, question.templateId, question.provenance.generatorVersion,
      ...question.provenance.evidenceRefs, ...question.provenance.entityRefs]),
  ].filter((value): value is string => typeof value === "string" && value.length >= 8 && value !== "none"));
  for (const value of internal) expect(html).not.toContain(value);
  await expect(page.locator("details[data-frozen-knowledge-base], [data-geo-copy-identity], [data-version-role], [data-version-competitor], [data-evidence-catalog]")).toHaveCount(0);
}

async function attachEvidence(fixture: GeoKbV2Fixture, guard: GeoKbV2Guard) {
  expect(guard.unexpected).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
  expect(guard.consoleErrors).toEqual([]);
  await test.info().attach("v2-offline-evidence.json", { contentType: "application/json", body: JSON.stringify({
    scope: "local browser; real handler/preparer/DTO/store adapters over synthetic in-memory transport; not production SQL/auth/provider evidence",
    buildId, candidateSchema: fixture.currentCandidate?.schemaVersion, stats: fixture.stats,
    visibilityCalls: guard.visibilityCalls, citationTrials: guard.report?.metrics.citation.trials ?? null,
    briefCalls: guard.briefCalls, draftCalls: guard.draftCalls, authorityChecks: guard.authorityChecks,
    authFixturePages: guard.authFixturePages, expectedNetworkDrops: guard.expectedNetworkDrops,
    blockedExternal: guard.blockedExternal, unexpected: guard.unexpected, pageErrors: guard.pageErrors, consoleErrors: guard.consoleErrors,
  }, null, 2) });
}

test("one click freezes current GEO knowledge, hides internal identity, and preserves the Visibility to Draft chain", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture();
  const guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  const editor = await open(page, fixture, "zh");

  await editor.locator("[data-generate-kb]").click();
  await expect.poll(() => fixture.currentFrozen?.snapshotId ?? null).not.toBeNull();
  const candidate = v2Candidate(fixture), frozen = fixture.currentFrozen!;
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 1 });
  expect(fixture.stats.dispatches).toEqual({ roles: 1, knowledge_pack: 1, questions: 1 });
  expect(fixture.stats.structuredOutputRequests.map(request => request.kind)).toEqual(["roles", "knowledge_pack", "questions"]);
  await expect(editor.locator("[data-geo-knowledge-pack]")).toBeVisible();
  await expect(editor.locator("[data-version-question]")).toHaveCount(candidate.questionSet.questions.length);
  expect(await editor.evaluate(root => {
    const pack = root.querySelector("[data-geo-knowledge-pack]");
    const questions = root.querySelector("[data-version-question]")?.closest("section");
    return Boolean(pack && questions && (pack.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(new Set(await editor.locator("[data-question-policy-line]").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize)))).toEqual(new Set(["13px"]));
  await assertCustomerPrivacy(page, fixture, candidate);
  await page.screenshot({ path: testInfo.outputPath("geo-knowledge-pack-desktop-zh.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("geo-knowledge-pack-narrow-zh.png"), fullPage: true, animations: "disabled" });

  await page.reload();
  await expect(page.locator("[data-geo-knowledge-pack]")).toBeVisible();
  await assertCustomerPrivacy(page, fixture, candidate);
  expect(fixture.currentFrozen).toEqual(frozen);
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 1 });

  await page.goto("/en/tools/ai-visibility-check");
  await expect(page.locator("#visibility-version")).toHaveValue(frozen.snapshotId);
  await page.locator("#visibility-samples").selectOption("3");
  await page.getByRole("checkbox", { name: "Perplexity", exact: true }).check();
  await page.getByRole("button", { name: en.tools.aiVisibility.form.start, exact: true }).click();
  await expect(page.getByRole("heading", { name: en.tools.aiVisibility.gaps.title, exact: true })).toBeVisible();
  expect(guard.visibilityCalls).toBe(candidate.questionSet.questions.length * 6);
  expect(guard.report?.metrics.citation.trials).toBe(countGeoCitationQuestions(candidate.questionSet) * 6);
  const [visibilityDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: en.tools.aiVisibility.v2.exportJson, exact: true }).click()]);
  expect(parseVisibilityImport(await downloaded(visibilityDownload)).ok).toBe(true);
  const gap = guard.report!.gaps.find(item => item.kind === "A");
  if (!gap) throw new Error("Real classifier did not derive A");
  const question = guard.report!.questions.find(item => item.questionId === gap.questionId)!;
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: question.text, exact: true }) });
  await card.getByRole("link", { name: en.tools.aiVisibility.gaps.actions.brief, exact: true }).click();
  await page.locator("[data-run-geo-brief]").click();
  await expect(page.locator("[data-shared-geo-result]")).toBeVisible();
  const [briefDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: en.tools.geoBrief.actions.downloadJson, exact: true }).click()]);
  const parsed = await parseGeoContentBrief(JSON.parse(await downloaded(briefDownload)));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Brief invalid");
  expect(parsed.value.geo_origin.promptset_ref.hash).toBe(candidate.context.questionSetHash);
  const [draft] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-geo-to-draft]").click()]);
  await expect(draft.locator('[data-intake-phase="loaded"]')).toBeVisible();
  await draft.locator("[data-run-draft]").click();
  await expect(draft.locator("[data-content-draft-result]")).toBeVisible();
  expect(guard.authorityChecks).toEqual([{ snapshotId: frozen.snapshotId, accepted: true }]);
  expect(guard.draftCalls).toBe(1);
  const [draftDownload] = await Promise.all([draft.waitForEvent("download"), draft.locator("[data-export-json]").click()]);
  expect((await parseDraftResult(JSON.parse(await downloaded(draftDownload)), parsed.value)).ok).toBe(true);
  await attachEvidence(fixture, guard);
});

test("a lost successful knowledge response recovers by its original key without another model call", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture(), guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  const editor = await open(page, fixture);
  guard.dropNextGenerationResponse("knowledge");
  await editor.locator("[data-generate-kb]").click();
  await expect(editor.locator('[data-generation-state="knowledge_pack"]')).toContainText("outcome is unknown");
  const request = guard.requests.find(entry => entry.id.endsWith("/v2/knowledge"))?.body as { idempotencyKey?: string } | undefined;
  expect(request?.idempotencyKey).toBeTruthy();
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 0 });

  await page.reload();
  const recovered = page.locator('[data-generation-state="knowledge_pack"]');
  await expect(recovered).toBeVisible();
  await recovered.getByRole("button", { name: "Check update", exact: true }).click();
  expect(guard.requests.find(entry => entry.id.endsWith("/v2/generation"))?.body).toEqual({ kbId: fixture.kbId, kind: "knowledge_pack", idempotencyKey: request!.idempotencyKey });
  await page.locator("[data-generate-kb]").click();
  await expect.poll(() => fixture.currentFrozen?.snapshotId ?? null).not.toBeNull();
  expect(fixture.stats.dispatches).toEqual({ roles: 1, knowledge_pack: 1, questions: 1 });
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 1 });
  await assertCustomerPrivacy(page, fixture, v2Candidate(fixture));
  await attachEvidence(fixture, guard);
});

test("an uncertain knowledge-provider attempt remains inspectable and is never automatically retried", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture(), guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  fixture.failNextModel("knowledge_pack");
  const editor = await open(page, fixture);
  await editor.locator("[data-generate-kb]").click();
  await expect(editor.locator('[data-generation-state="knowledge_pack"]')).toContainText("outcome is unknown");
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 0 });

  await page.reload();
  const uncertain = page.locator('[data-generation-state="knowledge_pack"]');
  await expect(uncertain).toContainText("outcome is unknown");
  await page.locator("[data-generate-kb]").click();
  expect(fixture.stats.dispatches).toEqual({ roles: 1, knowledge_pack: 1, questions: 0 });
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, knowledge_pack: 1, questions: 0 });
  await uncertain.getByRole("button", { name: "Check update", exact: true }).click();
  await expect(uncertain).toContainText("outcome is unknown");
  expect(guard.requests.filter(entry => entry.id.endsWith("/v2/knowledge"))).toHaveLength(1);
  await attachEvidence(fixture, guard);
});
