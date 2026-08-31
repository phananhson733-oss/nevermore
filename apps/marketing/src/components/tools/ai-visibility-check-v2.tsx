"use client";
// @input -- an actual V2 report, or two explicit user-chosen local files
// @output -- per-engine metrics and portable evidence, never trusted run authority
// @pos -- V2-only UI; the existing report renderer retains historical v1 behavior
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { visibilityReportMarkdown } from "../../lib/geo-tools/visibility-markdown.ts";
import { compareVisibilityReportsV2, exportVisibilityJson, parseVisibilityImport } from "../../lib/geo-tools/visibility-export.ts";
import type { VisibilityComparison } from "../../lib/geo-tools/visibility-contract.ts";
import type { VisibilityEngineAggregate, VisibilityReportV2 } from "../../lib/geo-tools/visibility-v2-contract.ts";

const PANEL = "rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7";
const BUTTON = "rounded-lg border border-brand-border-card px-3 py-2 text-[13px] text-text-dark-primary disabled:opacity-50";
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
function Metrics({ value }: { readonly value: VisibilityEngineAggregate }) {
  const t = useTranslations("tools.aiVisibility");
  const { shareOfVoice: sov, promptCoverage: coverage, meanPosition: rank } = value.metrics;
  return <div className="mt-2 grid gap-2 text-sm text-text-dark-secondary">
    <p>{t("overview.questionsMentioned.label")}: {value.metrics.questionsMentioned.point === null ? t("v2.unknown") : `${value.metrics.questionsMentioned.successes}/${value.metrics.questionsMentioned.trials}`} · {t("overview.acrossSamples")} {value.metrics.unpromptedMention.point === null ? t("v2.unknown") : `${value.metrics.unpromptedMention.successes}/${value.metrics.unpromptedMention.trials}`}</p>
    <p>{t("overview.questionsCited.label")}: {value.metrics.questionsCited.point === null ? t("v2.unknown") : `${value.metrics.questionsCited.successes}/${value.metrics.questionsCited.trials}`} · {t("overview.acrossSamples")} {value.metrics.citation.point === null ? t("v2.unknown") : `${value.metrics.citation.successes}/${value.metrics.citation.trials}`}</p>
    <p>{t("v2.sov", { own: sov.ownAnswers, total: sov.anyBrandAnswers, count: sov.confirmedCompetitorCount })}{sov.point === null ? ` · ${t("v2.unknown")}` : sov.point === 0 ? ` · ${t("v2.sovZeroObserved")}` : ` · ${(sov.point * 100).toFixed(1)}%`}</p>
    <p>{sov.lo === null || sov.hi === null ? t("v2.sovIntervalUnavailable", { reason: t(`v2.sovReasons.${sov.intervalReason ?? "no_brand_present_answers"}`) }) : t("v2.sovInterval", { lo: (sov.lo * 100).toFixed(1), hi: (sov.hi * 100).toFixed(1), clusters: sov.clusters })}</p>
    <p className="text-xs">{t("v2.sovAssumption")}</p>
    <p>{t("v2.coverage", { covered: coverage.successes, total: coverage.trials })}{coverage.point === null ? ` · ${t("v2.unknown")}` : ""}</p>
    <p>{rank.value === null ? t("v2.positionUnavailable") : t("v2.position", { position: rank.value.toFixed(2), count: rank.observations })}</p>
  </div>;
}
export function VisibilityV2Measurements({ report }: { readonly report: VisibilityReportV2 }) {
  const t = useTranslations("tools.aiVisibility");
  const locale = useLocale();
  return <section className={PANEL}>
    <h3 className="text-lg text-text-dark-primary">{t("v2.title")}</h3>
    {report.manifest.status !== "insufficient" && <><h4 className="mt-4 text-text-dark-primary">{t("v2.mixed")}</h4><Metrics value={report.aggregate} /></>}
    {report.byEngine.map((entry) => {
      const config = report.manifest.engines.find((config) => config.engine === entry.engine)!;
      const observed = [...new Set(entry.questions.flatMap((question) => question.samples.flatMap((sample) => sample.modelObserved === null ? [] : [sample.modelObserved])))];
      return <div key={entry.engine} className="mt-5 border-t border-brand-border-card pt-4">
        <h4 className="text-text-dark-primary">{t("v2.engine", { engine: entry.engine === "chatgpt" ? "ChatGPT" : "Perplexity" })}</h4>
        <p className="mt-1 text-sm text-text-dark-secondary">{t("v2.modelRequested", { model: config.modelRequested })}</p>
        <p className="mt-1 text-sm text-text-dark-secondary">{t("v2.modelObserved", { models: observed.length === 0 ? t("v2.unknown") : observed.join(", ") })}</p>
        <p className="mt-1 text-sm text-text-dark-secondary">{t("results.coverage", { answered: entry.answered, calls: entry.calls })} · {t(`results.status.${entry.status}`)}</p>
        {entry.status !== "insufficient" && report.manifest.status !== "insufficient" && <Metrics value={entry} />}
      </div>;
    })}
    <div className="mt-5 flex flex-wrap gap-3">
      <button type="button" className={BUTTON} onClick={() => download(`geo-visibility-${report.manifest.runId}.json`, exportVisibilityJson(report), "application/json")}>{t("v2.exportJson")}</button>
      <button type="button" className={BUTTON} onClick={() => download(`geo-visibility-${report.manifest.runId}.md`, visibilityReportMarkdown(report, locale), "text/markdown")}>{t("v2.exportMarkdown")}</button>
    </div>
  </section>;
}
export function VisibilityPortableRuns({ onComparison }: { readonly onComparison: (comparison: VisibilityComparison | null) => void }) {
  const t = useTranslations("tools.aiVisibility");
  const [base, setBase] = useState<VisibilityReportV2 | null>(null);
  const [current, setCurrent] = useState<VisibilityReportV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function read(file: File | undefined, side: "base" | "current"): Promise<void> {
    onComparison(null); setError(null);
    const set = side === "base" ? setBase : setCurrent;
    set(null);
    if (file === undefined) return;
    if (file.size > 4 * 1024 * 1024) { setError(t("v2.invalidFile")); return; }
    try {
      const parsed = parseVisibilityImport(await file.text());
      if (!parsed.ok) { setError(t("v2.invalidFile")); return; }
      set(parsed.report);
    } catch { setError(t("v2.invalidFile")); }
  }
  return <section className={PANEL}>
    <h3 className="text-lg text-text-dark-primary">{t("v2.importTitle")}</h3>
    <p className="mt-2 text-sm text-text-dark-secondary">{t("v2.imported")}</p>
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <label className="text-sm text-text-dark-primary">{t("v2.importBase")}<input className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={(event) => { void read(event.target.files?.[0], "base"); }} />{base !== null && <span>{t("v2.loaded", { id: base.manifest.runId })}</span>}</label>
      <label className="text-sm text-text-dark-primary">{t("v2.importCurrent")}<input className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={(event) => { void read(event.target.files?.[0], "current"); }} />{current !== null && <span>{t("v2.loaded", { id: current.manifest.runId })}</span>}</label>
    </div>
    <button type="button" className={`mt-4 ${BUTTON}`} disabled={base === null || current === null} onClick={() => {
      if (base === null || current === null) return;
      const result = compareVisibilityReportsV2(base, current);
      if (!result.compatible) { setError(t("v2.incompatible", { reason: result.reason })); onComparison(null); }
      else { setError(null); onComparison(result.comparison); }
    }}>{t("v2.compare")}</button>
    {error !== null && <p className="mt-3 text-sm text-brand-error" role="alert">{error}</p>}
  </section>;
}
