// @vitest-environment jsdom
// @input -- parsed frozen v2 fixtures, actual confirmation and EN/ZH catalogs
// @output -- editorial presentation, stable edits, explicit decision and exact export evidence
// @pos -- local DOM contract; live browser/provider acceptance remains separate
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as confirmation from "@sf/public-tools/content-brief/v2-brief";
import { buildResearchBundle, validateResearchOutput } from "@sf/public-tools/content-brief/v2-research";
import { buildSerpObservations } from "@sf/public-tools/content-brief/assemble";
import type { ConfirmedBriefV2, ContentBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { ContentBriefV2Results } from "./content-brief-v2-results.tsx";
import { validContentBriefV2 as fixture } from "./content-brief-v2-fixture.ts";
import { CONTENT_BRIEF_HANDOFF_KEY } from "@sf/public-tools/content-brief/contract";
import { parseConfirmedBriefHandoff } from "../../lib/tools/content-brief-v2-handoff.ts";


let root: Root | null = null;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; window.sessionStorage.clear(); });
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks();
  for (const [owner, key, descriptor] of [[navigator, "clipboard", originalClipboard], [URL, "createObjectURL", originalCreateUrl], [URL, "revokeObjectURL", originalRevokeUrl]] as const) {
    if (descriptor) Object.defineProperty(owner, key, descriptor); else Reflect.deleteProperty(owner, key);
  }
});

