// @vitest-environment jsdom
// @input  -- real Outline/Gap/Links components, EN/ZH catalogs and assembled Brief fixtures
// @output -- compact source layers with complete provenance in closed native disclosures
// @pos    -- presentation regression guard; preserves frozen outline/question and evidence identities

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentBrief, Provenance } from "@sf/public-tools/content-brief/contract";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { validContentBrief } from "./content-brief-fixture";
import { GapAngleCard } from "./content-brief-gap-angle-card";
import { LinksCards } from "./content-brief-links-cards";
import { OutlineList } from "./content-brief-outline-list";

let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function ProvenanceSections({ brief, locale }: { readonly brief: ContentBrief; readonly locale: string }) {
  const t = useTranslations("tools.contentBrief");
  return (
    <>
      <OutlineList brief={brief} locale={locale} t={t} />
      <GapAngleCard brief={brief} locale={locale} t={t} />
      <LinksCards brief={brief} locale={locale} t={t} />
    </>
  );
}

async function render(brief: ContentBrief, locale: "en" | "zh") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : zh} timeZone="UTC">
      <ProvenanceSections brief={brief} locale={locale} />
    </NextIntlClientProvider>,
  ));
  return host;
}

function element(host: Element, selector: string): Element {
  const node = host.querySelector(selector);
  expect(node, selector).not.toBeNull();
  return node!;
}

function primaryText(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("details").forEach((details) => details.remove());
  return copy.textContent ?? "";
}

function closedDetails(node: Element): HTMLDetailsElement {
  const details = element(node, "details") as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(details.firstElementChild?.tagName).toBe("SUMMARY");
  return details;
}

function expectFullSource(node: Element, provenance: Provenance, locale: "en" | "zh") {
  const chip = element(node, "[data-source-chip]");
  const sources = (locale === "en" ? en : zh).tools.contentBrief.sources;
  expect(chip.getAttribute("data-source-method")).toBe(provenance.method);
  if (provenance.method === "model") {
    expect(chip.textContent).toContain(sources.model);
    for (const origin of provenance.derived_from) {
      expect(chip.textContent).toContain(sources.origins[origin]);
    }
  } else {
    expect(chip.textContent).toContain(sources.methods[provenance.method]);
    expect(chip.textContent).toContain(sources.origins[provenance.origin]);
  }
  expect(chip.closest("details:not([open])")).not.toBeNull();
}

