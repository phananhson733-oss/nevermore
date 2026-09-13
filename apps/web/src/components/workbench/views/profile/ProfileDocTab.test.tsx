/** @vitest-environment jsdom */

/**
 * The structured "profile" tab (plan Task 9 Step 5; outward form
 * `ref:opengengrowth/views/SiteProfileView.tsx:192-305`).
 *
 * Pinned here:
 * - An unavailable count is an em dash, never 0 and never an empty cell, and
 *   the brand / non-brand clicks are two rows, so no "63 / " half-sentence can
 *   appear (jsx P7).
 * - The GSC section's provenance label has three renderings (Q6): the sample
 *   chip, nothing beside the title for the operator's own rows (they get a
 *   visible footnote, from the snapshot), and "source unknown". Each is
 *   asserted on the visible text, not on an attribute derived from the same
 *   variable as the label.
 * - A section whose signals are `null` is absent entirely, metrics included.
 * - Framework copy is marked `data-wb-frame` and is English in en (Q30).
 *
 * The documents here are written by hand on purpose: this file is about how a
 * given snapshot renders. That the source switches produce these snapshots is
 * pinned from the switches down in `ProfileView.run.test.tsx`.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { FIXTURE_DOC } from "@/lib/workbench/mock/builders/builder-fixtures";
import type { GscSignals, ProfileDoc } from "@/lib/workbench/types";
import { BLANK_PROFILE, HAN, must, renderProfile, type ProfileLocale } from "./profile-view-test-harness.tsx";
import { ProfileDocTab } from "./ProfileDocTab.tsx";

const en = getMessages("en").workbench;
let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(doc: ProfileDoc): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={getMessages("en")} timeZone="UTC">
        <ProfileDocTab doc={doc} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function section(scope: ParentNode, id: string): Element {
  return must(scope.querySelector(`[data-wb-profile-section="${id}"]`));
}

function metricValues(scope: ParentNode): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...scope.querySelectorAll("[data-wb-metric]")].map((metric) => [
      metric.getAttribute("data-wb-metric") ?? "",
      metric.querySelector("dd")?.textContent ?? "",
    ]),
  );
}

/** The value cell next to a label in a section's fact list. */
function fact(scope: Element, label: string): string {
  const term = must([...scope.querySelectorAll("dt")].find((dt) => dt.textContent === label));
  return must(term.nextElementSibling).textContent ?? "";
}

function withGsc(patch: Partial<GscSignals>): ProfileDoc {
  return { ...FIXTURE_DOC, gsc: { ...must(FIXTURE_DOC.gsc), ...patch } };
}

describe("ProfileDocTab metrics", () => {
  it("shows the sample pages and indexable counts, then the three third-party estimates", () => {
    const scope = render(FIXTURE_DOC);
    expect(metricValues(scope)).toEqual({ pages: "42", indexable: "37", traffic: "1500", dr: "29", refdomains: "77" });
    const labels = [...scope.querySelectorAll("[data-wb-metric] dt")].map((dt) => dt.textContent);
    expect(labels).toEqual([
      en.profile.metrics.pages,
      en.profile.metrics.indexable,
      en.profile.metrics.traffic,
      en.profile.metrics.dr,
      en.profile.metrics.refdomains,
    ]);
  });

  it("drops the third-party section and its three metrics when there is no estimate", () => {
    const scope = render({ ...FIXTURE_DOC, third: null });
    expect(Object.keys(metricValues(scope))).toEqual(["pages", "indexable"]);
    expect(scope.querySelector('[data-wb-profile-section="third"]')).toBeNull();
  });

  it("drops the crawl section and its two metrics when there are no crawl signals", () => {
    const scope = render({ ...FIXTURE_DOC, crawl: null });
    expect(Object.keys(metricValues(scope))).toEqual(["traffic", "dr", "refdomains"]);
    expect(scope.querySelector('[data-wb-profile-section="crawl"]')).toBeNull();
  });

  it("labels both generated sections as sample data", () => {
    const scope = render(FIXTURE_DOC);
    expect(section(scope, "crawl").textContent).toContain(getMessages("en").workbench.shell.sampleData);
    expect(section(scope, "third").textContent).toContain(getMessages("en").workbench.shell.sampleData);
  });
});

