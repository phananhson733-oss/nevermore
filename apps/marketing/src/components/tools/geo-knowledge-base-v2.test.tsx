// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKnowledgeBaseV2 } from "./geo-knowledge-base-v2.tsx";
import { GEO_KB_V2_AUTOSAVE_MS } from "./use-geo-kb-v2-editor.ts";
import { editorFixture, sourceFixture } from "./geo-kb-v2-ui.test-fixtures.ts";
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
  expect(host.querySelector("[data-save-pending]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.savePending);
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
  expect(panel?.querySelector("[data-gap-competitors]")?.textContent).toBe(en.tools.geoKnowledgeBase.measurementReview.gapCompetitors.replace("{source}", "6").replace("{draft}", "1").replace("{missing}", "5"));
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

it("builds the whole knowledge base from the confirmed Profile in one gesture", async () => {
  const base = editorFixture();
  // A knowledge base that has the Profile copy but none of what GEO derives
  // from it: this is the state a visitor lands in right after confirming.
  const view = { ...base, prepared: null, payload: { ...base.payload, officialName: "", aliases: [], categoryTerms: [], competitors: [],
    profileCopy: { ...base.payload.profileCopy, profile: { ...base.payload.profileCopy.profile, categories: ["invoice software"], directCompetitors: ["rival.example"] } } } };
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ data: { draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] } }))
    .mockResolvedValueOnce(Response.json({ data: sourceFixture({ ...view, draftVersion: 2, draftHash: "c".repeat(64) }) }))
    .mockResolvedValueOnce(Response.json({ data: { generation: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state: "dispatched", result: null, errorReason: null, attempt: null }, reused: false } }));
  await render(view);

  await click("[data-build-v2]");

  const paths = vi.mocked(fetch).mock.calls.map(call => String(call[0]));
  expect(paths).toEqual(["/api/tools/geo-knowledge-base/v2/draft", "/api/tools/geo-knowledge-base/v2/sources", "/api/tools/geo-knowledge-base/v2/roles"]);
  const saved = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as { payload: { officialName: string; aliases: string[]; categoryTerms: string[]; competitors: { domain: string }[] } };
  expect(saved.payload.officialName).toBe("Acme");
  expect(saved.payload.categoryTerms).toEqual(["invoice software"]);
  expect(saved.payload.aliases).toContain("Acme");
  expect(saved.payload.competitors.map(row => row.domain)).toEqual(["rival.example"]);
  const report = host.querySelector("[data-geo-v2-build-report]");
  expect(report?.querySelector("[data-build-outcome]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.buildDone);
  expect(report?.querySelector("[data-build-aliases]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.buildAliases.adopted);
});

it("stops the build at the failed step instead of paying for the model call after it", async () => {
  const base = editorFixture();
  const view = { ...base, prepared: null, payload: { ...base.payload, aliases: [] } };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await render(view);

  await click("[data-build-v2]");

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("/api/tools/geo-knowledge-base/v2/draft");
  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.buildStopped.save);
});

it("refuses to build onto a draft whose Profile copy is behind, and says which step comes first", async () => {
  const base = editorFixture();
  const view = { ...base, profile: base.profile === null ? null : { ...base.profile, reference: { ...base.profile.reference, snapshotRevision: 9, profileHash: "e".repeat(64) } } };
  await render(view);

  await click("[data-build-v2]");

  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.buildStopped.copy);
});
it("reads as three named parts with one ordered progress model", async () => {
  await render();
  expect([...host.querySelectorAll("[data-geo-v2-block]")].map(node => node.getAttribute("data-geo-v2-block"))).toEqual(["profile", "supplement", "run"]);
  expect(host.querySelector('[data-geo-v2-block="profile"]')?.querySelector("[data-geo-profile-summary]")).not.toBeNull();
  expect(host.querySelector('[data-geo-v2-block="supplement"]')?.querySelector('[data-base-field="officialName"]')).not.toBeNull();
  // The two primary actions sit in the header, as they do in the Profile
  // editor, so the first thing on screen is the thing most visitors press.
  // The run block keeps the per-step generation actions the progress list names.
  const header = host.querySelector("[data-save-state]")?.closest("div.rounded-card");
  expect(header?.querySelector("[data-build-v2]")).not.toBeNull();
  expect(header?.querySelector("[data-save-v2]")).not.toBeNull();
  expect(host.querySelector('[data-geo-v2-block="run"]')?.querySelector("[data-refresh-sources]")).not.toBeNull();
  expect(host.querySelector('[data-geo-v2-block="run"]')?.querySelector("[data-save-v2]")).toBeNull();
  expect([...host.querySelectorAll("[data-step]")].map(node => node.getAttribute("data-step"))).toEqual(["save", "sources", "roles", "prepare", "freeze"]);
  expect(host.querySelector('[data-step="freeze"]')?.textContent).toContain(en.tools.geoKnowledgeBase.steps.reasons.notReviewed);
});
it("names the one blocking gate on the progress list rather than a loose hint", async () => {
  await render({ ...editorFixture(), requiresSave: true });
  expect(host.querySelector('[data-step="save"]')?.getAttribute("data-step-state")).toBe("ready");
  expect(host.querySelector('[data-step="sources"]')?.getAttribute("data-step-state")).toBe("blocked");
  expect(host.querySelector('[data-step="sources"]')?.textContent).toContain(en.tools.geoKnowledgeBase.steps.reasons.unsaved);
});
it("says what a frozen version holds before showing all of it, with every count distinct", async () => {
  const view = editorFixture(), c = view.prepared!, role = c.payload.roles[0]!;
  // Distinct numbers, so swapping any two placeholders or reporting the total instead of the confirmed subset is caught.
  const fact = c.payload.facts[0]!;
  const payload = { ...c.payload, roles: [role, { ...role, id: "r2", review: "excluded" as const }],
    facts: [fact, { ...fact, key: "f2" }, { ...fact, key: "f3", review: "excluded" as const }, { ...fact, key: "f4", review: "excluded" as const }, { ...fact, key: "f5", review: "pending" as const }],
    competitors: [{ domain: "a.example", brandName: "A", confirmed: true }, { domain: "b.example", brandName: "B", confirmed: false }, { domain: "c.example", brandName: "C", confirmed: false }] };
  await render({ ...view, frozen: { kbId: view.kbId, snapshotId: c.candidateId, revision: 7, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: c.baseDraftHash, questionSetHash: c.context.questionSetHash, questionCount: 5, payload, questionSet: c.questionSet, context: c.context } });
  await click('[data-stage="frozen"]');
  const summary = host.querySelector("[data-frozen-summary] p")?.textContent ?? "";
  // Excluded and pending rows stay in the frozen record but do not measure; the line says so.
  expect(summary).toBe("v7 · 5 questions · 1/2 roles accepted · 1/3 competitors confirmed · 2/5 facts accepted · 2026-08-31T00:00:00.000Z");
  expect(host.querySelector("[data-frozen-summary] p details")).toBeNull();
  expect(host.querySelector("[data-frozen-summary] details")?.textContent).toContain(c.candidateId);
});
it("reads one role and one fact in the singular", async () => {
  const view = editorFixture(), c = view.prepared!;
  await render({ ...view, frozen: { kbId: view.kbId, snapshotId: c.candidateId, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: c.baseDraftHash, questionSetHash: c.context.questionSetHash, questionCount: 1, payload: c.payload, questionSet: c.questionSet, context: c.context } });
  await click('[data-stage="frozen"]');
  expect(host.querySelector("[data-frozen-summary] p")?.textContent).toContain("1 question · 1/1 roles accepted · 1/1 competitors confirmed · 1/1 facts accepted");
});
it("adopts a renamed product into the matching name and clears the gap notice", async () => {
  const view = editorFixture();
  const profile = { ...view.payload.profileCopy.profile, productName: "Renamed" };
  await render({ ...view, payload: { ...view.payload, profileCopy: { ...view.payload.profileCopy, profile } } });
  expect(host.querySelector("[data-gap-fields]")?.textContent).toBe(en.tools.geoKnowledgeBase.measurementReview.gapFields.replace("{fields}", "Matching name"));
  await click('[data-measurement-field="officialName"]'); await click("[data-apply-measurements]");
  expect(host.querySelector<HTMLInputElement>('[data-base-field="officialName"]')?.value).toBe("Renamed");
  expect(host.querySelector("[data-geo-v2-measurement]")).toBeNull();
});
it("says zero dispatched calls are not proof of no charge, and keeps raw codes in the disclosure", async () => {
  const view = editorFixture();
  await render({ ...view, generations: { ...view.generations, roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "a".repeat(64), state: "failed", result: null, errorReason: "model_unavailable",
    attempt: { attemptedCalls: 0, delivery: "not_attempted", modelRequested: null, inputTokens: null, outputTokens: null, requestCount: null } } } });
  const panel = host.querySelector('[data-generation-state="roles"]');
  const e = en.tools.geoKnowledgeBase.editor;
  expect(panel?.textContent).toContain(e.billingNote);
  expect(panel?.textContent).toContain(e.deliveries.not_attempted);
  expect(panel?.querySelector("details")?.textContent).toContain("model_unavailable");
  expect(panel?.querySelector("dl")?.textContent).not.toContain("model_unavailable");
});
it("stops promising the draft saves itself once a write has been refused", async () => {
  vi.useFakeTimers();
  try {
    await render();
    const hint = () => host.querySelector("[data-autosave-hint]");
    expect(hint()?.getAttribute("data-autosave-hint")).toBe("on");
    expect(hint()?.textContent).toBe(en.tools.geoKnowledgeBase.editor.autosave);
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
    await fill("Typed into a rate limit");
    await act(async () => { await vi.advanceTimersByTimeAsync(GEO_KB_V2_AUTOSAVE_MS + 100); });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Nothing is armed any more, so the page must not keep saying otherwise.
    expect(hint()?.getAttribute("data-autosave-hint")).toBe("failed");
    expect(hint()?.textContent).toBe(en.tools.geoKnowledgeBase.editor.autosaveHeld.failed);
    expect(hint()?.textContent).not.toBe(en.tools.geoKnowledgeBase.editor.autosave);
  } finally { vi.useRealTimers(); }
});
it("announces save state from one persistent live region and states autosave truthfully", async () => {
  const view = editorFixture();
  await render({ ...view, generations: { ...view.generations, roles: { generationId: "55555555-5555-4555-8555-555555555555", kbId: view.kbId, kind: "roles", inputHash: "b".repeat(64), state: "dispatched", result: null, errorReason: null, attempt: null } } });
  const live = host.querySelector("[aria-live=\"polite\"][data-save-state]");
  expect(live?.getAttribute("data-save-state")).toBe("idle");
  expect(host.querySelector("[data-autosave-hint]")?.getAttribute("data-autosave-hint")).toBe("running");
  expect(host.querySelector("[data-autosave-hint]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.autosaveHeld.running);
  await fill("Typed");
  expect(host.querySelector("[aria-live=\"polite\"][data-save-state]")).toBe(live);
  expect(live?.getAttribute("data-save-state")).toBe("unsaved");
  expect(host.querySelectorAll("[role=\"status\"][data-save-state]")).toHaveLength(0);
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

it("tells a never-saved draft apart from one whose stored copy differs", async () => {
  await render({ ...editorFixture(), draftVersion: 0, draftHash: null, requiresSave: true });
  expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("neverSaved");
  expect(host.querySelector("[data-save-state]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.neverSaved);
});
it("does not call a source receipt done once the draft has moved past the one it inspected", async () => {
  const view = editorFixture();
  await render({ ...view, sourceReceipt: { ...sourceFixture(view), draftHash: "f".repeat(64) } });
  expect(host.querySelector('[data-step="sources"]')?.getAttribute("data-step-state")).not.toBe("done");
  await act(async () => root.unmount()); root = createRoot(host);
  await render({ ...view, sourceReceipt: sourceFixture(view) });
  expect(host.querySelector('[data-step="sources"]')?.getAttribute("data-step-state")).toBe("done");
});
it("does not adopt an empty competitor list as a replacement", async () => {
  const view = editorFixture();
  const payload = { ...view.payload, competitors: [{ domain: "astro.com", brandName: "Astrodienst", confirmed: true }],
    profileCopy: { ...view.payload.profileCopy, profile: { ...view.payload.profileCopy.profile, directCompetitors: ["astro.com", "rival.example"] } } };
  await render({ ...view, payload });
  await click("[data-replace-competitors]");
  expect(host.querySelector<HTMLButtonElement>("[data-apply-measurements]")?.disabled).toBe(true);
});

it("says a change to a crawl-supported fact will cost its evidence", async () => {
  const view = editorFixture();
  const fact = view.payload.facts[0]!;
  await render({ ...view, payload: { ...view.payload, facts: [{ ...fact, supportRef: { receiptId: "33333333-3333-4333-8333-333333333333", evidenceId: "F1" } }] } });
  expect(host.querySelector("[data-support-ref-note]")?.textContent).toBe(en.tools.geoKnowledgeBase.editor.supportRefNote);
  await act(async () => root.unmount()); root = createRoot(host);
  await render({ ...view, payload: { ...view.payload, facts: [{ ...fact, supportRef: null }] } });
  expect(host.querySelector("[data-support-ref-note]")).toBeNull();
});
