// OFFLINE E2E: real V2 handlers, parsers, preparation and store adapters;
// synthetic in-memory RPC/account/provider transport, not real login or SQL.
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { geoKbV2EditorCopy } from "../src/components/tools/geo-kb-v2-editor-copy.ts";
import { geoKbV2Copy } from "../src/components/tools/geo-kb-v2-copy.ts";
import { parseGeoPreparedCandidate, type GeoPreparedCandidateV1 } from "../src/lib/geo-tools/kb-prepared-contract.ts";
import { parseVisibilityImport } from "../src/lib/geo-tools/visibility-export.ts";
import { countGeoCitationQuestions } from "../src/lib/geo-tools/kb-consumer-projection.ts";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import { parseDraftResult } from "@sf/public-tools/content-brief/parse-draft";
import { createGeoKbV2Fixture, type GeoKbV2Fixture } from "./geo-kb-v2-fixtures.ts";
import { installGeoKbV2Guard, type GeoKbV2Guard } from "./geo-kb-v2-harness.ts";

let buildId = "";
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  // Inspect names only, never the values of developer/provider credentials.
  expect(Object.keys(process.env).filter(name => /^(DATAFORSEO_|OPENAI_|AZURE_OPENAI_|GEO_BRIEF_|SUPABASE_SERVICE_ROLE_KEY$|DATABASE_URL$|TOKEN_ENCRYPTION_KEY$)/u.test(name))).toEqual([]);
  process.env.TOKEN_ENCRYPTION_KEY = "cd".repeat(32);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => { delete process.env.TOKEN_ENCRYPTION_KEY; expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId); });

async function open(page: Page, fixture: GeoKbV2Fixture, locale = "en") {
  await page.goto(`/${locale}/account/websites/${fixture.website.websiteId}/geo`);
  await expect(page).toHaveURL(new RegExp(`/account/websites/${fixture.website.websiteId}#geo$`, "u"));
  const editor = page.locator("[data-geo-kb-v2]"); await expect(editor).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  return editor;
}
async function downloaded(download: Download): Promise<string> {
  const path = await download.path(); if (!path) throw new Error("Missing local download");
  await test.info().attach(download.suggestedFilename(), { path, contentType: "application/json" });
  return readFile(path, "utf8");
}
async function evidence(fixture: GeoKbV2Fixture, guard: GeoKbV2Guard) {
  expect(guard.unexpected).toEqual([]); expect(guard.pageErrors).toEqual([]); expect(guard.consoleErrors).toEqual([]);
  await test.info().attach("v2-offline-evidence.json", { contentType: "application/json", body: JSON.stringify({
    scope: "local UI; real handler/preparer/DTO/store adapters over synthetic in-memory transport; not production SQL/auth/provider evidence", buildId,
    candidateId: fixture.currentCandidate?.candidateId, candidateHash: fixture.currentCandidate?.candidateHash, snapshotId: fixture.currentFrozen?.snapshotId,
    competitorEvidence: fixture.currentFrozen?.context.competitorEvidence ?? fixture.currentCandidate?.context.competitorEvidence ?? [],
    stats: fixture.stats, visibilityCalls: guard.visibilityCalls, citationTrials: guard.report?.metrics.citation.trials ?? null,
    briefCalls: guard.briefCalls, draftCalls: guard.draftCalls, draftAuthorityChecks: guard.authorityChecks, authFixturePages: guard.authFixturePages,
    requests: guard.requests.map(request => ({ id: request.id, ...request.id.endsWith("/freeze") || request.id.endsWith("/generation") ? { body: request.body } : {} })),
    expectedNetworkDrops: guard.expectedNetworkDrops, blockedExternal: guard.blockedExternal, unexpected: guard.unexpected, pageErrors: guard.pageErrors, consoleErrors: guard.consoleErrors,
  }, null, 2) });
}

