"use client";

/**
 * Canonical Results screen: one evidence workspace aligned to the customer
 * Artifact, followed by the independently-loaded client report and export
 * rail. The evidence workspace keeps technical rechecks and observational
 * measurement contracts distinct while presenting them as one Results story.
 */

import { useTranslations } from "next-intl";

import type { ActionRecheckAccepted } from "@/lib/api/hooks-results";

import { MeasurementResultsSection } from "./_measurement-results.tsx";
import { ReportSection } from "./_report-section.tsx";
import styles from "./results.module.css";

export type { ActionRecheckAccepted };

export function ResultsClient({
  projectId,
  initialOutputLocale,
}: {
  readonly projectId: string;
  readonly initialOutputLocale?: string | undefined;
}) {
  const t = useTranslations("results");
  return (
    <div className={styles.page} data-results-page="">
      <header
        className={`${styles.hero} ${styles.screenOnly}`}
        data-results-page-hero=""
      >
        <div className={styles.heroText}>
          <span className={styles.heroEyebrow}>{t("pageEyebrow")}</span>
          <h1 className={styles.heroTitle} data-app-page-title="">
            {t("pageTitle")}
          </h1>
          <p className={styles.heroLead}>{t("pageLead")}</p>
        </div>
        <a
          className={styles.heroAction}
          href="#results-report"
          data-results-report-link=""
        >
          {t("openReport")}
        </a>
      </header>
      <MeasurementResultsSection projectId={projectId} />
      <ReportSection
        projectId={projectId}
        initialOutputLocale={initialOutputLocale}
      />
    </div>
  );
}
