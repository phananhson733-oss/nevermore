// @input  -- one ContentBrief and the viewer locale
// @output -- the full result surface in handoff §4.7 order, or coverage-only when the
//            run had no SERP to build a brief from
// @pos    -- non-persistent result surface for the Marketing Content Brief Builder

"use client";

import { useTranslations } from "next-intl";
import type { ContentBrief } from "@sf/public-tools/content-brief/contract";

import { EvidenceCoverage } from "./content-brief-evidence-coverage";
import { FieldCards } from "./content-brief-field-cards";
import { GapAngleCard } from "./content-brief-gap-angle-card";
import { LinksCards } from "./content-brief-links-cards";
import { MustAnswerList } from "./content-brief-must-answer-list";
import { OutlineList } from "./content-brief-outline-list";
import { ReadinessBar } from "./content-brief-readiness-bar";
import { RunHeader } from "./content-brief-run-header";
import { VerdictCard } from "./content-brief-verdict-card";
import { WontSayFooter } from "./content-brief-wont-say-footer";

export function ContentBriefResults({
  brief,
  locale,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
}) {
  const t = useTranslations("tools.contentBrief");
  // No SERP means no brief body: the engine could not have derived a format,
  // an intent, a page to fetch or a question. Everything below the coverage
  // strip would be a row of "unavailable" cards restating the same fact.
  const bodiless = brief.run.mode === "unavailable";
  return (
    <div
      data-content-brief-results
      data-run-mode={brief.run.mode}
      className="mt-6 space-y-4"
    >
      <RunHeader brief={brief} locale={locale} t={t} />
      <EvidenceCoverage brief={brief} locale={locale} t={t} />
      {bodiless ? null : (
        <>
          <VerdictCard brief={brief} locale={locale} t={t} />
          <FieldCards brief={brief} locale={locale} t={t} />
          <MustAnswerList brief={brief} locale={locale} t={t} />
          <OutlineList brief={brief} locale={locale} t={t} />
          <GapAngleCard brief={brief} locale={locale} t={t} />
          <LinksCards brief={brief} locale={locale} t={t} />
          <ReadinessBar brief={brief} t={t} />
        </>
      )}
      <WontSayFooter t={t} />
    </div>
  );
}