async function versionSourceEvidence(container: Locator, candidate: GeoPreparedCandidateV1, locale: "en" | "zh") {
  const copy = geoKbV2Copy(locale), role = candidate.payload.roles.find(item => item.id === "finance-managers")!;
  const shownRole = container.locator('[data-version-role="finance-managers"]');
  await expect(shownRole.locator("[data-role-source-badge]")).toHaveText([copy.roleEvidence.inference, copy.roleEvidence.basis.profile, copy.roleEvidence.basis.gsc].join(" · "));
  const queries = new Set(candidate.context.evidenceCatalog.filter(item => item.kind === "gsc" && role.source.evidenceRefs.includes(item.id)).map(item => item.text));
  expect(queries.size).toBe(3);
  await expect(shownRole.locator("[data-role-referenced-query-count]")).toHaveText(String(queries.size));
  const lineage = shownRole.locator("[data-role-lineage]"); await expect(lineage).toHaveJSProperty("open", false);
  for (const ref of role.source.evidenceRefs) {
    await expect(lineage.getByText(ref, { exact: true })).toHaveCount(1);
    await expect(lineage.getByText(ref, { exact: true })).not.toBeVisible();
  }
  const failed = candidate.context.competitorEvidence.find(item => item.capture.domain === "missing-rival.example")!;
  expect(failed.capture.status).toBe("unavailable"); expect(failed.capture.reason).toBe("fetch_failed"); expect(failed.capture.observedAt).toBeNull();
  const competitor = container.locator('[data-version-competitor="missing-rival.example"]'), capture = competitor.locator("[data-competitor-capture]");
  await expect(competitor.locator("[data-current-competitor-mapping]")).toContainText(copy.unconfirmed);
  await expect(competitor.locator("[data-sov-eligibility]")).toHaveText(copy.competitorCapture.sovExcluded);
  await expect(capture.locator("[data-competitor-capture-status]")).toHaveText(`${copy.competitorCapture.statuses.unavailable} · ${copy.competitorCapture.reasons.fetch_failed}`);
  await expect(capture.getByRole("link", { name: "https://missing-rival.example/", exact: true })).toHaveAttribute("href", failed.capture.sourceUrl!);
  const field = (label: string) => capture.getByText(label, { exact: true }).locator("..").locator("dd");
  await expect(field(copy.fields.observedAt)).toHaveText(copy.unknown);
  await expect(field(copy.fields.source)).toHaveText(copy.notRecorded);
  await expect(field(copy.competitorCapture.receiptTime)).toHaveText(failed.receiptCreatedAt);
  const receipt = capture.locator("[data-competitor-receipt]"); await expect(receipt).toHaveJSProperty("open", false);
  await receipt.locator("summary").click();
  await expect(receipt.getByText(failed.receiptId, { exact: true })).toBeVisible();
  await expect(receipt.getByText(failed.contentHash, { exact: true })).toBeVisible();
  await expect(receipt.getByText(failed.capture.evidenceId, { exact: true })).toBeVisible();
  await receipt.locator("summary").click();
}

