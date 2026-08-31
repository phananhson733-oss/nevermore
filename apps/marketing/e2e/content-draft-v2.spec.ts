// @input -- real standalone Brief/Draft pages with every API isolated at browser-context scope
// @output -- confirmed-v2 handoff, exact generation/rerun/export and honest editorial boundaries
// @pos -- browser acceptance only; no Supabase login, provider call, publishing or production claim
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { CONTENT_BRIEF_HANDOFF_KEY } from "@sf/public-tools/content-brief/contract";
import { SECTION_ENDPOINT_BUDGET_MS } from "@sf/public-tools/content-brief/constants";
import { confirmBriefV2, fingerprintBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import { fingerprintDraftV2, parseDraftResultV2, type AssembleDraftV2Input } from "@sf/public-tools/content-brief/v2-draft";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateDraftV2Section } from "@sf/public-tools/content-brief/v2-draft-section";
import type { DraftResultV2, DraftV2Section, DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import { TOOL_HANDOFF_KEY } from "../src/lib/tools/tool-handoff";
import { fulfillJson, installDraftApiGuard, necessaryOnly, openConfirmedBriefV2, parseConfirmed } from "./content-draft-e2e-helpers";

interface RunBody { readonly brief: unknown; readonly settings: DraftV2Settings; readonly section_ids: readonly string[] }
interface SectionBody { readonly brief: unknown; readonly previous: unknown; readonly section_id: string }
const DEFAULT_SETTINGS: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "gap_only" };

function coverageFor(confirmed: ConfirmedBriefV2, sections: readonly DraftV2Section[]): AssembleDraftV2Input["coverage"] {
  return {
    items: confirmed.brief.generated!.research.questions.map((question) => {
      const section = sections.find((item) => item.answers.includes(question.id));
      return section?.status === "ok"
        ? { question_id: question.id, status: "covered" as const, covered_in: section.id, gap: null }
        : { question_id: question.id, status: "none" as const, covered_in: null, gap: "This question has no generated prose yet." };
    }),
    reads: { status: "complete", calls: 1, model_id: "offline-browser-coverage", temperature_requested: 0, temperature_effective: null, input_tokens: 80, output_tokens: 20 },
  };
}

/** Parse the exact request before deriving a reply; settings/selection cannot silently drift. */
async function resultForRequest(request: Request): Promise<{ confirmed: ConfirmedBriefV2; result: DraftResultV2 }> {
  const body = request.postDataJSON() as RunBody;
  const confirmed = await parseConfirmed(body.brief);
  const all = await draftResultV2Fixture(confirmed, { settings: body.settings });
  const sections: DraftV2Section[] = all.sections.map((section) => body.section_ids.includes(section.id)
    ? section : { ...confirmed.outline.find((heading) => heading.id === section.id)!, status: "skipped" });
  return { confirmed, result: await draftResultV2Fixture(confirmed, { settings: body.settings, sections, coverage: coverageFor(confirmed, sections) }) };
}

async function dynamicRun(route: Route, request: Request): Promise<void> {
  const { result } = await resultForRequest(request);
  await fulfillJson(result)(route);
}

function changedSection(confirmed: ConfirmedBriefV2, result: DraftResultV2, sectionId: string, text: string, claim: "no_claim" | "gap" = "no_claim"): DraftV2Section {
  const section = result.sections.find((value) => value.id === sectionId);
  if (section?.status !== "ok") throw new Error("Expected a successful source section");
  const scope = buildDraftV2SectionScope(confirmed, sectionId, result.settings);
  if (!scope.ok) throw new Error(scope.path);
  const parsed = validateDraftV2Section({ paragraphs: section.body.paragraphs.map((paragraph) => ({
    heading: paragraph.heading, sentences: [{ text, claim, evidence_refs: [] }],
  })) }, scope.value, confirmed.brief.context.input.language);
  if (!parsed.ok) throw new Error(parsed.path);
  return { ...section, body: parsed.value };
}

async function pasteConfirmed(page: Page, confirmed: ConfirmedBriefV2): Promise<void> {
  await page.locator("[data-paste-brief]").fill(JSON.stringify(confirmed));
  await page.locator("[data-load-brief]").click();
  await expect(page.locator("[data-draft-v2-workflow]")).toBeVisible();
  await expect(page.locator("form[data-content-draft-form]")).toHaveCount(0);
}

