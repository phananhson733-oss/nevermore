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
import { geoKbV2Copy } from "./geo-kb-v2-copy.ts";
import { geoKnowledgePackFixture } from "./geo-knowledge-pack.test-fixtures.ts";
import type { GeoKbFrozenSummary } from "./geo-kb-wire.ts";

let host: HTMLDivElement, root: Root, onStarted: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); sessionStorage.clear(); onStarted = vi.fn<() => void>(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(view = editorFixture(), locale = "en") { await act(async () => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}><GeoKnowledgeBaseV2 initialView={view} locale={locale} inline confirmedProfileRevision={1} onStarted={onStarted} /></NextIntlClientProvider>)); }
/**
 * A knowledge base with nothing stored in it: no draft and no published
 * version. `draftVersion: 0` and `draftHash: null` are not free choices -- the
 * wire parser refuses any view where the two disagree -- and the website GEO
 * route answers exactly this for an owner who has never built one
 * (`../../lib/geo-tools/kb-editor-loader.reachability.test.ts` reads it off the
 * HTTP body).
 */
function emptyView(overrides: Partial<ReturnType<typeof editorFixture>> = {}) {
  const base = editorFixture();
  return { ...base, draftVersion: 0, draftHash: null, requiresSave: true, frozen: null, prepared: null, sourceReceipt: null, ...overrides };
}
const CREATED = { kbId: editorFixture().kbId, draftVersion: 1, contentHash: "c".repeat(64), updatedAt: "2026-09-07T00:00:00.000Z", generationInputHash: "e".repeat(64), blockers: [] };
async function click(selector: string) { const node = host.querySelector<HTMLElement>(selector); if (!node) throw new Error(selector); await act(async () => node.click()); }
const editor = en.tools.geoKnowledgeBase.editor;
it("keeps a failed update customer-facing beside the previous knowledge", async () => {
  const base = editorFixture();
  await render({ ...base, frozen: frozenAt(base, base.draftHash!), generations: { ...base.generations,
    roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: base.kbId, kind: "roles", inputHash: "a".repeat(64),
      state: "failed", result: null, errorReason: "invalid_output", attempt: { attemptedCalls: 1, delivery: "response_received",
        modelRequested: "private-model", inputTokens: 12, outputTokens: 34, requestCount: 1 } },
  } }, "zh");
  expect(host.querySelector("[data-kb-state]")?.textContent).toContain("更新未完成，仍显示上次的知识内容");
  for (const hidden of ["这次生成做了什么", "生成角色建议", "实际发起的模型调用", "响应情况", "服务端原因", "invalid_output", "private-model", "已按当前产品档案生成并冻结"]) {
    expect(host.outerHTML).not.toContain(hidden);
  }
  expect(host.querySelectorAll("[data-version-question]")).not.toHaveLength(0);
  expect(host.querySelector("[data-read-generation]")).not.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
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
  // Product data belongs to the separate Profile module, not this GEO view.
  expect(host.querySelectorAll("[data-geo-profile-field]")).toHaveLength(0);
  expect(host.querySelector("[data-geo-profile-copy]")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["en", "three billed model calls", "two billed model calls"],
  ["zh", "三次模型调用（计费三次）", "两次模型调用"],
])("states the actual three-call cost of the one-click flow in %s", async (locale, expected, stale) => {
  await render(editorFixture(), locale);
  expect(renderedText(host)).toContain(expected);
  expect(renderedText(host)).not.toContain(stale);
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

it("resends a knowledge-backed question request with its exact original generation id and key", async () => {
  const base = editorFixture(), sourceReceipt = sourceFixture(base), sourceReceiptRefs = [{ receiptId: sourceReceipt.receiptId, contentHash: sourceReceipt.contentHash }];
  const idempotencyKey = "knowledge-question-key-1";
  const inputIdentity = JSON.stringify({ kind: "questions", kbId: base.kbId, baseVersion: base.draftVersion, draftHash: base.draftHash,
    sourceReceiptRefs, displayLocale: "en", knowledgeGenerationId: "55555555-5555-4555-8555-555555555555" });
  sessionStorage.setItem(`gg:geo-kb-generation:${base.kbId}:questions`, JSON.stringify({ idempotencyKey, draftHash: base.draftHash,
    baseVersion: base.draftVersion, generationId: null, inputIdentity, readNotFound: true }));
  vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic ambiguous resend"));
  await render({ ...base, sourceReceipt });

  const recovery = host.querySelector<HTMLButtonElement>('[data-resend-generation="questions"]');
  expect(recovery).not.toBeNull();
  await click('[data-resend-generation="questions"]');

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("/api/tools/geo-knowledge-base/v2/prepare");
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toMatchObject({ idempotencyKey,
    knowledgeGenerationId: "55555555-5555-4555-8555-555555555555" });
});

it("does not carry a stale knowledge id into an explicitly changed question input", async () => {
  const initial = editorFixture(), view = { ...initial, draftVersion: initial.draftVersion + 1, draftHash: "e".repeat(64) };
  const sourceReceipt = sourceFixture(view), idempotencyKey = "old-knowledge-question-key";
  const inputIdentity = JSON.stringify({ kind: "questions", kbId: view.kbId, baseVersion: initial.draftVersion, draftHash: initial.draftHash,
    sourceReceiptRefs: [{ receiptId: sourceReceipt.receiptId, contentHash: sourceReceipt.contentHash }], displayLocale: "en",
    knowledgeGenerationId: "55555555-5555-4555-8555-555555555555" });
  sessionStorage.setItem(`gg:geo-kb-generation:${view.kbId}:questions`, JSON.stringify({ idempotencyKey, draftHash: initial.draftHash,
    baseVersion: initial.draftVersion, generationId: null, inputIdentity }));
  vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic changed input"));
  await render({ ...view, sourceReceipt });

  expect(host.querySelector('[data-new-generation="questions"]')).not.toBeNull();
  await click('[data-new-generation="questions"]');

  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  expect(body).not.toHaveProperty("knowledgeGenerationId");
  expect(body.idempotencyKey).not.toBe(idempotencyKey);
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

it.each(["en", "zh"])("keeps internal provenance and version identity out of the customer frozen view in %s", async locale => {
  const base = editorFixture(), candidate = base.prepared!;
  const frozen = { kbId: base.kbId, snapshotId: candidate.candidateId, revision: 3, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: base.draftHash!, questionSetHash: candidate.context.questionSetHash, questionCount: candidate.questionSet.questions.length, payload: candidate.payload, questionSet: candidate.questionSet, context: candidate.context };
  await render({ ...base, frozen }, locale);

  const copy = geoKbV2Copy(locale);
  for (const heading of [copy.sections.identity, copy.sections.competitors, copy.sections.roles, copy.sections.facts, copy.sections.sources, copy.sections.version]) {
    expect(renderedText(host)).not.toContain(heading);
  }
  expect(host.querySelector("[data-frozen-summary]")).toBeNull();
  expect(host.querySelector("[data-geo-copy-identity]")).toBeNull();
  expect(host.querySelector("[data-evidence-catalog]")).toBeNull();
  for (const internalValue of [frozen.snapshotId, frozen.frozenAt, frozen.payload.profileCopy.profileHash, frozen.context.payloadHash, frozen.context.questionSetHash, frozen.context.contentHash]) {
    expect(host.textContent).not.toContain(internalValue);
  }

  expect(host.querySelectorAll("[data-geo-profile-field]")).toHaveLength(0);
  expect(host.querySelector("[data-geo-profile-copy]")).toBeNull();
  expect(host.querySelector('a[href$="#website-profile"]')).toBeNull();
  expect(renderedText(host)).not.toContain(frozen.payload.profileCopy.profile.productName);
  expect(host.querySelectorAll("[data-version-competitor]")).toHaveLength(0);
  expect(host.querySelectorAll("[data-version-question]")).toHaveLength(frozen.questionSet.questions.length);
  expect(renderedText(host)).toContain(frozen.questionSet.questions[0]!.text);
});

it("shows only GEO questions for a historical V1 freeze, with no expandable product archive or version identity", async () => {
  const base = editorFixture();
  const frozen: GeoKbFrozenSummary = {
    snapshotId: "77777777-7777-4777-8777-777777777777",
    revision: 9876543,
    frozenAt: "2026-08-30T00:00:00.000Z",
    contentHash: "9".repeat(64),
    questionSetHash: "8".repeat(64),
    questionCount: 1,
    retrievalCount: 1,
    registryVersion: "legacy-registry-secret",
    payload: {
      schemaVersion: "marketing-geo-kb.v1",
      targetUrl: base.payload.targetUrl,
      officialName: "Legacy Product Archive Secret",
      aliases: ["Legacy Alias Secret"],
      categoryTerms: ["Legacy Category Secret"],
      market: base.payload.market,
      roles: [],
      competitors: [],
      facts: [],
      importedFrom: null,
    },
    questions: [{ id: "legacy-question-internal-id", text: "Which historical GEO question still applies?", layer: "discovery", mode: "retrieval", calibrated: false, requiredEntities: ["historical GEO"] }],
  };
  await render({ ...base, frozen });

  expect(renderedText(host)).toContain("Which historical GEO question still applies?");
  expect(host.querySelector("details[data-frozen-knowledge-base]")).toBeNull();
  const question = host.querySelector("[data-legacy-question]");
  expect(question?.querySelectorAll("p")).toHaveLength(0);
  expect(Array.from(question?.querySelectorAll("span") ?? []).every(node => node.classList.contains("text-[13px]"))).toBe(true);
  for (const hidden of [frozen.snapshotId, frozen.frozenAt, frozen.contentHash, frozen.questionSetHash!, frozen.registryVersion!, "9876543", "Legacy Product Archive Secret", "Legacy Alias Secret", "Legacy Category Secret", "legacy-question-internal-id"]) {
    expect(host.outerHTML).not.toContain(hidden);
  }
});

it("keeps retained recovery identities and draft versions out of the page even beside frozen knowledge", async () => {
  const base = editorFixture(), frozen = frozenAt(base, base.draftHash!);
  const generationId = "77777777-7777-4777-8777-777777777778";
  const idempotencyKey = "private-recovery-key-123";
  const inputIdentity = JSON.stringify({ kind: "roles", kbId: base.kbId, baseVersion: 9876544, draftHash: "7".repeat(64), sourceReceiptRefs: [], displayLocale: "en" });
  sessionStorage.setItem(`gg:geo-kb-generation:${base.kbId}:history`, JSON.stringify([{ id: `roles:${generationId}`, kind: "roles", idempotencyKey,
    generationId, inputIdentity, draftHash: "7".repeat(64), baseVersion: 9876544, state: "uncertain", errorReason: "outcome_unknown" }]));
  await render({ ...base, frozen });

  expect(host.querySelector("[data-read-retained]")).not.toBeNull();
  for (const hidden of [generationId, idempotencyKey, inputIdentity, "9876544"]) expect(host.outerHTML).not.toContain(hidden);
});

it("shows the frozen customer knowledge pack before questions while keeping its wire identity hidden", async () => {
  const base = editorFixture(), knowledgePack = geoKnowledgePackFixture();
  const frozen = { ...frozenAt(base, base.draftHash!), wireSchemaVersion: "marketing-geo-kb-frozen-wire.v1" as const, knowledgePack };
  await render({ ...base, frozen }, "en");

  const pack = host.querySelector("[data-geo-knowledge-pack]");
  const questions = host.querySelector("[data-version-question]")?.closest("section");
  expect(pack).not.toBeNull();
  expect(questions).not.toBeNull();
  expect(pack!.compareDocumentPosition(questions!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(host.textContent).toContain("Example Cloud gives small teams a shared workflow");
  const customerHtml = host.outerHTML;
  const internalValues = new Set([
    frozen.wireSchemaVersion, frozen.snapshotId, frozen.kbId, frozen.contentHash, frozen.questionSetHash,
    frozen.payload.schemaVersion, frozen.payload.profileCopy.schemaVersion, frozen.payload.profileCopy.snapshotId, frozen.payload.profileCopy.profileHash,
    frozen.questionSet.schemaVersion, frozen.questionSet.registryVersion, frozen.questionSet.methodVersion,
    frozen.context.schemaVersion, frozen.context.candidateId, frozen.context.contentHash, frozen.context.payloadHash, frozen.context.questionSetHash,
    knowledgePack.schemaVersion, knowledgePack.contentHash, knowledgePack.meta.generatedAt,
    ...knowledgePack.sourceCatalogue.flatMap(source => [source.id, source.bodyHash]),
    ...(knowledgePack.entity.status === "unavailable" ? [] : knowledgePack.entity.value.sourceRefs),
    ...(knowledgePack.facts.status === "unavailable" ? [] : knowledgePack.facts.value.flatMap(item => [item.id, ...item.sourceRefs])),
    ...(knowledgePack.qa.status === "unavailable" ? [] : knowledgePack.qa.value.flatMap(item => [item.id, ...item.sourceRefs])),
    ...(knowledgePack.comparisons.status === "unavailable" ? [] : knowledgePack.comparisons.value.flatMap(item => [item.id, ...item.sourceRefs, ...item.rows.flatMap(row => [row.id, ...row.sourceRefs])])),
    ...(knowledgePack.scope.status === "unavailable" ? [] : Object.values(knowledgePack.scope.value).flatMap(items => items.flatMap(item => [item.id, ...item.sourceRefs]))),
    ...(knowledgePack.evidence.status === "unavailable" ? [] : Object.values(knowledgePack.evidence.value).flatMap(items => items.flatMap(item => [item.id, ...item.sourceRefs]))),
    ...(knowledgePack.coverage.status === "unavailable" ? [] : knowledgePack.coverage.value.flatMap(item => [item.id, ...item.sourceRefs])),
    ...frozen.context.evidenceCatalog.map(item => item.id),
    ...frozen.payload.roles.flatMap(role => [role.source.generationId, role.source.itemId, ...role.source.evidenceRefs]),
    ...frozen.questionSet.entityCatalog.map(entity => entity.id),
    ...frozen.questionSet.questions.flatMap(question => [question.id, question.templateId, question.provenance.generatorVersion, ...question.provenance.evidenceRefs, ...question.provenance.entityRefs]),
  // `none` is also an ordinary Tailwind/class token. Its presence is not the
  // registry version leaking, so keep the serialized scan on identities that
  // are distinguishable from presentation vocabulary.
  ].filter((value): value is string => typeof value === "string" && value !== "" && value !== "none"));
  for (const internalValue of internalValues) expect(customerHtml).not.toContain(internalValue);
  expect(host.querySelector("details")).toBeNull();
});

it("stops the run at the failed step instead of paying for the model call after it", async () => {
  const base = editorFixture();
  const view = { ...base, prepared: null, requiresSave: true };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  await render(view);

  await click("[data-generate-kb]");

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe("/api/tools/geo-knowledge-base/v2/draft");
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("failed");
  expect(host.querySelector("[data-geo-v2-build-report]")).toBeNull();
});

it("refuses to run onto a draft whose Profile copy is behind, and says which step comes first", async () => {
  const base = editorFixture();
  const view = { ...base, profile: base.profile === null ? null : { ...base.profile, reference: { ...base.profile.reference, snapshotRevision: 9, profileHash: "e".repeat(64) } } };
  await render(view);

  await click("[data-generate-kb]");

  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Save the latest website information");
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

  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("failed");
  expect(host.querySelector("[data-geo-v2-build-report]")).toBeNull();
  expect(host.textContent).not.toContain(editor.buildDone);
  // The run stopped, so nothing after roles was requested or billed.
  expect(vi.mocked(fetch).mock.calls.map(call => String(call[0]))).not.toContain("/api/tools/geo-knowledge-base/v2/prepare");
});

it("hides zero-call telemetry without making a no-charge claim", async () => {
  const base = editorFixture();
  const attempt = { attemptedCalls: 0 as const, delivery: "not_attempted" as const, modelRequested: null, inputTokens: null, outputTokens: null, requestCount: null };
  await render({ ...base, prepared: null, generations: { ...base.generations, roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: base.kbId, kind: "roles", inputHash: "a".repeat(64), state: "failed", result: null, errorReason: "rate_limited", attempt } } });
  const section = host.querySelector('[data-generation-state="roles"]');
  expect(section?.querySelector("dl")).toBeNull();
  expect(section?.textContent).toBe("Check update");
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
  expect(host.querySelector("[data-kb-state]")?.getAttribute("data-kb-state")).toBe("pending");
});

it("keeps an unsettled knowledge-content request visible and recoverable", async () => {
  const base = editorFixture();
  const uncertain = { generationId: "44444444-4444-4444-8444-444444444445", kbId: base.kbId, kind: "knowledge_pack" as const,
    inputHash: "b".repeat(64), state: "uncertain" as const, result: null, errorReason: "outcome_unknown" as const,
    attempt: { attemptedCalls: 1 as const, delivery: "outcome_unknown" as const, modelRequested: "fixture", inputTokens: null, outputTokens: null, requestCount: null } };
  await render({ ...base, prepared: null, sourceReceipt: sourceFixture(base), generations: { ...base.generations, knowledge_pack: uncertain } });

  const section = host.querySelector('[data-generation-state="knowledge_pack"]');
  expect(section?.querySelector("h3")).toBeNull();
  expect(section?.textContent).toContain("outcome is unknown");
  expect(section?.querySelector('[data-read-generation="knowledge_pack"]')).not.toBeNull();
});

it("uses customer guidance and never displays an unmapped server code", async () => {
  const base = editorFixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "input_stale" } }, { status: 409 }));
  await render({ ...base, prepared: null, requiresSave: true });
  await click("[data-generate-kb]");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Save the latest website information");
  expect(host.textContent).not.toContain("input_stale");

  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "teapot" } }, { status: 418 }));
  await click("[data-generate-kb]");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("The update could not finish");
  expect(host.outerHTML).not.toContain("teapot");
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

