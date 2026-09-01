"use client";
// @input -- a validated server-run V2 report, including independent page evidence
// @output -- evidence cards and real scoped Brief/T2/third-party task actions
// @pos -- GAP action surface; imported comparisons never mount this component
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { VisibilityReportV2 } from "../../lib/geo-tools/visibility-v2-contract.ts";
import { writeGeoGapHandoff } from "../../lib/geo-tools/gap-handoff.ts";
import { thirdPartyGapMarkdown } from "../../lib/geo-tools/gap-markdown.ts";
import { localePath } from "../../lib/locale-path.ts";
import { ACTION, CELL, EvidenceLinks, HEAD, NOTE, PANEL, SUMMARY, TableScroll } from "./ai-visibility-report/primitives.tsx";
const GAP_KINDS = ["A", "B", "C", "D", "unattributed"] as const;
const GAP_CARD_TONES = {
  neutral: { card: "border-l-brand-border-card", label: "text-text-dark-secondary" },
  warning: { card: "border-brand-warning/30 border-l-brand-warning bg-brand-warning/[0.06]", label: "text-brand-warning" },
  info: { card: "border-brand-info/30 border-l-brand-info bg-brand-info/[0.06]", label: "text-brand-info" },
} as const;

function gapTone(kind: typeof GAP_KINDS[number], count: number) {
  if (count === 0) return "neutral";
  return kind === "unattributed" ? "info" : "warning";
}