describe.each(["en", "zh"] as const)("compact Brief provenance (%s)", (locale) => {
  it("uses H2 numbering while preserving outline IDs, headings, questions and full source details", async () => {
    const brief = validContentBrief({}, { connected: true });
    if (brief.outline.status === "unavailable") throw new Error("fixture outline");
    const host = await render(brief, locale);
    for (const [index, item] of brief.outline.items.entries()) {
      const row = element(host, `[data-outline-item="${item.id}"]`);
      const visible = primaryText(row);
      expect(visible).toContain(`H2 ${index + 1}`);
      expect(visible).toContain(item.h2);
      expect(visible).not.toContain(`${index + 1}. ${item.h2}`);
      expect(visible).not.toContain(item.id);
      for (const heading of item.h3) expect(visible).toContain(heading);
      const answers = element(row, "[data-outline-answers]");
      expect(answers.closest("details")).toBeNull();
      for (const id of item.answers) expect(answers.textContent).toContain(id);
      expect(element(row, '[data-source-layer="model"]').closest("details")).toBeNull();
      const details = closedDetails(row);
      expect(details.textContent).toContain(item.id);
      expectFullSource(details, item.provenance, locale);
    }
  });

  it("keeps the gap angle readable and the cited profile facts complete inside closed details", async () => {
    const brief = validContentBrief({}, { connected: true });
    if (brief.gap_angle.status === "unavailable") throw new Error("fixture gap angle");
    const field = brief.gap_angle;
    const host = await render(brief, locale);
    const card = element(host, "[data-gap-angle]");
    const visible = primaryText(card);
    expect(visible).toContain(field.value);
    expect(visible).toContain(field.rationale);
    expect(element(card, '[data-source-layer="model"]').closest("details")).toBeNull();
    const details = closedDetails(card);
    expectFullSource(details, field.provenance, locale);
    for (const ref of field.profile_fact_refs) {
      const fact = brief.evidence.profile?.facts.find((candidate) => candidate.id === ref);
      if (fact === undefined) throw new Error("fixture profile fact");
      const cited = element(details, `[data-profile-fact="${ref}"]`);
      expect(cited.textContent).toContain(fact.field);
      expect(cited.textContent).toContain(fact.text);
      expect(element(cited, "[data-derivation]").getAttribute("data-derivation")).toBe(fact.derivation);
      expectFullSource(cited, fact.provenance, locale);
      expect(visible).not.toContain(fact.text);
    }
    const checked = element(card, "[data-checked-against]");
    expect(checked.textContent).toContain(String(field.checked_against.length));
    expect(checked.closest("details")).toBeNull();
  });

  it("preserves inferred profile facts as model-derived inside the cited-fact disclosure", async () => {
    const brief = validContentBrief({}, { connected: true });
    if (brief.gap_angle.status === "unavailable") throw new Error("fixture gap angle");
    // Display-only override exercises P2; it is not asserted to pass the exact parser.
    const withInferredFact: ContentBrief = { ...brief, gap_angle: { ...brief.gap_angle, profile_fact_refs: ["P1", "P2"] } };
    const host = await render(withInferredFact, locale);
    const card = element(host, "[data-gap-angle]");
    const fact = element(closedDetails(card), '[data-profile-fact="P2"]');
    expect(element(fact, "[data-derivation]").getAttribute("data-derivation")).toBe("inferred");
    expectFullSource(fact, { method: "model", derived_from: ["product_profile"] }, locale);
    expect(primaryText(card)).not.toContain("Per-domain warmup schedules.");
  });

  it("keeps owned URLs, rationale and metrics while collapsing full link provenance", async () => {
    const brief = validContentBrief({}, { connected: true });
    if (brief.internal_links.status === "unavailable" || brief.do_not_cover.status === "unavailable") {
      throw new Error("fixture owned-page fields");
    }
    const host = await render(brief, locale);
    const rows = [
      ...brief.internal_links.items.map((item) => ({ name: "internal-links", ref: item.page_ref, text: item.why, provenance: item.why_provenance })),
      ...brief.do_not_cover.items.map((item) => ({ name: "do-not-cover", ref: item.page_ref, text: item.topic, provenance: item.topic_provenance })),
    ];
    for (const item of rows) {
      const row = element(host, `[data-links-card="${item.name}"] [data-links-item="${item.ref}"]`);
      const page = brief.evidence.gsc_pages.find((candidate) => candidate.id === item.ref);
      if (page === undefined) throw new Error("fixture owned page");
      expect(primaryText(row)).toContain(item.text);
      const link = element(row, "a");
      expect(link.getAttribute("href")).toBe(page.page);
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.closest("details")).toBeNull();
      expect(row.textContent).toContain(new Intl.NumberFormat(locale).format(page.impressions));
      expect(row.textContent).toContain(new Intl.NumberFormat(locale).format(page.clicks));
      expect(element(row, '[data-source-layer="model"]').closest("details")).toBeNull();
      expectFullSource(closedDetails(row), item.provenance, locale);
    }
  });

  it("lets native summaries open and close without altering the frozen Brief", async () => {
    const brief = validContentBrief({}, { connected: true });
    const before = structuredClone(brief);
    const host = await render(brief, locale);
    const details = [...host.querySelectorAll("details")];
    expect(details.length).toBeGreaterThan(0);
    for (const disclosure of details) {
      const summary = element(disclosure, "summary") as HTMLElement;
      await act(async () => summary.click());
      expect(disclosure.open).toBe(true);
      await act(async () => summary.click());
      expect(disclosure.open).toBe(false);
    }
    expect(brief).toEqual(before);
    expect(host.textContent).not.toContain("tools.contentBrief");
  });

  it("keeps unavailable model fields as explicit reasons instead of empty disclosures", async () => {
    const host = await render(validContentBrief({}, { connected: true, llm: "validation_failed" }), locale);
    for (const selector of ["[data-outline]", "[data-gap-angle]", "[data-links-card]"]) {
      for (const card of host.querySelectorAll(selector)) {
        expect(card.getAttribute("data-field-status")).toBe("unavailable");
        expect(element(card, "[data-unavailable-reason]").getAttribute("data-unavailable-reason")).toBe("validation_failed");
        expect(card.querySelector("details, [data-source-layer]")).toBeNull();
      }
    }
  });
});