const cardCopy = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;

/**
 * The customer sentences used to live in two inline locale literals inside the
 * component, which put shipped copy outside the catalog and left three catalog
 * keys orphaned behind it. Pinned to the catalog value, in both locales, so a
 * silent regression to a hard-coded string fails here.
 */
it.each(["en", "zh"])("reads its customer status line from the catalog in %s", async locale => {
  const base = editorFixture();
  await render({ ...base, frozen: frozenAt(base, base.draftHash!), generations: { ...base.generations,
    roles: { generationId: "44444444-4444-4444-8444-444444444444", kbId: base.kbId, kind: "roles", inputHash: "a".repeat(64),
      state: "failed", result: null, errorReason: "invalid_output", attempt: { attemptedCalls: 1, delivery: "response_received",
        modelRequested: "private-model", inputTokens: 12, outputTokens: 34, requestCount: 1 } },
  } }, locale);

  expect(host.querySelector("[data-kb-state]")?.textContent).toBe(cardCopy(locale).state.failed);
  expect(host.querySelector('[data-read-generation="roles"]')?.textContent).toBe(cardCopy(locale).state.check);
});

it("leaves no orphaned generate-state keys behind the migrated copy", () => {
  for (const messages of [en, zh]) {
    const editorKeys = Object.keys(messages.tools.geoKnowledgeBase.editor as Record<string, unknown>);
    for (const removed of ["generateNone", "generateCurrent", "generateStale"]) {
      expect(editorKeys, removed).not.toContain(removed);
    }
    expect(Object.keys(messages.tools.geoKnowledgeBase as Record<string, unknown>)).toContain("card");
  }
});

