// @vitest-environment jsdom
// @input  -- real EN/ZH catalogs, the package's draft fixture, and the draft result components
// @output -- proof the front-end-verifiable items of handoff §8 (24-26, 29, 30) render the
//            promised copy in both locales, and that screen / Markdown / JSON agree
// @pos    -- integration guard against shipping literal next-intl key paths, an "unavailable"
//            coverage rendered as a count, or a projection that drifts from the screen

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ContentBrief,
  DraftResult,
} from "@sf/public-tools/content-brief/contract";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

import { localePath } from "../lib/locale-path";
import { ContentDraftResults } from "../components/tools/content-draft-results";
import { markdownNotes } from "../components/tools/content-draft-handoff-bar";
import {
  draftExportJson,
  draftMarkdown,
  gapSentences,
  markdownHeadings,
} from "../components/tools/content-draft-markdown";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

const NO_RERUN = { used: 0, running: null, onRerun: () => undefined };

async function render(
  locale: "en" | "zh",
  brief: ContentBrief,
  result: DraftResult,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const messages = locale === "en" ? enMessages : zhMessages;
  await act(async () => {
    root?.render(
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="UTC"
      >
        <ContentDraftResults
          result={result}
          brief={brief}
          rerun={NO_RERUN}
          locale={locale}
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function texts(host: HTMLElement, selector: string): string[] {
  return [...host.querySelectorAll(selector)].map(
    (node) => node.textContent ?? "",
  );
}

async function type(field: Element | null, value: string): Promise<void> {
  if (!(field instanceof HTMLInputElement))
    throw new Error("expected an input");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe.each([
  {
    locale: "en" as const,
    singleSource: "Only 1 competitor page has a matching excerpt.",
    unavailableTitle: "Coverage could not be checked",
    skippedCause: "the section was not selected",
    failedCause: "the section failed to generate",
    keyPath: /tools\.contentDraft|contentDraft\./,
  },
  {
    locale: "zh" as const,
    singleSource: "仅 1 篇竞品页面有对应片段。",
    unavailableTitle: "覆盖度不可得",
    skippedCause: "所在段没有勾选",
    failedCause: "所在段生成失败",
    keyPath: /tools\.contentDraft|contentDraft\./,
  },
])(
  "content draft result surface ($locale)",
  ({
    locale,
    singleSource,
    unavailableTitle,
    skippedCause,
    failedCause,
    keyPath,
  }) => {
    it("renders no literal key path anywhere", async () => {
      const brief = await draftBrief();
      const host = await render(
        locale,
        brief,
        await draftResultFixture(brief, { failSection: "O2" }),
      );
      expect(host.textContent ?? "").not.toMatch(keyPath);
    });

    it("underlines claims by default and drops every underline when the toggle is off, leaving the verify list alone (item 24)", async () => {
      const brief = await draftBrief();
      const result = await draftResultFixture(brief);
      const host = await render(locale, brief, result);
      // Every section is expanded so the count covers the whole document.
      for (const toggle of host.querySelectorAll(
        '[data-section-toggle][aria-expanded="false"]',
      )) {
        await act(async () => {
          toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      }
      expect(
        host.querySelectorAll("[data-claim-underline]").length,
      ).toBeGreaterThan(0);
      // A connective sentence never carries an underline, even with the toggle on.
      for (const node of host.querySelectorAll(
        '[data-sentence][data-claim="no_claim"]',
      )) {
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
      expect(
        host
          .querySelector("[data-draft-doc]")
          ?.getAttribute("data-claims-visible"),
      ).toBe("false");
      expect(host.querySelectorAll("[data-claim-underline]").length).toBe(0);
      for (const node of host.querySelectorAll("[data-sentence]")) {
        expect((node as HTMLElement).style.boxShadow).toBe("");
      }
      expect(texts(host, "[data-verify-item]")).toEqual(verifyBefore);
      expect(
        window.localStorage.getItem("gengrowth.content-draft.claims.v1"),
      ).toBe("off");
    });

    it("frames a single-source sentence third-party and groups profile-only sentences apart (item 25)", async () => {
      const brief = await draftBrief();
      const result = await draftResultFixture(brief);
      const host = await render(locale, brief, result);
      const single = host.querySelector('[data-verify-kind="single_source"]');
      expect(single).not.toBeNull();
      expect(single?.getAttribute("data-verify-tone")).toBe("third");
      expect(single?.className).toContain("source-third");
      expect(single?.querySelector("[data-verify-body]")?.textContent).toBe(
        singleSource,
      );
      const profileOnly = host.querySelector(
        '[data-verify-group="profile_only"]',
      );
      expect(profileOnly).not.toBeNull();
      expect(
        profileOnly?.querySelectorAll(
          '[data-verify-item][data-verify-kind="profile_only"]',
        ).length,
      ).toBe(
        result.verify_before_publish.filter(
          (item) => item.kind === "profile_only",
        ).length,
      );
      // The gap group is framed by the error colour, never by a source layer.
      expect(
        host
          .querySelector('[data-verify-kind="gap"]')
          ?.getAttribute("data-verify-tone"),
      ).toBe("error");
    });

    it("shows the whole coverage card as unavailable, with no count at all (item 26)", async () => {
      const brief = await draftBrief();
      const result = await draftResultFixture(brief, {
        coverage: "unavailable",
      });
      expect(result.coverage.status).toBe("unavailable");
      const host = await render(locale, brief, result);
      const card = host.querySelector("[data-coverage-card]");
      expect(card?.getAttribute("data-field-status")).toBe("unavailable");
      expect(card?.textContent).toContain(unavailableTitle);
      expect(
        card
          ?.querySelector("[data-unavailable-reason]")
          ?.getAttribute("data-unavailable-reason"),
      ).toBe("timeout");
      expect(card?.querySelectorAll("[data-coverage-figure]").length).toBe(0);
      expect(card?.querySelector("[data-coverage-total]")).toBeNull();
      expect(
        host.querySelector("[data-run-mode]")?.getAttribute("data-run-mode"),
      ).toBe("degraded");
    });

    it("prints the three counts over the total and names the cause of a skipped or failed section's question (items 22-23)", async () => {
      const brief = await draftBrief();
      const result = await draftResultFixture(brief, {
        failSection: "O2",
        skipSection: "O3",
      });
      if (result.coverage.status !== "available")
        throw new Error("fixture coverage unavailable");
      const host = await render(locale, brief, result);
      expect(
        host.querySelector('[data-coverage-figure="covered"]')?.textContent,
      ).toContain(String(result.coverage.covered));
      expect(
        host.querySelector('[data-coverage-figure="partial"]')?.textContent,
      ).toContain(String(result.coverage.partial));
      expect(
        host.querySelector('[data-coverage-figure="none"]')?.textContent,
      ).toContain(String(result.coverage.none));
      expect(
        host.querySelector("[data-coverage-total]")?.textContent,
      ).toContain(String(result.coverage.total));
      const skipped = host.querySelector(
        '[data-coverage-item][data-coverage-cause="section_skipped"]',
      );
      expect(skipped?.textContent).toContain(skippedCause);
      const failed = host.querySelector(
        '[data-coverage-item][data-coverage-cause="section_failed"]',
      );
      expect(failed?.textContent).toContain(failedCause);
      expect(
        host
          .querySelector('[data-draft-section="O2"]')
          ?.getAttribute("data-section-status"),
      ).toBe("failed");
      expect(
        host
          .querySelector('[data-draft-section="O2"]')
          ?.getAttribute("data-section-open"),
      ).toBe("true");
      expect(
        host
          .querySelector('[data-draft-section="O3"]')
          ?.getAttribute("data-section-status"),
      ).toBe("skipped");
      expect(
        host.querySelector("[data-run-mode]")?.getAttribute("data-run-mode"),
      ).toBe("degraded");
    });

    it("shows the On-Page button only for a valid published URL, opening with rel exactly opener (item 29)", async () => {
      const brief = await draftBrief();
      const host = await render(locale, brief, await draftResultFixture(brief));
      expect(host.querySelector("[data-open-on-page]")).toBeNull();
      await type(
        host.querySelector("#content-draft-published-url"),
        "not a url",
      );
      expect(host.querySelector("[data-open-on-page]")).toBeNull();
      expect(host.querySelector("[data-published-url-invalid]")).not.toBeNull();
      await type(
        host.querySelector("#content-draft-published-url"),
        "https://acme.example/blog/email-warmup-guide",
      );
      const link = host.querySelector("[data-open-on-page]");
      expect(link).not.toBeNull();
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("opener");
      expect(link?.getAttribute("href")).toBe(
        localePath(locale, "/tools/on-page-seo-check"),
      );
    });

    it("keeps the screen, the Markdown and the JSON on one DraftResult (items 29-30)", async () => {
      const brief = await draftBrief();
      const result = await draftResultFixture(brief, { failSection: "O2" });
      const host = await render(locale, brief, result);
      for (const toggle of host.querySelectorAll(
        '[data-section-toggle][aria-expanded="false"]',
      )) {
        await act(async () => {
          toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      }
      // The notes are the same translator-derived ones the copy button uses.
      const t = ((key: string, values?: Record<string, unknown>) => {
        const bundle = (locale === "en" ? enMessages : zhMessages).tools
          .contentDraft as unknown as Record<string, unknown>;
        const leaf = key
          .split(".")
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            bundle,
          );
        return String(leaf).replace(/\{(\w+)\}/g, (_match, name: string) =>
          String(values?.[name] ?? ""),
        );
      }) as unknown as Parameters<typeof markdownNotes>[0];
      const markdown = draftMarkdown(result, markdownNotes(t));
      const screenHeadings = texts(host, "[data-section-h2]");
      expect(markdownHeadings(markdown)).toEqual(screenHeadings);
      const exported = JSON.parse(draftExportJson(result)) as DraftResult;
      expect(exported.sections.map((section) => section.h2)).toEqual(
        screenHeadings,
      );
      expect(exported.run.fingerprint).toBe(
        host.querySelector('[data-fingerprint="draft"]')?.textContent,
      );

      const screenGaps = texts(host, '[data-sentence][data-claim="gap"]');
      expect(screenGaps.length).toBeGreaterThan(0);
      expect(screenGaps).toEqual([...gapSentences(result)]);
      for (const sentence of screenGaps) expect(markdown).toContain(sentence);
    });
  },
);