async function openDraft(page: Page, confirmed: ConfirmedBriefV2, locale: "en" | "zh" = "en"): Promise<void> {
  await page.goto(`/${locale}/tools/content-draft`);
  await necessaryOnly(page, locale);
  await pasteConfirmed(page, confirmed);
}

async function generate(page: Page): Promise<void> {
  await page.locator("button[data-generate-draft]").click();
  await expect(page.locator("[data-draft-v2-result]")).toBeVisible();
}

async function downloadText(page: Page, selector: string): Promise<{ text: string; filename: string }> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(selector).click()]);
  const path = await download.path();
  if (path === null) throw new Error("Download has no path");
  return { text: await readFile(path, "utf8"), filename: download.suggestedFilename() };
}

async function downloadResult(page: Page, confirmed: ConfirmedBriefV2, previous?: DraftResultV2): Promise<DraftResultV2> {
  const { text, filename } = await downloadText(page, "[data-download-draft-json]");
  const decoded: unknown = JSON.parse(text);
  const parsed = await parseDraftResultV2(decoded, confirmed, previous);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`Export rejected: ${parsed.path}`);
  expect(decoded).toEqual(parsed.value);
  expect(filename).toBe(`content-draft-r${confirmed.revision}-${parsed.value.run.fingerprint.slice(0, 12)}.json`);
  expect(await fingerprintDraftV2(parsed.value)).toBe(parsed.value.run.fingerprint);
  return parsed.value;
}

/** A real observed owned candidate, confirmed as a related page rather than the rewrite target. */
async function confirmedWithRelatedLink(): Promise<ConfirmedBriefV2> {
  const base = await confirmedDraftV2Fixture({ action: "update" });
  const unsigned = { ...base.brief, generated: {
    ...base.brief.generated!,
    page_plan: { ...base.brief.generated!.page_plan, action: "create" as const, target_ref: null, steps: [] },
    internal_links: [{ page_ref: "T1", anchor: "Reporting introduction", why: "Keep the existing introduction as related context." }],
  } };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const confirmed = await confirmBriefV2(brief, { outline: base.outline, revision: 3, confirmed_at: "2026-08-31T03:00:00.000Z", resolution: "accept_recommendation" });
  if (!confirmed.ok) throw new Error(confirmed.path);
  return parseConfirmed(confirmed.value);
}

