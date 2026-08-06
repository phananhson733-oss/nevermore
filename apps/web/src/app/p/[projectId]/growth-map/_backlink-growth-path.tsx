"use client";

import type {
  BacklinkMetric,
  BacklinkSnapshotSource,
} from "@sf/contracts";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Database,
  Link2,
  Radar,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LimitationHint, Spinner } from "@/components/ui";
import { useGrowthMapBacklinks } from "@/lib/api/hooks-growth-map-backlinks";
import { ProblemState } from "../_problem-display.tsx";
import { executionHrefForRef } from "../execution/_execution-deep-link.ts";
import {
  backlinkAuthorityPresentation,
  backlinkMetricPresentation,
  backlinkPageHref,
} from "./_backlink-growth-path-view-model.ts";
import styles from "./backlink-growth-path.module.css";

function formatNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function formatDate(locale: string, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function Metric({
  metric,
  label,
}: {
  readonly metric: BacklinkMetric;
  readonly label: string;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.backlinks");
  const presentation = backlinkMetricPresentation(metric);
  return (
    <dl className={styles.metric}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.metricValue}>
          {presentation.kind === "unavailable"
            ? t("metricUnavailable")
            : formatNumber(locale, presentation.value)}
        </span>
        <small>
          {presentation.kind === "provider_total"
            ? t("providerTotal")
            : presentation.kind === "observed_count"
              ? t("observedCount")
              : t("notCollected")}
        </small>
      </dd>
    </dl>
  );
}

function Authority({
  source,
}: {
  readonly source: BacklinkSnapshotSource;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.backlinks");
  const metric = backlinkAuthorityPresentation(source);
  return (
    <dl className={styles.metric}>
      <dt>
        {metric?.kind === "domain_authority"
          ? t("domainAuthority")
          : t("domainRating")}
      </dt>
      <dd>
        <span className={styles.metricValue}>
          {metric === null
            ? t("metricUnavailable")
            : formatNumber(locale, metric.value)}
        </span>
        <small>
          {metric === null ? t("providerOnly") : t("providerObserved")}
        </small>
      </dd>
    </dl>
  );
}

function SourceBadge({
  source,
}: {
  readonly source: BacklinkSnapshotSource;
}) {
  const t = useTranslations("growthMap.backlinks");
  return (
    <span className={styles.sourceBadge} data-source-kind={source.sourceKind}>
      {t(`source.${source.sourceKind}`)}
      <small>{t(`provider.${source.provider}`)}</small>
    </span>
  );
}

export function BacklinkGrowthPath({
  projectId,
}: {
  readonly projectId: string;
}) {
  const locale = useLocale();
  const t = useTranslations("growthMap.backlinks");
  const query = useGrowthMapBacklinks(projectId);

  if (query.isPending) {
    return (
      <section className={styles.state} data-backlink-growth-path role="status">
        <Spinner label={t("loading")} size="lg" />
        <p>{t("loading")}</p>
      </section>
    );
  }
  if (query.isError) {
    return (
      <ProblemState
        error={query.error}
        message={t("error")}
        onRetry={() => void query.refetch()}
        className={styles.state}
      />
    );
  }

  const model = query.data;
  const primary = model.primarySite;
  if (primary === null) {
    return (
      <section className={styles.unavailable} data-backlink-growth-path>
        <div className={styles.unavailableMark}>
          <Radar aria-hidden="true" size={28} />
        </div>
        <div>
          <span>{t("eyebrow")}</span>
          <h2>{t("unavailableTitle")}</h2>
          <LimitationHint
            label={t("dataBoundary")}
            limitations={model.coverage.limitations}
          />
          <small>{t("unavailableBoundary")}</small>
        </div>
      </section>
    );
  }

  const comparableIds = new Set(
    model.comparison.competitorSnapshotIds,
  );
  return (
    <div className={styles.path} data-backlink-growth-path>
      <section className={styles.hero}>
        <div className={styles.heroIntro}>
          <span>
            <Link2 aria-hidden="true" size={17} />
            {t("eyebrow")}
          </span>
          <h2>{t("title")}</h2>
          <p>{t("description")}</p>
        </div>
        <div className={styles.heroSource}>
          <SourceBadge source={primary} />
          <time dateTime={primary.capturedAt}>
            {t("capturedAt", {
              date: formatDate(locale, primary.capturedAt),
            })}
          </time>
        </div>
      </section>

      <section className={styles.summary} aria-label={t("siteSummary")}>
        <div className={styles.summaryIdentity}>
          <small>{t("currentSite")}</small>
          <strong>{primary.subjectName}</strong>
          <span>{primary.domain}</span>
        </div>
        <div className={styles.metrics}>
          <Metric metric={primary.backlinks} label={t("backlinks")} />
          <Metric
            metric={primary.referringDomains}
            label={t("referringDomains")}
          />
          <Authority source={primary} />
        </div>
      </section>

      {model.coverage.limitations.length === 0 ? null : (
        <section className={styles.boundary} aria-label={t("dataBoundary")}>
          <LimitationHint
            label={t("dataBoundary")}
            limitations={model.coverage.limitations}
          />
        </section>
      )}

      <section className={styles.opportunities}>
        <header className={styles.sectionHeader}>
          <div>
            <span>{t("opportunityEyebrow")}</span>
            <h3>{t("opportunityTitle")}</h3>
          </div>
          <strong>{model.opportunities.length}</strong>
        </header>
        {model.opportunities.length === 0 ? (
          <p className={styles.empty}>
            <CheckCircle2 aria-hidden="true" size={18} />
            {t("noOpportunity")}
          </p>
        ) : (
          <div className={styles.opportunityGrid}>
            {model.opportunities.map((opportunity) => (
              <article
                key={opportunity.opportunityKey}
                className={styles.opportunity}
                data-severity={opportunity.severity}
              >
                <div className={styles.opportunityHeading}>
                  <CircleAlert aria-hidden="true" size={19} />
                  <span>{t(`severity.${opportunity.severity}`)}</span>
                </div>
                <h4>{opportunity.title}</h4>
                <p>{opportunity.summary}</p>
                <div className={styles.opportunityActions}>
                  {opportunity.sitePageId === null ? (
                    <span>{t("siteLevelOpportunity")}</span>
                  ) : (
                    <Link
                      href={backlinkPageHref(
                        projectId,
                        opportunity.sitePageId,
                      )}
                    >
                      {t("openPage")}
                      <ArrowRight aria-hidden="true" size={16} />
                    </Link>
                  )}
                  {opportunity.executionRef === null ? (
                    <small>{t("awaitingExecution")}</small>
                  ) : (
                    <Link
                      href={executionHrefForRef(
                        projectId,
                        opportunity.executionRef,
                      )}
                    >
                      {t("openExecution")}
                      <ArrowUpRight aria-hidden="true" size={16} />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel}>
          <header className={styles.sectionHeader}>
            <div>
              <span>{t("pagesEyebrow")}</span>
              <h3>{t("pagesTitle")}</h3>
            </div>
            <strong>{model.pages.length}</strong>
          </header>
          {model.pages.length === 0 ? (
            <p className={styles.empty}>{t("noPages")}</p>
          ) : (
            <ul className={styles.pageList}>
              {model.pages.map((page) => (
                <li key={page.sitePageId}>
                  <Link href={backlinkPageHref(projectId, page.sitePageId)}>
                    <span>
                      <strong>{page.title ?? page.canonicalUrl}</strong>
                      <small>{new URL(page.canonicalUrl).pathname}</small>
                    </span>
                    <div className={styles.pageMetrics}>
                      <Metric metric={page.backlinks} label={t("backlinks")} />
                      <Metric
                        metric={page.referringDomains}
                        label={t("referringDomains")}
                      />
                    </div>
                    <ArrowRight aria-hidden="true" size={17} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.panel}>
          <header className={styles.sectionHeader}>
            <div>
              <span>{t("competitorEyebrow")}</span>
              <h3>{t("competitorTitle")}</h3>
            </div>
            <strong>{model.approvedCompetitors.length}</strong>
          </header>
          {model.comparison.state === "comparable" ? (
            <p className={styles.comparisonReady}>
              <CheckCircle2 aria-hidden="true" size={17} />
              {t("comparisonReady", {
                provider:
                  model.comparison.provider === "ahrefs"
                    ? "Ahrefs"
                    : "Moz",
              })}
            </p>
          ) : (
            <div className={styles.comparisonLimited}>
              <LimitationHint
                label={t("dataBoundary")}
                limitations={
                  model.comparison.limitation === null
                    ? []
                    : [model.comparison.limitation]
                }
              />
            </div>
          )}
          <ul className={styles.competitorList}>
            {model.approvedCompetitors.map((competitor) => (
              <li
                key={competitor.snapshotId}
                data-comparable={
                  comparableIds.has(competitor.snapshotId) ? "" : undefined
                }
              >
                <div>
                  <strong>{competitor.subjectName}</strong>
                  <small>{competitor.domain}</small>
                </div>
                <Metric
                  metric={competitor.referringDomains}
                  label={t("referringDomains")}
                />
                <Authority source={competitor} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className={styles.twoColumn}>
        <section className={styles.panel}>
          <header className={styles.sectionHeader}>
            <div>
              <span>{t("domainEyebrow")}</span>
              <h3>{t("domainTitle")}</h3>
            </div>
            <strong>{model.referringDomains.length}</strong>
          </header>
          <ul className={styles.domainList}>
            {model.referringDomains.map((domain) => (
              <li key={`${domain.snapshotId}:${domain.domain}`}>
                <div>
                  <strong>{domain.domain}</strong>
                  <small>{new URL(domain.topTargetUrl).pathname}</small>
                </div>
                <span>
                  {t("observedLinks", {
                    count: domain.observedBacklinks,
                  })}
                </span>
                <small>
                  {domain.authorityMetric === null
                    ? t("authorityNotProvided")
                    : `${domain.authorityMetric.kind === "domain_rating" ? "DR" : "DA"} ${formatNumber(locale, domain.authorityMetric.value)}`}
                </small>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <header className={styles.sectionHeader}>
            <div>
              <span>{t("sourceEyebrow")}</span>
              <h3>{t("sourceTitle")}</h3>
            </div>
            <Database aria-hidden="true" size={20} />
          </header>
          <ul className={styles.sourceList}>
            {model.sources.map((source) => (
              <li key={source.snapshotId}>
                <SourceBadge source={source} />
                <div>
                  <strong>{source.subjectName}</strong>
                  <small>{source.domain}</small>
                </div>
                <details>
                  <summary>{t("traceability")}</summary>
                  <code title={source.trace.sourceRef}>
                    {source.trace.sourceRef}
                  </code>
                  <span>
                    {t("rowCount", { count: source.trace.rowCount })}
                  </span>
                </details>
              </li>
            ))}
          </ul>
          <p className={styles.connectionBoundary}>
            {t("connectionBoundary")}
          </p>
        </section>
      </div>
    </div>
  );
}
