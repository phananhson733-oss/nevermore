// LOCAL ONLY. Real UI and HTTP parsers, deterministic account/store fixtures.
// No real login, Supabase, provider, publishing or production claim is made.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { parseMarketingWebsiteProfile, type MarketingWebsiteProfileV1 } from "../src/lib/account-websites/contracts.ts";
import { GEO_PROFILE_SUBSET_FIELDS } from "../src/lib/geo-tools/kb-profile-subset.ts";
import en from "../src/i18n/messages/en.json" with { type: "json" };
import zh from "../src/i18n/messages/zh.json" with { type: "json" };
import { installGeoChainGuard } from "./geo-chain-harness.ts";
import { createInlineGeoFixture } from "./geo-inline-fixtures.ts";

test.use({ actionTimeout: 15_000 });
let buildId = "";
test.beforeAll(async () => {
  expect(["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD", "OPENAI_API_KEY", "GEO_BRIEF_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"].filter(name => process.env[name] !== undefined)).toEqual([]);
  buildId = (await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim();
});
test.afterAll(async () => { expect((await readFile(new URL("../.next/BUILD_ID", import.meta.url), "utf8")).trim()).toBe(buildId); });

async function setup(page: Page, baseURL: string) {
  const state = createInlineGeoFixture();
  const guard = await installGeoChainGuard(page.context(), baseURL, state.fixture);
  // Test-only consent state, just as in account-settings.spec.ts. Analytics
  // remain off and no real browser profile or consent API is accessed.
  await page.context().addInitScript(() => {
    localStorage.setItem("gengrowth_consent", JSON.stringify({ consent_version: "1.0", necessary: true, analytics: false, marketing: false, updated_at: "2026-08-31T03:00:00.000Z" }));
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // The guard intentionally blocks external telemetry and auth SDK scripts;
    // every other console error is an application failure.
    if (message.type() === "error" && !message.text().includes("net::ERR_BLOCKED_BY_CLIENT")) errors.push(message.text());
  });
  await page.context().route(`**/api/account/websites/${state.fixture.website.websiteId}{,/confirm}`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === "GET") { await route.fallback(); return; }
    const body: unknown = request.postDataJSON();
    guard.requests.push({ id: `${request.method()} ${path}`, body });
    let website;
    if (path.endsWith("/confirm") && request.method() === "POST") website = state.confirmProfile();
    else if (request.method() === "PATCH" && typeof body === "object" && body !== null && "intent" in body && body.intent === "save_profile" && "profile" in body) website = state.saveProfile(parseMarketingWebsiteProfile(body.profile));
    else throw new Error(`Unexpected offline Profile mutation: ${request.method()} ${path}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { website } }) });
  });
  return { state, guard, errors };
}

async function assertCompleteProfile(page: Page, profile: MarketingWebsiteProfileV1) {
  const copy = page.locator("#geo section").filter({ has: page.getByRole("heading", { name: /^(The Profile fields GEO reads|GEO 读取的档案字段)$/u }) }).first();
  // Only the fields GEO reads, at rest -- no disclosure to open, and every one
  // of them read out rather than held in a control. Empty fields stay explicit.
  expect(await copy.locator("[data-geo-profile-field]").count()).toBe(GEO_PROFILE_SUBSET_FIELDS.length);
  await expect(copy.locator("input, textarea, select")).toHaveCount(0);
  for (const field of GEO_PROFILE_SUBSET_FIELDS) {
    const value = profile[field];
    const expected = typeof value === "string" ? [value] : value.length === 0 ? [""] : [...value];
    const readouts = copy.locator(`[data-geo-profile-field="${field}"] [data-geo-readout]`);
    await expect(readouts).toHaveCount(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      const text = expected[index]!;
      await expect(readouts.nth(index)).toHaveText(text === "" ? en.tools.geoKnowledgeBase.asset.emptyField : text);
    }
  }
  await expect(copy.locator("[data-geo-profile-field]").first()).toBeVisible();
  return copy;
}

test("en: inline complete copy stays detached through Profile confirmation, explicit adoption, save and reload", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Loopback URL required");
  const { state, guard, errors } = await setup(page, baseURL);
  const t = en.tools.geoKnowledgeBase;
  await page.goto(`/en/account/websites/${state.fixture.website.websiteId}/geo`);
  await expect(page).toHaveURL(new RegExp(`/account/websites/${state.fixture.website.websiteId}#geo$`, "u"));
  const geo = page.locator("#geo");
  await expect(geo.getByRole("heading", { name: t.asset.inlineTitle, exact: true })).toBeVisible();
  await expect(page.locator("#website-profile-productName")).toHaveValue("Acme");
  await assertCompleteProfile(page, state.initialPayload.profileCopy!.profile);
  expect(await page.evaluate(() => {
    const geo = document.querySelector("#geo"), profile = document.querySelector("#website-profile-productName");
    return geo !== null && profile !== null && Boolean(profile.compareDocumentPosition(geo) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  // Start an unsaved GEO edit before Profile collapses; neither the loader nor
  // confirmation revision signal may remount it or persist it implicitly.
  const aliases = geo.getByLabel(t.brand.aliasesLabel, { exact: true });
  await aliases.fill("Unsaved alias survives confirmation");
  await aliases.press("Enter");
  const unsavedAlias = geo.getByRole("button", { name: `${t.brand.aliasesLabel}: Unsaved alias survives confirmation`, exact: true });
  await expect(unsavedAlias).toBeVisible();
  await expect(geo.getByText(t.draft.unsaved, { exact: true })).toBeVisible();
  await page.locator("#website-profile-productName").fill("Updated Acme Profile");
  await expect(page.locator('[data-save-state="saved"]')).toBeVisible();
  await page.getByRole("button", { name: en.account.websites.editor.confirm.action, exact: true }).click();
  await expect(page.locator('[data-website-profile-collapsed="true"]')).toContainText("Confirmed v2");
  await expect(unsavedAlias).toBeVisible();
  await expect(geo.getByText(t.asset.copyStale, { exact: true })).toBeVisible();
  await expect(geo.locator('[data-geo-profile-field="productName"] [data-geo-readout]').first()).toHaveText("Acme");
  expect(guard.requests.filter(row => row.id.endsWith(`/${state.fixture.website.websiteId}/geo`))).toHaveLength(1);
  expect(state.savedPayloads).toEqual([]);

  await geo.getByRole("button", { name: t.asset.reviewCopy, exact: true }).click();
  const review = geo.locator('section[aria-labelledby="geo-copy-review-title"]');
  await expect(review).toContainText("Updated Acme Profile");
  await expect(review).toContainText("Acme");
  expect(state.savedPayloads).toEqual([]);
  await review.getByRole("button", { name: t.asset.applyCopy, exact: true }).click();
  await expect(review).toHaveCount(0);
  await expect(geo.getByText(t.draft.unsaved, { exact: true })).toBeVisible();
  await expect(geo.getByRole("button", { name: t.freeze.action, exact: true })).toBeDisabled();
  expect(state.savedPayloads).toEqual([]);
  await geo.getByRole("button", { name: t.draft.save, exact: true }).click();
  await expect.poll(() => state.savedPayloads.length).toBe(1);
  const saved = state.savedPayloads[0]!;
  expect(saved.profileCopy?.profile).toEqual(state.fixture.website.currentConfirmedSnapshot!.profile);
  expect(saved.profileCopy?.snapshotRevision).toBe("2");
  expect(saved.aliases).toEqual([...state.initialPayload.aliases, "Unsaved alias survives confirmation"]);
  for (const field of ["officialName", "categoryTerms", "market", "roles", "competitors", "facts"] as const) expect(saved[field]).toEqual(state.initialPayload[field]);
  await expect(geo.getByRole("button", { name: t.freeze.action, exact: true })).toBeEnabled();
  const history = geo.locator("[data-frozen-knowledge-base]");
  await history.locator(":scope > summary").click();
  await expect(history.locator('[data-geo-profile-field="productName"] [data-geo-readout]')).toHaveText("Acme");
  await expect(history).not.toContainText("Unsaved alias survives confirmation");
  const geoIds = await geo.locator("[id]").evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(geoIds).size).toBe(geoIds.length);
  await page.reload();
  await expect(geo.locator('[data-geo-profile-field="productName"] [data-geo-readout]').first()).toHaveText("Updated Acme Profile");
  expect(state.savedPayloads).toHaveLength(1);
  expect(state.frozen.payload).toEqual(state.initialPayload);
  expect(guard.unexpected).toEqual([]);
  expect(errors).toEqual([]);
  expect(state.fixture.providerCalls).toBe(0);
  await testInfo.attach("inline-copy-offline-evidence.json", { body: JSON.stringify({ scope: "local UI plus offline account/store seams; no real auth/provider/production", buildId, savedCopyRevision: saved.profileCopy?.snapshotRevision, frozenCopyRevision: state.frozen.payload.profileCopy?.snapshotRevision, requests: guard.requests.map(row => row.id), errors, unexpected: guard.unexpected }), contentType: "application/json" });
});

test("zh: Profile and complete GEO copy share the bottom layout without desktop or narrow overflow", async ({ page, baseURL }, testInfo) => {
  if (!baseURL) throw new Error("Loopback URL required");
  const { state, guard, errors } = await setup(page, baseURL);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/zh/account/websites/${state.fixture.website.websiteId}`);
  const geo = page.locator("#geo");
  await expect(geo.getByRole("heading", { name: zh.tools.geoKnowledgeBase.asset.inlineTitle, exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await expect(page.locator("#website-profile-productName")).toHaveValue("Acme");
  await assertCompleteProfile(page, state.initialPayload.profileCopy!.profile);
  for (const [name, width, height] of [["desktop", 1440, 1000], ["narrow", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`inline-profile-and-geo-${name}-full-zh.png`), fullPage: true, animations: "disabled" });
    await geo.getByRole("heading", { name: zh.tools.geoKnowledgeBase.asset.inlineTitle, exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`inline-geo-${name}-viewport-zh.png`), animations: "disabled" });
    await geo.locator('[data-geo-profile-field="productName"]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`inline-copy-fields-${name}-viewport-zh.png`), animations: "disabled" });
  }
  expect(guard.unexpected).toEqual([]); expect(errors).toEqual([]); expect(state.savedPayloads).toEqual([]);
});
