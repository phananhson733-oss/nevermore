// @vitest-environment jsdom
// @input -- real confirmed v2 fixtures, strict result parser and mocked HTTP/Google boundaries
// @output -- exact revision, session-first generation, safe reruns and truthful local DOM/export evidence
// @pos -- offline interaction contract; no provider or production claim
import { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { marked } from "marked";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmedDraftV2Fixture } from "../../../../../packages/public-tools/src/content-brief/v2-draft-fixtures.ts";
import { assembleDraftV2, parseDraftResultV2, type AssembleDraftV2Input } from "@sf/public-tools/content-brief/v2-draft";
import { buildDraftV2SectionScope } from "@sf/public-tools/content-brief/v2-draft-scope";
import { validateDraftV2Section } from "@sf/public-tools/content-brief/v2-draft-section";
import { DRAFT_TOTAL_BUDGET_MS, SECTION_ENDPOINT_BUDGET_MS } from "@sf/public-tools/content-brief/constants";
import { confirmBriefV2, fingerprintBriefV2 } from "@sf/public-tools/content-brief/v2-brief";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftResultV2, DraftV2Section, DraftV2Settings } from "@sf/public-tools/content-brief/v2-draft-contract";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { ContentDraftV2Workflow } from "./content-draft-v2-workflow.tsx";
import { ContentDraftV2Results, contentDraftV2Markdown } from "./content-draft-v2-results.tsx";

const { signIn } = vi.hoisted(() => ({ signIn: { callback: undefined as (() => boolean | void) | undefined, open: false } }));
vi.mock("../auth/sign-in-dialog", () => ({ SignInDialog: ({ open, onSignedIn }: { open: boolean; onSignedIn: () => boolean | void }) => { signIn.callback = onSignedIn; signIn.open = open; return null; } }));

const settings: DraftV2Settings = { tone: "explanatory", person: "second", product_mention: "gap_only" };
const llm = { attempts: 1, model_id: "offline-draft-model", temperature_requested: 0.4 as const, temperature_effective: null, input_tokens: 50, output_tokens: 20 };
const coverageRead = { status: "complete" as const, calls: 1, model_id: "offline-coverage-model", temperature_requested: 0 as const, temperature_effective: null, input_tokens: 80, output_tokens: 20 };
const noCoverage = { status: "unavailable" as const, reason: "insufficient_evidence" as const, attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null };
function exportNotes(locale: "en" | "zh" = "en") {
  const catalog = (locale === "en" ? en : zh).tools.contentDraft;
  return { failed: (reason: string) => catalog.sectionFail[reason as keyof typeof catalog.sectionFail], skipped: catalog.doc.skippedBody, relatedLinks: locale === "en" ? "Related links" : "相关链接" };
}
async function confirmedWithLinks(url = "https://owned.test/dates(a)[b]?next=(x)&tag=[v]#section(2)") {
  const original = await confirmedDraftV2Fixture({ action: "update" });
  const generated = original.brief.generated!;
  const unsigned = { ...original.brief, context: { ...original.brief.context,
    research: { ...original.brief.context.research, pages: original.brief.context.research.pages.map((page) => page.id === "T1" ? { ...page, url, final_url: url } : page) },
    candidates: original.brief.context.candidates.map((candidate) => ({ ...candidate, url })),
    gsc: { ...original.brief.context.gsc, matches: original.brief.context.gsc.matches.map((match) => ({ ...match, page: url })) },
  }, generated: { ...generated, page_plan: { ...generated.page_plan, action: "create" as const, target_ref: null, steps: [] }, internal_links: [{ page_ref: "T1", anchor: "Read [this] (guide)", why: "Compare finalized date ranges." }], do_not_cover: [{ page_ref: "T1", topic: "Do not export this excluded topic", why: "Covered by the dedicated page." }] } };
  const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
  const confirmed = await confirmBriefV2(brief, { outline: original.outline, revision: original.revision, confirmed_at: original.confirmed_at, resolution: original.resolution });
  if (!confirmed.ok) throw new Error(confirmed.path);
  return { confirmed: confirmed.value, url };
}

