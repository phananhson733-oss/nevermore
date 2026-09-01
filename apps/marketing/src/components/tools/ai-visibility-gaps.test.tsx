// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../i18n/messages/en.json";
import { visibilityReportFixtureV2 } from "../../lib/geo-tools/visibility-v2.test-fixtures.ts";
import { consumeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { VisibilityGapEvidence } from "./ai-visibility-gaps.tsx";
import { aiVisibilityGapPresentationMessages } from "./ai-visibility-report/gap-messages.ts";
import type { VisibilitySiteEvidenceV1 } from "../../lib/geo-tools/site-index-contract.ts";
import type { VisibilityReportV2 } from "../../lib/geo-tools/visibility-v2-contract.ts";

const messages = { ...en, tools: { ...en.tools, aiVisibility: { ...en.tools.aiVisibility, gaps: { ...en.tools.aiVisibility.gaps, presentation: aiVisibilityGapPresentationMessages.en } } } };
const siteEvidence: VisibilitySiteEvidenceV1 = {
  schemaVersion: "marketing-geo-site-evidence.v1", collectedAt: "2026-08-31T00:01:00.000Z",
  index: { scope: "declared_and_reachable_inventory", status: "complete", targetHost: "acme.test", discoveredCount: 0, pages: [], sitemapUrls: [], inventorySources: [], limits: [] },
  references: [{ id: "ref-1", url: "https://publisher.test/best-tools?utm_source=openai", finalUrl: "https://publisher.test/best-tools?utm_source=openai", fetchedAt: "2026-08-31T00:00:30.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "a".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Tools list", headings: [], pageType: "listicle", pageTypeBasis: "title_headings", ownPresence: null, ownPresenceBasis: null, ownPresenceExcerpt: "A bounded observed reference excerpt.", matches: [], sampleSlots: ["chatgpt:q1:1"] }],
  referenceOmittedCount: 2, citability: [], citabilityOmittedCount: 1,
};
async function inspect(report: VisibilityReportV2, check: (element: HTMLElement) => void | Promise<void>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div"), root = createRoot(element); document.body.append(element);
  try {
    await act(async () => root.render(<NextIntlClientProvider locale="en" messages={messages}><VisibilityGapEvidence report={report} locale="en" /></NextIntlClientProvider>));
    await check(element);
  } finally { await act(async () => root.unmount()); element.remove(); }
}

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
      await act(async () => root.render(<NextIntlClientProvider locale="en" messages={messages} onError={(error) => errors.push(error)}><VisibilityGapEvidence report={report} locale="en" /></NextIntlClientProvider>));
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
  it("shows only observed gap-kind counts with a separate unattributed category", async () => {
    const base = visibilityReportFixtureV2();
    const kinds = ["A", "A", "B", "C", "unattributed"] as const;
    const gaps = kinds.map((kind, i) => ({ id: `gap-${i}`, questionId: `q${i}`, kind, reason: "no_actionable_gap" as const, evidenceIds: [`evidence-${i}`], pageUrl: null, sourceUrls: [], action: "none" as const }));
    await inspect({ ...base, siteEvidence, gaps, questions: kinds.map((_, i) => ({ ...base.questions[0]!, questionId: `q${i}` })) }, element => {
      expect([...element.querySelectorAll("[data-gap-kind]")].map(node => [node.getAttribute("data-gap-kind"), node.querySelector("dd")?.textContent])).toEqual([["A", "2"], ["B", "1"], ["C", "1"], ["D", "0"], ["unattributed", "1"]]);
      const references = element.querySelector('[data-gap-references]')!;
      expect(element.querySelector('[data-gap-summary]')!.compareDocumentPosition(references) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(element.querySelector('[data-gap-row]')!.compareDocumentPosition(references) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(element.querySelector('[data-gap-row] details')?.hasAttribute("open")).toBe(false);
    });
  });
  it("renders zero actionable gaps as neutral, non-zero actionable gaps as warnings, and non-zero unattributed gaps as informational", async () => {
    const base = visibilityReportFixtureV2();
    const gaps = [
      { id: "gap-a", questionId: "q1", kind: "A" as const, reason: "no_matching_page_in_audited_inventory" as const, evidenceIds: ["site-index"], pageUrl: null, sourceUrls: [], action: "brief" as const },
      { id: "gap-u", questionId: "q2", kind: "unattributed" as const, reason: "no_actionable_gap" as const, evidenceIds: ["note"], pageUrl: null, sourceUrls: [], action: "none" as const },
    ];
    await inspect({ ...base, siteEvidence, gaps, questions: [base.questions[0]!, { ...base.questions[0]!, questionId: "q2" }] }, element => {
      expect([...element.querySelectorAll("[data-gap-kind]")].map((node) => [node.getAttribute("data-gap-kind"), node.getAttribute("data-gap-tone")])).toEqual([
        ["A", "warning"],
        ["B", "neutral"],
        ["C", "neutral"],
        ["D", "neutral"],
        ["unattributed", "info"],
      ]);
      expect(element.querySelector('[data-gap-kind="unattributed"]')?.textContent).toContain("Cause not yet known");
    });
  });
  it("keeps zero summary cards neutral and marks non-zero actionable versus unattributed counts with distinct tones", async () => {
    const base = visibilityReportFixtureV2();
    const zeroKinds = ["A", "B", "C", "D"] as const;
    const zeroReport = { ...base, siteEvidence, gaps: [{ id: "gap-unattributed", questionId: "q1", kind: "unattributed" as const, reason: "no_actionable_gap" as const, evidenceIds: ["evidence"], pageUrl: null, sourceUrls: [], action: "none" as const }], questions: [{ ...base.questions[0]!, questionId: "q1" }] };
    await inspect(zeroReport, element => {
      for (const kind of zeroKinds) {
        const card = element.querySelector<HTMLElement>(`[data-gap-kind="${kind}"]`);
        expect(card?.getAttribute("data-gap-tone")).toBe("neutral");
      }
      const unattributed = element.querySelector<HTMLElement>('[data-gap-kind="unattributed"]');
      expect(unattributed?.getAttribute("data-gap-tone")).toBe("info");
      expect(unattributed?.textContent).toContain("Cause not yet known");
    });
    const warningKinds = ["A", "B", "C", "D"] as const;
    const warningGaps = warningKinds.map((kind, index) => ({ id: `gap-${kind}`, questionId: `q${index + 1}`, kind, reason: "no_actionable_gap" as const, evidenceIds: [`evidence-${kind}`], pageUrl: null, sourceUrls: [], action: "none" as const }));
    await inspect({ ...base, siteEvidence, gaps: warningGaps, questions: warningKinds.map((_, index) => ({ ...base.questions[0]!, questionId: `q${index + 1}` })) }, element => {
      for (const kind of warningKinds) {
        const card = element.querySelector<HTMLElement>(`[data-gap-kind="${kind}"]`);
        expect(card?.getAttribute("data-gap-tone")).toBe("warning");
      }
      expect(element.querySelector<HTMLElement>('[data-gap-kind="unattributed"]')?.getAttribute("data-gap-tone")).toBe("neutral");
    });
  });
  it("does not turn unavailable independent evidence into five zero counts", async () => {
    await inspect(visibilityReportFixtureV2(), element => {
      expect(element.querySelector('[data-gap-summary]')).toBeNull();
      expect(element.querySelector('[data-gap-references]')).toBeNull();
      expect(element.textContent).toContain(en.tools.aiVisibility.gaps.noEvidence);
    });
  });
  it("collapses reference-page evidence into a scoped table while retaining safe links, unknown presence and omissions", async () => {
    await inspect({ ...visibilityReportFixtureV2(), siteEvidence }, element => {
      const disclosure = element.querySelector('[data-gap-references]');
      expect(disclosure?.tagName).toBe("DETAILS");
      expect(disclosure?.hasAttribute("open")).toBe(false);
      expect(disclosure?.querySelector("summary")?.textContent).toContain(en.tools.aiVisibility.gaps.references);
      const row = disclosure?.querySelector("tbody tr");
      expect(row?.querySelector("th")?.className).toContain("text-left");
      expect(row?.querySelector("a")?.textContent).toBe("publisher.test/best-tools");
      expect(row?.querySelector("a")?.getAttribute("href")).toBe(siteEvidence.references[0]!.url);
      expect(row?.querySelector("a")?.rel).toContain("noopener");
      expect(row?.textContent).toContain(en.tools.aiVisibility.gaps.pageType.listicle);
      expect(row?.textContent).toContain(en.tools.aiVisibility.gaps.presence.unknown);
      expect(row?.textContent).not.toContain(en.tools.aiVisibility.gaps.presence.absent);
      expect(row?.textContent).toContain("UTC");
      expect(row?.textContent).toContain(siteEvidence.references[0]!.ownPresenceExcerpt);
      expect(disclosure?.textContent).toContain("2 reference pages have no retained read evidence");
      expect(element.textContent).toContain("1 candidate page checks were incomplete");
    });
  });
  it("retains evidence disclosures while blocking cross-tool actions when the run was not saved", async () => {
    const base = visibilityReportFixtureV2();
    const report = { ...base, siteEvidence, limits: [...base.limits, "notStored"], gaps: [{ id: "gap-q1", questionId: "q1", kind: "A" as const, reason: "no_matching_page_in_audited_inventory" as const, evidenceIds: ["site-index"], pageUrl: null, sourceUrls: [], action: "brief" as const }] };
    await inspect(report, element => {
      expect(element.querySelector('a[href="/tools/geo-brief"]')).toBeNull();
      expect(element.textContent).toContain(en.tools.aiVisibility.gaps.notStored);
      expect(element.querySelector('[data-gap-row] details')?.textContent).toContain("site-index");
    });
  });
});