it("draws the shared knowledge base card shell without inventing actions this flow does not have", async () => {
  await render();

  expect(host.querySelector("[data-geo-kb-card]")).not.toBeNull();
  expect(host.querySelector("[data-geo-kb-v2]")).not.toBeNull();
  // This flow still generates and freezes in one gesture, so there is no
  // separate free publish action and no reviewable draft to section up yet.
  expect(host.querySelector("[data-publish-kb]")).toBeNull();
  expect(host.querySelector("[data-kb-publish-box]")).toBeNull();
  expect(host.querySelector("[data-kb-section]")).toBeNull();
});

/* ------------------------------------------------------------------ */
/* Starting a knowledge base that does not exist yet                    */
/* ------------------------------------------------------------------ */

/**
 * The cut between the two formats, from the card's side.
 *
 * Nothing in the product created a v3 draft: `createGeoKbV3Draft` had no
 * non-test caller, so an empty knowledge base got the v2 card, its button wrote
 * a v2 draft, and the create route then refused that draft forever. These pin
 * which knowledge base is offered the new start gesture and which is left
 * exactly where it was.
 */
it("starts a v3 knowledge base for one with nothing stored, rather than writing a v1/v2 draft", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: CREATED }));
  await render(emptyView());

  expect(host.querySelector("[data-geo-kb-start]")).not.toBeNull();
  expect(host.querySelector("[data-geo-kb-v2]")).toBeNull();
  // Creating writes a draft and spends one of the few creates an hour this
  // knowledge base is allowed. Rendering must not do it.
  expect(fetch).not.toHaveBeenCalled();

  await click("[data-generate-kb]");

  expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["/api/tools/geo-knowledge-base/v3/draft"]);
  // The literal zero the route requires: a create that sent the version it
  // happened to believe in would overwrite whatever another tab had written.
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body))).toEqual({ kbId: editorFixture().kbId, baseVersion: 0 });
  expect(onStarted).toHaveBeenCalledTimes(1);
});

