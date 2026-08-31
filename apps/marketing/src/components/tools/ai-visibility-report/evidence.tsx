"use client";
// @input -- retained answer/source evidence, or explicit historical count-only questions
// @output -- compact accessible disclosures without equating missing evidence with absence
// @pos -- bounded evidence reader; provider content is rendered only as text
import { useTranslations } from "next-intl";
import type { VisibilityCitedDomain, VisibilityQuestionResult, VisibilitySample } from "../../../lib/geo-tools/visibility-contract.ts";
import type { VisibilityQuestionCounts } from "../../../lib/geo-tools/visibility-store.ts";
import type { VisibilitySampleV2 } from "../../../lib/geo-tools/visibility-v2-contract.ts";
import { CELL, EvidenceLinks, HEAD, NOTE, PANEL, SectionTitle, SUMMARY, TableScroll } from "./primitives.tsx";

export function SourceTable({ domains, truncated = false }: { readonly domains: readonly VisibilityCitedDomain[]; readonly truncated?: boolean }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  return <section className={PANEL} data-section="sources">
    <SectionTitle title={t("sourcesTitle")} note={t("sourcesHelp")} count={domains.length} />
    {truncated && <p className={`mb-4 border-l-2 border-brand-border-strong pl-3 ${NOTE}`}>{t("sourceTruncated")}</p>}
    {domains.length === 0 ? <p className={NOTE}>{t("noSources")}</p> : <TableScroll><table className="w-full min-w-[480px] border-collapse">
      <caption className="sr-only">{t("sourcesTitle")}</caption>
      <thead><tr className="border-b border-brand-border-strong">{["domain", "answers", "role"].map((key) => <th key={key} className={HEAD} scope="col">{t(key)}</th>)}</tr></thead>
      <tbody>{domains.map((domain) => <tr key={domain.domain} className="border-b border-brand-border-card last:border-0">
        <th className={`${CELL} w-[65%] font-normal`} scope="row">
          <span className="font-mono text-sm">{domain.domain}</span>
          {domain.sampleUrls.length === 0 ? <p className={`mt-2 ${NOTE}`}>{t("sourceUrlsUnavailable")}</p> : <details className="mt-2">
            <summary className={`${SUMMARY} text-xs text-text-dark-secondary`}>{t("sourcePages", { count: domain.sampleUrls.length })}</summary>
            <div className="mt-3 max-w-lg"><EvidenceLinks urls={domain.sampleUrls} /></div>
          </details>}
        </th>
        <td className={`${CELL} font-mono tabular-nums`}>{domain.answers}</td>
        <td className={CELL}><span className={`text-xs ${domain.isOwn ? "text-brand-accent-text" : "text-text-dark-secondary"}`}>{shared(`domains.role.${domain.isOwn ? "own" : domain.isCompetitor ? "competitor" : "other"}`)}</span></td>
      </tr>)}</tbody>
    </table></TableScroll>}
  </section>;
}

