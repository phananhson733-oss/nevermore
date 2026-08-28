// @vitest-environment jsdom
// @input  -- real EN/ZH catalogs, the package's draft fixture, and the draft result components
// @output -- proof the front-end-verifiable items of handoff §8 (22-26, 29, 30) render the
//            promised copy in both locales, and that screen / copied Markdown / exported JSON
//            agree before and after a section rerun
// @pos    -- integration guard against shipping literal next-intl key paths, an "unavailable"
//            coverage rendered as a count, or a projection that drifts from the screen

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentBrief, DraftResult } from "@sf/public-tools/content-brief/contract";
import { draftFingerprint } from "@sf/public-tools/content-brief/canonical";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

import { localePath } from "../lib/locale-path";
import { ContentDraftResults } from "../components/tools/content-draft-results";
import { gapSentences, markdownHeadings } from "../components/tools/content-draft-markdown";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const RERUN = { used: 0, running: null, onRerun: () => undefined };

async function render(
  locale: "en" | "zh",
  brief: ContentBrief,
  result: DraftResult,
  host: HTMLElement = document.createElement("div"),
): Promise<HTMLElement> {
  if (!host.isConnected) document.body.append(host);
  root ??= createRoot(host);
  const messages = locale === "en" ? enMessages : zhMessages;
  await act(async () => {
    root?.render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <ContentDraftResults
          result={result}
          brief={brief}
          rerun={{ ...RERUN, writable: new Set(brief.draft_readiness.writable) }}
          locale={locale}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function texts(host: HTMLElement, selector: string): string[] {
  return [...host.querySelectorAll(selector)].map((node) => node.textContent ?? "");
}

async function type(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLInputElement)) throw new Error("expected an input");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error("expected an element");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  // The copy button settles through a clipboard promise: let the microtask
  // chain and the state update it ends in run to completion.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function expandAll(host: HTMLElement): Promise<void> {
  for (const toggle of host.querySelectorAll('[data-section-toggle][aria-expanded="false"]')) {
    await click(toggle);
  }
}

/** A rerun's reply: a new run id pointing at the run it replaces, re-fingerprinted. */
async function rerunOf(base: DraftResult, previous: DraftResult): Promise<DraftResult> {
  const next: DraftResult = {
    ...base,
    run: { ...base.run, run_id: "draft_01J6RERUN0000000000000002", reran_from: previous.run.run_id, fingerprint: "" },
  };
  return { ...next, run: { ...next.run, fingerprint: await draftFingerprint(next) } };
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe.each([
  {
    locale: "en" as const,
    singleSource: "Only 1 competitor page has a matching excerpt.",
    unavailableTitle: "Coverage could not be checked",
    skippedCause: "the section was not selected",
    failedCause: "the section failed to generate",
    generateSection: "Generate this section",
    copyLabel: "Copy Markdown",
    copiedLabel: "Markdown copied",
    keyPath: /tools\.contentDraft|contentDraft\./,
  },
  {
    locale: "zh" as const,
    singleSource: "仅 1 篇竞品页面有对应片段。",
    unavailableTitle: "覆盖度不可得",
    skippedCause: "所在段没有勾选",
    failedCause: "所在段生成失败",
    generateSection: "生成这一段",
    copyLabel: "复制 Markdown",
    copiedLabel: "Markdown 已复制",
    keyPath: /tools\.contentDraft|contentDraft\./,
  },
])("content draft result surface ($locale)", ({
  locale,
  singleSource,
  unavailableTitle,
  skippedCause,
  failedCause,
  generateSection,
  copyLabel,
  copiedLabel,
  keyPath,
}) => {
  it("renders no literal key path anywhere", async () => {
    const brief = await draftBrief();
    const host = await render(locale, brief, await draftResultFixture(brief, { failSection: "O2" }));
    expect(host.textContent ?? "").not.toMatch(keyPath);
  });

  it("underlines and names claims by default, and drops both when the toggle is off, leaving the verify list alone (item 24)", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief);
    const host = await render(locale, brief, result);
    await expandAll(host);
    const underlined = host.querySelectorAll("[data-claim-underline]");
    expect(underlined.length).toBeGreaterThan(0);
    // Every underline has a screen-reader name beside it, outside the sentence span.
    expect(host.querySelectorAll("[data-claim-mark]").length).toBe(underlined.length);
    for (const mark of host.querySelectorAll("[data-claim-mark]")) {
      expect(mark.className).toContain("sr-only");
      expect(mark.closest("[data-sentence]")).toBeNull();
      expect(mark.nextElementSibling?.hasAttribute("data-sentence")).toBe(true);
    }
    // The sentence text itself is untouched by the annotation.
    const sentenceTexts = texts(host, "[data-sentence]");
    expect(sentenceTexts).toEqual(
      result.sections.flatMap((section) =>
        section.status === "ok"
          ? section.body.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.text))
          : [],
      ),
    );
    // A connective sentence never carries an underline, even with the toggle on.
    for (const node of host.querySelectorAll('[data-sentence][data-claim="no_claim"]')) {
      expect(node.hasAttribute("data-claim-underline")).toBe(false);
      expect((node as HTMLElement).style.boxShadow).toBe("");
    }
    const verifyBefore = texts(host, "[data-verify-item]");
    expect(verifyBefore.length).toBe(result.verify_before_publish.length);

    const toggle = host.querySelector("[data-toggle-claims]");
    if (!(toggle instanceof HTMLInputElement)) throw new Error("no toggle");
    await act(async () => {
      toggle.click();
    });
    expect(host.querySelector("[data-draft-doc]")?.getAttribute("data-claims-visible")).toBe("false");
    expect(host.querySelectorAll("[data-claim-underline]").length).toBe(0);
    expect(host.querySelectorAll("[data-claim-mark]").length).toBe(0);
    for (const node of host.querySelectorAll("[data-sentence]")) {
      expect((node as HTMLElement).style.boxShadow).toBe("");
    }
    expect(texts(host, "[data-sentence]")).toEqual(sentenceTexts);
    expect(texts(host, "[data-verify-item]")).toEqual(verifyBefore);
    expect(window.localStorage.getItem("gengrowth.content-draft.claims.v1")).toBe("off");
  });

  it("frames a single-source sentence third-party and groups profile-only sentences apart (item 25)", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief);
    const host = await render(locale, brief, result);
    const single = host.querySelector('[data-verify-kind="single_source"]');
    expect(single).not.toBeNull();
    expect(single?.getAttribute("data-verify-tone")).toBe("third");
    expect(single?.className).toContain("source-third");
    expect(single?.querySelector("[data-verify-body]")?.textContent).toBe(singleSource);
    const profileOnly = host.querySelector('[data-verify-group="profile_only"]');
    expect(profileOnly).not.toBeNull();
    expect(profileOnly?.querySelectorAll('[data-verify-item][data-verify-kind="profile_only"]').length).toBe(
      result.verify_before_publish.filter((item) => item.kind === "profile_only").length,
    );
    // The gap group is framed by the error colour, never by a source layer.
    expect(host.querySelector('[data-verify-kind="gap"]')?.getAttribute("data-verify-tone")).toBe("error");
  });

  it("shows the whole coverage card as unavailable, with no count at all (item 26)", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { coverage: "unavailable" });
    expect(result.coverage.status).toBe("unavailable");
    const host = await render(locale, brief, result);
    const card = host.querySelector("[data-coverage-card]");
    expect(card?.getAttribute("data-field-status")).toBe("unavailable");
    expect(card?.textContent).toContain(unavailableTitle);
    expect(card?.querySelector("[data-unavailable-reason]")?.getAttribute("data-unavailable-reason")).toBe("timeout");
    expect(card?.querySelectorAll("[data-coverage-figure]").length).toBe(0);
    expect(card?.querySelector("[data-coverage-total]")).toBeNull();
    expect(host.querySelector("[data-run-mode]")?.getAttribute("data-run-mode")).toBe("degraded");
  });

  it("marks a skipped section's question not covered by section_skipped, mode partial, and offers to generate it (item 22)", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { skipSection: "O3" });
    if (result.coverage.status !== "available") throw new Error("fixture coverage unavailable");
    expect(result.run.mode).toBe("partial");
    expect(result.run.reads.sections).toMatchObject({ skipped: 1, failed: 0 });
    expect(result.run.reads.llm_sections.status).toBe("complete");
    const host = await render(locale, brief, result);
    expect(host.querySelector("[data-run-mode]")?.getAttribute("data-run-mode")).toBe("partial");
    expect(host.querySelector('[data-coverage-figure="covered"]')?.textContent).toContain(String(result.coverage.covered));
    expect(host.querySelector('[data-coverage-figure="partial"]')?.textContent).toContain(String(result.coverage.partial));
    expect(host.querySelector('[data-coverage-figure="none"]')?.textContent).toContain(String(result.coverage.none));
    expect(host.querySelector("[data-coverage-total]")?.textContent).toContain(String(result.coverage.total));
    const skipped = host.querySelector('[data-coverage-item][data-coverage-cause="section_skipped"]');
    expect(skipped?.getAttribute("data-coverage-status")).toBe("none");
    expect(skipped?.textContent).toContain(skippedCause);
    expect(host.querySelector('[data-coverage-item][data-coverage-cause="section_failed"]')).toBeNull();
    const section = host.querySelector('[data-draft-section="O3"]');
    expect(section?.getAttribute("data-section-status")).toBe("skipped");
    await click(section?.querySelector("[data-section-toggle]") ?? null);
    const generate = section?.querySelector('[data-rerun-section="O3"]');
    expect(generate?.getAttribute("data-rerun-kind")).toBe("generate");
    expect(generate?.textContent).toBe(generateSection);
    expect(host.querySelector("[data-run-sections]")?.textContent).toContain("1");
  });

  it("marks a failed section's question not covered by section_failed, mode degraded, llm partial (item 23)", async () => {
    const brief = await draftBrief();
    const result = await draftResultFixture(brief, { failSection: "O2" });
    if (result.coverage.status !== "available") throw new Error("fixture coverage unavailable");
    expect(result.run.mode).toBe("degraded");
    expect(result.run.reads.sections).toMatchObject({ failed: 1, skipped: 0 });
    expect(result.run.reads.llm_sections.status).toBe("partial");
    const host = await render(locale, brief, result);
    expect(host.querySelector("[data-run-mode]")?.getAttribute("data-run-mode")).toBe("degraded");
    const failed = host.querySelector('[data-coverage-item][data-coverage-cause="section_failed"]');
    expect(failed?.getAttribute("data-coverage-status")).toBe("none");
    expect(failed?.textContent).toContain(failedCause);
    expect(host.querySelector('[data-coverage-item][data-coverage-cause="section_skipped"]')).toBeNull();
    const section = host.querySelector('[data-draft-section="O2"]');
    expect(section?.getAttribute("data-section-status")).toBe("failed");
    expect(section?.getAttribute("data-section-open")).toBe("true");
    expect(section?.querySelector('[data-section-fail-reason="timeout"]')).not.toBeNull();
    expect(section?.querySelector('[data-rerun-section="O2"]')?.getAttribute("data-rerun-kind")).toBe("rerun");
  });

  it("shows the On-Page button only for a valid published URL, opening with rel exactly opener (item 29)", async () => {
    const brief = await draftBrief();
    const host = await render(locale, brief, await draftResultFixture(brief));
    expect(host.querySelector("[data-open-on-page]")).toBeNull();
    await type(host.querySelector("#content-draft-published-url"), "not a url");
    expect(host.querySelector("[data-open-on-page]")).toBeNull();
    expect(host.querySelector("[data-published-url-invalid]")).not.toBeNull();
    await type(host.querySelector("#content-draft-published-url"), "https://acme.example/blog/email-warmup-guide");
    const link = host.querySelector("[data-open-on-page]");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("opener");
    expect(link?.getAttribute("href")).toBe(localePath(locale, "/tools/on-page-seo-check"));
  });

  it("copies and exports the same DraftResult the screen shows, before and after a rerun replaces it (items 28-30)", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } },
    });
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { blobs.push(blob); return "blob:draft"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const brief = await draftBrief();
    const first = await draftResultFixture(brief, { failSection: "O2" });
    const host = await render(locale, brief, first);
    await expandAll(host);
    await type(host.querySelector("#content-draft-published-url"), "https://acme.example/blog/email-warmup-guide");

    async function checkProjections(result: DraftResult, copyIndex: number): Promise<void> {
      await click(host.querySelector("[data-copy-markdown]"));
      expect(written.length, `clipboard writes; failed=${host.querySelector("[data-copy-failed]")?.textContent ?? "none"}`).toBe(copyIndex + 1);
      expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copiedLabel);
      const markdown = written[copyIndex];
      expect(markdown).toBeDefined();
      const screenHeadings = texts(host, "[data-section-h2]");
      expect(markdownHeadings(markdown ?? "")).toEqual(screenHeadings);
      const screenGaps = texts(host, '[data-sentence][data-claim="gap"]');
      expect(screenGaps.length).toBeGreaterThan(0);
      expect(screenGaps).toEqual([...gapSentences(result)]);
      for (const sentence of screenGaps) expect(markdown).toContain(sentence);

      await click(host.querySelector("[data-export-json]"));
      const blob = blobs[copyIndex];
      expect(blob).toBeDefined();
      const exported = JSON.parse(await blobText(blob as Blob)) as DraftResult;
      expect(exported).toEqual(result);
      expect(exported.sections.map((section) => section.h2)).toEqual(screenHeadings);
      expect(exported.run.fingerprint).toBe(host.querySelector('[data-fingerprint="draft"]')?.textContent);
      expect(await draftFingerprint(exported)).toBe(exported.run.fingerprint);
    }

    await checkProjections(first, 0);

    // A rerun replaces the result under the same bar: the URL survives, the
    // "copied" state does not, and every projection now follows the new run.
    const second = await rerunOf(await draftResultFixture(brief), first);
    await render(locale, brief, second, host);
    await expandAll(host);
    expect(host.querySelector("[data-reran-from]")?.getAttribute("data-reran-from")).toBe(first.run.run_id);
    expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copyLabel);
    expect((host.querySelector("#content-draft-published-url") as HTMLInputElement).value).toBe(
      "https://acme.example/blog/email-warmup-guide",
    );
    expect(host.querySelector("[data-open-on-page]")).not.toBeNull();
    await checkProjections(second, 1);
    expect(written[1]).not.toBe(written[0]);
  });
});