/**
 * This used to stay on the v2 card, because a v3 draft standing over a v1/v2
 * published version was refused by the loader as `v3_predecessor_unsupported`
 * -- a permanent 503 for that knowledge base. The loader now reports such a
 * version as `opaque`, so there is nothing left to protect against, and holding
 * the line here would have meant only a knowledge base nobody had ever
 * published from could reach the redesign.
 */
it("starts a first v3 draft over a knowledge base that has already published", async () => {
  const base = editorFixture();
  await render(emptyView({ frozen: frozenAt(base, base.draftHash!) }));

  expect(host.querySelector("[data-geo-kb-start]")).not.toBeNull();
  expect(host.querySelector("[data-geo-kb-v2]")).toBeNull();
  // Still nothing sent until the owner presses: the published version is not
  // touched by rendering a start button over it.
  expect(fetch).not.toHaveBeenCalled();
});

it("leaves a knowledge base with a stored draft on the v2 card", async () => {
  await render();
  expect(host.querySelector("[data-geo-kb-start]")).toBeNull();
  expect(host.querySelector("[data-geo-kb-v2]")).not.toBeNull();
});

/**
 * The gesture that carries an existing v1/v2 draft across the cut.
 *
 * Without it the redesign is reachable only from a knowledge base nobody has
 * ever built, which is every knowledge base except the ones that matter. The
 * move is one-way, discards a draft, and makes the next update a paid one, so
 * each of those three is pinned as a sentence the owner is shown, not just as
 * behaviour after the press.
 */