describe("ProfileDocTab crawl facts", () => {
  it("says yes or no per key page", () => {
    const crawl = section(render(FIXTURE_DOC), "crawl");
    expect(fact(crawl, en.profile.doc.hasPricing)).toBe(en.profile.doc.yes);
    expect(fact(crawl, en.profile.doc.hasDocs)).toBe(en.profile.doc.no);
    expect(fact(crawl, en.profile.doc.hasBlog)).toBe(en.profile.doc.yes);
  });
});

describe("ProfileDocTab GSC counts", () => {
  it("prints each known count in its own row", () => {
    const gsc = section(render(FIXTURE_DOC), "gsc");
    expect(fact(gsc, en.profile.doc.gscTotal)).toBe("3");
    expect(fact(gsc, en.profile.doc.gscBrand)).toBe("1");
    expect(fact(gsc, en.profile.doc.gscBrandClicks)).toBe("120");
    expect(fact(gsc, en.profile.doc.gscNonBrandClicks)).toBe("45");
    expect(fact(gsc, en.profile.doc.gscNear)).toBe("2");
  });

  it("prints a dash for every unavailable count and never a half sentence", () => {
    const gsc = section(
      render(withGsc({ brandQueries: null, brandClicks: null, nonBrandClicks: null, near: null })),
      "gsc",
    );
    for (const label of [en.profile.doc.gscBrand, en.profile.doc.gscBrandClicks, en.profile.doc.gscNonBrandClicks, en.profile.doc.gscNear]) {
      expect(fact(gsc, label), label).toBe("—");
    }
    expect(gsc.textContent).not.toContain(" / ");
    expect(gsc.textContent).not.toMatch(/\b0\b/u);
  });

  // T9 review D5: the dash is explained on hover by the one "unknown" label.
  it("titles every dash with the unknown label", () => {
    const gsc = section(
      render(withGsc({ brandQueries: null, brandClicks: null, nonBrandClicks: null, near: null })),
      "gsc",
    );
    // Four counts, and the clicks of the fixture's second top query.
    const dashes = [...gsc.querySelectorAll("dd span[title]")].map((span) => [span.textContent, span.getAttribute("title")]);
    expect(dashes).toEqual(Array.from({ length: 5 }, () => ["—", en.profile.unknown]));
  });

  it("keeps a real zero a zero", () => {
    const gsc = section(render(withGsc({ brandClicks: 0, near: 0 })), "gsc");
    expect(fact(gsc, en.profile.doc.gscBrandClicks)).toBe("0");
    expect(fact(gsc, en.profile.doc.gscNear)).toBe("0");
  });

  it("lists the top queries with a dash for clicks it does not know", () => {
    const items = [...section(render(FIXTURE_DOC), "gsc").querySelectorAll("[data-wb-top-query]")];
    expect(items.map((item) => item.textContent)).toEqual(["acme seo120", "seo checklist—"]);
  });

  it("omits the top-queries row when there are none", () => {
    const gsc = section(render(withGsc({ top: [] })), "gsc");
    expect([...gsc.querySelectorAll("dt")].map((dt) => dt.textContent)).not.toContain(en.profile.doc.gscTop);
  });
});

describe("ProfileDocTab GSC provenance (Q6)", () => {
  const sample = getMessages("en").workbench.shell.sampleData;
  const unknown = en.profile.doc.gscSourceUnknown;

  it("labels sample rows as sample data", () => {
    const text = section(render({ ...FIXTURE_DOC, gscSource: "sample" }), "gsc").textContent ?? "";
    expect(text).toContain(sample);
    expect(text).not.toContain(unknown);
  });

  it("puts no label on the operator's own rows", () => {
    const text = section(render({ ...FIXTURE_DOC, gscSource: "user" }), "gsc").textContent ?? "";
    expect(text).not.toContain(sample);
    expect(text).not.toContain(unknown);
  });

  it("says the source is unknown, and not sample, when none was recorded", () => {
    const text = section(render({ ...FIXTURE_DOC, gscSource: null }), "gsc").textContent ?? "";
    expect(text).toContain(unknown);
    expect(text).not.toContain(sample);
  });

  // T9 review D3b: text alone cannot tell "no label" from a label that says
  // something else, so count what stands beside the section title.
  it.each<[ProfileDoc["gscSource"], number]>([
    ["sample", 2],
    ["user", 1],
    [null, 2],
  ])("gives a %j snapshot's GSC title row %i element(s): the heading, and a label unless the rows are the operator's", (gscSource, count) => {
    const heading = must(section(render({ ...FIXTURE_DOC, gscSource }), "gsc").querySelector("h3"));
    expect(must(heading.parentElement).children).toHaveLength(count);
  });

  it("has no GSC section at all without GSC signals", () => {
    expect(render({ ...FIXTURE_DOC, gsc: null, gscSource: null }).querySelector('[data-wb-profile-section="gsc"]')).toBeNull();
  });
});