async function resultFor(confirmed: ConfirmedBriefV2, options: { failed?: boolean; empty?: boolean; unavailable?: boolean; previous?: DraftResultV2; settings?: DraftV2Settings; cjk?: boolean; claims?: boolean } = {}) {
  const currentSettings = options.settings ?? settings;
  const sections: DraftV2Section[] = confirmed.outline.map((heading, index) => {
    if (options.empty && index === 1) return { ...heading, status: "skipped" };
    if ((options.failed || options.empty) && index === 0) return { ...heading, status: "failed", fail_reason: "provider_error", llm };
    const scope = buildDraftV2SectionScope(confirmed, heading.id, currentSettings);
    if (!scope.ok) throw new Error(scope.path);
    const pageRefs = [...scope.value.page_units.keys()];
    const sentences = options.claims ? (index === 0 ? [
      { text: "Reporting can lag behind collection.", claim: "bound", evidence_refs: pageRefs },
      { text: "Review the reporting timeline.", claim: "no_claim", evidence_refs: [] },
    ] : [
      { text: "The product compares finalized periods.", claim: "bound", evidence_refs: ["P1"] },
      { text: "Confirm the exact reporting interval.", claim: "gap", evidence_refs: [] },
      { text: "Prefer finalized period comparisons.", claim: "stance", evidence_refs: ["P2"] },
    ]) : [{ text: options.cjk ? "请比较完整周期。" : index === 0 ? "Review the reporting timeline." : "Compare the complete periods.", claim: "no_claim", evidence_refs: [] }];
    const body = validateDraftV2Section({ paragraphs: [{ heading: heading.h3[0] ?? null, sentences }] }, scope.value, confirmed.brief.context.input.language);
    if (!body.ok) throw new Error(body.path);
    return { ...heading, status: "ok", body: body.value, llm };
  });
  const input: AssembleDraftV2Input = {
    confirmed, settings: currentSettings, sections,
    coverage: { items: options.empty ? null : options.unavailable ? [] : confirmed.brief.generated!.research.questions.map((question) => ({ question_id: question.id, status: "covered", covered_in: options.failed ? "O2" : confirmed.outline.find((heading) => heading.answers.includes(question.id))!.id, gap: null })), reads: options.empty ? noCoverage : coverageRead },
    run: { run_id: options.previous ? "draft-rerun" : "draft-fixture", collected_at: "2026-08-31T02:00:00.000Z", elapsed_ms: 100, budget_ms: options.previous ? SECTION_ENDPOINT_BUDGET_MS : DRAFT_TOTAL_BUDGET_MS, rerun: options.previous ? { section_id: "O1", previous_run_id: options.previous.run.run_id, previous_fingerprint: options.previous.run.fingerprint } : null },
  };
  const result = await assembleDraftV2(input);
  if (!result.ok) throw new Error(result.path);
  expect((await parseDraftResultV2(result.value, confirmed, options.previous)).ok).toBe(true);
  return result.value;
}