it("offers the move only where there is a draft to move", async () => {
  await render(emptyView());
  expect(host.querySelector("[data-kb-upgrade-v3]")).toBeNull();
  expect(host.querySelector("[data-upgrade-v3]")).toBeNull();
});

it.each([
  ["en", ["discards this draft", "billed again", "stays exactly as it is"]],
  ["zh", ["丢弃当前这份草稿", "重新计费", "原样保留"]],
])("says in %s what the move costs, before the button that spends it", async (locale, claims) => {
  await render(editorFixture(), locale);
  const panel = host.querySelector("[data-kb-upgrade-v3]");

  expect(panel).not.toBeNull();
  // The note is above the button in the DOM, which is what puts it in front of
  // the owner rather than after the press.
  expect(panel!.querySelector("p")!.compareDocumentPosition(panel!.querySelector("[data-upgrade-v3]")!))
    .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  for (const claim of claims) expect(renderedText(panel as HTMLElement), claim).toContain(claim);
  expect(fetch).not.toHaveBeenCalled();
});

it("acknowledges the exact draft it discards", async () => {
  const base = editorFixture();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: CREATED }));
  await render(base);
  // Rendering the offer is free. Only the press writes.
  expect(fetch).not.toHaveBeenCalled();

  await click("[data-upgrade-v3]");

  expect(vi.mocked(fetch).mock.calls.map(call => call[0])).toEqual(["/api/tools/geo-knowledge-base/v3/draft"]);
  // `draftHash` is the acknowledgement the route demands: a press that did not
  // carry the digest of the draft on screen would be discarding something the
  // owner was never shown.
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)))
    .toEqual({ kbId: base.kbId, intent: "upgrade", baseVersion: base.draftVersion, draftHash: base.draftHash });
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("sends one upgrade for a double press", async () => {
  let settle: (value: Response) => void = () => {};
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { settle = resolve; }));
  await render();
  const button = host.querySelector<HTMLElement>("[data-upgrade-v3]")!;

  // Two presses before React has re-rendered the disabled state -- the latch,
  // not the attribute, is what stops the second. A second `intent: "upgrade"`
  // spends another of the few creates an hour this knowledge base gets.
  await act(async () => { button.click(); button.click(); });

  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => { settle(Response.json({ data: CREATED })); });
  expect(onStarted).toHaveBeenCalledTimes(1);
});

