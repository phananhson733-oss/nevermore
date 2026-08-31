// @vitest-environment jsdom
// @input -- real confirmed Brief v2, published URL gestures and private handoff storage
// @output -- exact revision-scoped On-Page handoff without publication, HTTP or URL payloads
// @pos -- compatibility contract for the v2 result's explicit next-tool action
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmedDraftV2Fixture, draftResultV2Fixture } from "@sf/public-tools/content-brief/v2-draft-fixtures";
import type { ConfirmedBriefV2 } from "@sf/public-tools/content-brief/v2-generation-contract";
import type { DraftResultV2 } from "@sf/public-tools/content-brief/v2-draft-contract";
import { TOOL_HANDOFF_KEY, TOOL_HANDOFF_TTL_MS, consumeToolHandoff } from "../../lib/tools/tool-handoff.ts";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { ContentDraftV2OnPage } from "./content-draft-v2-onpage.tsx";
import { ContentDraftV2Results } from "./content-draft-v2-results.tsx";

let root: Root | null = null;
const storageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No HTTP expected"); }));
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (storageDescriptor !== undefined) Object.defineProperty(window, "sessionStorage", storageDescriptor);
});
async function render(confirmed: ConfirmedBriefV2, locale: "en" | "zh" = "en", result?: DraftResultV2) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(<NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">{result === undefined ? <ContentDraftV2OnPage confirmed={confirmed} locale={locale} /> : <ContentDraftV2Results confirmed={confirmed} result={result} locale={locale} rerun={{ disabled: false, runningSection: null, onRerun: vi.fn() }} />}</NextIntlClientProvider>));
  return host;
}
function node<T extends Element = HTMLElement>(host: Element, selector: string): T { const found = host.querySelector(selector); expect(found, selector).not.toBeNull(); return found as T; }
async function type(host: Element, value: string) { await act(async () => { const input = node<HTMLInputElement>(host, "[data-published-url]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function gesture(host: Element, type: string) { const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: type === "auxclick" ? 1 : type === "contextmenu" ? 2 : 0 }); await act(async () => { node(host, "[data-open-on-page]").dispatchEvent(event); }); return event; }

describe("Draft v2 explicit On-Page exit", () => {
  it.each(["en", "zh"] as const)("asks for a published URL and never prefills the observed rewrite target (%s)", async (locale) => {
    const confirmed = await confirmedDraftV2Fixture({ action: "update" }); const host = await render(confirmed, locale);
    expect(node<HTMLInputElement>(host, "[data-published-url]").value).toBe(""); expect(host.querySelector("[data-open-on-page]")).toBeNull();
    expect(node(host, "[data-published-url-help]").textContent).toBe((locale === "en" ? en : zh).tools.contentDraft.handoff.publishedUrlHelp);
    expect(window.sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["click", "mousedown", "contextmenu", "auxclick"])("stages exact confirmed metadata synchronously for %s with base-language normalization", async (eventType) => {
    const confirmed = await confirmedDraftV2Fixture({ language: "zh-CN", action: "update" }); const host = await render(confirmed, "zh"); const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
    await type(host, " https://published.example/new-article?reader=seo "); expect(window.sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull();
    const link = node<HTMLAnchorElement>(host, "[data-open-on-page]"); expect(link.getAttribute("href")).toBe("/zh/tools/on-page-seo-check"); expect(link.target).toBe("_blank"); expect(link.rel).toBe("opener"); expect(new URL(link.href).search).toBe("");
    const event = await gesture(host, eventType); expect(event.defaultPrevented).toBe(false);
    const expected = { source: "content-draft", destination: "on-page-seo-check", scope: "query_page", property: null, query: confirmed.brief.context.input.primary, page: "https://published.example/new-article?reader=seo", evidenceId: confirmed.fingerprint, marketCode: confirmed.brief.context.input.market, languageCode: "zh", createdAt: now, expiresAt: now + TOOL_HANDOFF_TTL_MS };
    const raw = window.sessionStorage.getItem(TOOL_HANDOFF_KEY)!; expect(JSON.parse(raw)).toEqual(expected); expect(raw).not.toContain(confirmed.schema); expect(consumeToolHandoff(window.sessionStorage, now, "on-page-seo-check")).toEqual(expected); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["not a url", "/relative/page", "javascript:alert(1)", "file:///tmp/article.html", "https://user:password@example.com/article"])("offers no navigation for an invalid or credentialed URL: %s", async (url) => {
    const host = await render(await confirmedDraftV2Fixture()); await type(host, url); expect(node<HTMLInputElement>(host, "[data-published-url]").getAttribute("aria-invalid")).toBe("true"); expect(host.querySelector("[data-open-on-page]")).toBeNull(); expect(window.sessionStorage.getItem(TOOL_HANDOFF_KEY)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["click", "mousedown", "contextmenu", "auxclick"])("cancels %s when private storage refuses the handoff", async (eventType) => {
    const host = await render(await confirmedDraftV2Fixture()); await type(host, "https://published.example/article"); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    const event = await gesture(host, eventType); expect(event.defaultPrevented).toBe(true); expect(node(host, "[data-handoff-failed]").textContent).toBe(en.tools.contentDraft.handoff.failed); expect(fetch).not.toHaveBeenCalled();
  });
  it("also cancels navigation when accessing sessionStorage itself throws", async () => {
    const host = await render(await confirmedDraftV2Fixture()); await type(host, "https://published.example/article"); Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } }); const event = await gesture(host, "click"); expect(event.defaultPrevented).toBe(true); expect(host.querySelector("[data-handoff-failed]")).not.toBeNull();
  });
  it("mounts the exit even for a fully failed draft without claiming that the draft was published", async () => {
    const confirmed = await confirmedDraftV2Fixture({ action: "update" }); const result = await draftResultV2Fixture(confirmed, {
      sections: confirmed.outline.map((section) => ({ ...section, status: "failed", fail_reason: "not_configured", llm: { attempts: 0, model_id: null, temperature_requested: 0.4, temperature_effective: null, input_tokens: null, output_tokens: null } })),
      coverage: { items: null, reads: { status: "unavailable", reason: "insufficient_evidence", attempted: 0, calls: 0, model_id: null, input_tokens: null, output_tokens: null } },
    });
    const host = await render(confirmed, "en", result); expect(node<HTMLInputElement>(host, "[data-published-url]").value).toBe(""); expect(host.querySelector("[data-open-on-page]")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
});