async function prepareViaUi(page: Page, fixture: GeoKbV2Fixture) {
  const editor = await open(page, fixture), t = geoKbV2EditorCopy("en");
  await expect(editor.locator("[data-generate=questions]")).toBeDisabled();
  await editor.locator("[data-refresh-sources]").click();
  await expect(editor.locator('[data-apply-fact="F1"]')).toBeVisible();
  await editor.locator('[data-generate="roles"]').click();
  await expect(editor.locator('[data-adopt-role="finance-managers"]')).toBeVisible();
  await expect(editor.locator("[data-edit-role]")).toHaveCount(0); expect(fixture.payload.roles).toEqual([]);
  await editor.locator('[data-adopt-role="finance-managers"]').click();
  const role = editor.locator('[data-edit-role="finance-managers"]');
  await expect(role.locator("[data-review-state]")).toHaveText("Pending review");
  await expect(role.locator('[data-role-field="alternatives"]')).toHaveValue("spreadsheets");
  await expect(editor.locator("[data-generate=questions]")).toBeDisabled();
  await role.locator('[data-review-role="accepted"]').click();
  await editor.locator('[data-apply-fact="F1"]').click();
  const seats = editor.locator('[data-edit-fact="0"]');
  await expect(seats.locator("[data-review-state]")).toHaveText("Pending review");
  await seats.locator('[data-review-fact="accepted"]').click();
  const unknown = editor.locator('[data-edit-fact="1"]');
  await expect(unknown.locator('[data-fact-field="value"]')).toHaveValue("");
  await unknown.locator('[data-review-fact="accepted"]').click();
  await editor.locator('[data-edit-fact="2"] [data-review-fact="excluded"]').click();
  expect(fixture.payload.facts[0]?.review).toBe("pending");
  await editor.locator("[data-save-v2]").click();
  await expect(editor.getByText(t.saved, { exact: true })).toBeVisible();
  expect(fixture.payload.roles[0]?.review).toBe("accepted"); expect(fixture.payload.facts[0]?.supportRef).not.toBeNull();
  await editor.locator("[data-generate=questions]").click();
  const review = editor.locator("[data-prepared-review]");
  await expect(review.locator("[data-geo-version-content]")).toBeVisible();
  const candidate = parseGeoPreparedCandidate(fixture.currentCandidate);
  await expect(review.getByText(candidate.candidateHash, { exact: false })).toBeVisible();
  await expect(review.locator("[data-version-question]")).toHaveCount(candidate.questionSet.questions.length);
  await expect(review.locator('[data-version-role="finance-managers"]')).toContainText("Finance managers");
  await expect(review.locator('[data-version-role="finance-managers"]')).toContainText("spreadsheets");
  await expect(review.locator('[data-version-fact="Price"] [data-admitted-value]')).toHaveText("Not admitted as positive evidence");
  await expect(review.locator("[data-gsc-query-count]")).toHaveText("3");
  await versionSourceEvidence(review, candidate, "en");
  await expect(review.locator("[data-freeze-prepared]")).toBeDisabled();
  expect(fixture.currentFrozen).toBeNull(); expect(fixture.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  expect(fixture.stats.structuredOutputRequests.map(request => ({ kind: request.kind, type: request.responseFormat.type,
    name: request.responseFormat.json_schema.name, strict: request.responseFormat.json_schema.strict }))).toEqual([
    { kind: "roles", type: "json_schema", name: "geo_kb_roles_v1", strict: true },
    { kind: "questions", type: "json_schema", name: "geo_kb_questions_v2", strict: true },
  ]);
  return candidate;
}

test("V2 first-freeze review survives reload, then its exact evidence reaches Visibility, Brief and the real Draft verifier", async ({ page, baseURL }) => {
  test.setTimeout(120_000); if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture(), guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  const candidate = await prepareViaUi(page, fixture);
  await page.reload();
  const review = page.locator("[data-prepared-review]"); await expect(review.getByText(candidate.candidateHash, { exact: false })).toBeVisible();
  await versionSourceEvidence(review, candidate, "en");
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  await review.locator("[data-confirm-prepared]").check(); await review.locator("[data-freeze-prepared]").click();
  await expect.poll(() => fixture.currentFrozen?.snapshotId).toBeTruthy();
  const frozen = fixture.currentFrozen!;
  expect(guard.requests.find(request => request.id.endsWith("/v2/freeze"))?.body).toEqual({ kbId: fixture.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash });
  await page.reload();
  await page.locator('[data-stage="frozen"]').click(); await expect(page.locator("[data-frozen-v2]")).toContainText(frozen.snapshotId);
  await versionSourceEvidence(page.locator("[data-frozen-v2]"), candidate, "en");
  expect(frozen.context.competitorEvidence).toEqual(candidate.context.competitorEvidence);
  expect(fixture.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  await page.goto("/en/tools/ai-visibility-check"); await expect(page.locator("#visibility-version")).toHaveValue(frozen.snapshotId);
  await page.locator("#visibility-samples").selectOption("3"); await page.getByRole("checkbox", { name: "Perplexity", exact: true }).check();
  await page.getByRole("button", { name: en.tools.aiVisibility.form.start, exact: true }).click();
  await expect(page.getByRole("heading", { name: en.tools.aiVisibility.gaps.title, exact: true })).toBeVisible();
  expect(guard.visibilityCalls).toBe(candidate.questionSet.questions.length * 6);
  expect(guard.report?.metrics.citation.trials).toBe(countGeoCitationQuestions(candidate.questionSet) * 6);
  const [visibilityDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: en.tools.aiVisibility.v2.exportJson, exact: true }).click()]);
  const imported = parseVisibilityImport(await downloaded(visibilityDownload)); expect(imported.ok).toBe(true);
  const gap = guard.report!.gaps.find(item => item.kind === "A"); if (!gap) throw new Error("Real classifier did not derive A");
  const question = guard.report!.questions.find(item => item.questionId === gap.questionId)!;
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: question.text, exact: true }) });
  await card.getByRole("link", { name: en.tools.aiVisibility.gaps.actions.brief, exact: true }).click();
  await page.locator("[data-run-geo-brief]").click(); await expect(page.locator("[data-shared-geo-result]")).toBeVisible();
  const [briefDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: en.tools.geoBrief.actions.downloadJson, exact: true }).click()]);
  const parsed = await parseGeoContentBrief(JSON.parse(await downloaded(briefDownload))); expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error("Brief invalid");
  expect(parsed.value.geo_origin.promptset_ref.schema).toBe("marketing-geo-question-set.v2");
  expect(parsed.value.geo_origin.promptset_ref.hash).toBe(candidate.context.questionSetHash);
  expect(parsed.value.evidence.facts.map(fact => fact.text)).toEqual(["The product supports three seats."]);
  const [draft] = await Promise.all([page.waitForEvent("popup"), page.locator("[data-geo-to-draft]").click()]);
  await expect(draft.locator('[data-intake-phase="loaded"]')).toBeVisible(); await draft.locator("[data-run-draft]").click();
  await expect(draft.locator("[data-content-draft-result]")).toBeVisible();
  expect(guard.authorityChecks).toEqual([{ snapshotId: frozen.snapshotId, accepted: true }]); expect(guard.draftCalls).toBe(1);
  const [draftDownload] = await Promise.all([draft.waitForEvent("download"), draft.locator("[data-export-json]").click()]);
  expect((await parseDraftResult(JSON.parse(await downloaded(draftDownload)), parsed.value)).ok).toBe(true);
  await evidence(fixture, guard);
});

