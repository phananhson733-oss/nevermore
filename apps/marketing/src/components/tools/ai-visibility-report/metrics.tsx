"use client";
// @input -- server-computed question/sample metrics with their own denominators
// @output -- four headline cards followed by honest engine/intent breakdowns
// @pos -- visual hierarchy; never changes the measurement scope
import { useTranslations } from "next-intl";
import type { VisibilityMetrics } from "../../../lib/geo-tools/visibility-contract.ts";
import { isVisibilityReportV2, type AnyVisibilityReport, type VisibilityMetricsV2 } from "../../../lib/geo-tools/visibility-v2-contract.ts";
import { CELL, HEAD, NOTE, PANEL, Rate, RunStatus, SectionTitle, SUMMARY, TableScroll } from "./primitives.tsx";

const LAYER_ORDER = ["problem", "discovery", "comparison", "evaluation", "branded"] as const;
const METRIC_TONES = {
  accent: { article: "border-t-2 border-brand-accent/35", title: "text-brand-accent-text" },
  info: { article: "border-t-2 border-brand-info/35", title: "text-brand-info" },
  warning: { article: "border-t-2 border-brand-warning/35", title: "text-brand-warning" },
  primary: { article: "border-t-2 border-brand-border-strong", title: "text-text-dark-primary" },
} as const;

function SovValue({ sov, prominent = false }: { readonly sov: VisibilityMetricsV2["shareOfVoice"] | null; readonly prominent?: boolean }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const value = sov === null ? t("sovV1") : sov.point === null ? t("unavailable") : sov.point === 0 ? t("unobserved") : `${(sov.point * 100).toFixed(1)}%`;
  return <div>
    <p className={`font-mono font-semibold leading-tight tabular-nums text-text-dark-primary ${prominent ? sov === null || sov.point === null || sov.point === 0 ? "text-2xl" : "text-[32px]" : "text-sm"}`}>{value}</p>
    {sov !== null && <>
      {sov.point !== null && <p className={`mt-2 font-mono ${NOTE}`}>{t("sovAnswers", { own: sov.ownAnswers, total: sov.anyBrandAnswers })}</p>}
      <p className={`mt-1 ${NOTE}`}>{sov.lo === null || sov.hi === null ? shared("v2.sovIntervalUnavailable", { reason: shared(`v2.sovReasons.${sov.intervalReason ?? "no_brand_present_answers"}`) }) : t("sovCluster", { lo: (sov.lo * 100).toFixed(1), hi: (sov.hi * 100).toFixed(1), count: sov.clusters })}</p>
    </>}
  </div>;
}

export function MetricOverview({ metrics, coverage, v2 = null }: { readonly metrics: VisibilityMetrics; readonly coverage: { readonly covered: number; readonly total: number }; readonly v2?: VisibilityMetricsV2 | null }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const cards = [
    { key: "questionsMentioned", tone: "accent", title: t("mentionCardTitle"), content: <Rate proportion={metrics.questionsMentioned} unit="questions" prominent /> },
    { key: "questionsCited", tone: "info", title: t("citationCardTitle"), content: <Rate proportion={metrics.questionsCited} unit="questions" prominent /> },
    { key: "coverage", tone: "warning", title: t("coverageCardTitle"), content: <>
      <p className="font-mono text-[32px] font-semibold leading-tight tabular-nums text-text-dark-primary">{coverage.covered} / {coverage.total}</p>
      <p className={`mt-2 ${NOTE}`}>{coverage.total === coverage.covered ? t("coverageComplete") : t("coverageMissing", { count: coverage.total - coverage.covered })}</p>
    </> },
    { key: "sov", tone: "primary", title: t("sovCardTitle"), content: <SovValue sov={v2?.shareOfVoice ?? null} prominent /> },
  ] as const;
  return <section data-section="metrics">
    <SectionTitle title={t("metricsTitle")} note={t("measured")} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ key, tone, title, content }) => <article key={key} data-metric={key} data-metric-tone={tone} className={`min-w-0 border border-brand-border-card bg-brand-panel-sunken p-5 ${METRIC_TONES[tone].article}`}>
        <h4 className={`mb-5 text-sm ${METRIC_TONES[tone].title}`}>{title}</h4>
        {content}
      </article>)}
    </div>
    <div className="mt-4 grid gap-4 border-l-2 border-brand-accent-text bg-brand-panel px-4 py-3 sm:grid-cols-[1fr_auto]">
      <div><h4 className="text-sm font-medium text-text-dark-primary">{t("promptedTitle")}</h4><p className={`mt-1 ${NOTE}`}>{t("promptedHelp")}</p></div>
      <Rate proportion={metrics.promptedMention} unit="answers" />
    </div>
    <details className="mt-4 border border-brand-border-card bg-brand-panel p-4">
      <summary className={SUMMARY}>{t("methodsTitle")}</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><p className={`mb-2 ${NOTE}`}>{t("mention")} · {t("sampleRate")}</p><Rate proportion={metrics.unpromptedMention} unit="answers" /></div>
        <div><p className={`mb-2 ${NOTE}`}>{t("citation")} · {t("sampleRate")}</p><Rate proportion={metrics.citation} unit="answers" /></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <p className={NOTE}><span className="text-text-dark-primary">{t("mentionCardTitle")}.</span> {t("mentionHelp")}</p>
        <p className={NOTE}><span className="text-text-dark-primary">{t("citationCardTitle")}.</span> {t("citationHelp")}</p>
        <p className={NOTE}><span className="text-text-dark-primary">{t("coverageCardTitle")}.</span> {t("coverageHelp")}</p>
        <p className={NOTE}><span className="text-text-dark-primary">{t("sovCardTitle")}.</span> {t("sovHelp")}</p>
      </div>
      <p className={`mt-4 ${NOTE}`}>{t("zeroMethod")}</p>
      {v2 !== null && <><p className={`mt-3 ${NOTE}`}>{t("sovScope", { count: v2.shareOfVoice.confirmedCompetitorCount })}</p><p className={`mt-2 ${NOTE}`}>{shared("v2.sovAssumption")}</p></>}
    </details>
  </section>;
}