function SampleEvidence({ sample }: { readonly sample: VisibilitySample | VisibilitySampleV2 }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  const detailed = "engine" in sample ? sample : null;
  return <li data-sample={detailed?.slotId ?? `v1:${sample.questionId}:${sample.sampleIndex}`} className="min-w-0 border border-brand-border-card bg-brand-panel p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-mono text-xs text-text-dark-secondary">{detailed === null ? "ChatGPT" : detailed.engine === "chatgpt" ? "ChatGPT" : "Perplexity"} · {shared("questions.sampleLabel", { index: sample.sampleIndex })}</p>
      <p className={NOTE}>{shared(`questions.sampleStatus.${sample.status}`)} · {shared(sample.webSearchPerformed === null ? "questions.sampleSearchUnknown" : sample.webSearchPerformed ? "questions.sampleSearched" : "questions.sampleNoSearch")}</p>
    </div>
    {sample.status !== "ok" ? <p className={`mt-3 ${NOTE}`}>{shared("questions.sampleNoAnswer")}</p> : <>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={`border px-2 py-1 ${sample.mentioned ? "border-brand-accent-text/30 text-brand-accent-text" : "border-brand-border-card text-text-dark-secondary"}`}>{t(sample.mentioned ? "brandMentioned" : "brandNotMentioned")}</span>
        <span className="border border-brand-border-card px-2 py-1 text-text-dark-secondary">{t(sample.cited === null ? "citationUnavailable" : sample.cited ? "brandCited" : "brandNotCited")}</span>
      </div>
      {detailed !== null && <div className="mt-4">
        <h5 className="text-xs font-medium text-text-dark-secondary">{t("answerExcerpt")}</h5>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-dark-primary">{detailed.answerExcerpt ?? t("answerUnavailable")}</p>
        {detailed.answerExcerptTruncated && <p className={`mt-2 ${NOTE}`}>{t("answerTruncated")}</p>}
      </div>}
      {sample.mentioned && <div className="mt-4 border-l-2 border-brand-accent-text pl-3">
        <h5 className="text-xs font-medium text-brand-accent-text">{t("mentionExcerpt")}</h5>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-dark-primary">{sample.excerpt ?? t(detailed?.excerptOmitted ? "excerptOmitted" : "excerptUnavailable")}</p>
      </div>}
      {detailed === null && !sample.mentioned && <p className={`mt-3 ${NOTE}`}>{t("answerUnavailable")}</p>}
      <div className="mt-4 grid gap-4 border-t border-brand-border-card pt-4 md:grid-cols-2">
        <div>
          <h5 className="mb-2 text-xs font-medium text-text-dark-secondary">{t("citationUrls")}</h5>
          {sample.cited === null ? <p className={NOTE}>{t("citationUnavailable")}</p> : sample.citedUrls.length === 0 ? <p className={NOTE}>{t("noRetainedUrls")}</p> : <EvidenceLinks urls={sample.citedUrls} />}
          {sample.citedDomains.length > 0 && <p className={`mt-2 break-words ${NOTE}`}>{shared("questions.citedDomains", { domains: sample.citedDomains.join(" · ") })}</p>}
          {detailed !== null && <>
            {detailed.citedUrlsOmitted !== null && detailed.citedUrlsOmitted > 0 && <p className={`mt-2 ${NOTE}`}>{t("urlsOmitted", { count: detailed.citedUrlsOmitted })}</p>}
            {detailed.citedDomainsOmitted !== null && detailed.citedDomainsOmitted > 0 && <p className={`mt-2 ${NOTE}`}>{t("domainsOmitted", { count: detailed.citedDomainsOmitted })}</p>}
          </>}
        </div>
        <div>
          {sample.competitorsMentioned.length > 0 && <p className={NOTE}>{shared("questions.competitors", { names: sample.competitorsMentioned.join(" · ") })}</p>}
          {detailed !== null && <>
            <p className={`mt-2 ${NOTE}`}>{detailed.listPosition === null ? t("ownPositionUnavailable") : t("ownPosition", { position: detailed.listPosition })}</p>
            {detailed.competitorPositions !== null && detailed.competitorPositions.length > 0 && <>
              <h5 className="mt-3 text-xs font-medium text-text-dark-secondary">{t("competitorPositions")}</h5>
              <ul className={`mt-2 grid gap-1 ${NOTE}`}>{detailed.competitorPositions.map((position) => <li key={position.brandName}>{t("competitorPosition", { name: position.brandName, position: position.position })}</li>)}</ul>
            </>}
            {detailed.subtopics !== null && detailed.subtopics.length > 0 && <p className={`mt-3 ${NOTE}`}>{t("topics")}: {detailed.subtopics.join(" · ")}</p>}
            {detailed.subtopicsOmitted !== null && detailed.subtopicsOmitted > 0 && <p className={`mt-2 ${NOTE}`}>{t("topicsOmitted", { count: detailed.subtopicsOmitted })}</p>}
          </>}
        </div>
      </div>
    </>}
  </li>;
}

export function QuestionEvidence({ questions }: { readonly questions: readonly (VisibilityQuestionResult | VisibilityQuestionCounts)[] }) {
  const t = useTranslations("tools.aiVisibility.report"), shared = useTranslations("tools.aiVisibility");
  return <section className={PANEL} data-section="questions">
    <SectionTitle title={t("questionsTitle")} note={t("questionsHelp")} count={questions.length} />
    <div className="divide-y divide-brand-border-card">{questions.map((question) => <details key={question.questionId} className="group py-4 first:pt-0 last:pb-0">
      <summary className={`${SUMMARY} list-none [&::-webkit-details-marker]:hidden`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="break-words text-sm font-medium leading-relaxed">{question.text}</h4>
            <p className={`mt-2 ${NOTE}`}>{shared(`layers.names.${question.layer}`)} · {t(question.mode === "retrieval" ? "retrieval" : "demand")}{question.prompted ? ` · ${shared("questions.promptedTag")}` : ""}{"calibrated" in question ? ` · ${t(question.calibrated ? "calibrated" : "uncalibrated")}` : ""}</p>
            {question.answered === 0 ? <p className={`mt-2 ${NOTE}`}>{shared("questions.noAnswers")}</p> : <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dark-secondary">
              <span>{shared("questions.mentionCount", { mentioned: question.mentioned, answered: question.answered })}</span>
              <span>{question.mode === "demand" ? shared("questions.demandCitationNote", { cited: question.cited }) : question.citationEvaluable === 0 ? shared("questions.citationNotEvaluable") : shared("questions.citationCount", { cited: question.cited, evaluable: question.citationEvaluable })}</span>
            </div>}
          </div>
          <span aria-hidden="true" className="mt-1 shrink-0 font-mono text-lg text-brand-accent-text transition-transform group-open:rotate-45">+</span>
        </div>
      </summary>
      <div className="mt-4">
        {"citationUnknown" in question && question.citationUnknown > 0 && <p className={`mb-3 ${NOTE}`}>{shared("questions.citationUnknown", { count: question.citationUnknown })}</p>}
        {"samples" in question && question.samples.length > 0 ? <ul className="grid gap-3">{question.samples.map((sample) => <SampleEvidence key={`${"engine" in sample ? String(sample.engine) : "v1"}:${sample.questionId}:${sample.sampleIndex}`} sample={sample} />)}</ul> : question.answered > 0 ? <p className={NOTE}>{t("historicalSamplesUnavailable")}</p> : null}
      </div>
    </details>)}</div>
  </section>;
}