let root: Root | null = null;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; signIn.open = false; signIn.callback = undefined; });
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const [owner, key, descriptor] of [[navigator, "clipboard", originalClipboard], [URL, "createObjectURL", originalCreateUrl], [URL, "revokeObjectURL", originalRevokeUrl]] as const) { if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key); }
});
function node<T extends Element = HTMLElement>(host: Element, selector: string): T { const found = host.querySelector(selector); expect(found, selector).not.toBeNull(); return found as T; }
async function click(host: Element, selector: string) { await act(async () => node<HTMLButtonElement>(host, selector).click()); }
async function choose(host: Element, field: string, value: string) { await act(async () => { const select = node<HTMLSelectElement>(host, `[data-setting="${field}"]`); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
function response(value: unknown, status = 200, headers?: HeadersInit) { return new Response(JSON.stringify(value), { status, headers }); }
function api(result: DraftResultV2) { const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response(result)); vi.stubGlobal("fetch", fetcher); return fetcher; }
async function render(confirmed: ConfirmedBriefV2, options: { locale?: "en" | "zh"; authenticated?: boolean; result?: DraftResultV2 } = {}) {
  const locale = options.locale ?? "en"; const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onReplace = vi.fn(); const onKeepForSignIn = vi.fn(() => true);
  const rerender = async (next: ConfirmedBriefV2, nextResult = options.result) => { await act(async () => root?.render(<NextIntlClientProvider locale={locale} messages={locale === "zh" ? zh : en} timeZone="UTC">{nextResult ? <ContentDraftV2Results confirmed={next} result={nextResult} locale={locale} rerun={{ disabled: false, runningSection: null, onRerun: vi.fn() }} /> : <ContentDraftV2Workflow key={next.fingerprint} confirmed={next} source="paste" locale={locale} authenticated={options.authenticated ?? true} onReplace={onReplace} onKeepForSignIn={onKeepForSignIn} />}</NextIntlClientProvider>)); };
  await rerender(confirmed); return { host, onReplace, onKeepForSignIn, rerender };
}

describe("Draft v2 exact-revision workflow", () => {
  it.each(["en", "zh"] as const)("starts with settings open, then folds them and focuses the named result region after success (%s)", async (locale) => {
    const confirmed = await confirmedDraftV2Fixture(); api(await resultFor(confirmed)); const { host } = await render(confirmed, { locale }); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(false);
    await click(host, "[data-generate-draft]"); await flush(); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(true); expect(node(host, "[data-toggle-settings]").getAttribute("aria-expanded")).toBe("false"); const region = node(host, "[data-draft-result-region]"); expect(region.getAttribute("role")).toBe("region"); expect(region.getAttribute("aria-label")).toBe(locale === "en" ? "Draft result" : "初稿结果"); expect(document.activeElement).toBe(region);
  });
  it("reopens settings without sending a request or replacing the generated draft", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); const fetcher = api(result); const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); await flush(); const calls = fetcher.mock.calls.length;
    await click(host, "[data-toggle-settings]"); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(false); expect(node(host, "[data-toggle-settings]").getAttribute("aria-expanded")).toBe("true"); expect(fetcher).toHaveBeenCalledTimes(calls); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(result.run.run_id); expect(JSON.parse(node(host, "[data-draft-json]").textContent!)).toEqual(result);
  });
  it("reopens folded settings on a failed section rerun and keeps the previous result and alert visible", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); const fetcher = api(result); const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); await flush(); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(true);
    fetcher.mockImplementation(async (url) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response({ error: { code: "quota_unavailable" } }, 503)); await click(host, '[data-rerun-section="O1"]'); await flush(); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(false); const alert = node(host, '[data-error-code="quota_unavailable"]'); expect(alert.closest("[hidden]")).toBeNull(); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(result.run.run_id);
  });
  it("preserves the published URL across a successful section rerun while settings stay folded", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const previous = await resultFor(confirmed); const next = await resultFor(confirmed, { previous }); const fetcher = api(previous); const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); await flush(); await act(async () => { const input = node<HTMLInputElement>(host, "[data-published-url]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://published.test/keep-through-rerun"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    fetcher.mockImplementation(async (url) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response(next)); await click(host, '[data-rerun-section="O1"]'); await flush(); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(next.run.run_id); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(true); expect(node<HTMLInputElement>(host, "[data-published-url]").value).toBe("https://published.test/keep-through-rerun");
  });
  it("keeps settings open when a valid returned artifact has no successfully generated section", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed, { empty: true }); api(result); const { host } = await render(confirmed); await click(host, '[data-section-checkbox="O2"]'); await click(host, "[data-generate-draft]"); await flush(); expect(node<HTMLElement>(host, "[data-draft-settings-panel]").hidden).toBe(false); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(result.run.run_id);
  });
  it("shows the effective confirmed revision, rewrite target and actual instructions without doing any work on mount", async () => {
    const confirmed = await confirmedDraftV2Fixture({ action: "update", reverse: true }); const fetcher = api(await resultFor(confirmed)); const { host, onKeepForSignIn } = await render(confirmed);
    expect(node(host, "[data-confirmed-revision]").textContent).toContain("2"); expect(node<HTMLAnchorElement>(host, "[data-target-page]").href).toBe("https://owned.test/T1");
    expect(node(host, "[data-rewrite-plan]").textContent).toContain("Clarify the current reporting introduction.");
    expect(Array.from(host.querySelectorAll("[data-section-checkbox]"), (item) => item.getAttribute("data-section-checkbox"))).toEqual(["O2", "O1"]);
    expect(fetcher).not.toHaveBeenCalled(); expect(onKeepForSignIn).not.toHaveBeenCalled();
  });
  it("checks the live session first and posts the exact confirmed envelope with only selected section ids", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const fetcher = api(await resultFor(confirmed)); const { host } = await render(confirmed);
    await click(host, '[data-section-checkbox="O2"]'); await click(host, "[data-generate-draft]"); await flush();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/session", "/api/tools/content-draft/run"]);
    const request = (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1]; expect(JSON.parse(String(request.body))).toEqual({ brief: confirmed, settings, section_ids: ["O1"] });
  });
  it("refuses an empty section selection before either session or paid calls", async () => {
    const confirmed = await confirmedDraftV2Fixture({ paaOnly: true }); const fetcher = api(await resultFor(confirmed)); const { host } = await render(confirmed);
    await click(host, '[data-section-checkbox="O1"]'); await click(host, '[data-section-checkbox="O2"]'); await click(host, "[data-generate-draft]");
    expect(fetcher).not.toHaveBeenCalled(); expect(node(host, "[role=alert]").textContent).toMatch(/at least one/i);
  });
  it("never posts when signed out and only persists after successful Google sign-in, vetoing reload on failure", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const fetcher = vi.fn(async () => response({ signedIn: false })); vi.stubGlobal("fetch", fetcher); const { host, onKeepForSignIn } = await render(confirmed, { authenticated: false });
    expect(onKeepForSignIn).not.toHaveBeenCalled(); await click(host, "[data-generate-draft]"); expect(fetcher).toHaveBeenCalledTimes(1); expect(signIn.open).toBe(true); expect(onKeepForSignIn).not.toHaveBeenCalled();
    onKeepForSignIn.mockReturnValue(false); let keep: boolean | void; await act(async () => { keep = signIn.callback?.(); }); expect(keep!).toBe(false); expect(onKeepForSignIn).toHaveBeenCalledTimes(1); expect(node(host, "[data-keep-failed]").textContent).toMatch(/did not refresh/i);
  });
  it.each(["quota_unavailable", "rate_limited", "run_in_progress"])("retains the last good draft on a refused second run: %s", async (code) => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); const fetcher = api(result); const { host } = await render(confirmed);
    await click(host, "[data-generate-draft]"); await flush(); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(result.run.run_id);
    fetcher.mockImplementation(async (url) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response({ error: { code } }, 429, { "Retry-After": "30" }));
    await click(host, "[data-toggle-settings]"); await click(host, "[data-generate-draft]"); await flush(); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(result.run.run_id); expect(node(host, "[role=alert]").getAttribute("data-error-code")).toBe(code);
  });
  it.each(["schema", "fingerprint", "confirmed", "settings"])("rejects a new result with wrong %s before publishing it", async (kind) => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); const otherSettings = await resultFor(confirmed, { settings: { ...settings, tone: "technical" } });
    const invalid = kind === "schema" ? { ...result, schema: "gengrowth.content_draft/v1" } : kind === "fingerprint" ? { ...result, run: { ...result.run, fingerprint: "f".repeat(64) } } : kind === "confirmed" ? { ...result, confirmed_ref: { ...result.confirmed_ref, fingerprint: "f".repeat(64) } } : otherSettings;
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response(invalid)));
    const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); await flush(); expect(host.querySelector("[data-draft-v2-result]")).toBeNull(); expect(node(host, "[role=alert]").textContent).toMatch(/valid|match|schema|fingerprint/i);
  });
  it("blocks rerun while settings are dirty and sends the entire exact previous result after settings match", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const previous = await resultFor(confirmed); const next = await resultFor(confirmed, { previous }); const fetcher = api(previous); const { host } = await render(confirmed);
    await click(host, "[data-generate-draft]"); await flush(); await click(host, "[data-toggle-settings]"); await choose(host, "tone", "technical"); expect(node(host, "[data-settings-changed]")).toBeDefined(); expect(node<HTMLButtonElement>(host, '[data-rerun-section="O1"]').disabled).toBe(true);
    await choose(host, "tone", "explanatory"); fetcher.mockImplementation(async (url) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : response(next));
    await click(host, '[data-rerun-section="O1"]'); await flush(); const call = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit]; expect(call[0]).toBe("/api/tools/content-draft/section"); expect(JSON.parse(String(call[1].body))).toEqual({ brief: confirmed, section_id: "O1", previous }); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(next.run.run_id);
  });
  it("locks all mutable inputs while busy and rejects duplicate submissions", async () => {
    const confirmed = await confirmedDraftV2Fixture(); let finish!: (value: Response) => void; const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetcher); const { host } = await render(confirmed);
    await click(host, "[data-generate-draft]"); await click(host, "[data-generate-draft]"); expect(fetcher).toHaveBeenCalledTimes(1); expect(node<HTMLSelectElement>(host, '[data-setting="tone"]').disabled).toBe(true); expect(node<HTMLInputElement>(host, '[data-section-checkbox="O1"]').disabled).toBe(true); expect(node<HTMLButtonElement>(host, "[data-replace-brief]").disabled).toBe(true);
    await act(async () => finish(response({ signedIn: false }))); expect(node<HTMLSelectElement>(host, '[data-setting="tone"]').disabled).toBe(false);
  });
  it("aborts an obsolete confirmed revision and ignores its delayed session response", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const replacement = await confirmedDraftV2Fixture({ reverse: true }); let finish!: (value: Response) => void; const fetcher = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetcher); const { host, rerender } = await render(confirmed);
    await click(host, "[data-generate-draft]"); const signal = fetcher.mock.calls[0]![1]?.signal; await rerender(replacement); expect(signal?.aborted).toBe(true); await act(async () => finish(response({ signedIn: true }))); expect(fetcher).toHaveBeenCalledTimes(1); expect(host.querySelector("[data-draft-v2-result]")).toBeNull();
  });
  it("ignores an obsolete result even when its real asynchronous fingerprint parse finishes after replacement", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const replacement = await confirmedDraftV2Fixture({ reverse: true }); const result = await resultFor(confirmed); const fetcher = api(result); let release!: () => void; let calls = 0;
    vi.stubGlobal("crypto", { subtle: { digest: async (algorithm: AlgorithmIdentifier, bytes: BufferSource) => { const digest = await webcrypto.subtle.digest(algorithm, bytes); calls += 1; if (calls === 3) await new Promise<void>((resolve) => { release = resolve; }); return digest; } } });
    const { host, rerender } = await render(confirmed); await click(host, "[data-generate-draft]"); await act(async () => { await vi.waitFor(() => expect(release).toBeTypeOf("function")); }); expect(host.querySelector("[data-draft-v2-result]")).toBeNull();
    await rerender(replacement); await act(async () => release()); await flush(); expect(fetcher).toHaveBeenCalledTimes(2); expect(host.querySelector("[data-draft-v2-result]")).toBeNull(); expect(node<HTMLSelectElement>(host, '[data-setting="tone"]').disabled).toBe(false);
  });
  it("does not persist or publish after unmount, including a delayed paid response", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); let finish!: (value: Response) => void; const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url) === "/api/auth/session" ? response({ signedIn: true }) : new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    const { host, onKeepForSignIn } = await render(confirmed); await click(host, "[data-generate-draft]"); const callback = signIn.callback; const signal = fetcher.mock.calls[1]![1]?.signal; await act(async () => root?.unmount()); root = null; expect(signal?.aborted).toBe(true); expect(callback?.()).toBeUndefined(); expect(onKeepForSignIn).not.toHaveBeenCalled(); await act(async () => finish(response(result))); expect(host.textContent).toBe("");
  });
  it("keeps the validated previous draft when the rerun response is not bound to it", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const previous = await resultFor(confirmed); const fetcher = api(previous); const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); await flush(); await click(host, '[data-rerun-section="O1"]'); await flush();
    expect(fetcher).toHaveBeenCalledTimes(4); expect(node(host, "[data-draft-v2-result]").getAttribute("data-run-id")).toBe(previous.run.run_id); expect(node(host, "[role=alert]").getAttribute("data-error-code")).toBe("invalid_result");
  });
  it("treats unavailable session verification as a no-paid-call boundary", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const fetcher = vi.fn(async () => response({ signedIn: "true" })); vi.stubGlobal("fetch", fetcher); const { host } = await render(confirmed); await click(host, "[data-generate-draft]"); expect(fetcher).toHaveBeenCalledTimes(1); expect(signIn.open).toBe(false); expect(node(host, "[role=alert]").getAttribute("data-error-code")).toBe("auth_unavailable");
  });
  it("rejects a valid result that generated an unchecked section", async () => {
    const confirmed = await confirmedDraftV2Fixture(); api(await resultFor(confirmed)); const { host } = await render(confirmed); await click(host, '[data-section-checkbox="O2"]'); await click(host, "[data-generate-draft]"); await flush(); expect(host.querySelector("[data-draft-v2-result]")).toBeNull(); expect(node(host, "[role=alert]").getAttribute("data-error-code")).toBe("invalid_result");
  });
});

