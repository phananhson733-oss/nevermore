// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKnowledgeBaseV2 } from "./geo-knowledge-base-v2.tsx";
import { editorFixture } from "./geo-kb-v2-ui.test-fixtures.ts";
import { geoKbV2EditorCopy } from "./geo-kb-v2-editor-copy.ts";
let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(view = editorFixture(), locale = "en") { await act(async () => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}><GeoKnowledgeBaseV2 initialView={view} locale={locale} inline confirmedProfileRevision={1} /></NextIntlClientProvider>)); }
async function click(selector: string) { const node = host.querySelector<HTMLElement>(selector); if (!node) throw new Error(selector); await act(async () => node.click()); }
async function fill(value: string) { const input = host.querySelector<HTMLInputElement>('[data-base-field="officialName"]'); if (!input) throw new Error("input missing"); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
it.each(["en", "zh"])("shows the complete persisted candidate before first freeze in %s and requires explicit review", async locale => {
  await render(editorFixture(), locale); const review = host.querySelector('[data-prepared-review]');
  expect(review?.textContent).toContain("Finance teams"); expect(review?.textContent).toContain("spreadsheets"); expect(review?.textContent).toContain("How can finance teams reduce late invoices?");
  expect(review?.querySelector('[data-geo-profile-field="productName"] input')).toHaveProperty("value", "Acme");
  expect(host.querySelector<HTMLButtonElement>('[data-freeze-prepared]')?.disabled).toBe(true);
  await click('[data-confirm-prepared]'); expect(host.querySelector<HTMLButtonElement>('[data-freeze-prepared]')?.disabled).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps dirty edits when switching stages and never merges them into frozen content", async () => {
  const view = editorFixture(), candidate = view.prepared!;
  await render({ ...view, frozen: { kbId: view.kbId, snapshotId: candidate.candidateId, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: candidate.baseDraftHash, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context } });
  await fill("My unsaved matching name"); await click('[data-stage="frozen"]');
  const frozen = host.querySelector('[data-frozen-v2]'); expect(frozen?.textContent).toContain("Acme"); expect(frozen?.textContent).not.toContain("My unsaved matching name");
  await click('[data-stage="input"]'); expect(host.querySelector('[data-base-field="officialName"]')).toHaveProperty("value", "My unsaved matching name");
  expect(host.querySelector<HTMLButtonElement>('[data-generate="questions"]')?.disabled).toBe(true); expect(fetch).not.toHaveBeenCalled();
});
it("tabs retain valid panel targets and support arrow-key focus without losing draft state", async () => {
  await render(); const input = host.querySelector<HTMLButtonElement>('[data-stage="input"]')!, frozen = host.querySelector<HTMLButtonElement>('[data-stage="frozen"]')!;
  for (const tab of [input, frozen]) expect(document.getElementById(tab.getAttribute("aria-controls")!)).not.toBeNull();
  input.focus(); await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(frozen); expect(frozen.getAttribute("aria-selected")).toBe("true"); expect(input.tabIndex).toBe(-1);
});
it("only a separate explicit new-input action can proceed past an old uncertain run", async () => {
  const view = editorFixture(); await render({ ...view, generations: { ...view.generations, roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "uncertain", result: null, errorReason: "outcome_unknown", attempt: { attemptedCalls: 1, delivery: "outcome_unknown", modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: null } } } });
  expect(host.querySelector<HTMLButtonElement>('[data-generate="roles"]')!.disabled).toBe(true);
  await fill("New saved brand"); vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] } })); await click('[data-save-v2]');
  expect(host.querySelector<HTMLButtonElement>('[data-new-generation="roles"]')?.disabled).toBe(false); expect(host.textContent).toContain("another charge");
  expect(host.querySelector<HTMLButtonElement>('[data-generate="roles"]')!.disabled).toBe(true);
});
it("offers explicit same-key resend only after an exact-key read returned not found", async () => {
  await render(); vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await click('[data-generate="roles"]');
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)); expect(host.querySelector('[data-resend-generation="roles"]')).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "not_found" } }, { status: 404 })); await click('[data-read-generation="roles"]');
  expect(host.querySelector<HTMLButtonElement>('[data-resend-generation="roles"]')?.disabled).toBe(false);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("network")); await click('[data-resend-generation="roles"]');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body))).toEqual(sent);
});

it("does not claim unsaved edits for a draft the visitor has not touched", async () => {
  const view = editorFixture();
  await render({ ...view, requiresSave: true });
  expect(host.querySelector("[data-save-pending]")?.textContent).toBe(geoKbV2EditorCopy("en").savePending);
  expect(host.textContent).not.toContain(geoKbV2EditorCopy("en").unsaved);
  expect(host.querySelector<HTMLButtonElement>('[data-generate="roles"]')?.disabled).toBe(true);
  await fill("Typed by a person");
  expect(host.textContent).toContain(geoKbV2EditorCopy("en").unsaved);
  expect(host.querySelector("[data-save-pending]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it("names the competitor difference between the Profile copy and the draft, and adopts a bounded subset", async () => {
  const view = editorFixture();
  const domains = ["astro.com", "astro-seek.com", "astrostyle.com", "cafeastrology.com", "astrotheme.com", "astro-charts.com"];
  const payload = { ...view.payload, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }],
    profileCopy: { ...view.payload.profileCopy, profile: { ...view.payload.profileCopy.profile, directCompetitors: domains } } };
  await render({ ...view, payload });
  const panel = host.querySelector("[data-geo-v2-measurement]");
  expect(panel).not.toBeNull();
  expect(panel?.querySelector("[data-gap-competitors]")?.textContent).toContain("6");
  expect(panel?.querySelector("[data-gap-competitors]")?.textContent).toContain("1");
  expect(host.querySelectorAll("[data-competitor-choice]")).toHaveLength(6);
  await click("[data-replace-competitors]");
  const choices = [...host.querySelectorAll<HTMLInputElement>("[data-competitor-choice]")];
  for (const choice of choices.slice(0, 5)) await act(async () => choice.click());
  expect(choices[5]?.disabled).toBe(true);
  await click("[data-apply-measurements]");
  const rows = [...host.querySelectorAll<HTMLInputElement>('[data-competitor-field="domain"]')].map(node => node.value);
  expect(rows).toEqual(domains.slice(0, 5));
  expect(fetch).not.toHaveBeenCalled();
});