export function EngineTable({ report }: { readonly report: AnyVisibilityReport }) {
  const t = useTranslations("tools.aiVisibility.report");
  const v2 = isVisibilityReportV2(report);
  const rows = v2 ? report.byEngine : [{ engine: "chatgpt", metrics: report.metrics, calls: report.manifest.calls, answered: report.manifest.answered, status: report.manifest.status }];
  const table = <TableScroll><table className="w-full min-w-[680px] border-collapse"><caption className="sr-only">{t("engineTitle")}</caption>
      <thead><tr className="border-b border-brand-border-strong">{["engine", "mentionColumn", "citationColumn", "sov", "samples", "state"].map((key) => <th key={key} scope="col" className={HEAD}>{t(key)}</th>)}</tr></thead>
      <tbody>{rows.map((row) => {
        const hasConclusions = report.manifest.status !== "insufficient" && row.status !== "insufficient";
        return <tr key={row.engine} className="border-b border-brand-border-card last:border-0">
          <th scope="row" className={`${CELL} font-medium`}>{row.engine === "chatgpt" ? "ChatGPT" : "Perplexity"}</th>
          <td className={CELL}>{hasConclusions ? <Rate proportion={row.metrics.questionsMentioned} unit="questions" /> : t("notEnough")}</td>
          <td className={CELL}>{hasConclusions ? <Rate proportion={row.metrics.questionsCited} unit="questions" /> : t("notEnough")}</td>
          <td className={CELL}>{hasConclusions ? <SovValue sov={"shareOfVoice" in row.metrics ? row.metrics.shareOfVoice as VisibilityMetricsV2["shareOfVoice"] : null} /> : t("notEnough")}</td>
          <td className={`${CELL} font-mono tabular-nums`}>{t("callsShort", { answered: row.answered, calls: row.calls })}</td>
          <td className={CELL}><RunStatus status={row.status} /></td>
        </tr>;
      })}</tbody>
    </table></TableScroll>;
  if (rows.length === 1) return <details className={PANEL} data-section="engines">
    <summary className={SUMMARY}>{t("engineTitle")}</summary>
    <p className={`mt-2 ${NOTE}`}>{t("engineHelp")}</p>
    <div className="mt-5">{table}</div>
  </details>;
  return <section className={PANEL} data-section="engines">
    <SectionTitle title={t("engineTitle")} note={t("engineHelp")} />
    {table}
  </section>;
}

export function LayerTable({ metrics, v2 = null }: { readonly metrics: VisibilityMetrics; readonly v2?: VisibilityMetricsV2 | null }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const rows = LAYER_ORDER.map((layer) => ({
    layer,
    metric: metrics.byLayer.find((entry) => entry.layer === layer),
    detail: v2?.byLayer.find((entry) => entry.layer === layer),
  }));
  return <section className={PANEL} data-section="layers">
    <SectionTitle title={t("layerTitle")} note={t("layerHelp")} />
    <TableScroll><table className="w-full min-w-[600px] border-collapse"><caption className="sr-only">{t("layerTitle")}</caption>
      <thead><tr className="border-b border-brand-border-strong">{["intent", "mentionColumn", "citationColumn", ...(v2 === null ? [] : ["position", "samples"])].map((key) => <th key={key} className={HEAD} scope="col">{t(key)}</th>)}</tr></thead>
      <tbody>{rows.map(({ layer, metric, detail }) => {
        const missing = metric === undefined;
        return <tr key={layer} className="border-b border-brand-border-card last:border-0">
          <th className={`${CELL} font-normal`} scope="row">{shared(`layers.names.${layer}`)}</th>
          <td className={CELL}>{missing ? <span className={NOTE}>{t("layerMissing")}</span> : <Rate proportion={metric.mention} unit="answers" />}</td>
          <td className={CELL}>{missing ? "—" : <Rate proportion={metric.citation} unit="answers" />}</td>
          {v2 !== null && <><td className={`${CELL} font-mono`}>{missing || detail === undefined || detail.meanPosition.value === null ? "—" : t("positionValue", { position: detail.meanPosition.value.toFixed(2), count: detail.meanPosition.observations })}</td><td className={`${CELL} font-mono`}>{missing || detail === undefined ? "—" : t("callsShort", { answered: detail.answeredSamples, calls: detail.plannedSamples })}</td></>}
        </tr>;
      })}</tbody>
    </table></TableScroll>
  </section>;
}
