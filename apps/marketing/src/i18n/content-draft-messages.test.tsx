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

const RERUN = { used: 0, running: null, disabled: false, onRerun: () => undefined };

async function render(
  locale: "en" | "zh",
  brief: ContentBrief,
  result: DraftResult,
  host: HTMLElement = document.createElement("div"),
  rerun: Partial<typeof RERUN> = {},
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
          rerun={{ ...RERUN, ...rerun, writable: new Set(brief.draft_readiness.writable) }}
          locale={locale}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

/** The Markdown the copy button must produce, composed here from the sentences alone. */
function expectedMarkdown(result: DraftResult, notes: { failed: (reason: string) => string; skipped: string }): string {
  const blocks = result.sections.map((section) => {
    if (section.status === "failed") return `## ${section.h2}\n\n> ${notes.failed(section.fail_reason)}`;
    if (section.status === "skipped") return `## ${section.h2}\n\n> ${notes.skipped}`;
    const paragraphs = section.body.paragraphs.map((paragraph) => paragraph.sentences.map((sentence) => sentence.text).join(" "));
    return [`## ${section.h2}`, ...paragraphs].join("\n\n");
  });
  return `${[`# ${result.brief_ref.keyword}`, ...blocks].join("\n\n")}\n`;
}

function catalog(locale: "en" | "zh"): Record<string, unknown> {
  return (locale === "en" ? enMessages : zhMessages).tools.contentDraft as unknown as Record<string, unknown>;
}

/**
 * Approved copy, written down here rather than read from the catalog, so a
 * catalog edit fails this test instead of silently re-approving itself. The
 * DOM and the catalog leaf are each compared against these literals.
 */
const APPROVED_CLAIM_MARKS = {
  en: {
    none: "[no claim]",
    first: "[bound · profile fact]",
    third: "[bound · competitor excerpt]",
    gap: "[gap]",
    stance: "[stance]",
  },
  zh: {
    none: "[无主张]",
    first: "[有据 · 档案事实]",
    third: "[有据 · 竞品片段]",
    gap: "[缺口]",
    stance: "[立场]",
  },
} as const;

const APPROVED_COPY_FAILED = {
  en: "The browser refused clipboard access. Check the permission and try again.",
  zh: "浏览器拒绝了剪贴板访问，请检查权限后重试。",
} as const;

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
    // EVERY sentence has a screen-reader name beside it, outside the sentence
    // span -- a connective sentence too, so silence never means "unmarked".
    const sentences = host.querySelectorAll("[data-sentence]");
    expect(host.querySelectorAll("[data-claim-mark]").length).toBe(sentences.length);
    const approved = APPROVED_CLAIM_MARKS[locale];
    // The catalog itself carries the approved literals...
    const claimMark = catalog(locale)["claimMark"] as Record<string, string>;
    expect(claimMark).toEqual({
      boundThird: approved.third,
      boundFirst: approved.first,
      gap: approved.gap,
      stance: approved.stance,
      noClaim: approved.none,
    });
    // ...and so does every mark in the DOM, chosen by the sentence's own state.
    const seen = new Set<string>();
    for (const mark of host.querySelectorAll("[data-claim-mark]")) {
      expect(mark.className).toContain("sr-only");
      expect(mark.closest("[data-sentence]")).toBeNull();
      const sentence = mark.nextElementSibling;
      expect(sentence?.hasAttribute("data-sentence")).toBe(true);
      const claim = sentence?.getAttribute("data-claim");
      const tone = mark.getAttribute("data-claim-mark");
      const expected =
        claim === "no_claim" ? approved.none
        : claim === "gap" ? approved.gap
        : claim === "stance" ? approved.stance
        : tone === "third" ? approved.third
        : approved.first;
      expect(mark.textContent?.trim(), `${claim}/${tone}`).toBe(expected);
      seen.add(`${claim}/${tone}`);
    }
    // Every state the mark can take was actually rendered and checked.
    expect([...seen].sort()).toEqual(["bound/first", "bound/third", "gap/gap", "no_claim/none", "stance/first"]);
    expect(host.querySelectorAll('[data-claim-mark="none"]').length).toBe(
      host.querySelectorAll('[data-sentence][data-claim="no_claim"]').length,
    );
    // First- and third-party differ in shape, not only in colour.
    const first = host.querySelector('[data-claim-underline="first"]') as HTMLElement | null;
    const third = host.querySelector('[data-claim-underline="third"]') as HTMLElement | null;
    expect(first).not.toBeNull();
    expect(third).not.toBeNull();
    expect(first?.style.boxShadow).toContain("--sc-source-first");
    expect(third?.style.boxShadow).toContain("--sc-source-third");
    expect(first?.style.textDecoration).toContain("dotted");
    expect(third?.style.textDecoration).toBe("");
    expect(first?.style.cssText).not.toBe(third?.style.cssText);
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
      expect((node as HTMLElement).style.cssText).toBe("");
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
    const sectionFail = catalog(locale)["sectionFail"] as Record<string, string>;
    const notes = {
      failed: (reason: string) => sectionFail[reason] ?? reason,
      skipped: (catalog(locale)["doc"] as Record<string, string>)["skippedBody"] ?? "",
    };

    async function checkProjections(result: DraftResult, copyIndex: number): Promise<void> {
      await click(host.querySelector("[data-copy-markdown]"));
      expect(written.length, `clipboard writes; failed=${host.querySelector("[data-copy-failed]")?.textContent ?? "none"}`).toBe(copyIndex + 1);
      expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copiedLabel);
      const markdown = written[copyIndex];
      expect(markdown).toBeDefined();
      // Exactly the sentences, paragraph by paragraph; nothing the screen
      // adds for a screen reader leaks into the clipboard.
      expect(markdown).toBe(expectedMarkdown(result, notes));
      for (const mark of Object.values(catalog(locale)["claimMark"] as Record<string, string>)) {
        expect(markdown).not.toContain(mark);
      }
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

  it("reports the latest copy click, whatever order the clipboard settles them in", async () => {
    const pending: { resolve: () => void; reject: () => void }[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve, reject) => {
            pending.push({ resolve, reject });
          }),
      },
    });
    const brief = await draftBrief();
    const host = await render(locale, brief, await draftResultFixture(brief));
    await click(host.querySelector("[data-copy-markdown]"));
    await click(host.querySelector("[data-copy-markdown]"));
    expect(pending).toHaveLength(2);
    // The second click settles first and succeeds...
    await act(async () => {
      pending[1]?.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copiedLabel);
    // ...then the first, superseded one fails, and must not overwrite it.
    await act(async () => {
      pending[0]?.reject();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copiedLabel);
    expect(host.querySelector("[data-copy-failed]")).toBeNull();
  });

  it("reports a failed latest copy in words, and clears it when the next copy succeeds", async () => {
    const pending: { text: string; resolve: () => void; reject: () => void }[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (text: string) =>
          new Promise<void>((resolve, reject) => {
            pending.push({ text, resolve, reject });
          }),
      },
    });
    const brief = await draftBrief();
    const result = await draftResultFixture(brief);
    const host = await render(locale, brief, result);
    const sectionFail = catalog(locale)["sectionFail"] as Record<string, string>;
    const notes = {
      failed: (reason: string) => sectionFail[reason] ?? reason,
      skipped: (catalog(locale)["doc"] as Record<string, string>)["skippedBody"] ?? "",
    };
    await click(host.querySelector("[data-copy-markdown]"));
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0].reject();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((catalog(locale)["actions"] as Record<string, string>)["copyFailed"]).toBe(APPROVED_COPY_FAILED[locale]);
    expect(host.querySelector("[data-copy-failed]")?.textContent).toBe(APPROVED_COPY_FAILED[locale]);
    expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copyLabel);
    await click(host.querySelector("[data-copy-markdown]"));
    // The second click really wrote the clipboard, with this result's exact Markdown.
    expect(pending).toHaveLength(2);
    expect(pending[1].text).toBe(expectedMarkdown(result, notes));
    await act(async () => {
      pending[1].resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("[data-copy-failed]")).toBeNull();
    expect(host.querySelector("[data-copy-markdown]")?.textContent).toBe(copiedLabel);
  });

  it("disables every rerun control while a full generation is in flight", async () => {
    const brief = await draftBrief();
    const host = await render(locale, brief, await draftResultFixture(brief, { failSection: "O2" }), undefined, { disabled: true });
    await expandAll(host);
    const buttons = host.querySelectorAll("[data-rerun-section]");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button instanceof HTMLButtonElement && button.disabled).toBe(true);
    }
  });

  it("cancels the On-Page link's click and context menu when the handoff cannot be stored", async () => {
    const brief = await draftBrief();
    const host = await render(locale, brief, await draftResultFixture(brief));
    await type(host.querySelector("#content-draft-published-url"), "https://acme.example/blog/email-warmup-guide");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    for (const type of ["click", "contextmenu"]) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true });
      await act(async () => {
        host.querySelector("[data-open-on-page]")?.dispatchEvent(event);
      });
      expect(event.defaultPrevented, type).toBe(true);
    }
    expect(host.querySelector("[data-handoff-failed]")).not.toBeNull();
  });
});
