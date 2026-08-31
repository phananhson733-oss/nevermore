// @vitest-environment jsdom
// @input -- real Brief result components, EN/ZH catalogs and frozen provider fixtures
// @output -- Artifact hierarchy, honest source states and inspectable default-closed evidence
// @pos -- presentation contract; browser tests separately verify computed CSS and keyboard behavior

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentBrief } from "@sf/public-tools/content-brief/contract";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { ContentBriefResults } from "./content-brief-results";
import { validContentBrief, withFingerprint, withRun } from "./content-brief-fixture";

let root: Root | null = null;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

async function render(brief: ContentBrief, locale: "en" | "zh" = "en") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">
      <ContentBriefResults brief={brief} locale={locale} />
    </NextIntlClientProvider>,
  ));
  return host;
}

function element(host: Element, selector: string): Element {
  const node = host.querySelector(selector);
  expect(node, selector).not.toBeNull();
  return node!;
}

describe("Content Brief approved Artifact presentation", () => {
  it("keeps keyword, compact sources, verdict, three fields and editorial body in Artifact order", async () => {
    const brief = validContentBrief({}, { connected: true });
    const host = await render(brief);
    const selectors = ["[data-brief-header]", "[data-source-summary]", "[data-verdict-card]", "[data-field-cards]", "[data-must-answer]", "[data-outline]", "[data-gap-angle]", '[data-links-card="internal-links"]', '[data-links-card="do-not-cover"]', "[data-readiness-bar]", "[data-wont-say]"];
    const nodes = selectors.map((selector) => element(host, selector));
    for (let index = 1; index < nodes.length; index += 1) {
      expect(nodes[index - 1]!.compareDocumentPosition(nodes[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    expect(element(host, "[data-brief-header] h3").textContent).toBe(brief.keyword.primary);
    expect(host.querySelectorAll("[data-field-card]")).toHaveLength(3);
    expect(host.querySelectorAll("[data-source-summary-item]")).toHaveLength(4);
    expect(element(host, "[data-source-summary]").textContent).not.toContain(brief.run.reads.llm.model_id);
  });

  it("keeps full run and evidence values in closed native disclosures", async () => {
    const brief = await withFingerprint(validContentBrief({}, { connected: true }));
    const host = await render(brief);
    const run = element(host, "details[data-run-details]");
    const evidence = element(host, "details[data-evidence-details]");
    for (const details of [run, evidence]) {
      expect(details.hasAttribute("open")).toBe(false);
      expect(details.firstElementChild?.tagName).toBe("SUMMARY");
    }
    expect(run.textContent).toContain(brief.run.reads.llm.model_id);
    expect(run.textContent).toContain(brief.run.fingerprint);
    expect(run.querySelector("[data-temperature-requested]")).not.toBeNull();
    expect(evidence.textContent).toContain("5,200");
    expect(evidence.textContent).toContain("900");
    expect(evidence.querySelector("[data-gsc-rows]")).not.toBeNull();
    expect(JSON.parse(element(evidence, "[data-evidence-ledger]").textContent ?? "null")).toEqual(brief.evidence);
    for (const selector of ["[data-model-id]", "[data-run-fingerprint]", "[data-gsc-rows]"]) {
      expect(element(host, selector).closest("details:not([open])")).not.toBeNull();
    }
  });

  it.each(["en", "zh"] as const)("renders not-requested as neutral not-used without unknown attempts (%s)", async (locale) => {
    const host = await render(validContentBrief(), locale);
    for (const name of ["gsc", "profile"]) {
      const cell = element(host, `[data-coverage-cell="${name}"]`);
      const summary = element(host, `[data-source-summary-item="${name}"]`);
      for (const node of [cell, summary]) {
        expect(node.textContent).toContain(locale === "en" ? "Not used" : "未使用");
        expect(node.textContent).not.toMatch(/attempts not known|尝试次数未知|unavailable|不可得/);
        expect(node.querySelector('[class*="text-brand-error"]')).toBeNull();
      }
    }
    for (const card of host.querySelectorAll("[data-links-card]")) {
      expect(card.textContent).toContain(locale === "en" ? "Not used" : "未使用");
      expect(card.textContent).not.toMatch(/there are no owned pages|没有可归属页面/);
    }
  });

  it("names only the actual partial lanes and keeps complete GSC with no primary sample distinct", async () => {
    const brief = validContentBrief({}, { notObserved: true });
    const host = await render(brief);
    const summary = element(host, "[data-mode-body]").textContent ?? "";
    expect(summary).toContain("Competitor pages");
    expect(summary).toContain("6/10");
    expect(summary).toContain("2 partially read");
    expect(summary).toContain("3 not fetched");
    expect(summary).toContain("1 skipped");
    expect(summary).not.toMatch(/Search Console|SERP| or /);
    const gsc = element(host, '[data-source-summary-item="gsc"]');
    expect(gsc.textContent).toContain("complete");
    expect(gsc.textContent).not.toMatch(/unavailable|no related pages/i);
    expect(element(host, '[data-primary-coverage-reason="query_not_in_sample"]').textContent).toContain("not in the query sample");
  });

  it("names actual GSC truncated dimensions and unreadable rows, not unrelated possible failures", async () => {
    const brief = validContentBrief({}, { connected: true });
    const gsc = brief.run.reads.gsc;
    if (gsc.status === "unavailable") throw new Error("fixture GSC");
    const host = await render(withRun(brief, { reads: { gsc: { ...gsc, status: "partial", truncated: ["page"], unreadable_rows: { query: 0, query_page: 3, page: 1 } } } }));
    const summary = element(host, "[data-mode-body]").textContent ?? "";
    expect(summary).toContain("Search Console");
    expect(summary).toContain("Truncated: page");
    expect(summary).toContain("query-page 3");
    expect(summary).not.toMatch(/fewer SERP| or /);
  });

  it("keeps real errors distinct from a neutral unused source", async () => {
    const host = await render(withRun(validContentBrief(), { reads: { product_profile: { status: "unavailable", reason: "provider_error", attempted: 1 } } }));
    const cell = element(host, '[data-coverage-cell="profile"]');
    expect(cell.textContent).toContain("upstream provider returned an error");
    expect(cell.textContent).toContain("attempted 1");
    expect(cell.querySelector('[class*="text-brand-error"]')).not.toBeNull();
  });

  it("uses compact question rows with frozen coverage, source and closed member evidence", async () => {
    const brief = validContentBrief();
    const host = await render(brief);
    if (brief.must_answer.status === "unavailable") throw new Error("fixture questions");
    for (const item of brief.must_answer.items) {
      const row = element(host, `[data-must-answer-item="${item.id}"]`);
      expect(row.getAttribute("data-question-row")).toBe("");
      expect(element(row, "[data-must-answer-q]").textContent).toBe(item.q);
      expect(element(row, "[data-covered-by]").textContent).toContain(`${item.covered_by}/6`);
      expect(element(row, "[data-source-chip]").getAttribute("data-source-tone")).toBe("model");
      expect(element(row, "[data-source-layer]").closest("details")).toBeNull();
      expect(element(row, "[data-source-chip]").closest("details:not([open])")).not.toBeNull();
      expect(element(row, "details").hasAttribute("open")).toBe(false);
      expect(row.querySelectorAll("[data-cluster-member]")).toHaveLength(item.cluster.members.length);
    }
    expect(element(host, '[data-field-card="intent"] [data-source-chip]').getAttribute("data-source-tone")).toBe("third");
  });

  it("keeps field values prominent and their rule/distribution details closed", async () => {
    const host = await render(validContentBrief({}, { completeC5: true }));
    for (const field of ["intent", "format"]) {
      const card = element(host, `[data-field-card="${field}"]`);
      expect(element(card, "details[data-field-details]").hasAttribute("open")).toBe(false);
      expect(element(card, `[data-${field}-support], [data-${field}-values]`).closest("details")).toBeNull();
      expect(element(card, "[data-source-chip]").closest("details")).toBeNull();
    }
    expect(element(host, "[data-format-distribution]").closest("details:not([open])")).not.toBeNull();
    expect(element(host, "[data-length-median]").textContent).toContain("1,210");
  });

  it("keeps the keyword and an actionable coverage-only explanation when no SERP came back", async () => {
    const brief = validContentBrief({}, { serp: "unavailable" });
    const host = await render(brief);
    expect(element(host, "[data-brief-header] h3").textContent).toBe(brief.keyword.primary);
    expect(element(host, "[data-coverage-only-help]").textContent).toMatch(/settings.*submit/i);
    expect(host.querySelector("[data-generate-draft]")).toBeNull();
    expect(host.querySelector("[data-verdict-card]")).toBeNull();
  });

  it("keeps all ten v1 boundaries in a closed native disclosure after the handoff", async () => {
    const host = await render(validContentBrief());
    const details = element(host, "details[data-wont-say-details]");
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.firstElementChild?.tagName).toBe("SUMMARY");
    expect(details.querySelectorAll("[data-wont-say-item]")).toHaveLength(10);
    expect(details.querySelector('[data-wont-say-item="noPaa"]')?.textContent).toBe(en.tools.contentBrief.wontSay.noPaa);
    expect(element(host, "[data-readiness-bar]").compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
