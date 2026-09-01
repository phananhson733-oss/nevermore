// @vitest-environment jsdom
// @input -- real V2 measurement fixtures, a retained V1 summary, and EN/ZH catalogs
// @output -- report hierarchy, honest evidence states, accessible links and comparison semantics
// @pos -- independent acceptance tests for the Artifact-aligned report surface
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { visibilityReportFixtureV2 } from "../../lib/geo-tools/visibility-v2.test-fixtures.ts";
import { parseVisibilityImport } from "../../lib/geo-tools/visibility-export.ts";
import { wilson } from "../../lib/geo-tools/stats.ts";
import type { VisibilityReport } from "../../lib/geo-tools/visibility-contract.ts";
import type { AnyVisibilityReport, VisibilityComparisonV2 } from "../../lib/geo-tools/visibility-v2-contract.ts";
import { AiVisibilityComparison, AiVisibilityLegacySummary, AiVisibilityReport } from "./ai-visibility-report/index.tsx";
import { aiVisibilityReportMessages } from "./ai-visibility-report/messages.ts";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function mount(report: AnyVisibilityReport, locale: "en" | "zh" = "en") {
  const base = locale === "zh" ? zh : en;
  const messages = { ...base, tools: { ...base.tools, aiVisibility: { ...base.tools.aiVisibility, report: aiVisibilityReportMessages[locale] } } };
  act(() => root.render(<NextIntlClientProvider locale={locale} timeZone="UTC" messages={messages}><AiVisibilityReport report={report} locale={locale} /></NextIntlClientProvider>));
}
function legacyReport(): VisibilityReport {
  const v2 = visibilityReportFixtureV2();
  return { ...v2, manifest: { schemaVersion: "marketing-geo-visibility.v1", kbId: v2.manifest.kbId, snapshotId: v2.manifest.snapshotId, snapshotRevision: 1, questionSetHash: v2.manifest.questionSetHash, questionCount: 1, samplesPerQuestion: 1, marketCode: "US", model: "gpt-5", surface: "dataforseo", startedAt: v2.manifest.startedAt, finishedAt: v2.manifest.finishedAt, calls: 1, answered: 1, successRatio: 1, costUsd: 0.01, status: "ok" }, comparison: null };
}
const metric = (name: string) => host.querySelector(`[data-metric="${name}"]`);

