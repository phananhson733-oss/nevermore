"use client";

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  Minus,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

import {
  LimitationHint,
  Spinner,
  StatusPill,
  type StatusTone,
} from "@/components/ui";
import { useMeasurementTargetKeywordRanks } from "@/lib/api/hooks-results-keyword-ranks";
import type {
  GrowthMapCoverageAvailability,
} from "@sf/contracts";

import {
  targetKeywordGrowthMapHref,
  targetKeywordRankLimitationKey,
  targetKeywordRankRow,
  type TargetKeywordRankRow,
} from "./_target-keyword-ranks-view-model";
import styles from "./results.module.css";

const COVERAGE_TONE: Readonly<
  Record<GrowthMapCoverageAvailability, StatusTone>
> = {
  available: "success",
  partial: "warning",
  stale: "warning",
  unavailable: "neutral",
};

function rankValue(value: number | null, unavailable: string): string {
  return value === null ? unavailable : String(value);
}

function RankChange({
  row,
}: {
  readonly row: TargetKeywordRankRow;
}) {
  const t = useTranslations("results.measurement.targetKeywordRanks");
  if (row.improvement === null) {
    return (
      <span
        className={styles.targetRankChange}
        data-trend="unavailable"
      >
        {t("notAvailable")}
      </span>
    );
  }
  if (row.trend === "improved") {
    return (
      <span
        className={styles.targetRankChange}
        data-trend="improved"
      >
        <ArrowUp aria-hidden="true" size={15} />
        {t("improvedBy", { count: row.improvement })}
      </span>
    );
  }
  if (row.trend === "regressed") {
    return (
      <span
        className={styles.targetRankChange}
        data-trend="regressed"
      >
        <ArrowDown aria-hidden="true" size={15} />
        {t("regressedBy", { count: Math.abs(row.improvement) })}
      </span>
    );
  }
  return (
    <span
      className={styles.targetRankChange}
      data-trend={row.trend}
    >
      <Minus aria-hidden="true" size={15} />
      {t("unchanged")}
    </span>
  );
}

export function TargetKeywordRanks({
  projectId,
  measurementWindowId,
}: {
  readonly projectId: string;
  readonly measurementWindowId: string;
}) {
  const t = useTranslations("results.measurement.targetKeywordRanks");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const query = useMeasurementTargetKeywordRanks(
    projectId,
    measurementWindowId,
  );

  return (
    <section
      className={styles.targetRanks}
      aria-labelledby={`target-keyword-ranks-${measurementWindowId}`}
    >
      <header className={styles.targetRanksHeader}>
        <span className={styles.metricSectionIcon}>
          <Target aria-hidden="true" size={20} />
        </span>
        <div>
          <div className={styles.metricSectionTitle}>
            <h3 id={`target-keyword-ranks-${measurementWindowId}`}>
              {t("title")}
            </h3>
            {query.data ? (
              <StatusPill
                tone={COVERAGE_TONE[query.data.coverage.availability]}
              >
                {t(
                  `coverage.${query.data.coverage.availability}`,
                )}
              </StatusPill>
            ) : null}
          </div>
          <p>{t("lead")}</p>
        </div>
      </header>

      {query.isPending ? (
        <div className={styles.targetRanksState} role="status">
          <Spinner label={t("loading")} size="sm" />
          <span>{t("loading")}</span>
        </div>
      ) : query.isError ? (
        <div className={styles.targetRanksState} role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <span>{t("error")}</span>
          <button type="button" onClick={() => void query.refetch()}>
            {t("retry")}
          </button>
        </div>
      ) : query.data.keywords.length === 0 ? (
        <div className={styles.targetRanksEmpty}>
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>{t("emptyTitle")}</strong>
            <p>{t("emptyBody")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.targetRanksTableScroll}>
            <table className={styles.targetRanksTable}>
              <thead>
                <tr>
                  <th scope="col">{t("table.keyword")}</th>
                  <th scope="col">{t("table.topic")}</th>
                  <th scope="col">{t("table.before")}</th>
                  <th scope="col">{t("table.after")}</th>
                  <th scope="col">{t("table.change")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.keywords.map((keyword) => {
                  const row = targetKeywordRankRow(keyword);
                  return (
                    <tr key={row.keywordId}>
                      <th scope="row">
                        <Link
                          href={targetKeywordGrowthMapHref(
                            projectId,
                            row.keywordId,
                          )}
                        >
                          <span>{row.keyword}</span>
                          <ArrowRight
                            aria-hidden="true"
                            size={15}
                          />
                        </Link>
                        <small>
                          {row.marketCode} · {row.languageTag}
                        </small>
                      </th>
                      <td>{row.topic}</td>
                      <td>
                        {rankValue(
                          row.baselineRank,
                          t("notAvailable"),
                        )}
                      </td>
                      <td>
                        {rankValue(
                          row.outcomeRank,
                          t("notAvailable"),
                        )}
                      </td>
                      <td>
                        <RankChange row={row} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.targetRanksTimestamp}>
            {t("generatedAt", {
              value: new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(query.data.generatedAt)),
            })}
          </p>
        </>
      )}

      {query.data && query.data.coverage.limitations.length > 0 ? (
        <div className={styles.targetRanksLimitations}>
          <LimitationHint
            label={tCommon("limitations")}
            limitations={query.data.coverage.limitations.map((limitation) =>
              t(`limitation.${targetKeywordRankLimitationKey(limitation)}`),
            )}
          />
        </div>
      ) : null}

      <p className={styles.targetRanksNote}>{t("nonCausal")}</p>
    </section>
  );
}
