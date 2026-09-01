"use client";
// @input -- real V1/V2 reports or an explicitly count-only saved V1 summary
// @output -- Artifact-aligned evidence hierarchy, exports and compatible comparisons
// @pos -- results-only entrypoint; the root controller owns input, history and polling
import { useState } from "react";
import { useTranslations } from "next-intl";
import { VISIBILITY_MIN_SUCCESS_RATIO, type VisibilityRunManifest } from "../../../lib/geo-tools/visibility-contract.ts";
import { exportVisibilityJson } from "../../../lib/geo-tools/visibility-export.ts";
import { visibilityReportMarkdown } from "../../../lib/geo-tools/visibility-markdown.ts";
import { isVisibilityReportV2, type AnyVisibilityReport, type VisibilityRunManifestV2, type VisibilityReportV2 } from "../../../lib/geo-tools/visibility-v2-contract.ts";
import type { StoredVisibilityRun } from "../../../lib/geo-tools/visibility-store.ts";
import { VisibilityGapEvidence } from "../ai-visibility-gaps.tsx";
import { AiVisibilityComparison } from "./comparison.tsx";
import { QuestionEvidence, SourceTable } from "./evidence.tsx";
import { EngineTable, LayerTable, MetricOverview } from "./metrics.tsx";
import { ACTION, formatMoment, NOTE, PANEL, RunStatus, SUMMARY } from "./primitives.tsx";

export { AiVisibilityComparison } from "./comparison.tsx";

function ReportHeader({ manifest, locale, host }: { readonly manifest: VisibilityRunManifest | VisibilityRunManifestV2; readonly locale: string; readonly host?: string }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  return <header className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-border-strong pb-5">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-3"><h3 className="break-all font-mono text-lg font-semibold text-text-dark-primary">{host ?? t("legacy")}</h3><RunStatus status={manifest.status} /></div>
      <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 ${NOTE}`}>
        <span>{t("snapshot", { revision: manifest.snapshotRevision })}</span><span>{manifest.marketCode}{"language" in manifest ? ` / ${manifest.language}` : ""}</span>
        <span>{t("samplePlan", { questions: manifest.questionCount, samples: manifest.samplesPerQuestion })}</span>
      </div>
      <p className={`mt-2 ${NOTE}`}>{shared("results.finished", { time: formatMoment(manifest.finishedAt, locale) })}</p>
    </div>
    <div className="text-left sm:text-right"><p className="font-mono text-sm text-text-dark-primary">{shared("results.coverage", { answered: manifest.answered, calls: manifest.calls })}</p><p className={`mt-2 max-w-sm ${NOTE}`}>{manifest.costUsd === null ? shared("results.costUnavailable") : shared("results.cost", { cost: manifest.costUsd })}</p></div>
  </header>;
}

function Withheld() {
  const t = useTranslations("tools.aiVisibility");
  return <section className={`${PANEL} border-l-2 border-l-brand-border-strong`} role="status"><h3 className="font-medium text-text-dark-primary">{t("results.withheldTitle")}</h3><p className={`mt-2 ${NOTE}`}>{t("results.withheldBody", { percent: Math.round(VISIBILITY_MIN_SUCCESS_RATIO * 100) })}</p></section>;
}

function RunDetails({ manifest, locale, report, runId }: { readonly manifest: VisibilityRunManifest | VisibilityRunManifestV2; readonly locale: string; readonly report?: AnyVisibilityReport; readonly runId?: string }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const v2 = report !== undefined && isVisibilityReportV2(report) ? report : null;
  const engines = "engines" in manifest ? manifest.engines : null;
  return <details data-section="metadata" className={PANEL}>
    <summary className={SUMMARY}>{t("metadataTitle")}</summary>
    <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2">
      {(runId !== undefined || "runId" in manifest) && <div><dt className={NOTE}>{t("runId")}</dt><dd className="mt-1 break-all font-mono text-xs text-text-dark-primary">{runId ?? ("runId" in manifest ? manifest.runId : "")}</dd></div>}
      <div><dt className={NOTE}>{t("frozenReference")}</dt><dd className="mt-1 break-all font-mono text-xs text-text-dark-primary">{manifest.snapshotId}</dd></div>
      <div><dt className={NOTE}>{t("questionSet")}</dt><dd className="mt-1 break-all font-mono text-xs text-text-dark-primary">{manifest.questionSetHash}</dd></div>
      <div><dt className={NOTE}>{shared("results.title")}</dt><dd className="mt-1 text-text-dark-primary">{manifest.schemaVersion} · {formatMoment(manifest.finishedAt, locale)}</dd></div>
    </dl>
    {engines === null && "model" in manifest ? <div className="mt-4 border-t border-brand-border-card pt-4"><p className={NOTE}>{t("requestedModel")}: {manifest.model}</p><p className={`mt-1 break-all ${NOTE}`}>{shared("results.surface", { surface: manifest.surface })}</p></div> : engines?.map((engine) => {
      const observed = v2 === null ? [] : [...new Set(v2.byEngine.find((row) => row.engine === engine.engine)?.questions.flatMap((question) => question.samples.flatMap((sample) => sample.modelObserved === null ? [] : [sample.modelObserved])) ?? [])];
      return <div key={engine.engine} className="mt-4 border-t border-brand-border-card pt-4"><h4 className="font-mono text-sm text-text-dark-primary">{engine.engine === "chatgpt" ? "ChatGPT" : "Perplexity"}</h4><p className={`mt-2 ${NOTE}`}>{t("requestedModel")}: {engine.modelRequested}</p><p className={`mt-1 ${NOTE}`}>{t("observedModels")}: {observed.length === 0 ? t("unavailable") : observed.join(" · ")}</p><p className={`mt-1 break-all ${NOTE}`}>{shared("results.surface", { surface: engine.surface })}</p></div>;
    })}
    {"costKnownCalls" in manifest && <p className={`mt-4 ${NOTE}`}>{t("knownCosts", { known: manifest.costKnownCalls, calls: manifest.calls })}{manifest.discardedSlots > 0 ? ` · ${t("discarded", { count: manifest.discardedSlots })}` : ""}</p>}
    <p className={`mt-4 ${NOTE}`}>{shared("results.minSuccess", { percent: Math.round(VISIBILITY_MIN_SUCCESS_RATIO * 100) })}</p>
    {v2 !== null && v2.context.competitors.some((rival) => !rival.confirmed) && <p className={`mt-3 ${NOTE}`}>{t("sovExcluded", { names: v2.context.competitors.filter((rival) => !rival.confirmed).map((rival) => rival.brandName || rival.domain).join(" · ") })}</p>}
    {report !== undefined && <ul className={`mt-4 grid gap-3 border-t border-brand-border-card pt-4 ${NOTE}`}>{report.limits.map((limit) => <li key={limit}>{limit === "historicalSamplesUnavailable" ? t("historicalSamplesUnavailable") : shared(`limits.${limit}`)}</li>)}</ul>}
    <p className={`mt-4 ${NOTE}`}>{t("observationsOnly")}</p>
  </details>;
}

function ReportExports({ report, locale }: { readonly report: VisibilityReportV2; readonly locale: string }) {
  const [failed, setFailed] = useState(false);
  const t = useTranslations("tools.aiVisibility");
  function download(kind: "json" | "md") {
    try {
      const content = kind === "json" ? exportVisibilityJson(report) : visibilityReportMarkdown(report, locale);
      const url = URL.createObjectURL(new Blob([content], { type: kind === "json" ? "application/json" : "text/markdown" }));
      const link = document.createElement("a"); link.href = url; link.download = `geo-visibility-${report.manifest.runId}.${kind}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000); setFailed(false);
    } catch { setFailed(true); }
  }
  return <div><div className="flex flex-wrap gap-3"><button type="button" className={ACTION} onClick={() => download("json")}>{t("v2.exportJson")}</button><button type="button" className={ACTION} onClick={() => download("md")}>{t("v2.exportMarkdown")}</button></div>{failed && <p className="mt-3 text-sm text-brand-error" role="alert">{t("report.exportFailed")}</p>}</div>;
}

