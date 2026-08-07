// @input  -- both locales of the traffic-drop-diagnosis landing copy
// @output -- a failing test when the page stops covering penalties or shrinks
// @pos    -- the guard for 交办 item 6: penalty coverage, depth, and FAQ reach

import { describe, expect, it } from "vitest";

import { getConnectedToolContent } from "./connected-tool-content.ts";

const LOCALES = ["en", "zh"] as const;

/**
 * Every string the landing page renders from the content object, in render
 * order. The JSON-LD blocks are generated off the same object, so this is
 * also what a search engine quotes back.
 */
function visibleBody(locale: string): string {
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  return [
    content.title,
    content.description,
    content.sourceLabel,
    content.sourceDetail,
    content.cta,
    content.trust,
    content.workflowTitle,
    ...content.steps.flatMap((s) => [s.name, s.text]),
    content.outputTitle,
    ...content.outputs.flatMap((o) => [o.label, o.body]),
    ...content.faq.flatMap((f) => [f.question, f.answer]),
  ].join("\n");
}

describe("traffic-drop-diagnosis landing copy", () => {
  it("runs 1,000+ words of visible EN body copy", () => {
    // The recruitment theme is "was I penalized?" and the audit measured the
    // page at ~471 words — thinner than the two public tools it sits beside.
    const words = visibleBody("en").split(/\s+/).filter(Boolean);
    expect(words.length).toBeGreaterThanOrEqual(1000);
  });

  it("actually says penalty, penalized, and manual action in the EN body", () => {
    // The audit found `penalt` appearing 0 times on a page recruited for
    // "was I penalized?". The vocabulary must exist in the visible copy, not
    // only in the results screen behind a connection.
    const body = visibleBody("en").toLowerCase();
    expect(body).toContain("penalty");
    expect(body).toContain("penalized");
    expect(body).toContain("manual action");
    expect(body).toContain("algorithmic");
  });

  it("mirrors the penalty coverage in the ZH body", () => {
    const body = visibleBody("zh");
    expect(body).toContain("手动操作");
    expect(body).toContain("惩罚");
    expect(body).toContain("降权");
  });

  for (const locale of LOCALES) {
    it(`carries eight FAQ entries (${locale})`, () => {
      const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
      expect(content.faq).toHaveLength(8);
    });
  }

  it("keeps every FAQ entry out of the drafts filter", () => {
    // FaqPageJsonLd maps the whole array, but getConnectedToolContent drops
    // entries flagged `requiresDrafts` when drafts are disabled. Nothing on
    // this page depends on drafts, so no entry may opt into that filter — a
    // flagged entry would silently vanish from the page and the FAQPage
    // structured data together.
    for (const locale of LOCALES) {
      const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
      for (const entry of content.faq) {
        expect(entry.requiresDrafts, entry.question).toBeUndefined();
      }
      for (const step of content.steps) {
        expect(step.requiresDrafts, step.name).toBeUndefined();
      }
    }
  });

  it("keeps ZH structurally identical to EN", () => {
    const en = getConnectedToolContent("en", "traffic-drop-diagnosis");
    const zh = getConnectedToolContent("zh", "traffic-drop-diagnosis");
    expect(zh.steps.length).toBe(en.steps.length);
    expect(zh.outputs.length).toBe(en.outputs.length);
    expect(zh.faq.length).toBe(en.faq.length);
  });

  it("answers the two recruitment questions, honestly", () => {
    const en = getConnectedToolContent("en", "traffic-drop-diagnosis");
    const manualAction = en.faq.find((f) =>
      f.question.toLowerCase().includes("manual action"),
    );
    // The only authoritative source for a manual action is the visitor's own
    // Search Console report, and the answer must send them there.
    expect(manualAction).toBeDefined();
    expect(manualAction?.answer).toContain("Manual actions report");

    const coreUpdate = en.faq.find((f) =>
      f.question.toLowerCase().includes("core update"),
    );
    // The engine treats update timing as context that cannot support a
    // conclusion (core-updates.ts); the copy may not upgrade it to one.
    expect(coreUpdate).toBeDefined();
    expect(coreUpdate?.answer.toLowerCase()).toContain("no");
  });

  for (const locale of LOCALES) {
    it(`promises no outcome and confirms no causation (${locale})`, () => {
      // Same line the engine holds: it situates a drop against observed data
      // and never confirms what caused it or what a change would recover.
      const body = visibleBody(locale).toLowerCase();
      for (const forbidden of [
        "will recover",
        "guaranteed",
        "we confirm the cause",
        "confirms the cause",
        "保证恢复",
        "确认根因",
        "一定能",
      ]) {
        expect(body, forbidden).not.toContain(forbidden);
      }
    });
  }
});