test("Chinese V2 retains unsaved draft and frozen data through Profile ABA and desktop/narrow stage changes", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000); if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture(); await fixture.prepareComplete(); const candidate = parseGeoPreparedCandidate(fixture.currentCandidate);
  await fixture.post("freeze", { kbId: fixture.kbId, candidateId: candidate.candidateId, candidateHash: candidate.candidateHash });
  const originalFrozen = structuredClone(fixture.currentFrozen), originalPositioning = fixture.website.draft!.profile.oneLinePositioning;
  // Another source collection may exist today; frozen rendering must retain
  // the exact earlier selected receipt, not join this newer one into history.
  expect((await fixture.post("sources", { kbId: fixture.kbId })).status).toBe(200);
  const latestReceipt = (await fixture.load()).sourceReceipt!;
  expect(candidate.context.sourceReceiptRefs.some(ref => ref.receiptId === latestReceipt.receiptId)).toBe(false);
  const guard = await installGeoKbV2Guard(page.context(), baseURL, fixture), editor = await open(page, fixture, "zh"), t = geoKbV2EditorCopy("zh");
  const aliases = editor.locator('[data-base-field="aliases"]'); await aliases.fill("Acme\nAcme Billing\nBrowser draft only");
  await editor.locator('[data-stage="frozen"]').click(); await expect(editor.locator("[data-frozen-v2]")).not.toContainText("Browser draft only");
  await editor.locator('[data-stage="input"]').click(); await expect(aliases).toHaveValue("Acme\nAcme Billing\nBrowser draft only");
  await page.locator("#website-profile-oneLinePositioning").fill("Changed Profile B"); await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.getByRole("button", { name: zh.account.websites.editor.confirm.action, exact: true }).click();
  await expect(page.locator('[data-website-profile-collapsed="true"]')).toContainText("v2");
  await page.getByRole("button", { name: zh.account.websites.editor.confirm.edit, exact: true }).click();
  await page.locator("#website-profile-oneLinePositioning").fill(originalPositioning); await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.getByRole("button", { name: zh.account.websites.editor.confirm.action, exact: true }).click();
  await expect(page.locator('[data-website-profile-collapsed="true"]')).toContainText("v1");
  await expect(editor.getByText(t.sourceChanged, { exact: true })).toBeVisible(); await expect(aliases).toHaveValue("Acme\nAcme Billing\nBrowser draft only");
  expect(fixture.currentFrozen).toEqual(originalFrozen); expect(fixture.stats.modelCalls).toEqual({ roles: 1, questions: 1 });
  await editor.locator('[data-stage="frozen"]').click(); const frozen = editor.locator("[data-frozen-v2]");
  await expect(frozen.locator('[data-version-role="finance-managers"]')).toContainText("Finance managers");
  const sourceReads = fixture.stats.sourceReads.length;
  await versionSourceEvidence(frozen, candidate, "zh");
  expect(fixture.stats.sourceReads).toHaveLength(sourceReads);
  expect(fixture.currentFrozen?.context.competitorEvidence).toEqual(candidate.context.competitorEvidence);
  expect(guard.requests.filter(request => request.id.endsWith(`/${fixture.website.websiteId}/geo`))).toHaveLength(1);
  for (const [label, width, height] of [["desktop", 1440, 1000], ["narrow", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await frozen.locator('[data-version-competitor="missing-rival.example"]').evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 90 }));
    await page.screenshot({ path: testInfo.outputPath(`v2-${label}-competitor-capture-zh.png`), animations: "disabled" });
    await frozen.locator("[data-version-role]").first().evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 90 })); await page.screenshot({ path: testInfo.outputPath(`v2-${label}-roles-zh.png`), animations: "disabled" });
    await frozen.locator("[data-version-question]").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`v2-${label}-questions-zh.png`), animations: "disabled" });
    await page.screenshot({ path: testInfo.outputPath(`v2-${label}-full-zh.png`), fullPage: true, animations: "disabled" });
  }
  await evidence(fixture, guard);
});