it.each(["draft_exists", "conflict"])("re-reads rather than reporting a failure on %s", async (code) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code }, draftVersion: 7 }, { status: 409 }));
  await render();

  await click("[data-upgrade-v3]");

  // Another tab moved first, or the draft moved under this one. Either way what
  // is stored is now worth reading; a failure notice would be describing a
  // knowledge base that has already crossed.
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("says nothing was changed only where a retry can still work", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "profile_unusable" } }, { status: 422 }));
  await render();

  await click("[data-upgrade-v3]");

  expect(onStarted).not.toHaveBeenCalled();
  expect(host.querySelector('[data-kb-upgrade-v3] [role="alert"]')?.textContent).toBe(editor.upgradeFailed);
  // "you can try again" is a promise about the next press, so the next press is
  // the test: the latch has to be open again, not stuck on the failed attempt.
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: CREATED }));
  await click("[data-upgrade-v3]");
  expect(onStarted).toHaveBeenCalledTimes(1);
});

it.each([
  ["a dropped connection", () => vi.mocked(fetch).mockRejectedValueOnce(new TypeError("network"))],
  ["a 503 the route can only reach after the write", () =>
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "store_unavailable" } }, { status: 503 }))],
  ["a body this client cannot read", () =>
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { nonsense: true } }))],
])("refuses to promise nothing changed after %s", async (_case, arrange) => {
  /*
   * The upgrade discards the v1/v2 draft before these three can happen, so the
   * client does not know whether the move went through. "Nothing was changed"
   * would be an assurance nobody verified, about a one-way gesture, in the one
   * window where being wrong hides that the draft is gone and the next update
   * bills.
   */
  arrange();
  await render();

  await click("[data-upgrade-v3]");

  const alert = host.querySelector('[data-kb-upgrade-v3] [role="alert"]')?.textContent;
  expect(alert).toBe(editor.upgradeUnconfirmed);
  expect(alert).not.toBe(editor.upgradeFailed);
  expect(onStarted).not.toHaveBeenCalled();
});

