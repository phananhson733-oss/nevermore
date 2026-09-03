// One real local browser path across existing UI/HTTP builders, with only the
// account/store/provider seams injected. No Profile, database or paid writes.
import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import { installGeoChainGuard } from "./geo-chain-harness.ts";
import { createVisibilityProfileUpdateFixture, PROFILE_UPDATE_FROZEN } from "./ai-visibility-profile-update-fixture.ts";

let buildId = "", previousKey: string | undefined;
test.use({ actionTimeout: 15_000 });
test.beforeAll(async () => {
  expect(["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "GEO_BRIEF_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter(name => process.env[name] !== undefined)).toEqual([]);
  previousKey = process.env["TOKEN_ENCRYPTION_KEY"]; process.env["TOKEN_ENCRYPTION_KEY"] = "cd".repeat(32);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => {
  if (previousKey === undefined) delete process.env["TOKEN_ENCRYPTION_KEY"]; else process.env["TOKEN_ENCRYPTION_KEY"] = previousKey;
  expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId);
});

test("confirmed Profile v2 is explicitly copied, reviewed, saved and frozen before exact v2 sampling", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Loopback baseURL required");
  const state = createVisibilityProfileUpdateFixture(), fixture = state.fixture;
  const guard = await installGeoChainGuard(page.context(), baseURL, fixture);
  const localeErrors = new Set<string>();
  page.on("console", message => { if (/MISSING_MESSAGE|FORMATTING_ERROR|INVALID_MESSAGE/u.test(message.text())) localeErrors.add(message.text().split("\n")[0]!); });
  const kb = en.tools.geoKnowledgeBase, visibility = en.tools.aiVisibility;
  await page.goto("/en/tools/ai-visibility-check");
  await expect(page.locator("#visibility-version")).toHaveValue(state.oldFrozen.snapshotId);
  await expect(page.getByText(visibility.source.sync.outdated, { exact: true })).toBeVisible();
  expect(fixture.providerCalls).toBe(0);
  const reviewLink = page.getByRole("link", { name: visibility.source.review, exact: true });
  await expect(reviewLink).toHaveAttribute("href", `/account/websites/${fixture.website.websiteId}/geo`);
  await reviewLink.click();
  await expect(page).toHaveURL(new RegExp(`/account/websites/${fixture.website.websiteId}/geo$`));
  await expect(page.locator('[data-geo-profile-field="productName"] [data-geo-readout]').first()).toHaveText("Acme");
  await expect(page.getByText(kb.asset.copyStale, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: kb.asset.reviewCopy, exact: true }).click();
  const copyReview = page.locator('section[aria-labelledby="geo-copy-review-title"]');
  await expect(copyReview).toContainText("Acme Insight");
  expect(state.savedPayloads).toEqual([]);
  await copyReview.getByRole("button", { name: kb.asset.applyCopy, exact: true }).click();
  await expect(copyReview).toHaveCount(0);
  await expect(page.locator('[data-geo-profile-field="productName"] [data-geo-readout]').first()).toHaveText("Acme Insight");
  expect(state.savedPayloads).toEqual([]);
  const measurement = page.locator("[data-measurement-review]");
  await measurement.locator(":scope > summary").click();
  await measurement.locator('[data-measurement-field="officialName"]').check();
  await measurement.locator('[data-measurement-field="categoryTerms"]').check();
  await measurement.locator("[data-apply-measurements]").click();
  await expect(page.getByRole("button", { name: kb.freeze.action, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: kb.draft.save, exact: true }).click();
  await expect(page.getByRole("button", { name: kb.freeze.action, exact: true })).toBeEnabled();
  expect(state.savedPayloads).toHaveLength(1);
  expect(state.savedPayloads[0]!.profileCopy!.profile).toEqual(state.sourceProfile);
  expect(state.savedPayloads[0]!.profileCopy!.snapshotRevision).toBe("2");
  expect(state.savedPayloads[0]!.officialName).toBe("Acme Insight");
  expect(state.savedPayloads[0]!.categoryTerms).toEqual(["business intelligence"]);
  expect(state.savedPayloads[0]!.aliases).toEqual(state.oldFrozen.payload.aliases);
  expect(state.savedPayloads[0]!.competitors).toEqual(state.oldFrozen.payload.competitors);
  expect(fixture.providerCalls).toBe(0);
  await page.getByRole("button", { name: kb.freeze.action, exact: true }).click();
  await expect.poll(() => state.frozenVersions.length).toBe(2);
  expect(fixture.frozen.snapshotId).toBe(PROFILE_UPDATE_FROZEN);
  expect(fixture.frozen.revision).toBe(2);
  expect(fixture.frozen.questionSetHash).not.toBe(state.oldFrozen.questionSetHash);
  expect(JSON.stringify(state.oldFrozen)).toBe(state.oldBytes);
  expect(fixture.providerCalls).toBe(0);

  await page.goto("/en/tools/ai-visibility-check");
  await page.getByRole("button", { name: visibility.workbench.refresh, exact: true }).click();
  await expect(page.locator("#visibility-version")).toHaveValue(PROFILE_UPDATE_FROZEN);
  await expect(page.getByText(visibility.source.sync.current, { exact: true })).toBeVisible();
  await page.locator('[data-source="questions"] > summary').click();
  await expect(page.locator('[data-source="questions"]')).toContainText("business intelligence");
  await page.locator("#visibility-samples").selectOption("3");
  expect(guard.requests.filter(request => request.id === "POST /api/tools/ai-visibility-check/run")).toEqual([]);
  expect(fixture.providerCalls).toBe(0);
  await page.getByRole("button", { name: visibility.form.start, exact: true }).click();
  await expect(page.locator('[data-visibility-report="marketing-geo-visibility.v2"]')).toBeVisible();
  expect(guard.requests.find(request => request.id === "POST /api/tools/ai-visibility-check/run")?.body).toEqual({
    kbId: fixture.frozen.kbId, snapshotId: PROFILE_UPDATE_FROZEN, samplesPerQuestion: 3, engines: ["chatgpt"],
  });
  expect(fixture.report?.manifest.snapshotRevision).toBe(2);
  expect(fixture.report?.manifest.questionSetHash).toBe(fixture.frozen.questionSetHash);
  expect(fixture.providerCalls).toBe(fixture.frozen.questionCount * 3);
  expect(JSON.stringify(state.oldFrozen)).toBe(state.oldBytes);
  expect(guard.unexpected).toEqual([]);
  expect([...localeErrors]).toEqual([]);
  await writeFile(test.info().outputPath("source-update-evidence.json"), JSON.stringify({
    scope: "local injected account/store/provider seams; real UI and handlers; no production or paid calls",
    buildId, sourceProfileRevision: 2, savedPayload: state.savedPayloads[0],
    frozenVersions: state.frozenVersions.map(version => ({ snapshotId: version.snapshotId, revision: version.revision, contentHash: version.contentHash, questionSetHash: version.questionSetHash })),
    oldFrozenUnchanged: JSON.stringify(state.oldFrozen) === state.oldBytes,
    requests: guard.requests, offlineProviderCalls: fixture.providerCalls,
  }, null, 2));
});
