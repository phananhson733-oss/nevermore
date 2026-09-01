"use client";
// @input -- an already-validated paired comparison, including optional V2 SOV
// @output -- separate observed counts and statistically permitted change claims
// @pos -- comparison UI shared by saved reports and untrusted portable comparisons
import { useTranslations } from "next-intl";
import type { VisibilityComparison } from "../../../lib/geo-tools/visibility-contract.ts";
import type { AnyVisibilityComparison } from "../../../lib/geo-tools/visibility-v2-contract.ts";
import { CELL, formatMoment, HEAD, NOTE, PANEL, Rate, SectionTitle, SUMMARY, TableScroll } from "./primitives.tsx";

function ChangeCell({ row }: { readonly row: VisibilityComparison["aggregates"][number] }) {
  const t = useTranslations("tools.aiVisibility");
  if (!row.testable) return <>{t("comparison.notTestable")}</>;
  if (!row.changed) return <>{t("comparison.unchanged")}</>;
  const counts = { gained: row.gained, lost: row.lost, pairs: row.pairs };
  return <>{row.lo === null || row.hi === null ? t("comparison.changedNoInterval", counts) : t("comparison.changed", { ...counts, lo: Math.round(row.lo * 1000) / 10, hi: Math.round(row.hi * 1000) / 10 })}</>;
}

export function AiVisibilityComparison({ comparison, locale }: { readonly comparison: AnyVisibilityComparison; readonly locale: string }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const sov = "shareOfVoice" in comparison ? comparison.shareOfVoice.comparison : null;
  const percentage = (value: number | null) => value === null ? t("unavailable") : `${(value * 100).toFixed(1)}%`;
  return <section className={PANEL} data-section="comparison">
    <SectionTitle title={t("comparisonTitle")} note={shared("comparison.intro", { time: formatMoment(comparison.baseFinishedAt, locale) })} />
    <TableScroll><table className="w-full min-w-[640px] border-collapse"><caption className="sr-only">{t("comparisonTitle")}</caption>
      <thead><tr className="border-b border-brand-border-strong">{["metric", "base", "current", "change"].map((key) => <th key={key} className={HEAD} scope="col">{shared(`comparison.column.${key}`)}</th>)}</tr></thead>
      <tbody>
        {comparison.aggregates.map((row) => <tr key={row.metric} className="border-b border-brand-border-card last:border-0">
          <th className={`${CELL} font-normal`} scope="row">{shared(`comparison.metrics.${row.metric}`)}</th>
          <td className={CELL}><Rate proportion={row.base} unit="questions" /></td><td className={CELL}><Rate proportion={row.current} unit="questions" /></td><td className={`${CELL} max-w-sm`}><ChangeCell row={row} /></td>
        </tr>)}
        {sov !== null && <tr className="border-b border-brand-border-card last:border-0"><th className={`${CELL} font-normal`} scope="row">{shared("comparison.metrics.shareOfVoice")}</th><td className={`${CELL} font-mono`}>{percentage(sov.beforePoint)}</td><td className={`${CELL} font-mono`}>{percentage(sov.afterPoint)}</td><td className={`${CELL} max-w-sm`}>{sov.lo === null || sov.hi === null || sov.point === null ? shared("comparison.sovUnavailable", { pairs: sov.pairs, reason: shared(`v2.sovReasons.${sov.intervalReason ?? "no_brand_present_answers"}`) }) : shared("comparison.sovChange", { change: (sov.point * 100).toFixed(1), lo: (sov.lo * 100).toFixed(1), hi: (sov.hi * 100).toFixed(1), pairs: sov.pairs })}</td></tr>}
      </tbody>
    </table></TableScroll>
    {sov !== null && <p className={`mt-4 ${NOTE}`}>{shared("comparison.sovScope")}</p>}
    <details className="mt-5 border-t border-brand-border-card pt-4"><summary className={SUMMARY}>{shared("comparison.questionsTitle")} ({comparison.questions.length})</summary>
      {comparison.questions.length === 0 ? <p className={`mt-3 ${NOTE}`}>{t("noChange")}</p> : <ul className="mt-3 grid gap-3">{comparison.questions.map((question) => <li key={question.questionId} className="text-sm text-text-dark-primary">
        <p>{question.text}</p><p className={`mt-1 ${NOTE}`}>{shared(`comparison.direction.${question.direction}`)} · {shared("comparison.questionRow", { base: question.baseMentioned, current: question.currentMentioned, of: question.of })}</p>
      </li>)}</ul>}
    </details>
    <p className={`mt-4 ${NOTE}`}>{t("comparisonDirection")} · {t("observationsOnly")}</p>
  </section>;
}