async function render(brief: ContentBriefV2, locale: "en" | "zh" = "en", onConfirmed = vi.fn<(value: ConfirmedBriefV2 | null) => void>(), onReturnToSettings = vi.fn()) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const rerender = async (next: ContentBriefV2) => { await act(async () => root?.render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC"><ContentBriefV2Results brief={next} locale={locale} onConfirmed={onConfirmed} onReturnToSettings={onReturnToSettings} /></NextIntlClientProvider>)); };
  await rerender(brief);
  return { host, onConfirmed, onReturnToSettings, rerender };
}
function node<T extends Element = HTMLElement>(host: Element, selector: string): T { const found = host.querySelector(selector); expect(found, selector).not.toBeNull(); return found as T; }
async function click(host: Element, selector: string) { await act(async () => { node<HTMLButtonElement>(host, selector).click(); }); }
async function type(host: Element, selector: string, value: string) { const input = node<HTMLInputElement | HTMLTextAreaElement>(host, selector); const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => { const details = input.closest("details"); if (details && !details.open) details.querySelector("summary")?.click(); Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function confirmedValue(onConfirmed: ReturnType<typeof vi.fn<(value: ConfirmedBriefV2 | null) => void>>) {
  await act(async () => { await vi.waitFor(() => { const value = onConfirmed.mock.calls.at(-1)?.[0]; expect(value).not.toBeNull(); expect(value).toBeDefined(); }); });
  const value = onConfirmed.mock.calls.at(-1)![0]!;
  expect((await confirmation.parseConfirmedBriefV2(value)).ok).toBe(true);
  return value;
}

describe("Artifact-aligned Brief v2 result", () => {
  it("keeps collection time and budget visible and separates generation from partial source reads", async () => {
    const original = await fixture();
    const brief = { ...original, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "competitors" ? { ...read, status: "partial" as const, attempted: 3 } : read) } };
    const { host } = await render(brief);
    const timing = node(host, "[data-run-timing]");
    expect(timing.closest("details")).toBeNull();
    expect(timing.textContent).toContain("4.2s / 45s");
    expect(timing.textContent).toContain("Elapsed / run budget");
    expect(node(host, "[data-run-collected]").querySelector(".sr-only")).toBeNull();
    expect(node(host, "[data-run-collected]").textContent).toContain("2026");
    expect(node(host, "[data-generation-status]").textContent).toBe("Ready for review");
    expect(node(host, "[data-read-coverage-status]").textContent).toBe("Limited evidence");
    expect(node(host, '[data-source-summary-item="competitors"]').textContent).toContain("1/3");
  });

  it.each(["en", "zh"] as const)("keeps observed facts and raw PAA usable after timeout without inventing a plan (%s)", async (locale) => {
    const brief = await fixture({ action: "update", unavailable: true, locale });
    const before = JSON.stringify(brief);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network permitted"));
    const { host, onReturnToSettings } = await render(brief, locale);
    expect(node(host, "[data-generation-failure]").closest("details")).toBeNull();
    expect(node(host, "[data-generation-cause]").textContent).toContain(locale === "en" ? "timed out" : "超时");
    expect(node(host, "[data-recovery-boundary]").textContent).toContain(locale === "en" ? "new full run" : "重新完整运行");
    expect(node(host, '[data-field-card="length"]').textContent).toContain("P25");
    expect(node(host, '[data-field-card="length"]').textContent).toContain("P75");
    expect(node(host, '[data-observed-formats]').textContent).toContain(locale === "en" ? "URL-only" : "仅按 URL");
    expect(node(host, '[data-gsc-match="G1"]').closest("details")).toBeNull();
    expect(node(host, '[data-owned-candidate="T1"]').closest("details")).toBeNull();
    expect(node(host, '[data-raw-paa="A1"]').textContent).toContain(brief.context.research.paa[0]!.question);
    expect(host.querySelector("[data-verdict-card], [data-question-row], [data-outline], [data-confirm-brief], [data-generate-draft]")).toBeNull();
    expect(onReturnToSettings).not.toHaveBeenCalled();
    const recovery = node<HTMLButtonElement>(host, "[data-return-to-settings]");
    recovery.focus(); expect(document.activeElement).toBe(recovery);
    await click(host, "[data-return-to-settings]");
    expect(onReturnToSettings).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(brief)).toBe(before);
  });

  it.each([
    ["provider_error", "provider returned an error"],
    ["validation_failed", "did not pass validation"],
    ["not_configured", "not configured"],
    ["insufficient_evidence", "Not enough usable evidence"],
  ] as const)("shows the actual %s cause before raw metadata", async (reason, text) => {
    const original = await fixture({ unavailable: true, action: "undecidable" });
    if (original.run.llm.status !== "unavailable") throw new Error("fixture");
    const brief = { ...original, run: { ...original.run, llm: { ...original.run.llm, reason } } };
    const { host } = await render(brief);
    expect(node(host, "[data-generation-cause]").textContent).toContain(text);
    expect(node(host, "[data-owned-evidence]").textContent).toContain("Not used");
    expect(node(host, '[data-source-summary-item="profile"]').textContent).toContain("Not used");
  });

  it("shows an honest question coverage denominator, inline source layers and immutable question chips", async () => {
    const { host } = await render(await fixture());
    const row = node(host, '[data-question-row="Q1"]');
    expect(node(row, "[data-covered-by]").textContent).toContain("1/1");
    expect(node(row, "[data-question-coverage-bar]").getAttribute("aria-label")).toContain("1 of 1");
    expect(node(row, '[data-source-layer="third"]').closest("details")).toBeNull();
    expect(node(host, '[data-outline-question="Q1"]').textContent).toBe("Q1");
    expect(node(host, "[data-question-coverage-boundary]").textContent).toContain("retained competitor pages");
    expect(node(host, '[data-must-answer] > div [data-source-layer="model"]').closest("details")).toBeNull();
  });

  it("keeps unreported read counts explicit instead of rendering empty fractions", async () => {
    const original = await fixture();
    const brief = { ...original, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "serp" ? { ...read, attempted: null, retained: null } : read) } };
    const { host } = await render(brief);
    expect(node(host, '[data-source-summary-item="serp"]').textContent).toContain("Not reported/Not reported");
  });

  it("keeps missing GSC property distinct from an explicitly unused source", async () => {
    const original = await fixture({ unavailable: true });
    const brief = { ...original, context: { ...original.context, gsc: { ...original.context.gsc, status: "unavailable" as const, reason: "not_connected" as const, property: null, window: null } } };
    const { host } = await render(brief);
    expect(node(host, "[data-owned-evidence]").textContent).toContain("Unavailable");
    expect(node(host, "[data-owned-evidence]").textContent).not.toContain("Not used");
    expect(node(host, "[data-gsc-window]").textContent).toBe("Unavailable");
  });

  it("keeps selected-but-unavailable profile metadata distinct from not used", async () => {
    const original = await fixture({ unavailable: true });
    const brief = { ...original, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "profile" ? { ...read, attempted: 1, reason: "provider_error" as const } : read) } };
    const { host } = await render(brief);
    expect(node(host, "[data-profile-snapshot]").textContent).toBe("Unavailable");
  });

  it("does not turn an unreadable PAA source into a zero-over-zero observation", async () => {
    const original = await fixture({ unavailable: true, count: 0 });
    const brief = { ...original, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "paa" ? { ...read, status: "unavailable" as const, reason: "provider_error" as const, attempted: null, retained: null } : read) } };
    const { host } = await render(brief);
    expect(node(host, "[data-raw-paa-candidates]").textContent).toContain("Unavailable");
    expect(node(host, "[data-raw-paa-candidates]").textContent).not.toContain("0/0");
  });

  it("renders plural observed formats and unknown counts separately from the model's chosen format", async () => {
    const original = await fixture();
    const page = original.context.research.pages[0]!;
    const pages = ["https://a.example/blog/guide", "https://b.example/tools/check", "https://c.example/opaque"].map((url, index) => ({ ...page, id: `C${index + 1}`, url, final_url: url }));
    const research = buildResearchBundle(pages, original.context.research.paa);
    if (!research.ok) throw new Error(research.path);
    const brief = { ...original, context: { ...original.context, research: research.value } };
    const { host } = await render(brief);
    const formats = node(host, "[data-observed-formats]");
    expect(node(formats, '[data-format-count="guide"]').textContent).toContain("1/3");
    expect(node(formats, '[data-format-count="tool"]').textContent).toContain("1/3");
    expect(node(formats, '[data-format-count="unknown"]').textContent).toContain("1/3");
    expect(formats.textContent).toContain("No format has a majority");
    expect(formats.textContent).toContain("Observed candidates: Guide · Tool");
    expect(node(host, '[data-field-card="format"]').textContent).toContain("Model suggestion");
  });

  it.each([false, true])("uses v3 SERP titles and read coverage without changing the question denominator (generation unavailable: %s)", async (unavailable) => {
    const original = await fixture({ unavailable });
    const rows = buildSerpObservations([
      { url: original.context.research.pages[0]!.url, title: "How to check reporting delays" },
      { url: null, title: "The best reporting tools" },
      { url: "https://search.example/c", title: "Report A vs Report B" },
      { url: "https://search.example/d", title: "Reporting overview" },
    ].map((row, index) => ({ ...row, rank: index + 1, domain: row.url ? new URL(row.url).hostname : "search.example" })));
    const candidate = { ...original, schema: "gengrowth.content_brief/v3" as const, context: { ...original.context, serp: { rows, read: { status: "partial" as const, requested: 10, returned: 4, unresolved: 1 } } }, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "serp" ? { ...read, status: "partial" as const, retained: 4 } : read) } };
    const brief = { ...candidate, run: { ...candidate.run, fingerprint: await confirmation.fingerprintBriefV2(candidate) } };
    expect(await confirmation.parseContentBriefV2(brief)).toEqual({ ok: true, value: brief });
    const { host, onConfirmed } = await render(brief);
    const formats = node(host, "[data-observed-formats]");
    expect(formats.textContent).toContain("SERP title + URL heuristic");
    expect(formats.textContent).not.toContain("URL-only");
    expect(formats.textContent).toContain("4/10 organic results");
    expect(formats.textContent).toContain("1 unresolved");
    expect(node(formats, '[data-format-count="guide"]').textContent).toContain("1/4");
    expect(node(formats, '[data-format-count="listicle"]').textContent).toContain("1/4");
    expect(node(formats, '[data-format-count="unknown"]').textContent).toContain("1/4");
    expect(node(formats, '[data-format-source="S1"]').textContent).toContain("How to check reporting delays");
    expect(node(formats, '[data-format-source="S2"]').querySelector("a")).toBeNull();
    if (!unavailable) {
      expect(node(host, '[data-question-row="Q1"] [data-covered-by]').textContent).toContain("1/1");
      await click(host, "[data-confirm-brief]");
      const confirmed = await confirmedValue(onConfirmed);
      expect(confirmed.schema).toBe("gengrowth.confirmed_brief/v3");
      expect(confirmed.brief.context.serp).toEqual(brief.context.serp);
    }
  });

  it.each(["en", "zh"] as const)("hands the exact confirmed revision privately to Draft (%s)", async (locale) => {
    const { host, onConfirmed } = await render(await fixture({ locale }), locale);
    expect(host.querySelector("[data-generate-draft]")).toBeNull();
    await click(host, "[data-confirm-brief]");
    const confirmed = await confirmedValue(onConfirmed);
    const link = node<HTMLAnchorElement>(host, "[data-generate-draft]");
    expect(link.getAttribute("href")).toBe(locale === "en" ? "/tools/content-draft" : "/zh/tools/content-draft");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("opener");
    await act(async () => { link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    expect(raw).not.toBeNull();
    expect(await parseConfirmedBriefHandoff(JSON.parse(raw!))).toEqual({ ok: true, value: confirmed });
    expect(link.href).not.toContain(confirmed.fingerprint);
    await type(host, '[data-outline-h2="O1"]', "Changed after staging");
    expect(host.querySelector("[data-generate-draft]")).toBeNull();
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });
  it("cancels navigation on blocked storage and does not delete a newer foreign handoff when edited", async () => {
    const { host, onConfirmed } = await render(await fixture());
    await click(host, "[data-confirm-brief]"); await confirmedValue(onConfirmed);
    const link = node<HTMLAnchorElement>(host, "[data-generate-draft]");
    await act(async () => { link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    window.sessionStorage.setItem(CONTENT_BRIEF_HANDOFF_KEY, "newer handoff");
    await type(host, '[data-outline-h2="O1"]', "Edited");
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBe("newer handoff");
    await click(host, "[data-confirm-brief]"); await confirmedValue(onConfirmed);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { node(host, "[data-generate-draft]").dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(host.querySelector("[data-draft-handoff-error]")).not.toBeNull();
  });
  it.each(["en", "zh"] as const)("puts the keyword, actual page recommendation, compact questions and editable outline first (%s)", async (locale) => {
    const brief = await fixture({ locale }); const { host } = await render(brief, locale);
    expect(node(host, "[data-brief-header] h3").textContent).toBe("reporting delays");
    const selectors = ["[data-brief-header]", "[data-source-summary]", "[data-verdict-card]", "[data-field-cards]", "[data-must-answer]", "[data-outline]", "[data-confirmation-bar]"];
    for (let i = 1; i < selectors.length; i++) expect(node(host, selectors[i - 1]!).compareDocumentPosition(node(host, selectors[i]!)) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(host.querySelectorAll("[data-field-card]")).toHaveLength(3);
    expect(host.querySelectorAll("[data-question-row]")).toHaveLength(2);
    expect(host.querySelector("[data-generate-draft]")).toBeNull();
    expect(host.textContent).not.toMatch(/v1.*(?:unsupported|不支持)/i);
    expect(node<HTMLButtonElement>(host, "[data-copy-confirmed-json]").disabled).toBe(true);
    expect(node<HTMLButtonElement>(host, "[data-download-confirmed-json]").disabled).toBe(true);
  });

  it("keeps exact run/source metadata in default-closed native disclosures", async () => {
    const brief = await fixture(); const { host } = await render(brief);
    for (const details of host.querySelectorAll("details")) { expect(details.hasAttribute("open")).toBe(false); expect(details.firstElementChild?.tagName).toBe("SUMMARY"); }
    expect(JSON.parse(node(host, "[data-run-ledger]").textContent!)).toEqual(brief.run);
    expect(JSON.parse(node(host, "[data-evidence-ledger]").textContent!)).toEqual(brief.context);
    expect(node(host, "[data-run-fingerprint]").closest("details:not([open])")).not.toBeNull();
    expect(node(host, "[data-temperature-effective]").textContent).toMatch(/not reported/i);
    expect(node(host, "[data-serp-cost]").textContent).toMatch(/not reported/i);
    expect(node(host, '[data-source-summary-item="profile"]').textContent).toContain("Not used");
    expect(node(host, '[data-source-summary-item="profile"]').textContent).not.toMatch(/unavailable|unknown/i);
    expect(node(host, "[data-gsc-window]").textContent).toContain("2026-08-01");
  });

  it("labels Chinese observed length as characters, and intent/format as model judgments", async () => {
    const { host } = await render(await fixture({ locale: "zh" }), "zh");
    expect(node(host, '[data-field-card="length"]').textContent).toContain("非空白字符");
    expect(node(host, '[data-field-card="length"]').textContent).not.toContain("词（");
    for (const field of ["intent", "format"]) expect(node(host, `[data-field-card="${field}"]`).textContent).toContain("模型建议");
  });

  it("shows PAA-only coverage as zero observed competitor pages and one question still supports confirmation", async () => {
    const { host } = await render(await fixture({ paaOnly: true, count: 1 }));
    expect(node(host, '[data-question-row="Q1"] [data-covered-by]').textContent).toContain("0");
    expect(node(host, '[data-question-row="Q1"]').textContent).toContain("PAA");
    expect(node(host, "[data-paa-boundary]").textContent).toMatch(/not factual support/i);
    expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(false);
  });

  it("preserves stable IDs and question mappings through wording changes and keyboard-button reorder", async () => {
    const brief = await fixture(); const before = JSON.stringify(brief); const { host, onConfirmed } = await render(brief);
    await type(host, '[data-outline-h2="O1"]', "Check the delay before writing");
    await type(host, '[data-outline-h3="O1"]', "Collection date\nUpdate date");
    await click(host, '[data-move-down="O1"]');
    expect(Array.from(host.querySelectorAll("[data-outline-section]"), (el) => el.getAttribute("data-outline-section"))).toEqual(["O2", "O1"]);
    await click(host, "[data-confirm-brief]");
    const value = await confirmedValue(onConfirmed);
    expect(value.outline.map(({ id, answers }) => ({ id, answers }))).toEqual([{ id: "O2", answers: ["Q2"] }, { id: "O1", answers: ["Q1"] }]);
    expect(value.outline[1]?.h2).toBe("Check the delay before writing");
    expect(value.outline[1]?.h3).toEqual(["Collection date", "Update date"]);
    expect(value.brief.generated?.research.outline[0]?.h2).toBe("Understand reporting delays");
    expect(value.revision).toBe(1); expect(JSON.stringify(brief)).toBe(before);
    expect(node(host, "[data-confirmed-summary]").textContent).toContain("Revision 1");
  });

  it("requires an explicit unchecked choice before confirming an undecidable action", async () => {
    const { host, onConfirmed } = await render(await fixture({ action: "undecidable" }));
    expect(node<HTMLInputElement>(host, "[data-resolve-create]").checked).toBe(false);
    expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(true);
    await click(host, "[data-resolve-create]"); await click(host, "[data-confirm-brief]");
    const value = await confirmedValue(onConfirmed);
    expect(value.resolution).toBe("create_despite_uncertainty");
    expect(value.brief.generated?.page_plan.action).toBe("undecidable");
    expect(node(host, "[data-confirmed-summary]").textContent).toMatch(/your decision/i);
  });

  it("keeps an actual update target and executable rewrite instructions rather than silently creating a page", async () => {
    const { host, onConfirmed } = await render(await fixture({ action: "update" }));
    expect(node(host, "[data-verdict-card]").textContent).toContain("Rewrite the existing page");
    expect(node<HTMLAnchorElement>(host, "[data-target-page]").href).toBe("https://owned.example/reporting");
    expect(node(host, "[data-plan-step]").textContent).toContain("Clarify collection and update dates");
    expect(host.querySelector("[data-resolve-create]")).toBeNull();
    await click(host, "[data-confirm-brief]");
    expect((await confirmedValue(onConfirmed)).brief.generated?.page_plan.target_ref).toBe("T1");
  });

  it("invalidates confirmation on every edit and confirms a new exact revision", async () => {
    const { host, onConfirmed } = await render(await fixture()); await click(host, "[data-confirm-brief]");
    const first = await confirmedValue(onConfirmed);
    await type(host, '[data-outline-h2="O1"]', "Changed headline");
    expect(onConfirmed.mock.calls.at(-1)?.[0]).toBeNull();
    expect(host.querySelector("[data-confirmed-summary]")).toBeNull();
    expect(node<HTMLButtonElement>(host, "[data-copy-confirmed-json]").disabled).toBe(true);
    await click(host, "[data-confirm-brief]");
    const second = await confirmedValue(onConfirmed);
    expect(second.revision).toBe(2); expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  it.each([{ count: 0 }, { unavailable: true }])("does not offer a confirmation/editor without an outline (%o)", async (options) => {
    const brief = await fixture(options); const { host } = await render(brief);
    expect(host.querySelector("[data-confirm-brief]")).toBeNull(); expect(host.querySelector("[data-outline-h2]")).toBeNull();
    expect(node(host, "[data-no-outline]").textContent?.length).toBeGreaterThan(10);
    expect(JSON.parse(node(host, "[data-run-ledger]").textContent!)).toEqual(brief.run);
  });

  it("copies and downloads the exact confirmed revision with the same original evidence and fingerprint", async () => {
    const { host, onConfirmed } = await render(await fixture());
    await type(host, '[data-outline-h2="O1"]', "A user-edited headline"); await click(host, "[data-confirm-brief]");
    const value = await confirmedValue(onConfirmed);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await click(host, "[data-copy-confirmed-json]");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0] === JSON.stringify(value)).toBe(true);
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(value);
    expect(JSON.parse(node(host, "[data-confirmed-json]").textContent!)).toEqual(value);
    const blobs: Blob[] = [];
    const revoke = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { blobs.push(blob); return "blob:confirmed-test"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toContain(`r${value.revision}-${value.fingerprint.slice(0, 12)}`); });
    await click(host, "[data-download-confirmed-json]");
    expect(anchorClick).toHaveBeenCalledTimes(1); expect(blobs).toHaveLength(1);
    const exported = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blobs[0]!); });
    expect(JSON.parse(exported)).toEqual(value);
    expect(exported).toBe(JSON.stringify(value));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:confirmed-test"));
    expect(host.querySelector('a[download]')).toBeNull();
  });

  it("does not replace a new confirmed edit with an older asynchronous confirmation", async () => {
    const realConfirm = confirmation.confirmBriefV2;
    let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(confirmation, "confirmBriefV2").mockImplementationOnce(async (input, edits) => { await barrier; return realConfirm(input, edits); });
    const { host, onConfirmed } = await render(await fixture()); await click(host, "[data-confirm-brief]");
    const older = spy.mock.results[0]!.value;
    expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").getAttribute("aria-busy")).toBe("true");
    await type(host, '[data-outline-h2="O1"]', "A newer edit"); await click(host, "[data-confirm-brief]");
    const latest = await confirmedValue(onConfirmed);
    await act(async () => { release(); await older; });
    expect(onConfirmed.mock.calls.filter(([value]) => value !== null)).toHaveLength(1);
    expect(latest.outline[0]?.h2).toBe("A newer edit");
    expect(JSON.parse(node(host, "[data-confirmed-json]").textContent!)).toEqual(latest);
  });

  it("drops a pending confirmation after replacement with a different Brief", async () => {
    const realConfirm = confirmation.confirmBriefV2;
    let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(confirmation, "confirmBriefV2").mockImplementationOnce(async (input, edits) => { await barrier; return realConfirm(input, edits); });
    const { host, onConfirmed, rerender } = await render(await fixture()); await click(host, "[data-confirm-brief]");
    const older = spy.mock.results[0]!.value; const replacement = await fixture({ runId: "replacement", action: "undecidable" });
    await rerender(replacement); await act(async () => { release(); await older; });
    expect(onConfirmed.mock.calls.filter(([value]) => value !== null)).toHaveLength(0);
    expect(host.querySelector("[data-confirmed-summary]")).toBeNull();
    expect(node<HTMLInputElement>(host, "[data-resolve-create]").checked).toBe(false);
  });

  it("invalidates a confirmation when the owning result object is replaced, even if its causal fingerprint is unchanged", async () => {
    const brief = await fixture(); const { host, onConfirmed, rerender } = await render(brief); await click(host, "[data-confirm-brief]"); await confirmedValue(onConfirmed);
    await rerender({ ...brief, run: { ...brief.run, elapsed_ms: brief.run.elapsed_ms + 1 } });
    expect(onConfirmed.mock.calls.at(-1)?.[0]).toBeNull();
    expect(host.querySelector("[data-confirmed-summary]")).toBeNull();
    expect(node<HTMLButtonElement>(host, "[data-copy-confirmed-json]").disabled).toBe(true);
  });

  it("never calls back with an async result after unmount", async () => {
    const realConfirm = confirmation.confirmBriefV2;
    let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(confirmation, "confirmBriefV2").mockImplementationOnce(async (input, edits) => { await barrier; return realConfirm(input, edits); });
    const { host, onConfirmed } = await render(await fixture()); await click(host, "[data-confirm-brief]");
    const pending = spy.mock.results[0]!.value;
    await act(async () => root?.unmount()); root = null;
    const calls = onConfirmed.mock.calls.length;
    await act(async () => { release(); await pending; });
    expect(onConfirmed.mock.calls).toHaveLength(calls);
  });

  it("prevents duplicate confirms and recovers after a failed confirmation without advancing the revision", async () => {
    const spy = vi.spyOn(confirmation, "confirmBriefV2").mockRejectedValueOnce(new Error("local crypto unavailable"));
    const { host, onConfirmed } = await render(await fixture());
    await act(async () => { node<HTMLButtonElement>(host, "[data-confirm-brief]").click(); node<HTMLButtonElement>(host, "[data-confirm-brief]").click(); });
    expect(spy).toHaveBeenCalledTimes(1); expect(node(host, '[role="alert"]').textContent).toContain("could not be confirmed");
    expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(false);
    await click(host, "[data-confirm-brief]"); expect((await confirmedValue(onConfirmed)).revision).toBe(1);
  });

  it("validates heading code points and H3 limits, with labeled keyboard-accessible controls", async () => {
    const { host } = await render(await fixture());
    for (const input of host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-outline-h2], [data-outline-h3]")) expect(input.labels?.length).toBe(1);
    expect(node<HTMLButtonElement>(host, '[data-move-up="O1"]').disabled).toBe(true);
    expect(node<HTMLButtonElement>(host, '[data-move-down="O2"]').disabled).toBe(true);
    expect(node(host, '[data-move-down="O1"]').getAttribute("aria-label")).toBe("Move O1 down");
    await type(host, '[data-outline-h2="O1"]', "𠀀".repeat(161)); expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(true);
    await type(host, '[data-outline-h2="O1"]', "𠀀".repeat(160)); expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(false);
    await type(host, '[data-outline-h3="O1"]', "A\nB\nC\nD"); expect(node<HTMLButtonElement>(host, "[data-confirm-brief]").disabled).toBe(true);
    expect(node(host, '[role="alert"]').textContent).toContain("at most 3");
  });

  it("keeps supporting-query evidence distinct and shows low-position owned-page reads without dismissing them", async () => {
    const base = await fixture({ action: "update" });
    const changed = { ...base, context: { ...base.context, gsc: { ...base.context.gsc, matches: [{ ...base.context.gsc.matches[0]!, query: "reporting dates", keyword: "reporting dates", scope: "supporting" as const, position: 67 }] } } };
    const brief = { ...changed, run: { ...changed.run, fingerprint: await confirmation.fingerprintBriefV2(changed) } };
    expect((await confirmation.parseContentBriefV2(brief)).ok).toBe(true);
    const { host } = await render(brief);
    const evidence = node<HTMLDetailsElement>(host, "[data-page-evidence]");
    expect(evidence.open).toBe(false);
    expect(node(evidence, '[data-gsc-match="G1"]').textContent).toContain("Supporting keyword");
    expect(node(evidence, '[data-gsc-match="G1"]').textContent).toContain("reporting dates");
    expect(node(evidence, '[data-gsc-match="G1"]').textContent).toContain("67");
    expect(node(evidence, '[data-owned-candidate="T1"]').textContent).toContain("Content observed");
    expect(node(host, "[data-verdict-card]").textContent).toContain("Rewrite the existing page");
  });

  it("preserves the confirmed revision after clipboard failure and never makes a network request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network permitted"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const { host, onConfirmed } = await render(await fixture()); await click(host, "[data-confirm-brief]");
    const confirmed = await confirmedValue(onConfirmed); await click(host, "[data-copy-confirmed-json]");
    expect(node(host, '[role="status"]').textContent).toContain("Clipboard access failed");
    expect(JSON.parse(node(host, "[data-confirmed-json]").textContent!)).toEqual(confirmed);
    expect(node<HTMLButtonElement>(host, "[data-download-confirmed-json]").disabled).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps real H3 wording readable while its editing controls start collapsed", async () => {
    const { host } = await render(await fixture());
    const details = node<HTMLDetailsElement>(host, '[data-h3-editor="O1"]');
    expect(details.open).toBe(false);
    expect(node(details, "summary").textContent).toContain("Collection timing");
    expect(node<HTMLTextAreaElement>(details, '[data-outline-h3="O1"]').value).toBe("Collection timing");
  });

  it("keeps the v2 catalogs aligned and describes actual supporting/PAA behavior, not the legacy exclusion", () => {
    const keys = (object: Record<string, unknown>, prefix = ""): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === "object" && value !== null ? keys(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
    expect(keys(en.tools.contentBrief.v2)).toEqual(keys(zh.tools.contentBrief.v2));
    expect(en.tools.contentBrief.v2.supportingHint).toContain("separately exact-matched");
    expect(en.tools.contentBrief.v2.supportingHint).toContain("do not trigger additional searches");
    expect(zh.tools.contentBrief.v2.supportingHint).toContain("分别精确匹配");
    expect(zh.tools.contentBrief.v2.formIntro).toContain("初始 People Also Ask");
    expect(en.tools.contentBrief.v2.formIntro).toContain("owned pages to read");
    expect(en.tools.contentBrief.v2.formIntro).toContain("no report is saved");
  });

  it("keeps wire exports under the real handoff byte cap for a near-limit valid Brief with maximum edited headings", async () => {
    const original = await fixture({ paaOnly: true, count: 1 });
    const paa = Array.from({ length: 7 }, (_, i) => ({ id: `A${i + 1}`, question: `Which reporting check is needed for step ${i + 1}?`, seed_question: null }));
    const pages = Array.from({ length: 2 }, (_, i) => ({ id: `C${i + 1}`, role: "competitor" as const, url: `https://competitor.example/reporting/${i}`, final_url: `https://competitor.example/reporting/${i}`, fetched_at: original.run.collected_at, content_hash: "a".repeat(64), body_complete: true, research: { segments: Array.from({ length: 12 }, () => ({ heading: null, text: "Observed reporting detail", truncated: false })), segments_total: 12, omitted_segments: 0, length: { value: 36, unit: "words" as const, tokenizer: "whitespace" as const } } }));
    const research = buildResearchBundle(pages, paa); if (!research.ok) throw new Error(research.path);
    const anchors = research.value.units.filter((unit) => unit.kind === "paa").map((unit) => unit.id);
    const result = validateResearchOutput({ questions: paa.map((item, i) => ({ anchor: anchors[i]!, q: item.question, sources: [anchors[i]!] })), outline: paa.map((_, i) => ({ h2: `Reporting step ${i + 1}`, h3: [], answers: [anchors[i]!] })) }, research.value);
    if (!result.ok) throw new Error(result.path);
    const matches = Array.from({ length: 30 }, (_, i) => ({ id: `G${i + 1}`, query: "reporting delays", keyword: "reporting delays", scope: "primary" as const, page: `https://owned.example/${i}/${"a".repeat(1800)}`, clicks: 0, impressions: 1, position: 67 }));
    const assemble = (length: number): ContentBriefV2 => ({ ...original, context: { ...original.context, research: research.value, gsc: { ...original.context.gsc, matches }, profile_snapshot: { website_id: "00000000-0000-4000-8000-000000000001", revision: 1, hash: "b".repeat(64) }, facts: Array.from({ length: 32 }, (_, i) => ({ id: `P${i + 1}`, field: `${i}${"文".repeat(length)}`, text: "文".repeat(300), derivation: "declared", provenance: { method: "observed", origin: "product_profile" } })) }, generated: { ...original.generated!, research: result.value, page_plan: { ...original.generated!.page_plan, action: "undecidable" } }, run: { ...original.run, reads: original.run.reads.map((read) => read.source === "paa" ? { ...read, attempted: 7, retained: 7 } : read.source === "gsc" ? { ...read, attempted: 30, retained: 30 } : read.source === "competitors" ? { ...read, status: "complete", reason: null, attempted: 2, retained: 2 } : read.source === "profile" ? { ...read, status: "complete", reason: null, attempted: 32, retained: 32 } : read) } });
    const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
    let low = 0; let high = 1998; let fitting = assemble(0);
    while (low <= high) { const midpoint = Math.floor((low + high) / 2); const candidate = assemble(midpoint); if (bytes(candidate) <= confirmation.BRIEF_V2_MAX_BYTES) { fitting = candidate; low = midpoint + 1; } else high = midpoint - 1; }
    const brief = { ...fitting, run: { ...fitting.run, fingerprint: await confirmation.fingerprintBriefV2(fitting) } };
    expect((await confirmation.parseContentBriefV2(brief)).ok).toBe(true);
    const { host, onConfirmed } = await render(brief);
    for (const item of result.value.outline) { await type(host, `[data-outline-h2="${item.id}"]`, "𠀀".repeat(160)); await type(host, `[data-outline-h3="${item.id}"]`, Array.from({ length: 3 }, () => "𠀀".repeat(160)).join("\n")); }
    await click(host, "[data-resolve-create]"); await click(host, "[data-confirm-brief]"); const value = await confirmedValue(onConfirmed);
    expect(bytes(value)).toBeGreaterThan(230 * 1024);
    expect(bytes(value)).toBeLessThanOrEqual(confirmation.CONFIRMED_BRIEF_V2_MAX_BYTES);
    expect(bytes(JSON.stringify(value, null, 2))).toBeGreaterThan(confirmation.CONFIRMED_BRIEF_V2_MAX_BYTES);
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await click(host, "[data-copy-confirmed-json]");
    const wire = writeText.mock.calls[0]![0] as string;
    expect(bytes(wire)).toBeLessThanOrEqual(confirmation.CONFIRMED_BRIEF_V2_MAX_BYTES);
    expect(wire === JSON.stringify(value)).toBe(true);
    expect((await confirmation.parseConfirmedBriefV2(JSON.parse(wire))).ok).toBe(true);
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { blobs.push(blob); return "blob:large-confirmed-test"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await click(host, "[data-download-confirmed-json]");
    const downloaded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blobs[0]!); });
    expect(bytes(downloaded)).toBeLessThanOrEqual(confirmation.CONFIRMED_BRIEF_V2_MAX_BYTES);
    expect(downloaded === wire).toBe(true);
    expect((await confirmation.parseConfirmedBriefV2(JSON.parse(downloaded))).ok).toBe(true);
  });
});
