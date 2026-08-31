// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import { visibilityReportFixtureV2 } from "../../lib/geo-tools/visibility-v2.test-fixtures.ts";
import { consumeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { VisibilityGapEvidence } from "./ai-visibility-gaps.tsx";

describe("real GAP action controls", () => {
  it("writes exact A/D selectors and B URL/question handoff while C has no Brief link", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    const base = visibilityReportFixtureV2();
    const gaps = [
      { id: "gap-q1", questionId: "q1", kind: "A" as const, reason: "no_matching_page_in_audited_inventory" as const, evidenceIds: ["site-index"], pageUrl: null, sourceUrls: [], action: "brief" as const },
      { id: "gap-q2", questionId: "q2", kind: "B" as const, reason: "relevant_page_citability_failed" as const, evidenceIds: ["page-1"], pageUrl: "https://acme.test/guide", sourceUrls: [], action: "citability" as const },
      { id: "gap-q3", questionId: "q3", kind: "C" as const, reason: "missing_from_read_reference_pages" as const, evidenceIds: ["ref-1"], pageUrl: null, sourceUrls: ["https://publisher.test/list"], action: "third_party" as const },
    ];
    const report = { ...base, questions: [base.questions[0]!, { ...base.questions[0]!, questionId: "q2", text: "How do reminders work?" }, { ...base.questions[0]!, questionId: "q3" }], gaps };
    const element = document.createElement("div"), root = createRoot(element);
    document.body.append(element);
    const errors: unknown[] = [];
    try {
      await act(async () => root.render(<NextIntlClientProvider locale="en" messages={en} onError={(error) => errors.push(error)}><VisibilityGapEvidence report={report} locale="en" /></NextIntlClientProvider>));
      const brief = element.querySelector<HTMLAnchorElement>('a[href="/tools/geo-brief"]');
      expect(brief).not.toBeNull();
      brief?.addEventListener("click", (event) => event.preventDefault());
      await act(async () => brief?.click());
      expect(consumeGeoGapHandoff(sessionStorage)).toMatchObject({ destination: "geo-brief", runId: base.manifest.runId, questionId: "q1", gapId: "gap-q1", pageUrl: null });
      const t2 = element.querySelector<HTMLAnchorElement>('a[href="/tools/page-citability-check?handoff=geo-gap"]');
      t2?.addEventListener("click", (event) => event.preventDefault());
      await act(async () => t2?.click());
      expect(consumeGeoGapHandoff(sessionStorage, Date.now(), "page-citability-check")).toMatchObject({ destination: "page-citability-check", questionId: "q2", pageUrl: "https://acme.test/guide", questionText: "How do reminders work?" });
      expect(element.querySelectorAll('a[href="/tools/geo-brief"]')).toHaveLength(1);
      expect([...element.querySelectorAll("button")].some((button) => button.textContent === en.tools.aiVisibility.gaps.actions.thirdParty)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await act(async () => root.unmount()); element.remove(); }
  });
});