describe("Artifact-aligned visibility report", () => {
  it("starts with four readable measured metrics and moves technical metadata into a disclosure", () => {
    mount(visibilityReportFixtureV2());
    expect([...host.querySelectorAll("[data-metric]")].map((node) => node.getAttribute("data-metric"))).toEqual(["questionsMentioned", "questionsCited", "coverage", "sov"]);
    expect([...host.querySelectorAll("[data-metric]")].map((node) => node.getAttribute("data-metric-tone"))).toEqual(["accent", "info", "warning", "primary"]);
    expect([...host.querySelectorAll("[data-metric] h4")].map((node) => node.textContent)).toEqual(["Natural mentions", "Own-site citations", "Answer coverage", "Brand-present answer share"]);
    expect(metric("questionsMentioned")?.textContent).toContain("0 / 1 questions");
    expect(metric("questionsMentioned")?.textContent).not.toContain("Unprompted questions with at least one brand mention");
    expect(metric("questionsCited")?.textContent).not.toContain("Unprompted retrieval questions with at least one citation");
    expect(metric("coverage")?.textContent).toContain("1 / 1");
    expect(metric("coverage")?.textContent).toContain("Every frozen question received a valid answer");
    expect(metric("coverage")?.textContent).not.toContain("All frozen questions with at least one valid answer");
    expect(metric("sov")?.textContent).not.toContain("SOV counts your brand among answers");
    expect(host.textContent).toContain("Unprompted questions with at least one brand mention");
    expect(host.textContent).toContain("SOV counts your brand among answers");
    expect(host.querySelector('[data-section="metadata"]')?.tagName).toBe("DETAILS");
    expect(host.querySelector('[data-section="metadata"]')?.hasAttribute("open")).toBe(false);
    expect(host.querySelector('[data-section="metrics"]')!.compareDocumentPosition(host.querySelector('[data-section="metadata"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("does not turn one unobserved question into a zero percentage or samples", () => {
    mount(visibilityReportFixtureV2());
    expect(metric("questionsMentioned")?.textContent).toContain("Not observed");
    expect(metric("questionsMentioned")?.textContent).not.toContain("0.0%");
    expect(metric("questionsMentioned")?.textContent).toContain("Upper bound");
    expect(metric("questionsMentioned")?.querySelector("[data-rate-unit]")?.getAttribute("data-rate-unit")).toBe("questions");
    expect(metric("sov")?.textContent).not.toContain("0 / 0");
  });
  it("preserves mention observations when bounded excerpts were omitted", () => {
    const initial = visibilityReportFixtureV2();
    const sample = { ...initial.questions[0]!.samples[0]!, mentioned: true, excerpt: null, excerptOmitted: true, answerExcerpt: "Acme appears in the observed answer.", answerExcerptTruncated: true, cited: true, citedDomains: ["acme.test"], citedUrls: ["https://acme.test/guide?utm_source=openai"], citedUrlsOmitted: 2 };
    mount(visibilityReportFixtureV2({ samples: [sample] }));
    const answer = host.querySelector('[data-sample="chatgpt:q1:1"]');
    expect(answer?.textContent).toContain("Brand mentioned");
    expect(answer?.textContent).toContain("Mention excerpt omitted");
    expect(answer?.textContent).not.toContain("No mention in this answer");
    expect(answer?.textContent).toContain(sample.answerExcerpt);
    expect(answer?.textContent).toContain("2 citation URLs omitted");
    expect(answer?.querySelector("a")?.href).toBe(sample.citedUrls[0]);
    expect(answer?.querySelector("a")?.textContent).toBe("acme.test/guide");
    expect(answer?.querySelector("a")?.rel).toContain("noopener");
  });
  it("keeps unknown citations and failed calls separate from negative observations", () => {
    const initial = visibilityReportFixtureV2();
    mount(visibilityReportFixtureV2({ samples: [{ ...initial.questions[0]!.samples[0]!, cited: null, citedUrlsOmitted: null, citedDomainsOmitted: null }] }));
    expect(host.querySelector('[data-sample="chatgpt:q1:1"]')?.textContent).toContain("Citation evidence unavailable");
    mount(visibilityReportFixtureV2({ samples: [] }));
    expect(host.textContent).toContain("No answer to this question came back");
    expect(host.textContent).not.toContain("Brand not mentioned");
  });
  it("shows observed competitor positions without inventing ranks from prose", () => {
    const initial = visibilityReportFixtureV2();
    mount(visibilityReportFixtureV2({ context: { ...initial.context, competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }] }, samples: [{ ...initial.questions[0]!.samples[0]!, competitorsMentioned: ["Rival"], competitorPositions: [{ brandName: "Rival", position: 2 }] }] }));
    expect(host.querySelector('[data-sample="chatgpt:q1:1"]')?.textContent).toContain("Rival · position 2");
    expect(host.querySelector('[data-sample="chatgpt:q1:1"]')?.textContent).toContain("Own list position unavailable");
  });
  it("retains historical V1 measurements but labels unretained answer evidence and SOV honestly", () => {
    const report = legacyReport();
    mount({ ...report, questions: report.questions.map((question) => ({ ...question, samples: [] })), citedDomains: [{ domain: "source.test", answers: 2, isOwn: false, isCompetitor: false, sampleUrls: [] }], limits: ["historicalSamplesUnavailable"] });
    expect(metric("sov")?.textContent).toContain("Not recorded in V1");
    expect(metric("coverage")?.textContent).toContain("1 / 1");
    expect(host.textContent).toContain("Original answer evidence was not retained");
    expect(host.textContent).not.toContain("No answer to this question came back");
    expect(host.querySelector('[data-section="sources"]')?.textContent).toContain("Not independently read");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent?.includes("Download run JSON"))).toBe(false);
  });
  it("reads a saved V1 summary without constructing unavailable calibration or citation-error fields", () => {
    const report = legacyReport();
    const messages = { ...en, tools: { ...en.tools, aiVisibility: { ...en.tools.aiVisibility, report: aiVisibilityReportMessages.en } } };
    const { samples: _samples, calibrated: _calibrated, citationUnknown: _unknown, ...counts } = report.questions[0]!;
    const summary = { runId: "saved-run", kbId: report.manifest.kbId, snapshotId: report.manifest.snapshotId, questionSetHash: report.manifest.questionSetHash, samplesPerQuestion: report.manifest.samplesPerQuestion, createdAt: report.manifest.finishedAt, manifest: report.manifest, metrics: report.metrics, perQuestion: [counts], citedDomains: report.citedDomains };
    act(() => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><AiVisibilityLegacySummary summary={summary} locale="en" /></NextIntlClientProvider>));
    expect(host.textContent).toContain("V1 saved aggregate counts only");
    expect(host.textContent).toContain("Original answer evidence was not retained");
    expect(host.textContent).not.toContain("Wording not calibrated");
    expect(host.textContent).not.toContain("0 answers came back with a citation list");
    expect(host.textContent).not.toContain("No answer to this question came back");
    expect(metric("sov")?.textContent).toContain("Not recorded in V1");
  });
  it("retains partial-run coverage and withholds an insufficient engine's rates", () => {
    const initial = visibilityReportFixtureV2();
    const definitions = Array.from({ length: 5 }, (_, index) => ({ ...initial.questions[0]!.definition, id: `q${index + 1}`, text: `Which tool handles job ${index + 1}?` }));
    const samples = definitions.flatMap((question, index) => (["chatgpt", "perplexity"] as const).flatMap((engine) => index > 1 && engine === "perplexity" ? [] : [{ ...initial.questions[0]!.samples[0]!, engine, questionId: question.id, slotId: `${engine}:${question.id}:1`, providerTaskId: `${engine}-${question.id}` }]));
    const report = visibilityReportFixtureV2({ engines: ["chatgpt", "perplexity"], questions: definitions, samples });
    expect(report.manifest.status).toBe("partial");
    mount(report);
    const engineRows = host.querySelectorAll('[data-section="engines"] tbody tr');
    expect(engineRows[0]?.textContent).toContain("5 / 5");
    expect(engineRows[0]?.querySelector('[data-rate-unit="questions"]')).not.toBeNull();
    expect(engineRows[1]?.textContent).toContain("2 / 5");
    expect(engineRows[1]?.textContent).toContain("Insufficient answers");
    expect(engineRows[1]?.querySelector('[data-rate-unit]')).toBeNull();
    expect(metric("coverage")?.textContent).toContain("5 / 5");
  });
  it.each([
    { locale: "en", names: ["Problem", "Discovery", "Comparison", "Evaluation", "Branded"], missing: "No questions in this run" },
    { locale: "zh", names: ["问题", "发现", "对比", "选型", "品牌词"], missing: "本轮没有这类问题" },
  ] as const)("renders all five intent layers and marks missing layers as not asked ($locale)", ({ locale, names, missing }) => {
    const initial = visibilityReportFixtureV2();
    const definitions = [
      { ...initial.questions[0]!.definition, id: "q-discovery", text: "Which tool is best?", layer: "discovery" as const },
      { ...initial.questions[0]!.definition, id: "q-comparison", text: "How does Acme compare with Rival?", layer: "comparison" as const },
      { ...initial.questions[0]!.definition, id: "q-branded", text: "What is Acme?", layer: "branded" as const, mode: "demand" as const },
    ];
    const samples = [
      { ...initial.questions[0]!.samples[0]!, questionId: "q-discovery", slotId: "chatgpt:q-discovery:1" },
      { ...initial.questions[0]!.samples[0]!, questionId: "q-comparison", slotId: "chatgpt:q-comparison:1", mentioned: true },
      { ...initial.questions[0]!.samples[0]!, questionId: "q-branded", slotId: "chatgpt:q-branded:1", mentioned: true, webSearchPerformed: false, cited: false },
    ];
    mount(visibilityReportFixtureV2({ questions: definitions, samples }), locale);
    const rows = [...host.querySelectorAll('[data-section="layers"] tbody tr')];
    expect(rows.map((row) => row.querySelector('th[scope="row"]')?.textContent)).toEqual(names);
    for (const row of [rows[0], rows[3]]) {
      expect([...row!.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual([missing, "—", "—", "—"]);
      expect(row?.querySelector("[data-rate-unit]")).toBeNull();
      expect(row?.textContent).not.toMatch(/[0-9%]/);
    }
    expect(rows[1]?.textContent).not.toContain(missing);
    expect(rows[1]?.querySelectorAll("td")[3]?.textContent).toBe("1 / 1");
    expect(rows[2]?.textContent).toContain("100%");
    expect(rows[2]?.querySelectorAll("td")[3]?.textContent).toBe("1 / 1");
    expect(rows[4]?.querySelectorAll("td")[3]?.textContent).toBe("1 / 1");
  });
  it("shows the complete intent taxonomy in V1 without inventing missing-layer rates", () => {
    mount(legacyReport());
    const rows = [...host.querySelectorAll('[data-section="layers"] tbody tr')];
    expect(rows.map((row) => row.querySelector('th[scope="row"]')?.textContent)).toEqual(["Problem", "Discovery", "Comparison", "Evaluation", "Branded"]);
    const missingRows = rows.filter((row) => row.textContent?.includes("No questions in this run"));
    expect(missingRows).toHaveLength(4);
    for (const row of missingRows) {
      expect([...row.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(["No questions in this run", "—"]);
      expect(row.querySelector("[data-rate-unit]")).toBeNull();
    }
    expect(rows[1]?.querySelectorAll('[data-rate-unit="answers"]')).toHaveLength(2);
  });
  it("withholds rate, stage, gap and comparison conclusions for insufficient runs", () => {
    const report = visibilityReportFixtureV2({ samples: [] });
    mount(report);
    expect(host.textContent).toContain("No conclusions from this run");
    expect(host.querySelector("[data-metric]")).toBeNull();
    expect(host.querySelector('[data-section="layers"]')).toBeNull();
    expect(host.querySelector('[data-section="gaps"]')).toBeNull();
    expect(host.querySelector('[data-section="questions"]')).not.toBeNull();
    expect(host.querySelector('[data-section="engines"]')?.textContent).toContain("0 / 1");
  });
  it("uses left-aligned source rows with short safe links in expandable details", () => {
    const report = visibilityReportFixtureV2();
    mount({ ...report, citedDomains: [{ domain: "source.test", answers: 2, isOwn: false, isCompetitor: false, sampleUrls: ["https://source.test/path?tracking=long", "javascript:alert(1)"] }] });
    const sources = host.querySelector('[data-section="sources"]');
    expect(sources?.querySelector('th[scope="row"]')?.className).toContain("text-left");
    expect(sources?.querySelector("details summary")?.textContent).toContain("Source pages");
    expect(sources?.querySelector("a")?.textContent).toBe("source.test/path");
    expect(sources?.querySelectorAll("a").length).toBe(1);
  });
  it("adds evidenced source types and reports omitted unsafe source URLs without inventing domain-level presence", () => {
    const report = visibilityReportFixtureV2();
    const typedReport: AnyVisibilityReport = {
      ...report,
      limits: [...report.limits, "citationEvidenceTruncated" as const],
      citedDomains: [
        { domain: "source.test", answers: 2, isOwn: false, isCompetitor: false, sampleUrls: ["https://source.test/path?tracking=long", "javascript:alert(1)"] },
        { domain: "mixed.test", answers: 1, isOwn: false, isCompetitor: true, sampleUrls: ["https://mixed.test/compare"] },
        { domain: "unknown.test", answers: 1, isOwn: false, isCompetitor: false, sampleUrls: [] },
        { domain: "unsafe-only.test", answers: 1, isOwn: false, isCompetitor: false, sampleUrls: ["javascript:alert(2)"] },
      ],
      siteEvidence: {
        schemaVersion: "marketing-geo-site-evidence.v1",
        collectedAt: "2026-08-31T00:02:00.000Z",
        index: { scope: "declared_and_reachable_inventory", status: "complete", targetHost: "acme.test", discoveredCount: 0, sitemapUrls: [], inventorySources: [], limits: [], pages: [] },
        references: [
          { id: "ref-1", url: "https://www.source.test/path?tracking=long", finalUrl: "https://www.source.test/path?tracking=long", fetchedAt: "2026-08-31T00:02:00.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "a".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Source", headings: [], pageType: "listicle", pageTypeBasis: "title_headings", ownPresence: true, ownPresenceBasis: "brand_text", ownPresenceExcerpt: "Acme", matches: [], sampleSlots: ["chatgpt:q1:1"] },
          { id: "ref-2", url: "https://mixed.test/compare", finalUrl: "https://mixed.test/compare", fetchedAt: "2026-08-31T00:02:00.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "b".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Compare", headings: [], pageType: "comparison", pageTypeBasis: "title_headings", ownPresence: false, ownPresenceBasis: "none", ownPresenceExcerpt: null, matches: [], sampleSlots: ["chatgpt:q1:1"] },
          { id: "ref-3", url: "https://mixed.test/docs", finalUrl: "https://mixed.test/docs", fetchedAt: "2026-08-31T00:02:00.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "c".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Docs", headings: [], pageType: "documentation", pageTypeBasis: "title_headings", ownPresence: false, ownPresenceBasis: "none", ownPresenceExcerpt: null, matches: [], sampleSlots: ["chatgpt:q1:1"] },
        ],
        referenceOmittedCount: 0,
        citability: [],
        citabilityOmittedCount: 0,
      },
    };
    mount(typedReport);
    const sources = host.querySelector('[data-section="sources"]');
    expect([...sources!.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["Domain", "Citing answers", "Source type", "Identity"]);
    const rows = [...sources!.querySelectorAll("tbody tr")];
    expect(rows[0]?.textContent).toContain("Listicle");
    expect(rows[0]?.querySelectorAll("td")[0]?.textContent).toBe("2");
    expect(rows[0]?.textContent).toContain("1 source page could not be displayed safely.");
    expect(rows[0]?.textContent).not.toContain("javascript:alert(1)");
    expect(rows[1]?.textContent).toContain("Multiple");
    expect(rows[2]?.textContent).toContain("Not independently read");
    expect(rows[3]?.querySelectorAll("td")[0]?.textContent).toBe("1");
    expect(rows[3]?.textContent).toContain("1 source page could not be displayed safely.");
    expect(rows[3]?.textContent).not.toContain("Source page URLs were not retained.");
    expect(sources?.textContent).toContain("retained lower bound");
    expect(sources?.textContent).not.toContain("Present on own page");

    mount(typedReport, "zh");
    const zhSources = host.querySelector('[data-section="sources"]');
    expect([...zhSources!.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual(["域名", "被引回答数", "来源类型", "身份"]);
    const zhRows = [...zhSources!.querySelectorAll("tbody tr")];
    expect(zhRows[0]?.textContent).toContain("榜单页");
    expect(zhRows[1]?.textContent).toContain("多种类型");
    expect(zhRows[2]?.textContent).toContain("未独立读取");
    expect(zhRows[3]?.textContent).toContain("1 条来源页面无法安全展示。");
    expect(zhSources?.textContent).toContain("已保留证据的下限");
  });
  it("exports actual V2 evidence through the existing portable format", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", class extends URL { static override createObjectURL(blob: Blob) { blobs.push(blob); return "blob:report"; } static override revokeObjectURL() {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount(visibilityReportFixtureV2());
    const button = [...host.querySelectorAll("button")].find((button) => button.textContent === "Download run JSON");
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(blobs[0]?.type).toBe("application/json");
    const exported = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blobs[0]!);
    });
    const parsed = parseVisibilityImport(exported);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.manifest.runId).toBe(visibilityReportFixtureV2().manifest.runId);
  });
  it("renders the same semantic hierarchy in Chinese", () => {
    mount(visibilityReportFixtureV2(), "zh");
    expect(metric("questionsMentioned")?.textContent).toContain("自然提及");
    expect(metric("questionsMentioned")?.textContent).toContain("0 / 1 个问题");
    expect(metric("sov")?.textContent).toContain("品牌出现回答占比");
    expect(host.textContent).not.toContain("tools.aiVisibility.report");
  });
  it("does not label paired question inference as a difference confidence interval", () => {
    const comparison: VisibilityComparisonV2 = { baseRunId: "earlier", baseFinishedAt: "2026-08-30T00:00:00Z", aggregates: [{ metric: "questionsMentioned", base: wilson(1, 15), current: wilson(8, 15), diff: 7 / 15, gained: 7, lost: 0, pairs: 15, lo: 0.646, hi: 1, changed: true, testable: true }], questions: [], shareOfVoice: { baseClusters: [], comparison: { point: null, beforePoint: null, afterPoint: null, lo: null, hi: null, pairs: 1, matchedQuestionIds: ["q1"], method: "paired_question_cluster_hoeffding_ratio_95.v1", intervalReason: "fewer_than_10_question_pairs", assumption: "independent_question_clusters", scope: "paired_observed_answers", direction: "inconclusive" } } };
    const messages = { ...en, tools: { ...en.tools, aiVisibility: { ...en.tools.aiVisibility, report: aiVisibilityReportMessages.en } } };
    act(() => root.render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><AiVisibilityComparison comparison={comparison} locale="en" /></NextIntlClientProvider>));
    expect(host.textContent).toContain("7 improved, 0 got worse, of 15 comparable questions");
    expect(host.textContent).toContain("questions that moved improved");
    expect(host.textContent).toContain("fewer than 10 comparable question pairs");
    expect(host.textContent).not.toContain("0.0 to 0.0");
  });
});
