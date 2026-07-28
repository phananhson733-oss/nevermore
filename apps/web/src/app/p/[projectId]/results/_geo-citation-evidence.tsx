"use client";

import type {
  GeoCitationEvidencePhase,
  GeoCitationPlatform,
} from "@sf/contracts";
import {
  CircleAlert,
  ExternalLink,
  Link2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  Spinner,
  StatusPill,
  type StatusTone,
} from "@/components/ui";
import { useMeasurementGeoCitations } from "@/lib/api/hooks-results-geo-citations";

import type { MeasurementDimensionView } from "./_measurement-view-model";
import styles from "./results.module.css";

const STATE_TONE: Readonly<
  Record<MeasurementDimensionView["state"], StatusTone>
> = {
  observed: "success",
  insufficient_data: "warning",
  unavailable: "neutral",
  regressed: "danger",
};

function platformLabel(
  platform: GeoCitationPlatform,
  t: ReturnType<typeof useTranslations>,
): string {
  return platform.kind === "known"
    ? t(`geoEvidence.platform.${platform.key}`)
    : t("geoEvidence.otherPlatform", {
        provider: platform.providerKey,
      });
}

function PhaseEvidence({
  phase,
  value,
}: {
  readonly phase: "baseline" | "outcome";
  readonly value: GeoCitationEvidencePhase | null;
}) {
  const t = useTranslations("results.measurement");
  const locale = useLocale();
  if (value === null) {
    return (
      <section className={styles.geoPhase} data-availability="unavailable">
        <header>
          <h4>{t(`geoEvidence.phase.${phase}`)}</h4>
          <StatusPill tone="neutral">
            {t("geoEvidence.phaseUnavailable")}
          </StatusPill>
        </header>
        <p>{t("geoEvidence.phaseUnavailableBody")}</p>
      </section>
    );
  }

  const citationCount = value.queries.reduce(
    (count, query) => count + query.citations.length,
    0,
  );
  return (
    <section className={styles.geoPhase} data-availability="available">
      <header>
        <h4>{t(`geoEvidence.phase.${phase}`)}</h4>
        <span>
          {t("geoEvidence.phaseSummary", {
            queries: value.queries.length,
            citations: citationCount,
          })}
        </span>
      </header>
      <div className={styles.geoQueryList}>
        {value.queries.map((query) => (
          <details className={styles.geoQuery} key={query.id}>
            <summary>
              <span>
                <strong>{query.query}</strong>
                <small>
                  {platformLabel(query.platform, t)} · {query.model}
                </small>
              </span>
              <StatusPill
                tone={
                  query.citationState === "cited"
                    ? "success"
                    : query.citationState === "unavailable"
                      ? "neutral"
                      : "warning"
                }
              >
                {t(
                  `geoEvidence.citationState.${query.citationState}`,
                )}
              </StatusPill>
            </summary>

            <dl className={styles.geoQueryMeta}>
              <div>
                <dt>{t("geoEvidence.platformLabel")}</dt>
                <dd>{platformLabel(query.platform, t)}</dd>
              </div>
              <div>
                <dt>{t("geoEvidence.modelLabel")}</dt>
                <dd>{query.model}</dd>
              </div>
              <div>
                <dt>{t("geoEvidence.collectorLabel")}</dt>
                <dd>
                  {query.collector.providerKey} ·{" "}
                  {query.collector.version}
                </dd>
              </div>
              <div>
                <dt>{t("geoEvidence.collectedAt")}</dt>
                <dd>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(query.collectedAt))}
                </dd>
              </div>
              <div>
                <dt>{t("geoEvidence.marketLanguage")}</dt>
                <dd>
                  {query.marketCode} · {query.languageTag}
                </dd>
              </div>
            </dl>

            {query.answerEvidence ? (
              <blockquote className={styles.geoAnswerEvidence}>
                <span>{t("geoEvidence.answerExcerpt")}</span>
                <p>{query.answerEvidence.excerpt}</p>
                <code>
                  {query.answerEvidence.selector} ·{" "}
                  {query.answerEvidence.contentHash.slice(0, 12)}
                </code>
              </blockquote>
            ) : null}

            {query.citations.length > 0 ? (
              <ol className={styles.geoCitations}>
                {query.citations.map((citation) => (
                  <li key={citation.id}>
                    <header>
                      <strong>
                        {t("geoEvidence.citationOrdinal", {
                          ordinal: citation.citationOrdinal,
                        })}
                      </strong>
                      <a
                        href={citation.citationUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t("geoEvidence.openCitation")}
                        <ExternalLink aria-hidden="true" size={14} />
                      </a>
                    </header>
                    <dl>
                      <div>
                        <dt>{t("geoEvidence.answerCitationExcerpt")}</dt>
                        <dd>{citation.answerEvidenceExcerpt}</dd>
                      </div>
                      <div>
                        <dt>{t("geoEvidence.citedPageExcerpt")}</dt>
                        <dd>{citation.citedPageExcerpt}</dd>
                      </div>
                      <div>
                        <dt>{t("geoEvidence.paragraphIdentity")}</dt>
                        <dd>
                          <code>
                            {citation.citedParagraphSelector}
                            {citation.citedParagraphIndex === null
                              ? ""
                              : ` · #${citation.citedParagraphIndex}`}
                            {" · "}
                            {citation.citedParagraphHash.slice(0, 12)}
                          </code>
                        </dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.geoNoCitation}>
                {t("geoEvidence.noDirectCitation")}
              </p>
            )}

            {(query.evidenceStatements ?? []).length > 0 ? (
              <section
                className={styles.geoStructureEvidence}
                aria-label={t("geoEvidence.structureTitle")}
              >
                <header>
                  <strong>{t("geoEvidence.structureTitle")}</strong>
                  <small>{t("geoEvidence.structureBoundary")}</small>
                </header>
                <ul>
                  {(query.evidenceStatements ?? []).map(
                    (statement, index) => (
                      <li
                        key={`${statement.evidence.contentHash}:${statement.evidence.selector}:${index}`}
                      >
                        <StatusPill
                          tone={
                            statement.classification === "observation"
                              ? "success"
                              : "warning"
                          }
                        >
                          {t(
                            `geoEvidence.structureClassification.${statement.classification}`,
                          )}
                        </StatusPill>
                        <p>{statement.statement}</p>
                        <blockquote>
                          <span>
                            {t("geoEvidence.structureEvidenceExcerpt")}
                          </span>
                          <p>{statement.evidence.excerpt}</p>
                          <code>
                            {statement.evidence.selector} ·{" "}
                            {statement.evidence.contentHash.slice(0, 12)}
                          </code>
                        </blockquote>
                        {statement.limitation === null ? null : (
                          <small>{statement.limitation}</small>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ) : null}

            {query.limitation ? (
              <p className={styles.geoQueryLimitation}>
                <CircleAlert aria-hidden="true" size={15} />
                {query.limitation}
              </p>
            ) : null}
          </details>
        ))}
      </div>
    </section>
  );
}

export function GeoCitationEvidence({
  projectId,
  measurementWindowId,
  dimension,
}: {
  readonly projectId: string;
  readonly measurementWindowId: string;
  readonly dimension: MeasurementDimensionView;
}) {
  const t = useTranslations("results.measurement");
  const query = useMeasurementGeoCitations(
    projectId,
    measurementWindowId,
  );

  return (
    <section
      className={styles.geoEvidence}
      aria-labelledby={`geo-citation-evidence-${measurementWindowId}`}
    >
      <header className={styles.geoEvidenceHeader}>
        <span className={styles.metricSectionIcon}>
          <Link2 aria-hidden="true" size={20} />
        </span>
        <div>
          <div className={styles.metricSectionTitle}>
            <h3 id={`geo-citation-evidence-${measurementWindowId}`}>
              {t("geoTitle")}
            </h3>
            <StatusPill tone={STATE_TONE[dimension.state]}>
              {t(`observationState.${dimension.state}`)}
            </StatusPill>
          </div>
          <p>{t("geoEvidence.lead")}</p>
        </div>
      </header>

      <div className={styles.geoMetricTableScroll}>
        <table className={styles.geoMetricTable}>
          <thead>
            <tr>
              <th scope="col">{t("table.metric")}</th>
              <th scope="col">{t("table.before")}</th>
              <th scope="col">{t("table.after")}</th>
              <th scope="col">{t("table.change")}</th>
            </tr>
          </thead>
          <tbody>
            {dimension.metrics.map((metric) => (
              <tr key={metric.key}>
                <th scope="row">{t(`metric.${metric.key}`)}</th>
                <td>{metric.baseline ?? t("notAvailable")}</td>
                <td>{metric.outcome ?? t("notAvailable")}</td>
                <td>{metric.delta ?? t("notAvailable")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {query.isPending ? (
        <div className={styles.geoEvidenceState} role="status">
          <Spinner label={t("geoEvidence.loading")} size="sm" />
          <span>{t("geoEvidence.loading")}</span>
        </div>
      ) : query.isError ? (
        <div className={styles.geoEvidenceState} role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <span>{t("geoEvidence.error")}</span>
          <button type="button" onClick={() => void query.refetch()}>
            {t("geoEvidence.retry")}
          </button>
        </div>
      ) : (
        <div className={styles.geoPhases}>
          <PhaseEvidence
            phase="baseline"
            value={query.data.phases.baseline}
          />
          <PhaseEvidence
            phase="outcome"
            value={query.data.phases.outcome}
          />
        </div>
      )}

      {query.data?.limitation ?? dimension.limitation ? (
        <p className={styles.geoEvidenceLimitation}>
          <CircleAlert aria-hidden="true" size={16} />
          {query.data?.limitation ?? dimension.limitation}
        </p>
      ) : null}
      <p className={styles.geoEvidenceNonCausal}>
        {t("geoEvidence.nonCausal")}
      </p>
    </section>
  );
}