describe("ProfileDocTab product and ICP", () => {
  it("says the AI part is a placeholder to replace, and renders one ICP section per segment", () => {
    const icp = must(FIXTURE_DOC.ai.icp[0]);
    const scope = render({ ...FIXTURE_DOC, ai: { ...FIXTURE_DOC.ai, icp: [icp, { ...icp, seg: "second" }] } });
    expect(section(scope, "product").textContent).toContain(en.profile.doc.placeholderNote);
    const titles = [...scope.querySelectorAll('[data-wb-profile-section="icp"] h3')].map((h) => h.textContent);
    expect(titles).toEqual(["ICP 1", "ICP 2"]);
  });
});

describe("ProfileDocTab frame", () => {
  it("marks framework copy and keeps it English in en (Q30)", () => {
    const scope = render(FIXTURE_DOC);
    const frames = [...scope.querySelectorAll("[data-wb-frame]")];
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.map((frame) => frame.textContent ?? "").join("").trim()).not.toBe("");
    for (const frame of frames) {
      expect(frame.textContent ?? "", frame.outerHTML).not.toMatch(HAN);
      expect(frame.textContent ?? "").not.toContain("workbench.");
    }
  });

  it("renders no inline style", () => {
    expect(render(FIXTURE_DOC).querySelector("[style]")).toBeNull();
  });
});

// Delivery review F1: the operator's own rows had no visible provenance, only the
// header chip's hover title. The footnote follows the snapshot's frozen
// `gscSource`; every case sets the project's current `gscRowsSource` to something
// else, so a section that read the current rows would show the wrong thing.
describe("ProfileDocTab GSC footnote, from the snapshot", () => {
  it.each<[ProfileLocale, ProfileDoc["gscSource"], ProfileDoc["gscSource"], string | null, "sampleData" | "gscSourceUnknown" | null]>([
    ["en", "user", "sample", "These GSC rows come from data you imported, not from a sample", null],
    ["en", "sample", "user", null, "sampleData"],
    ["en", null, "user", null, "gscSourceUnknown"],
    ["zh-CN", "user", "sample", "这些 GSC 行来自你导入的数据，不是示例", null],
    ["zh-CN", "sample", "user", null, "sampleData"],
    ["zh-CN", null, "user", null, "gscSourceUnknown"],
  ])("(%s) a %j snapshot with %j rows in the project now: footnote %j", (locale, gscSource, gscRowsSource, sentence, label) => {
    const rendered = renderProfile(
      {
        ...BLANK_PROFILE,
        profileDoc: { ...FIXTURE_DOC, gscSource },
        gscRows: [{ query: "acme seo", clicks: 3, impressions: 90, ctr: 0.03, position: 14 }],
        gscRowsSource,
      },
      { locale },
    );
    cleanup = rendered.unmount;
    const gsc = section(rendered.container, "gsc");
    expect(gsc.querySelector("[data-wb-gsc-foot]")?.textContent ?? null).toBe(sentence);
    const messages = getMessages(locale).workbench;
    const labels = { sampleData: messages.shell.sampleData, gscSourceUnknown: messages.profile.doc.gscSourceUnknown };
    // The chip and the unknown label stay as they were: only the snapshot's own label is there.
    for (const [name, value] of Object.entries(labels)) {
      if (name === label) expect(gsc.textContent ?? "", name).toContain(value);
      else expect(gsc.textContent ?? "", name).not.toContain(value);
    }
  });
});