it("turns an inherited feature into a pending fact carrying the source the Profile already recorded", async () => {
  const view = editorFixture();
  const profile = { ...view.payload.profileCopy.profile, coreFeatures: ["Free birth chart calculator"], fieldProvenance: [
    { path: "/coreFeatures" as const, derivation: "observed" as const, confidence: "high" as const, source: "public_page" as const,
      observedAt: "2026-08-31T05:34:14.891Z", evidenceUrls: ["https://example.com/tools"], limitation: null }] };
  await render({ ...view, payload: { ...view.payload, facts: [], profileCopy: { ...view.payload.profileCopy, profile } } });
  const add = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label")?.endsWith("Free birth chart calculator"));
  expect(add?.disabled).toBe(false);
  expect(host.querySelectorAll("[data-edit-fact]")).toHaveLength(0);
  await act(async () => add!.click());
  expect(host.querySelectorAll("[data-edit-fact]")).toHaveLength(1);
  const values = [...host.querySelectorAll<HTMLInputElement>('[data-fact-field="sourceUrl"], [data-fact-field="observedAt"], [data-fact-field="key"]')].map(node => node.value);
  expect(values).toContain("coreFeatures[0]");
  expect(values).toContain("https://example.com/tools");
  expect(values).toContain("2026-08-31T05:34:14.891Z");
  expect(host.querySelector("[data-edit-fact] [data-review-state]")?.textContent).toBe("Pending review");
  expect(fetch).not.toHaveBeenCalled();
});

it("reads as three named parts with one ordered progress model", async () => {
  await render();
  expect([...host.querySelectorAll("[data-geo-v2-block]")].map(node => node.getAttribute("data-geo-v2-block"))).toEqual(["profile", "supplement", "run"]);
  expect(host.querySelector('[data-geo-v2-block="profile"]')?.querySelector("[data-geo-profile-summary]")).not.toBeNull();
  expect(host.querySelector('[data-geo-v2-block="supplement"]')?.querySelector('[data-base-field="officialName"]')).not.toBeNull();
  expect(host.querySelector('[data-geo-v2-block="run"]')?.querySelector("[data-save-v2]")).not.toBeNull();
  expect([...host.querySelectorAll("[data-step]")].map(node => node.getAttribute("data-step"))).toEqual(["save", "sources", "roles", "prepare", "freeze"]);
  expect(host.querySelector('[data-step="freeze"]')?.textContent).toContain(en.tools.geoKnowledgeBase.steps.reasons.notReviewed);
});
it("names the one blocking gate on the progress list rather than a loose hint", async () => {
  await render({ ...editorFixture(), requiresSave: true });
  expect(host.querySelector('[data-step="save"]')?.getAttribute("data-step-state")).toBe("ready");
  expect(host.querySelector('[data-step="sources"]')?.getAttribute("data-step-state")).toBe("blocked");
  expect(host.querySelector('[data-step="sources"]')?.textContent).toContain(en.tools.geoKnowledgeBase.steps.reasons.unsaved);
});
it("says what a frozen version holds before showing all of it", async () => {
  const view = editorFixture(), candidate = view.prepared!;
  await render({ ...view, frozen: { kbId: view.kbId, snapshotId: candidate.candidateId, revision: 3, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: candidate.baseDraftHash, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context } });
  await click('[data-stage="frozen"]');
  const summary = host.querySelector("[data-frozen-summary]")?.textContent ?? "";
  expect(summary).toContain("v3");
  expect(summary).toContain(`${candidate.questionSet.questions.length} questions`);
  expect(summary).toContain(`${candidate.payload.roles.length} roles`);
  expect(summary).toContain(`${candidate.payload.competitors.filter(row => row.confirmed).length}/${candidate.payload.competitors.length} competitors confirmed`);
});

// next-intl renders a missing key as its own path instead of throwing, and the
// account route hands the client a narrowed message tree. Rendering against
// exactly that tree is the only thing that catches a namespace it forgot.
it.each(["en", "zh"])("renders no untranslated key path against the messages the account route provides in %s", async locale => {
  const messages = locale === "zh" ? zh : en;
  const narrowed = { account: messages.account, tools: { geoKnowledgeBase: messages.tools.geoKnowledgeBase } };
  const view = editorFixture();
  const payload = { ...view.payload, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }],
    profileCopy: { ...view.payload.profileCopy, profile: { ...view.payload.profileCopy.profile, directCompetitors: ["astro.com", "rival.example"] } } };
  await act(async () => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={narrowed}>
    <GeoKnowledgeBaseV2 initialView={{ ...view, payload }} locale={locale} inline confirmedProfileRevision={1} />
  </NextIntlClientProvider>));
  for (const details of host.querySelectorAll("details")) details.open = true;
  expect(host.querySelector("[data-geo-v2-measurement]")).not.toBeNull();
  expect(host.textContent).not.toMatch(/tools\.geoKnowledgeBase|account\.websites/u);
});