test.describe("Draft v2 — API-isolated browser acceptance", () => {
  test("real edited Brief producer opens a v2 popup that peeks while server-signed-out; exact manual-paste fallback then generates", async ({ page }) => {
    const { brief } = await confirmedDraftV2Fixture();
    const guard = await installDraftApiGuard(page, { signedIn: true, briefRun: fulfillJson(brief), run: dynamicRun });
    const confirmed = await openConfirmedBriefV2(page, brief, { edit: true });
    expect(confirmed.revision).toBe(1);
    expect(confirmed.outline.map((section) => section.id)).toEqual(["O2", "O1"]);
    expect(confirmed.outline[1]).toMatchObject({ h2: "Check reporting collection dates", h3: ["Collection date", "Finalized period"], answers: ["Q1"] });
    expect(guard.briefRequests).toHaveLength(1);
    expect(guard.briefRequests[0]?.postDataJSON()).toMatchObject({ response_schema: "gengrowth.content_brief/v2" });
    const link = page.locator("a[data-generate-draft]");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "opener");
    const [popup] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
    await popup.waitForURL("**/tools/content-draft");
    await expect(popup.locator("[data-handoff-pending]")).toBeVisible();
    await expect(popup.locator('[data-intake-phase="empty"]')).toBeVisible();
    await expect(popup.locator("[data-draft-v2-workflow]")).toHaveCount(0);
    const received = await popup.evaluate((key) => sessionStorage.getItem(key), CONTENT_BRIEF_HANDOFF_KEY);
    expect(received).not.toBeNull();
    const envelope = JSON.parse(received ?? "null") as { version: number; brief: unknown; created_at: number; expires_at: number };
    expect(envelope.version).toBe(2);
    expect(await parseConfirmed(envelope.brief)).toEqual(confirmed);
    expect(envelope.expires_at).toBeGreaterThan(envelope.created_at);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), CONTENT_BRIEF_HANDOFF_KEY)).toBe(received);
    expect(await popup.evaluate(() => window.opener !== null)).toBe(true);
    expect(new URL(popup.url()).search).toBe("");
    expect(new URL(popup.url()).hash).toBe("");
    expect(popup.url()).not.toContain(confirmed.fingerprint);
    expect(popup.url()).not.toContain(brief.context.input.primary);
    // No Supabase credentials exist in the standalone server. This is explicitly
    // a manual fallback, not a claimed authenticated handoff take or real login.
    await pasteConfirmed(popup, await parseConfirmed(envelope.brief));
    await popup.locator('[data-setting="tone"]').selectOption("technical");
    await popup.locator('[data-setting="person"]').selectOption("third");
    await popup.locator('[data-setting="product_mention"]').selectOption("none");
    await generate(popup);
    expect(guard.runRequests).toHaveLength(1);
    await expect(popup.locator("[data-draft-settings-panel]")).toBeHidden();
    await expect(popup.locator("[data-draft-result-region]")).toBeFocused();
    await popup.locator("[data-toggle-settings]").click();
    await expect(popup.locator("[data-draft-settings-panel]")).toBeVisible();
    expect(guard.runRequests).toHaveLength(1);
    await expect(popup.locator("[data-draft-v2-result]")).toBeVisible();
    await popup.locator("[data-toggle-settings]").click();
    await expect(popup.locator("[data-draft-settings-panel]")).toBeHidden();
    const body = guard.runRequests[0]?.postDataJSON() as RunBody;
    expect(Object.keys(body).sort()).toEqual(["brief", "section_ids", "settings"]);
    expect(body.brief).toEqual(confirmed);
    expect(body.section_ids).toEqual(["O2", "O1"]);
    expect(body.settings).toEqual({ tone: "technical", person: "third", product_mention: "none" });
    const result = await downloadResult(popup, confirmed);
    expect(result.confirmed_ref).toMatchObject({ fingerprint: confirmed.fingerprint, revision: 1 });
    expect(await popup.locator("[data-draft-h2]").allTextContents()).toEqual(confirmed.outline.map((section) => section.h2));
    expect(await popup.locator('[data-draft-section="O1"] [data-draft-h3]').allTextContents()).toEqual(["Collection date", "Finalized period"]);
    await expect(popup.locator('[data-draft-section="O1"]')).toContainText("Review the reporting period before comparing results.");
    expect(guard.unexpected).toEqual([]);
  });

  test("GEO schemaVersion and unconfirmed Content Brief v2 get explicit local guidance before any run", async ({ page }) => {
    const confirmed = await confirmedDraftV2Fixture();
    const guard = await installDraftApiGuard(page, { signedIn: true });
    await page.goto("/en/tools/content-draft");
    await necessaryOnly(page, "en");
    for (const [document, code, message] of [
      [{ schemaVersion: "marketing-geo-brief.v1", title: "GEO evidence" }, "geo_document", "This is a GEO Brief"],
      [confirmed.brief, "confirmation_required", "has not been confirmed"],
    ] as const) {
      await page.locator("[data-paste-brief]").fill(JSON.stringify(document));
      await page.locator("[data-load-brief]").click();
      await expect(page.locator(`[data-intake-rejected="${code}"]`)).toContainText(message);
      await expect(page.locator("[data-content-brief-entry]")).toHaveAttribute("href", "/tools/content-brief");
      await expect(page.locator("[data-draft-v2-workflow]")).toHaveCount(0);
    }
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("a signed-out session blocks a confirmed v2 paid run at the sign-in dialog", async ({ page }) => {
    const guard = await installDraftApiGuard(page, { signedIn: false });
    await openDraft(page, await confirmedDraftV2Fixture());
    await page.locator("button[data-generate-draft]").click();
    await expect(page.locator("dialog, [role=dialog]").first()).toBeVisible();
    expect(guard.runRequests).toHaveLength(0);
    expect(guard.unexpected).toEqual([]);
  });

  test("PAA-only questions permit prose but never fabricate factual U-reference support", async ({ page }) => {
    const confirmed = await confirmedDraftV2Fixture({ paaOnly: true });
    const guard = await installDraftApiGuard(page, { signedIn: true, run: async (route, request) => {
      const { confirmed: actual, result } = await resultForRequest(request);
      const sections = result.sections.map((section) => changedSection(actual, result, section.id, "Reporting updates can be delayed.", "gap"));
      await fulfillJson(await draftResultV2Fixture(actual, { settings: result.settings, sections }))(route);
    } });
    await openDraft(page, confirmed);
    await generate(page);
    await expect(page.locator("[data-claim=gap]")).toHaveCount(confirmed.outline.length);
    await expect(page.locator('[href^="#draft-v2-evidence-U"]')).toHaveCount(0);
    await expect(page.locator("[data-evidence-ref]")).toHaveCount(0);
    const result = await downloadResult(page, confirmed);
    expect(result.verify_before_publish).toHaveLength(confirmed.outline.length);
    expect(result.verify_before_publish.every((item) => item.kind === "gap" && item.support_count === 0 && item.evidence_refs.length === 0)).toBe(true);
    expect(result.sections.every((section) => section.status === "ok" && section.body.paragraphs.every((paragraph) => paragraph.sentences.every((sentence) => sentence.evidence_refs.length === 0)))).toBe(true);
    expect(guard.unexpected).toEqual([]);
  });

  test("rerun posts the true previous body, changes only its target, and a failed next rerun retains the verified result", async ({ page }) => {
    const confirmed = await confirmedDraftV2Fixture({ reverse: true });
    let calls = 0;
    const guard = await installDraftApiGuard(page, { signedIn: true, run: dynamicRun, section: async (route, request) => {
      calls += 1;
      if (calls === 2) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unknown" }) });
        return;
      }
      const body = request.postDataJSON() as SectionBody;
      const actual = await parseConfirmed(body.brief);
      const parsed = await parseDraftResultV2(body.previous, actual);
      if (!parsed.ok) throw new Error(parsed.path);
      const previous = parsed.value;
      const sections = previous.sections.map((section) => section.id === body.section_id
        ? changedSection(actual, previous, section.id, "Compare only the finalized reporting window in this rewritten section.") : section);
      const next = await draftResultV2Fixture(actual, {
        settings: previous.settings, sections, coverage: coverageFor(actual, sections),
        run: { run_id: "draft-browser-rerun", collected_at: "2026-08-31T04:00:00.000Z", elapsed_ms: 55, budget_ms: SECTION_ENDPOINT_BUDGET_MS, rerun: { previous_run_id: previous.run.run_id, previous_fingerprint: previous.run.fingerprint, section_id: body.section_id } },
      });
      await fulfillJson(next)(route);
    } });
    await openDraft(page, confirmed);
    await generate(page);
    const first = await downloadResult(page, confirmed);
    await page.locator('[data-rerun-section="O1"]').click();
    await expect(page.locator("[data-draft-v2-result]")).toHaveAttribute("data-run-id", "draft-browser-rerun");
    const second = await downloadResult(page, confirmed, first);
    expect(guard.sectionRequests[0]?.postDataJSON()).toEqual({ brief: confirmed, section_id: "O1", previous: first });
    expect(second.run.rerun).toEqual({ previous_run_id: first.run.run_id, previous_fingerprint: first.run.fingerprint, section_id: "O1" });
    expect(second.run.budget_ms).toBe(SECTION_ENDPOINT_BUDGET_MS);
    expect(second.run.reads.llm_sections.calls).toBe(1);
    expect(second.sections.filter((section) => section.id !== "O1")).toEqual(first.sections.filter((section) => section.id !== "O1"));
    expect(second.sections.find((section) => section.id === "O1")).not.toEqual(first.sections.find((section) => section.id === "O1"));
    await expect(page.locator('[data-draft-section="O1"]')).toContainText("Compare only the finalized reporting window");
    await page.locator('[data-rerun-section="O2"]').click();
    await expect(page.locator('[data-error-code="unknown"]')).toBeVisible();
    expect(guard.sectionRequests[1]?.postDataJSON()).toEqual({ brief: confirmed, section_id: "O2", previous: second });
    expect(await downloadResult(page, confirmed, first)).toEqual(second);
    await page.locator('[data-setting="tone"]').selectOption("technical");
    await expect(page.locator("[data-settings-changed]")).toBeVisible();
    for (const button of await page.locator("[data-rerun-section]").all()) await expect(button).toBeDisabled();
    expect(guard.sectionRequests).toHaveLength(2);
    expect(guard.unexpected).toEqual([]);
  });

  for (const invalid of ["stale-revision", "bad-fingerprint"] as const) {
    test(`rejects a ${invalid} result without rendering or exporting it`, async ({ page }) => {
      const confirmed = await confirmedDraftV2Fixture();
      const guard = await installDraftApiGuard(page, { signedIn: true, run: async (route, request) => {
        const { confirmed: actual, result } = await resultForRequest(request);
        if (invalid === "bad-fingerprint") {
          await fulfillJson({ ...result, run: { ...result.run, fingerprint: "0".repeat(64) } })(route);
        } else {
          const newer = await confirmBriefV2(actual.brief, { outline: actual.outline, revision: actual.revision + 1, confirmed_at: actual.confirmed_at, resolution: actual.resolution });
          if (!newer.ok) throw new Error(newer.path);
          await fulfillJson(await draftResultV2Fixture(newer.value, { settings: result.settings }))(route);
        }
      } });
      await openDraft(page, confirmed);
      await page.locator("button[data-generate-draft]").click();
      await expect(page.locator('[data-error-code="invalid_result"]')).toBeVisible();
      await expect(page.locator("[data-draft-v2-result]")).toHaveCount(0);
      await expect(page.locator("[data-download-draft-json]")).toHaveCount(0);
      expect(guard.runRequests).toHaveLength(1);
      expect(guard.unexpected).toEqual([]);
    });
  }

  for (const unavailable of ["failed", "skipped"] as const) {
    test(`JSON copy/download parse exactly and Markdown keeps ${unavailable} headings plus confirmed related links once`, async ({ page, context }) => {
      const confirmed = await confirmedWithRelatedLink();
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const guard = await installDraftApiGuard(page, { signedIn: true, run: async (route, request) => {
        const { confirmed: actual, result } = await resultForRequest(request);
        const sections: DraftV2Section[] = result.sections.map((section) => section.id !== "O2" || unavailable === "skipped" ? section : {
          ...actual.outline.find((heading) => heading.id === section.id)!, status: "failed", fail_reason: "provider_error",
          llm: { attempts: 1, model_id: "offline-browser-failure", temperature_requested: 0.4, temperature_effective: null, input_tokens: 50, output_tokens: null },
        });
        await fulfillJson(await draftResultV2Fixture(actual, { settings: result.settings, sections, coverage: coverageFor(actual, sections) }))(route);
      } });
      await openDraft(page, confirmed);
      if (unavailable === "skipped") await page.locator('[data-section-checkbox="O2"]').uncheck();
      await generate(page);
      const body = guard.runRequests[0]?.postDataJSON() as RunBody;
      expect(body.settings).toEqual(DEFAULT_SETTINGS);
      expect(body.brief).toEqual(confirmed);
      expect(body.section_ids).toEqual(unavailable === "skipped" ? ["O1"] : ["O1", "O2"]);
      const result = await downloadResult(page, confirmed);
      expect(result.sections.find((section) => section.id === "O2")?.status).toBe(unavailable);
      await page.locator("[data-copy-draft-json]").click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(JSON.stringify(result));
      const copiedJson: unknown = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(await parseDraftResultV2(copiedJson, confirmed)).toEqual({ ok: true, value: result });
      const markdown = await downloadText(page, "[data-download-markdown]");
      expect(markdown.filename).toMatch(/\.md$/u);
      for (const heading of confirmed.outline) {
        expect(markdown.text).toContain(`## ${heading.h2}`);
        if (result.sections.find((section) => section.id === heading.id)?.status === "ok") {
          for (const h3 of heading.h3) expect(markdown.text).toContain(`### ${h3}`);
        }
      }
      expect(markdown.text).toContain(unavailable === "failed"
        ? "> The model provider returned an error for this section."
        : "> You left this section unchecked, so no model call was made.");
      expect(markdown.text.match(/https:\/\/owned\.test\/T1/gu)).toHaveLength(1);
      expect(markdown.text.match(/Reporting introduction/gu)).toHaveLength(1);
      await page.locator("[data-copy-markdown]").click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(markdown.text);
      expect(guard.unexpected).toEqual([]);
    });
  }

  for (const action of ["create", "update"] as const) {
    test(`${action} preserves its real page plan; only a user-entered published URL opens an On-Page popup with base language and no auto-audit`, async ({ page }) => {
      const confirmed = await confirmedDraftV2Fixture({ action, language: "zh-CN" });
      const guard = await installDraftApiGuard(page, { signedIn: true, run: dynamicRun });
      await openDraft(page, confirmed, "zh");
      await expect(page.locator("[data-page-action]")).toHaveText(action === "update" ? "重写现有页面" : "新建页面");
      if (action === "update") {
        await expect(page.locator("[data-target-page]")).toHaveAttribute("href", "https://owned.test/T1");
        expect(await page.locator("[data-rewrite-plan] li").count()).toBe(confirmed.brief.generated!.page_plan.steps.length);
        for (const step of confirmed.brief.generated!.page_plan.steps) await expect(page.locator("[data-rewrite-plan]")).toContainText(step.instruction);
      } else {
        await expect(page.locator("[data-target-page]")).toHaveCount(0);
        await expect(page.locator("[data-rewrite-plan]")).toHaveCount(0);
      }
      await generate(page);
      await expect(page.locator("[data-draft-length]")).toContainText("字");
      await expect(page.locator("[data-draft-length]")).not.toContainText("words");
      await expect(page.locator("[data-published-url]")).toHaveValue("");
      await expect(page.locator("[data-open-on-page]")).toHaveCount(0);
      const published = "https://published.example/reporting-guide";
      await page.locator("[data-published-url]").fill(published);
      const link = page.locator("[data-open-on-page]");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "opener");
      const [popup] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
      await popup.waitForURL("**/tools/on-page-seo-check");
      await expect(popup.locator("#onpage-url")).toHaveValue(published);
      await expect(popup.locator("#onpage-query")).toHaveValue(confirmed.brief.context.input.primary);
      await expect(popup.locator("#onpage-country")).toHaveValue(confirmed.brief.context.input.market);
      await expect(popup.locator("#onpage-language")).toHaveValue("zh");
      expect(await popup.evaluate((key) => sessionStorage.getItem(key), TOOL_HANDOFF_KEY)).toBeNull();
      expect(new URL(popup.url()).search).toBe("");
      expect(popup.url()).not.toContain(published);
      expect(popup.url()).not.toContain(confirmed.fingerprint);
      expect(guard.runRequests).toHaveLength(1);
      expect(guard.sectionRequests).toHaveLength(0);
      expect(guard.unexpected).toEqual([]);
    });
  }

  for (const locale of ["en", "zh"] as const) for (const viewport of ["desktop", "mobile"] as const) {
    test(`${locale} ${viewport} screenshot: actual Necessary Only click, compact editorial text and no horizontal overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport === "desktop" ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
      const confirmed = await confirmedDraftV2Fixture({ language: locale === "zh" ? "zh-CN" : "en-US", action: viewport === "desktop" ? "update" : "create" });
      const guard = await installDraftApiGuard(page, { signedIn: true, run: dynamicRun });
      await openDraft(page, confirmed, locale);
      await generate(page);
      await expect(page.locator("[data-draft-settings-panel]")).toBeHidden();
      await expect(page.locator("[data-draft-result-region]")).toBeFocused();
      await expect(page.locator("[data-draft-h3]").first()).toHaveCSS("font-size", "15px");
      await expect(page.locator("[data-length-note]")).toHaveCSS("font-size", "11px");
      await expect(page.locator("[data-claim]").first().locator("..")).toHaveCSS("font-size", "14px");
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator("[data-draft-v2-workflow]").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(880);
      expect(guard.consentRequests).toHaveLength(1);
      expect(guard.consentRequests[0]?.postDataJSON()).toMatchObject({ categories: [
        { category: "necessary", status: "accepted" }, { category: "analytics", status: "rejected" }, { category: "marketing", status: "rejected" },
      ] });
      const screenshot = testInfo.outputPath(`content-draft-v2-${locale}-${viewport}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`${locale}-${viewport}`, { path: screenshot, contentType: "image/png" });
      const viewportScreenshot = testInfo.outputPath(`content-draft-v2-${locale}-${viewport}-result-viewport.png`);
      await page.screenshot({ path: viewportScreenshot });
      await testInfo.attach(`${locale}-${viewport}-result-viewport`, { path: viewportScreenshot, contentType: "image/png" });
      expect(guard.unexpected).toEqual([]);
    });
  }
});
