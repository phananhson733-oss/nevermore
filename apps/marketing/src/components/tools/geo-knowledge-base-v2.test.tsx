// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKnowledgeBaseV2 } from "./geo-knowledge-base-v2.tsx";
import { editorFixture, sourceFixture } from "./geo-kb-v2-ui.test-fixtures.ts";
import { renderedText } from "./rendered-text.test-helper.ts";
import { geoV2Digest } from "../../lib/geo-tools/kb-v2-digest.ts";

let host: HTMLDivElement, root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(view = editorFixture(), locale = "en") { await act(async () => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}><GeoKnowledgeBaseV2 initialView={view} locale={locale} inline confirmedProfileRevision={1} /></NextIntlClientProvider>)); }
async function click(selector: string) { const node = host.querySelector<HTMLElement>(selector); if (!node) throw new Error(selector); await act(async () => node.click()); }
const editor = en.tools.geoKnowledgeBase.editor;
function unsupportedLanguageView() {
  const base = editorFixture();
  const profile = { ...base.payload.profileCopy.profile, locale: "zh-CN" };
  const payload = { ...base.payload, market: { ...base.payload.market, language: "zh-cn" }, profileCopy: { ...base.payload.profileCopy, profile } };
  return { ...base, prepared: null, frozen: null, sourceReceipt: null, draftHash: geoV2Digest(payload), profileCopyHash: geoV2Digest(payload.profileCopy), payload };
}
function savedUnsupportedLanguageView() {
  const base = editorFixture();
  const payload = { ...base.payload, market: { ...base.payload.market, language: "zh-cn" } };
  return { ...base, prepared: null, frozen: null, sourceReceipt: null, draftHash: geoV2Digest(payload), payload };
}