describe("Draft v2 truthful results and exact exports", () => {
  it("hides an old export success on rerun while preserving the visitor's published URL", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const previous = await resultFor(confirmed); const next = await resultFor(confirmed, { previous }); const { host, rerender } = await render(confirmed, { result: previous }); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await act(async () => { const input = node<HTMLInputElement>(host, "[data-published-url]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://published.test/keep-me"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await click(host, "[data-copy-markdown]"); expect(node(host, '[role="status"]').textContent).toBe(en.tools.contentDraft.v2.export.copied);
    await rerender(confirmed, next); expect(host.querySelector('[role="status"]')).toBeNull(); expect(node<HTMLInputElement>(host, "[data-published-url]").value).toBe("https://published.test/keep-me");
  });
  it("does not attach an old asynchronous clipboard success to the replacement result", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const previous = await resultFor(confirmed); const next = await resultFor(confirmed, { previous }); let resolve!: () => void; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => new Promise<void>((finish) => { resolve = finish; })) } }); const { host, rerender } = await render(confirmed, { result: previous });
    await click(host, "[data-copy-draft-json]"); await rerender(confirmed, next); await act(async () => resolve()); expect(host.querySelector('[role="status"]')).toBeNull();
  });
  it("keeps the newest export action's receipt when an earlier clipboard promise finishes later", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed); let resolve!: () => void; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => new Promise<void>((finish) => { resolve = finish; })) } }); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:latest-export" }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); const { host } = await render(confirmed, { result });
    await click(host, "[data-copy-markdown]"); await click(host, "[data-download-draft-json]"); expect(node(host, '[role="status"]').textContent).toBe(en.tools.contentDraft.v2.export.downloaded); await act(async () => resolve()); expect(node(host, '[role="status"]').textContent).toBe(en.tools.contentDraft.v2.export.downloaded);
  });
  it("renders the text of a real observed excerpt heading, not its structured heading object", async () => {
    const original = await confirmedDraftV2Fixture();
    const unsigned = { ...original.brief, context: { ...original.brief.context, research: { ...original.brief.context.research, pages: original.brief.context.research.pages.map((page, index) => index === 0 ? { ...page, research: { ...page.research, segments: page.research.segments.map((segment) => ({ ...segment, heading: { level: "h2" as const, text: "Evidence section heading" } })) } } : page) } } };
    const brief = { ...unsigned, run: { ...unsigned.run, fingerprint: await fingerprintBriefV2(unsigned) } };
    const parsed = await confirmBriefV2(brief, { outline: original.outline, revision: original.revision, confirmed_at: original.confirmed_at, resolution: original.resolution }); if (!parsed.ok) throw new Error(parsed.path);
    const result = await resultFor(parsed.value, { claims: true }); const { host } = await render(parsed.value, { result }); expect(node(host, '[data-evidence-ref="U1"]').textContent).toContain("Evidence section heading");
  });
  it.each(["en", "zh"] as const)("renders real H2/H3, claim annotations, page excerpts and profile evidence (%s)", async (locale) => {
    const confirmed = await confirmedDraftV2Fixture({ action: "update" }); const result = await resultFor(confirmed, { claims: true }); const { host } = await render(confirmed, { locale, result });
    expect(Array.from(host.querySelectorAll("[data-draft-h2]"), (item) => item.textContent)).toEqual(confirmed.outline.map((item) => item.h2)); expect(Array.from(host.querySelectorAll("[data-draft-h3]"), (item) => item.textContent)).toEqual(confirmed.outline.flatMap((item) => item.h3));
    for (const claim of ["bound", "gap", "no_claim", "stance"]) expect(host.querySelector(`[data-claim="${claim}"]`)).not.toBeNull();
    expect(node(host, '[data-evidence-ref="P1"]').textContent).toContain("Compares finalized reporting periods"); expect(node(host, '[data-evidence-ref="U1"]').textContent).toContain("Reporting can lag behind collection.");
    expect(node(host, "[data-support-count]").textContent).toMatch(locale === "en" ? /2 observed supporting pages/i : /2.*已观测支持页面/);
    expect(host.querySelectorAll("details[open]")).toHaveLength(0); expect(JSON.parse(node(host, "[data-run-ledger]").textContent!)).toEqual(result.run);
  });
  it("shows PAA-only questions with model coverage even if their planned section failed", async () => {
    const confirmed = await confirmedDraftV2Fixture({ paaOnly: true }); const result = await resultFor(confirmed, { failed: true }); const { host } = await render(confirmed, { result });
    expect(host.querySelectorAll("[data-coverage-question]")).toHaveLength(2); expect(node(host, '[data-coverage-question="Q1"]').textContent).toMatch(/PAA.*Covered.*O2/i); expect(node(host, '[data-draft-section="O1"]').textContent).toMatch(/failed/i); expect(host.querySelector("[data-evidence-ref]")).toBeNull();
  });
  it("labels CJK prose length as non-whitespace characters and excludes H2/H3", async () => {
    const confirmed = await confirmedDraftV2Fixture({ language: "zh-CN" }); const result = await resultFor(confirmed, { cjk: true }); const { host } = await render(confirmed, { locale: "zh", result }); expect(node(host, "[data-draft-length]").textContent).toContain(`${result.totals.value}`); expect(node(host, "[data-draft-length]").textContent).toContain("非空白字符"); expect(node(host, "[data-length-note]").textContent).toMatch(/不含.*标题/);
  });
  it("distinguishes unavailable coverage from a deterministic empty draft with zero calls", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed, { unavailable: true }); const { host } = await render(confirmed, { result }); expect(node(host, "[data-coverage-summary]").textContent).toMatch(/unavailable/i); expect(node(host, "[data-coverage-summary]").textContent).not.toMatch(/0\s*\//); await act(async () => root?.unmount()); root = null;
    const empty = await resultFor(confirmed, { empty: true }); const second = await render(confirmed, { result: empty }); expect(node(second.host, "[data-coverage-method]").textContent).toMatch(/no generated text.*no coverage model call/i); expect(empty.run.reads.llm_coverage.calls).toBe(0); expect(second.host.querySelectorAll('[data-coverage-status="none"]')).toHaveLength(2);
  });
  it("copies clean Markdown and downloads exactly the same minified frozen JSON object", async () => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed, { claims: true }); const before = JSON.stringify(result); const { host } = await render(confirmed, { result }); const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await click(host, "[data-copy-markdown]"); const markdown = String(writeText.mock.calls[0]![0]); expect(markdown).toBe(contentDraftV2Markdown(result, confirmed, exportNotes())); expect(markdown).toContain("## Understand reporting\n\n### Collection timing\n\nReporting can lag behind collection."); expect(markdown).not.toMatch(/\[bound|support_count|evidence_refs/);
    await click(host, "[data-copy-draft-json]"); expect(writeText.mock.calls[1]![0]).toBe(before); const blobs: Blob[] = []; const revoke = vi.fn(); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { blobs.push(blob); return "blob:draft-v2"; } }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await click(host, "[data-download-draft-json]"); const exported = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]!); }); expect(exported).toBe(before); expect(JSON.stringify(result)).toBe(before); await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:draft-v2"));
  });
  it.each(["en", "zh"] as const)("keeps failed and skipped H2 headings with closed localized reasons in actual copied Markdown (%s)", async (locale) => {
    const confirmed = await confirmedDraftV2Fixture(); const result = await resultFor(confirmed, { empty: true }); const { host } = await render(confirmed, { locale, result }); const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    expect(node<HTMLButtonElement>(host, "[data-copy-markdown]").disabled).toBe(false); await click(host, "[data-copy-markdown]"); const notes = exportNotes(locale);
    const expected = `## ${confirmed.outline[0]!.h2}\n\n> ${notes.failed("provider_error")}\n\n## ${confirmed.outline[1]!.h2}\n\n> ${notes.skipped}`;
    expect(writeText.mock.calls[0]![0]).toBe(expected); expect(contentDraftV2Markdown(result, confirmed, notes)).toBe(expected); expect(host.querySelector("[data-related-links]")).toBeNull();
  });
  it.each(["en", "zh"] as const)("retains each confirmed related link once in UI and safely escaped Markdown (%s)", async (locale) => {
    const { confirmed, url } = await confirmedWithLinks(); const result = await resultFor(confirmed, { failed: true }); const before = JSON.stringify({ confirmed, result }); const { host } = await render(confirmed, { locale, result });
    const links = host.querySelectorAll<HTMLAnchorElement>("[data-related-link]"); expect(links).toHaveLength(1); expect(links[0]!.href).toBe(url); expect(links[0]!.textContent).toBe("Read [this] (guide)"); expect(links[0]!.rel).toBe("noopener noreferrer");
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } }); await click(host, "[data-copy-markdown]"); const markdown = String(writeText.mock.calls[0]![0]);
    const related = "- [Read \\[this\\] \\(guide\\)](https://owned.test/dates%28a%29%5Bb%5D?next=%28x%29&amp;tag=%5Bv%5D#section%282%29)";
    expect(markdown.split(related)).toHaveLength(2); expect(markdown).toContain(`## ${exportNotes(locale).relatedLinks}\n\n${related}`); expect(markdown).toContain(`## ${confirmed.outline[0]!.h2}\n\n> ${exportNotes(locale).failed("provider_error")}`); expect(markdown).toContain(`## ${confirmed.outline[1]!.h2}\n\n### ${confirmed.outline[1]!.h3[0]}`); expect(markdown).not.toContain("Do not export this excluded topic"); expect(markdown).toBe(contentDraftV2Markdown(result, confirmed, exportNotes(locale)));
    const blobs: Blob[] = []; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { blobs.push(blob); return "blob:markdown-related"; } }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); await click(host, "[data-download-markdown]"); const downloaded = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]!); }); expect(downloaded).toBe(markdown);
    await click(host, "[data-copy-draft-json]"); expect(writeText.mock.calls[1]![0]).toBe(JSON.stringify(result)); expect(JSON.stringify({ confirmed, result })).toBe(before);
  });
  it("preserves literal entity-shaped query values when Markdown is rendered as a link", async () => {
    const { confirmed, url } = await confirmedWithLinks("https://owned.test/dates?literal=&copy;&next=two#section(2)"); const result = await resultFor(confirmed); const view = document.createElement("div"); view.innerHTML = await marked.parse(contentDraftV2Markdown(result, confirmed, exportNotes()));
    const href = node<HTMLAnchorElement>(view, "a").href; expect(new URL(href).search).toBe(new URL(url).search); expect(node(view, "a").textContent).toBe("Read [this] (guide)");
  });
});
