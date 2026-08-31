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
const PANEL = "rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7";
const ACTION = "inline-block rounded-lg border border-brand-border-card px-3 py-2 text-sm text-text-dark-primary disabled:opacity-50";
export function VisibilityGapEvidence({ report, locale }: { readonly report: VisibilityReportV2; readonly locale: string }) {
  const t = useTranslations("tools.aiVisibility"), [failed, setFailed] = useState(false);
  const evidence = report.siteEvidence, stored = !report.limits.includes("notStored");
  const timestamp = (time: string) => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(time)) + " UTC";
  return <section className={PANEL}>
    <h3 className="text-lg text-text-dark-primary">{t("gaps.title")}</h3>
    <p className="mt-2 text-sm text-text-dark-secondary">{t("gaps.intro")}</p>
    {evidence === null ? <p className="mt-3 text-sm text-text-dark-secondary">{t("gaps.noEvidence")}</p> : <>
      <p className="mt-3 text-sm text-text-dark-secondary">{t("gaps.indexStatus", { status: t(`gaps.indexValues.${evidence.index.status}`), count: evidence.index.pages.filter((page) => page.state === "read").length, discovered: evidence.index.discoveredCount })}</p>
      <h4 className="mt-5 text-text-dark-primary">{t("gaps.references")}</h4>
      <ul className="mt-3 grid gap-3">{evidence.references.map((page) => <li className="rounded-lg border border-brand-border-card p-3 text-sm" key={page.id}>
        <a className="break-all text-brand-accent-text underline" href={page.url} target="_blank" rel="noopener noreferrer">{page.url}</a>
        <p className="mt-1 text-text-dark-secondary">{t(`gaps.pageType.${page.pageType}`)} · {t(`gaps.presence.${page.ownPresence === null ? "unknown" : page.ownPresence ? "present" : "absent"}`)}</p>
        <p className="mt-1 text-xs text-text-dark-secondary">{t("gaps.readAt", { time: timestamp(page.fetchedAt) })}</p>
        {page.ownPresenceExcerpt !== null && <p className="mt-2 text-text-dark-secondary">{page.ownPresenceExcerpt}</p>}
      </li>)}</ul>
      {evidence.referenceOmittedCount > 0 && <p className="mt-2 text-xs text-text-dark-secondary">{t("gaps.referenceOmitted", { count: evidence.referenceOmittedCount })}</p>}
      {evidence.citabilityOmittedCount > 0 && <p className="mt-2 text-xs text-text-dark-secondary">{t("gaps.citabilityOmitted", { count: evidence.citabilityOmittedCount })}</p>}
    </>}
    <div className="mt-5 grid gap-4">{report.gaps.map((gap) => {
      const question = report.questions.find((question) => question.questionId === gap.questionId);
      if (question === undefined) return null;
      const brief = (gap.kind === "A" || gap.kind === "D") && gap.action === "brief";
      const t2 = gap.kind === "B" && gap.action === "citability" && gap.pageUrl !== null;
      const destination = brief ? "geo-brief" as const : "page-citability-check" as const;
      return <article key={gap.id} className="rounded-lg border border-brand-border-card p-4">
        <p className="text-sm font-medium text-text-dark-primary">{t(`gaps.kind.${gap.kind}`)}</p>
        <h4 className="mt-2 text-text-dark-primary">{question.text}</h4>
        <p className="mt-2 text-sm text-text-dark-secondary">{t(`gaps.reasons.${gap.reason}`)}</p>
        <p className="mt-2 break-all font-mono text-xs text-text-dark-secondary">{gap.evidenceIds.join(" · ")}</p>
        {(brief || t2) && (stored ? <a className={`mt-3 ${ACTION}`} href={localePath(locale, brief ? "/tools/geo-brief" : "/tools/page-citability-check?handoff=geo-gap")} onClick={(event) => {
          let saved = false;
          try { saved = writeGeoGapHandoff(sessionStorage, { destination, runId: report.manifest.runId, kbId: report.manifest.kbId, snapshotId: report.manifest.snapshotId, questionId: gap.questionId, gapId: gap.id, pageUrl: brief ? null : gap.pageUrl, questionText: brief ? null : question.text }); } catch { /* Session storage can be unavailable. */ }
          if (!saved) { event.preventDefault(); setFailed(true); }
        }}>{t(brief ? "gaps.actions.brief" : "gaps.actions.citability")}</a> : <p className="mt-3 text-sm text-text-dark-secondary">{t("gaps.notStored")}</p>)}
        {gap.kind === "C" && gap.action === "third_party" && <button type="button" className={`mt-3 ${ACTION}`} onClick={() => {
          const markdown = thirdPartyGapMarkdown(report, gap.id, locale);
          if (markdown === null) { setFailed(true); return; }
          const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" })), link = document.createElement("a");
          link.href = url; link.download = `geo-third-party-${report.manifest.runId}-${gap.questionId}.md`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>{t("gaps.actions.thirdParty")}</button>}
      </article>;
    })}</div>
    {failed && <p className="mt-3 text-sm text-brand-error" role="alert">{t("gaps.handoffFailed")}</p>}
  </section>;
}