it.each([
  ["en", ["billed model call", "crawls your site"]],
  ["zh", ["计费", "抓取"]],
])("claims no charge in %s for a step that makes none", async (locale, forbidden) => {
  await render(emptyView(), locale);
  // The shell's own cost sentence describes the update run, which is the next
  // press on the review card this hands over to -- not this one.
  expect(host.querySelector("[data-kb-cost]")).toBeNull();
  for (const phrase of forbidden) expect(renderedText(host), phrase).not.toContain(phrase);
  // And the v2 flow's three-call sentence is not being reused either.
  expect(renderedText(host)).not.toContain(editor.generateCost);
});

it("re-reads rather than reporting a failure when the knowledge base turns out to have a draft already", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "draft_exists" }, draftVersion: 4 }, { status: 409 }));
  await render(emptyView());

  await click("[data-generate-kb]");

  // Whatever is stored, this card has stopped describing it; a start button
  // left over the top would offer to create a second first draft.
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("keeps a Profile that has to be fixed apart from a failure to retry, and from success", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "profile_unusable" }, fields: ["/subset/productName"] }, { status: 422 }));
  await render(emptyView());
  await click("[data-generate-kb]");
  const invalid = host.querySelector('[role="alert"]')?.textContent;

  expect(invalid).toBe(cardCopy("en").state.invalid);
  expect(onStarted).not.toHaveBeenCalled();
  // Nothing about the refusal reaches the screen: the code names an internal
  // projection, and the field list names Profile internals.
  expect(host.textContent).not.toContain("profile_unusable");
  expect(host.textContent).not.toContain("/subset/productName");

  await act(async () => root.unmount());
  root = createRoot(host);
  vi.mocked(fetch).mockReset();
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "store_unavailable" } }, { status: 503 }));
  await render(emptyView());
  await click("[data-generate-kb]");
  const failed = host.querySelector('[role="alert"]')?.textContent;

  expect(failed).toBe(cardCopy("en").state.error);
  // Three outcomes, three answers. Two of them reading the same sentence would
  // send an owner to retry a refusal that will never change on its own.
  expect(failed).not.toBe(invalid);
  expect(onStarted).not.toHaveBeenCalled();
});