it("offers one action and no workbench", async () => {
  await render();
  // The inputs are maintained in the Product Profile. This page derives a
  // knowledge base from them, so it has the one button that does that and
  // nothing to type into: no stage tabs, no per-step buttons, no editors for
  // roles, competitors or facts, no candidate review checkbox.
  expect(host.querySelector("[data-generate-kb]")).not.toBeNull();
  for (const gone of ['[data-stage]', '[data-refresh-sources]', '[data-generate="roles"]', '[data-generate="questions"]',
    "[data-build-v2]", "[data-confirm-v2]", "[data-save-v2]", "[data-geo-v2-progress]", "[data-prepared-review]",
    "[data-edit-role]", "[data-edit-fact]", "[data-confirm-prepared]", "[data-freeze-prepared]", "[data-adopt-role]"]) {
    expect(host.querySelector(gone), gone).toBeNull();
  }
  expect(host.querySelectorAll("input, textarea, select")).toHaveLength(0);
  // The Profile it reads is still read out, in the Profile editor's own shape.
  expect(host.querySelectorAll("[data-geo-profile-field]").length).toBeGreaterThan(0);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["en", "GEO Knowledge Base generation currently supports English question languages only", "current GEO question language is zh-cn"],
  ["zh", "当前 GEO 知识库仅支持英文提问语言", "当前 GEO 提问语言是 zh-cn"],
])("blocks an unsupported question language before any request in %s", async (locale, boundary, actual) => {
  await render(unsupportedLanguageView(), locale);

  const button = host.querySelector<HTMLButtonElement>("[data-generate-kb]");
  expect(button?.disabled).toBe(true);
  expect(host.querySelector("[data-generation-language-warning]")?.textContent).toContain(boundary);
  expect(host.querySelector("[data-generation-language-warning]")?.textContent).toContain(actual);
  expect(host.textContent).not.toContain("unsupported_language");
  await click("[data-generate-kb]");
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["resend_same", "new_input"] as const)("disables explicit %s recovery when the current language is unsupported", async action => {
  const initial = savedUnsupportedLanguageView();
  const view = action === "resend_same" ? initial : { ...initial, draftVersion: initial.draftVersion + 1 };
  const old = action === "resend_same" ? { baseVersion: view.draftVersion, draftHash: view.draftHash } : { baseVersion: initial.draftVersion, draftHash: "a".repeat(64) };
  const inputIdentity = JSON.stringify({ kind: "roles", kbId: view.kbId, baseVersion: old.baseVersion,
    draftHash: old.draftHash, sourceReceiptRefs: [], displayLocale: "en" });
  sessionStorage.setItem(`gg:geo-kb-generation:${view.kbId}:roles`, JSON.stringify({ idempotencyKey: "old-key-123",
    draftHash: old.draftHash, baseVersion: old.baseVersion, generationId: null, inputIdentity, readNotFound: action === "resend_same" }));
  await render(view);

  const selector = action === "resend_same" ? '[data-resend-generation="roles"]' : '[data-new-generation="roles"]';
  const recovery = host.querySelector<HTMLButtonElement>(selector);
  expect(recovery).not.toBeNull();
  expect(recovery?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>("[data-generate-kb]")?.disabled).toBe(false);
  await click(selector);
  expect(fetch).not.toHaveBeenCalled();
});

const frozenAt = (base: ReturnType<typeof editorFixture>, contentHash: string) => {
  const candidate = base.prepared!;
  return { kbId: base.kbId, snapshotId: candidate.candidateId, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context };
};

it("says there is nothing yet, and names the action that makes one", async () => {
  await render({ ...editorFixture(), frozen: null });
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("none");
  expect(host.querySelector("[data-kb-empty]")?.textContent).toBe(editor.generateEmpty);
  expect(host.querySelector("[data-generate-kb]")?.textContent).toBe(editor.generate);
});

it("shows a version generated from the current Profile as the current one", async () => {
  const base = editorFixture();
  await render({ ...base, frozen: frozenAt(base, base.draftHash!) });
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("current");
  expect(host.querySelector("[data-generate-kb]")?.textContent).toBe(editor.regenerate);
  expect(host.querySelector("[data-frozen-v2]")).not.toBeNull();
  expect(host.querySelector("[data-kb-empty]")).toBeNull();
});

it("does not pass off a version from an older draft as the current answer", async () => {
  const base = editorFixture();
  await render({ ...base, frozen: frozenAt(base, "f".repeat(64)) });
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("stale");
  // Still shown: it is what exists, and hiding it would leave the page blank
  // while a real frozen version sits in the account.
  expect(host.querySelector("[data-frozen-v2]")).not.toBeNull();
});

it("shows what a frozen version holds, with every count distinct", async () => {
  const base = editorFixture(), candidate = base.prepared!;
  await render({ ...base, frozen: { kbId: base.kbId, snapshotId: candidate.candidateId, revision: 3, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: base.draftHash!, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context } });
  const summary = host.querySelector("[data-frozen-summary]");
  expect(summary).not.toBeNull();
  expect(renderedText(host)).toContain("Finance teams");
});

it("stops the run at the failed step instead of paying for the model call after it", async () => {
  const base = editorFixture();
  const view = { ...base, prepared: null, requiresSave: true };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await render(view);

  await click("[data-generate-kb]");

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("/api/tools/geo-knowledge-base/v2/draft");
  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(editor.buildStopped.save);
});

it("refuses to run onto a draft whose Profile copy is behind, and says which step comes first", async () => {
  const base = editorFixture();
  const view = { ...base, profile: base.profile === null ? null : { ...base.profile, reference: { ...base.profile.reference, snapshotRevision: 9, profileHash: "e".repeat(64) } } };
  await render(view);

  await click("[data-generate-kb]");

  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(editor.buildStopped.copy);
  // No derivation ran, so no part of one is reported.
  expect(host.querySelector("[data-build-fields]")).toBeNull();
});

it("never calls a dispatched or refused role generation a knowledge base", async () => {
  const base = editorFixture();
  const view = { ...base, prepared: null, payload: { ...base.payload, aliases: [] } };
  const roles = (state: string, errorReason: string | null) => Response.json({ data: { generation: { generationId: "44444444-4444-4444-8444-444444444444", kbId: view.kbId, kind: "roles", inputHash: "d".repeat(64), state, result: null, errorReason, attempt: null }, reused: false } });
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ data: { draftVersion: 2, contentHash: "c".repeat(64), updatedAt: "2026-08-31T00:00:00.000Z", blockers: [] } }))
    .mockResolvedValueOnce(Response.json({ data: sourceFixture({ ...view, draftVersion: 2, draftHash: "c".repeat(64) }) }))
    // The route answers 200 for a generation the provider refused.
    .mockResolvedValueOnce(roles("failed", "rate_limited"));
  await render(view);

  await click("[data-generate-kb]");

  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(editor.buildStopped.rolesFailed);
  expect(host.textContent).not.toContain(editor.buildDone);
  // The run stopped, so nothing after roles was requested or billed.
  expect(vi.mocked(fetch).mock.calls.map(call => String(call[0]))).not.toContain("/api/tools/geo-knowledge-base/v2/prepare");
});

