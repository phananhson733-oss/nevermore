"use client";

// @input  -- one finished run: its extract, its score, and the results page read for it
// @output -- the report sections, in the order someone reads them
// @pos    -- everything derived from the crawl, before the visitor's own words
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";

import type { KeywordEvidence } from "@sf/public-tools/seo-audit/keyword-evidence/types";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools/seo-audit/types";
import type { SerpLandscape } from "../../lib/agents/audit-contract.ts";
import type { OnPageScore } from "../../lib/on-page-checker/scoring.ts";
import { OnPageScoreCard } from "./on-page-score-card.tsx";
import { OnPageCheckList } from "./on-page-check-list.tsx";
import { OnPageSerpPreview } from "./on-page-serp-preview.tsx";
import { OnPageTermTables } from "./on-page-term-tables.tsx";
import { OnPageSerpLandscape } from "./on-page-serp-landscape.tsx";

export function OnPageReportSections({
  extract,
  score,
  landscape,
  evidence,
}: {
  readonly extract: SeoAuditTargetPageExtract | null;
  readonly score: OnPageScore | null;
  readonly landscape: SerpLandscape | null;
  readonly evidence: KeywordEvidence;
}) {
  const t = useTranslations("tools.onPageChecker");
  const tTerms = useTranslations("tools.onPageChecker.terms");
  const tLandscape = useTranslations("tools.onPageChecker.landscape");

  return (
    <>
      {/*
        The score first, then what it is made of. A visitor who wants one
        number gets it without scrolling; a visitor who wants to check it
        has every check that produced it on the same screen.
      */}
      {score !== null && extract !== null && (
        <div className="grid gap-5">
          <OnPageScoreCard extract={extract} score={score} />
        </div>
      )}

      {extract !== null && (
        <section className="grid gap-3">
          <h3 className="text-[15px] text-text-dark-primary">
            {t("sections.previewHeading")}
          </h3>
          <OnPageSerpPreview extract={extract} />
        </section>
      )}

      {score !== null && (
        <section className="grid gap-3">
          <h3 className="text-[15px] text-text-dark-primary">
            {t("sections.checksHeading")}
          </h3>
          <OnPageCheckList categories={score.categories} />
        </section>
      )}

      {landscape !== null && (
        <section className="grid gap-3">
          <h3 className="text-[15px] text-text-dark-primary">
            {tLandscape("heading")}
          </h3>
          <OnPageSerpLandscape landscape={landscape} />
        </section>
      )}

      {/*
        What the page is about, before what it was asked about. The
        keyword table below answers "is my word here"; this one answers
        "what is here", which is the question a page that ranks for the
        wrong thing needs asked.
      */}
      {extract !== null && (
        <section className="grid gap-3">
          <h3 className="text-[15px] text-text-dark-primary">
            {tTerms("heading")}
          </h3>
          <OnPageTermTables extract={extract} evidence={evidence} />
        </section>
      )}
    </>
  );
}