export function VisibilityGapEvidence({ report, locale }: { readonly report: VisibilityReportV2; readonly locale: string }) {
  const t = useTranslations("tools.aiVisibility"), [failed, setFailed] = useState(false);
  const evidence = report.siteEvidence, stored = !report.limits.includes("notStored");
  const timestamp = (time: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(time)) + " UTC";
  return <section className={PANEL}>
    <h3 className="text-base font-semibold text-brand-accent-text">{t("gaps.title")}</h3>
    <p className={`mt-2 max-w-3xl ${NOTE}`}>{t("gaps.intro")}</p>
    {evidence === null ? <p className="mt-3 text-sm text-text-dark-secondary">{t("gaps.noEvidence")}</p> : <>
      <dl data-gap-summary className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {GAP_KINDS.map(kind => {
          const count = report.gaps.filter(gap => gap.kind === kind).length;
          const tone = gapTone(kind, count);
          const styles = GAP_CARD_TONES[tone];
          return <div key={kind} data-gap-kind={kind} data-gap-tone={tone} className={`flex min-w-0 flex-col border border-brand-border-card border-l-2 bg-brand-panel-sunken p-3 ${styles.card}`}>
          <dt className={`order-2 mt-2 ${NOTE} ${styles.label}`}>{t(`gaps.kind.${kind}`)}</dt>
          <dd className="order-1 font-mono text-2xl font-semibold tabular-nums text-text-dark-primary">{count}</dd>
        </div>;
        })}
      </dl>
      <p className={`mt-3 ${NOTE}`}>{t("gaps.indexStatus", { status: t(`gaps.indexValues.${evidence.index.status}`), count: evidence.index.pages.filter((page) => page.state === "read").length, discovered: evidence.index.discoveredCount })}</p>
      {evidence.citabilityOmittedCount > 0 && <p className={`mt-2 ${NOTE}`}>{t("gaps.citabilityOmitted", { count: evidence.citabilityOmittedCount })}</p>}
    </>}
    <div className="mt-5 divide-y divide-brand-border-card">{report.gaps.map((gap) => {
      const question = report.questions.find((question) => question.questionId === gap.questionId);
      if (question === undefined) return null;
      const brief = (gap.kind === "A" || gap.kind === "D") && gap.action === "brief";
      const t2 = gap.kind === "B" && gap.action === "citability" && gap.pageUrl !== null;
      const destination = brief ? "geo-brief" as const : "page-citability-check" as const;
      return <article key={gap.id} data-gap-row={gap.id} className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="text-xs font-medium text-brand-accent-text">{t(`gaps.kind.${gap.kind}`)}</p>
          <h4 className="mt-2 break-words text-sm font-medium text-text-dark-primary">{question.text}</h4>
          <p className={`mt-2 ${NOTE}`}>{t(`gaps.reasons.${gap.reason}`)}</p>
          <details className="mt-3">
            <summary className={`${SUMMARY} text-xs`}>{t("gaps.presentation.evidence")} ({gap.evidenceIds.length})</summary>
            <ul className="mt-2 grid gap-1">{gap.evidenceIds.map(id => <li key={id} className={`break-all font-mono ${NOTE}`}>{id}</li>)}</ul>
          </details>
        </div>
        <div className="self-start sm:pt-1">
        {(brief || t2) && (stored ? <a className={`mt-3 ${ACTION}`} href={localePath(locale, brief ? "/tools/geo-brief" : "/tools/page-citability-check?handoff=geo-gap")} onClick={(event) => {
          let saved = false;
          try { saved = writeGeoGapHandoff(sessionStorage, { destination, runId: report.manifest.runId, kbId: report.manifest.kbId, snapshotId: report.manifest.snapshotId, questionId: gap.questionId, gapId: gap.id, pageUrl: brief ? null : gap.pageUrl, questionText: brief ? null : question.text }); } catch { /* Session storage can be unavailable. */ }
          if (!saved) { event.preventDefault(); setFailed(true); }
        }}>{t(brief ? "gaps.actions.brief" : "gaps.actions.citability")}</a> : <p className={`max-w-xs ${NOTE}`}>{t("gaps.notStored")}</p>)}
        {gap.kind === "C" && gap.action === "third_party" && <button type="button" className={`mt-3 ${ACTION}`} onClick={() => {
          const markdown = thirdPartyGapMarkdown(report, gap.id, locale);
          if (markdown === null) { setFailed(true); return; }
          const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" })), link = document.createElement("a");
          link.href = url; link.download = `geo-third-party-${report.manifest.runId}-${gap.questionId}.md`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>{t("gaps.actions.thirdParty")}</button>}
        </div>
      </article>;
    })}</div>
    {evidence !== null && <details data-gap-references className="mt-5 border-t border-brand-border-card pt-4">
      <summary className={SUMMARY}>{t("gaps.references")} ({evidence.references.length})</summary>
      <div className="mt-3"><TableScroll><table className="w-full min-w-[650px] border-collapse">
        <caption className="sr-only">{t("gaps.references")}</caption>
        <thead><tr className="border-b border-brand-border-strong">{["page", "pageType", "presence", "readAt"].map(key => <th key={key} scope="col" className={HEAD}>{t(`gaps.presentation.${key}`)}</th>)}</tr></thead>
        <tbody>{evidence.references.map(page => <tr key={page.id} data-reference-id={page.id} className="border-b border-brand-border-card last:border-0">
          <th scope="row" className={`${CELL} w-[40%] font-normal`}><EvidenceLinks urls={[page.url]} />{page.ownPresenceExcerpt !== null && <p className={`mt-2 max-w-md whitespace-pre-wrap break-words ${NOTE}`}>{page.ownPresenceExcerpt}</p>}</th>
          <td className={CELL}>{t(`gaps.pageType.${page.pageType}`)}</td>
          <td className={CELL}>{t(`gaps.presence.${page.ownPresence === null ? "unknown" : page.ownPresence ? "present" : "absent"}`)}</td>
          <td className={`${CELL} whitespace-nowrap font-mono text-xs`}><time dateTime={page.fetchedAt}>{timestamp(page.fetchedAt)}</time></td>
        </tr>)}</tbody>
      </table></TableScroll></div>
      {evidence.referenceOmittedCount > 0 && <p className={`mt-3 ${NOTE}`}>{t("gaps.referenceOmitted", { count: evidence.referenceOmittedCount })}</p>}
    </details>}
    {failed && <p className="mt-3 text-sm text-brand-error" role="alert">{t("gaps.handoffFailed")}</p>}
  </section>;
}