it("says zero dispatched calls are not proof of no charge", async () => {
  const base = editorFixture();
  const attempt = { attemptedCalls: 0 as const, delivery: "not_attempted" as const, modelRequested: null, inputTokens: null, outputTokens: null, requestCount: null };
  await render({ ...base, prepared: null, generations: { ...base.generations, roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: base.kbId, kind: "roles", inputHash: "a".repeat(64), state: "failed", result: null, errorReason: "rate_limited", attempt } } });
  const section = host.querySelector('[data-generation-state="roles"]');
  expect(section?.textContent).toContain(editor.billingNote);
});

it("will not repeat a run whose outcome the server never settled", async () => {
  const base = editorFixture();
  const uncertain = { generationId: "44444444-4444-4444-8444-444444444444", kbId: base.kbId, kind: "roles" as const, inputHash: "a".repeat(64), state: "uncertain" as const, result: null, errorReason: "outcome_unknown" as const, attempt: { attemptedCalls: 1 as const, delivery: "outcome_unknown" as const, modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: null } };
  await render({ ...base, prepared: null, sourceReceipt: sourceFixture(base), generations: { ...base.generations, roles: uncertain } });
  expect(host.querySelector('[data-generation-state="roles"]')?.textContent).toContain("outcome is unknown");

  await click("[data-generate-kb]");

  // A request that may already have run and billed is the one thing the single
  // gesture must not repeat on its own. It stops and says which step.
  expect(fetch).not.toHaveBeenCalled();
  expect(host.querySelector("[data-build-outcome]")?.textContent).toBe(editor.buildStopped.roles);
});

it("says why a run was refused without repeating the code, and keeps an unmapped one", async () => {
  const base = editorFixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "input_stale" } }, { status: 409 }));
  await render({ ...base, prepared: null, requiresSave: true });
  await click("[data-generate-kb]");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Saved input or the Profile source version changed");
  expect(host.textContent).not.toContain("input_stale");

  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "teapot" } }, { status: 418 }));
  await click("[data-generate-kb]");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("teapot");
});

it.each([
  ["en", "The model step was not called, but source refresh may already have completed"],
  ["zh", "本次被拒绝的模型步骤没有发起调用，但之前的来源刷新可能已经完成"],
])("localizes a server language refusal honestly in %s", async (locale, message) => {
  const base = editorFixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "unsupported_language" } }, { status: 422 }));
  await render({ ...base, prepared: null, requiresSave: true }, locale);

  await click("[data-generate-kb]");

  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message);
  expect(host.textContent).not.toContain("unsupported_language");
});

it.each(["en", "zh"])("renders no untranslated key path in %s", async locale => {
  const base = editorFixture(), candidate = base.prepared!;
  await render({ ...base, frozen: { kbId: base.kbId, snapshotId: candidate.candidateId, revision: 1, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: base.draftHash!, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context } }, locale);
  expect(host.textContent).not.toMatch(/tools\.geoKnowledgeBase\./u);
  expect(host.textContent).not.toMatch(/account\.websites\./u);
});