test("lost successful response recovers by its original key after reload without another role dispatch", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture({ connected: false }), guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  const editor = await open(page, fixture); await editor.locator("[data-refresh-sources]").click();
  await expect(editor.getByText(/Observed query count: Unknown/u)).toBeVisible();
  guard.dropNextGenerationResponse("roles"); await editor.locator('[data-generate="roles"]').click();
  await expect(editor.locator('[data-generation-state="roles"]')).toContainText("outcome is unknown");
  const request = guard.requests.find(entry => entry.id.endsWith("/v2/roles"))!.body as { idempotencyKey: string };
  await page.reload(); await expect(page.locator("[data-geo-kb-v2]")).toBeVisible();
  await page.locator('[data-generation-state="roles"]').getByRole("button", { name: geoKbV2EditorCopy("en").readGeneration, exact: true }).click();
  await expect(page.locator('[data-adopt-role="finance-managers"]')).toBeVisible();
  expect(guard.requests.find(entry => entry.id.endsWith("/v2/generation"))?.body).toEqual({ kbId: fixture.kbId, kind: "roles", idempotencyKey: request.idempotencyKey });
  expect(fixture.stats.dispatches.roles).toBe(1); expect(fixture.stats.modelCalls.roles).toBe(1);
  expect(guard.requests.filter(entry => entry.id.endsWith("/v2/roles"))).toHaveLength(1); await evidence(fixture, guard);
});

test("a genuinely uncertain provider attempt remains inspectable and never automatically dispatches after reload", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Loopback required");
  const fixture = createGeoKbV2Fixture(), guard = await installGeoKbV2Guard(page.context(), baseURL, fixture);
  fixture.failNextModel("roles"); const editor = await open(page, fixture); await editor.locator('[data-generate="roles"]').click();
  await expect(editor.locator('[data-generation-state="roles"]')).toContainText("outcome is unknown"); await page.reload();
  await page.locator('[data-generation-state="roles"]').getByRole("button", { name: geoKbV2EditorCopy("en").readGeneration, exact: true }).click();
  expect(fixture.stats.dispatches.roles).toBe(1); expect(fixture.stats.modelCalls.roles).toBe(1);
  expect(guard.requests.filter(entry => entry.id.endsWith("/v2/roles"))).toHaveLength(1); await evidence(fixture, guard);
});