export function AiVisibilityReport({ report, locale }: { readonly report: AnyVisibilityReport; readonly locale: string }) {
  const v2 = isVisibilityReportV2(report) ? report : null;
  const sufficient = report.manifest.status !== "insufficient";
  const coverage = v2 === null ? { covered: report.questions.filter((question) => question.answered > 0).length, total: report.manifest.questionCount } : { covered: v2.metrics.promptCoverage.successes, total: v2.metrics.promptCoverage.trials };
  return <div className="grid min-w-0 gap-6" data-visibility-report={report.manifest.schemaVersion}>
    <ReportHeader manifest={report.manifest} locale={locale} host={v2?.context.targetHost} />
    {sufficient ? <MetricOverview metrics={report.metrics} coverage={coverage} v2={v2?.metrics ?? null} /> : <Withheld />}
    <EngineTable report={report} />
    {sufficient && <LayerTable metrics={report.metrics} v2={v2?.metrics ?? null} />}
    {v2 !== null && sufficient && <div data-section="gaps"><VisibilityGapEvidence report={v2} locale={locale} /></div>}
    <SourceTable domains={report.citedDomains} references={v2?.siteEvidence?.references ?? []} truncated={report.limits.includes("citationEvidenceTruncated")} />
    <QuestionEvidence questions={report.questions} />
    {sufficient && report.comparison !== null && <AiVisibilityComparison comparison={report.comparison} locale={locale} />}
    {v2 !== null && <ReportExports report={v2} locale={locale} />}
    <RunDetails manifest={report.manifest} locale={locale} report={report} />
  </div>;
}

/** Saved V1 rows are not expanded into fake V1 reports: omitted evidence stays absent. */
export function AiVisibilityLegacySummary({ summary, locale }: { readonly summary: StoredVisibilityRun; readonly locale: string }) {
  const t = useTranslations("tools.aiVisibility.report");
  const sufficient = summary.manifest.status !== "insufficient";
  return <div className="grid min-w-0 gap-6" data-visibility-report="historical-summary">
    <ReportHeader manifest={summary.manifest} locale={locale} />
    <p className="border-l-2 border-brand-border-strong bg-brand-panel px-4 py-3 text-sm text-text-dark-secondary"><strong className="font-medium text-text-dark-primary">{t("historicalTitle")}</strong> · {t("historicalHelp")}</p>
    {sufficient ? <><MetricOverview metrics={summary.metrics} coverage={{ covered: summary.perQuestion.filter((question) => question.answered > 0).length, total: summary.manifest.questionCount }} /><LayerTable metrics={summary.metrics} /></> : <Withheld />}
    <SourceTable domains={summary.citedDomains} />
    <QuestionEvidence questions={summary.perQuestion} />
    <RunDetails manifest={summary.manifest} locale={locale} runId={summary.runId} />
  </div>;
}