/**
 * The status line over a knowledge base with nothing in it.
 *
 * Pinned in both locales and written out, because it was provably unpinned:
 * replacing `copy.status.none` with `copy.status.draft` on this card left all
 * 552 unit files green while the card announced "A draft is ready for you to
 * publish" over a knowledge base that holds nothing at all. Filling the
 * expectation from `cardCopy(locale).status.none` would not have caught it
 * either -- that reads the same leaf the component rendered from.
 */
it.each([
  ["en", "No knowledge base version yet.", "A draft is ready for you to publish."],
  ["zh", "还没有知识库版本。", "草稿已就绪，等你发布。"],
])("says a knowledge base with nothing stored has nothing stored, in %s", async (locale, empty, draft) => {
  await render(emptyView(), locale);

  expect(host.querySelector("[data-kb-state]")?.textContent).toBe(empty);
  expect(renderedText(host)).not.toContain(draft);
  expect(fetch).not.toHaveBeenCalled();
});

/**
 * The three outcomes of a create, over their whole membership.
 *
 * The test above these drove one member of the four-member "the Profile has to
 * be fixed" set and one of the three-member "something is already stored" set,
 * so dropping any of the other five from either list left the suite green --
 * and dropping one from the first list sends an owner to retry a refusal that
 * will never change on its own, while dropping one from the second leaves a
 * start button standing over a draft that already exists.
 */
const INVALID_SENTENCE = "The website information cannot be used yet. Check and save it before trying again.";
const ERROR_SENTENCE = "The update could not finish. Please try again later.";

it.each([
  ["profile_unusable", 422],
  ["profile_not_confirmed", 409],
  ["website_not_found", 404],
  ["draft_invalid", 422],
])("sends %s to the Profile that has to be fixed, never to a retry", async (code, status) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code } }, { status }));
  await render(emptyView());

  await click("[data-generate-kb]");

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(INVALID_SENTENCE);
  expect(onStarted).not.toHaveBeenCalled();
  // The code names an internal projection; it is never the customer's word.
  expect(host.textContent).not.toContain(code);
});

it.each([
  ["draft_exists", 409, 4],
  ["legacy_draft", 409, 2],
  ["conflict", 409, 7],
])("re-reads rather than failing when %s says something is already stored", async (code, status, draftVersion) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code }, draftVersion }, { status }));
  await render(emptyView());

  await click("[data-generate-kb]");

  // Whatever is stored, this card has stopped describing it. Leaving a start
  // button over it would offer to create a second first draft.
  expect(onStarted).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it.each([
  ["store_unavailable", 503],
  ["rate_limited", 429],
  ["auth_required", 401],
  ["invalid_request", 400],
])("reports %s as a failure to try again, not as a Profile to fix", async (code, status) => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code } }, { status }));
  await render(emptyView());

  await click("[data-generate-kb]");

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(ERROR_SENTENCE);
  expect(ERROR_SENTENCE).not.toBe(INVALID_SENTENCE);
  expect(onStarted).not.toHaveBeenCalled();
});

it("reports a request that never reached the server as a failure to try again", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline"));
  await render(emptyView());

  await click("[data-generate-kb]");

  expect(host.querySelector('[role="alert"]')?.textContent).toBe(ERROR_SENTENCE);
  expect(onStarted).not.toHaveBeenCalled();
});

it("creates one first draft however fast the button is pressed", async () => {
  // Never settles, so the card stays in flight for the whole test.
  vi.mocked(fetch).mockReturnValue(new Promise<Response>(() => undefined));
  await render(emptyView());
  const node = host.querySelector<HTMLElement>("[data-generate-kb]");
  if (node === null) throw new Error("no start button");

  // Both clicks in one task, which is the only case a guard can fail at and
  // the only one `disabled` does not already cover: React has not re-rendered
  // between them, so the button is still enabled and both run the same handler
  // closure -- holding the same `state`. Measured before the fix: two creates.
  await act(async () => { node.click(); node.click(); });

  expect(fetch).toHaveBeenCalledTimes(1);
});
