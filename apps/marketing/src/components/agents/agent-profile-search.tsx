// @input  -- controlled profile-search evidence, local review callbacks, and localized copy
// @output -- source-bounded candidate rows and explicit direct/indirect/exclude decisions
// @pos    -- Stage 03 review block; never fetches or persists an app Product Profile

"use client";

import {
  CircleAlert,
  DatabaseZap,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useId } from "react";

import {
  type AgentProfileSearchData,
} from "../../lib/agents/profile-search-contract";
import {
  deriveAgentCompetitorDisplayFrame,
  deriveAgentCompetitorSuggestions,
  resolveAgentCompetitorClassification,
  type AgentCompetitorClassification,
  type AgentCompetitorClassifications,
  type AgentCompetitorSuggestion,
} from "./agent-competitor-candidates";

export interface AgentProfileSearchCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly loadingAction: string;
  readonly organicBoundary: string;
  readonly serpBoundary: string;
  readonly seedSerpBoundary: string;
  readonly noData: string;
  readonly marketUnsupported: string;
  readonly sourceUnavailable: string;
  readonly requestError: string;
  readonly domainLabel: string;
  readonly intersectionsLabel: string;
  readonly averagePositionLabel: string;
  readonly medianPositionLabel: string;
  readonly ratingLabel: string;
  readonly trafficLabel: string;
  readonly keywordsCountLabel: string;
  readonly visibilityLabel: string;
  readonly relevantSerpItemsLabel: string;
  readonly rankLabel: string;
  readonly observedAtLabel: string;
  readonly unavailableMetricLabel: string;
  readonly providerCountLabel: string;
  readonly confirmedCountLabel: string;
  readonly excludedCountLabel: string;
  readonly providerEvidenceLabel: string;
  readonly seedSerpEvidenceLabel: string;
  readonly suggestedDirectLabel: string;
  readonly suggestedIndirectLabel: string;
  readonly higherOverlapLabel: string;
  readonly adjacentOverlapLabel: string;
  readonly unclassifiedLabel: string;
  readonly seedSerpObservedLabel: string;
  readonly currentDirectLabel: string;
  readonly currentIndirectLabel: string;
  readonly currentExcludedLabel: string;
  readonly directAction: string;
  readonly indirectAction: string;
  readonly excludeAction: string;
}

export type AgentProfileSearchClassifications =
  AgentCompetitorClassifications;

export interface AgentProfileSearchProps {
  readonly locale?: string;
  readonly loading: boolean;
  readonly data: AgentProfileSearchData | null;
  readonly errorCode: string | null;
  readonly onDiscover: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly reviewDisabled?: boolean;
  readonly suggestions?: readonly AgentCompetitorSuggestion[];
  readonly classifications?: AgentProfileSearchClassifications;
  readonly onClassify?: (
    domain: string,
    classification: AgentCompetitorClassification,
  ) => void;
  readonly copy: AgentProfileSearchCopy;
}

function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
      value,
    );
  } catch {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
      value,
    );
  }
}

function formatFetchedAt(value: string | null, locale: string): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const options = { dateStyle: "medium", timeStyle: "short" } as const;
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(date);
  }
}

function formatMetric(
  value: number | null,
  locale: string,
  unavailableLabel: string,
): string {
  return value === null ? unavailableLabel : formatNumber(value, locale);
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="min-w-0 border-l border-brand-border-faint pl-2.5 first:border-l-0 first:pl-0">
      <dt className="font-mono text-[8px] leading-[1.35] tracking-[0.07em] text-text-dark-faint uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[11px] text-text-dark-primary">
        {value}
      </dd>
    </div>
  );
}

function AvailabilityNotice({
  availability,
  message,
}: {
  readonly availability: Exclude<
    AgentProfileSearchData["availability"],
    "available"
  >;
  readonly message: string;
}) {
  return (
    <div
      data-profile-search-results={availability}
      role="status"
      className="flex min-w-0 items-start gap-2.5 rounded-row border border-brand-border bg-brand-panel px-3.5 py-3"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-brand-warning"
      />
      <p className="min-w-0 text-[11.5px] leading-[1.55] text-text-dark-secondary">
        {message}
      </p>
    </div>
  );
}

export function AgentProfileSearch({
  locale = "en",
  loading,
  data,
  errorCode,
  onDiscover,
  disabled = false,
  disabledReason,
  reviewDisabled = false,
  suggestions,
  classifications = { direct: [], indirect: [], excluded: [] },
  onClassify,
  copy,
}: AgentProfileSearchProps) {
  const titleId = useId();
  const resultsId = useId();
  const disabledReasonId = useId();
  const actionDisabled = disabled || loading;
  const formattedFetchedAt = formatFetchedAt(data?.observedAt ?? null, locale);
  const boundary =
    data?.method === "target_query_serp"
      ? copy.serpBoundary
      : data?.method === "serp_competitors"
        ? copy.seedSerpBoundary
        : copy.organicBoundary;
  const reviewSuggestions =
    suggestions ??
    (data ? deriveAgentCompetitorSuggestions(data, data.targetHost) : []);
  const displayFrame = deriveAgentCompetitorDisplayFrame(
    reviewSuggestions,
    classifications,
  );
  const confirmedCount =
    displayFrame.direct.length + displayFrame.indirect.length;
  const excludedCount = displayFrame.excluded.length;

  return (
    <section
      data-profile-search
      aria-labelledby={titleId}
      className="min-w-0 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken"
    >
      <div className="grid min-w-0 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-5">
        <div className="min-w-0">
          <h4
            id={titleId}
            className="mt-2 text-[14px] font-semibold text-text-dark-primary"
          >
            {copy.title}
          </h4>
          <p className="mt-1.5 max-w-2xl text-[11.5px] leading-[1.6] text-text-dark-secondary">
            {copy.description}
          </p>
        </div>

        <div className="min-w-0 md:max-w-[18rem] md:text-right">
          <button
            type="button"
            onClick={onDiscover}
            disabled={actionDisabled}
            aria-busy={loading}
            aria-controls={resultsId}
            aria-describedby={
              disabled && disabledReason ? disabledReasonId : undefined
            }
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[9px] border border-brand-accent/45 bg-brand-accent/[0.09] px-4 text-[11.5px] font-semibold text-brand-accent-text transition-colors hover:bg-brand-accent/[0.15] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-55 md:w-auto"
          >
            {loading ? (
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Search aria-hidden="true" className="size-3.5" />
            )}
            {loading ? copy.loadingAction : copy.action}
          </button>
          {disabled && disabledReason ? (
            <p
              id={disabledReasonId}
              className="mt-2 text-[10px] leading-[1.45] text-brand-warning"
            >
              {disabledReason}
            </p>
          ) : null}
        </div>
      </div>

      <div
        id={resultsId}
        aria-live="polite"
        className={
          errorCode || data
            ? "min-w-0 border-t border-brand-border-faint px-4 py-3.5 md:px-5"
            : "sr-only"
        }
      >
        {errorCode ? (
          <div
            data-profile-search-error={errorCode}
            role="alert"
            className="flex min-w-0 items-start gap-2.5 rounded-row border border-brand-error/25 bg-brand-error/[0.06] px-3.5 py-3"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-brand-error"
            />
            <p className="min-w-0 text-[11.5px] leading-[1.55] text-brand-error">
              {copy.requestError}
            </p>
          </div>
        ) : data?.availability === "available" ? (
          <div data-profile-search-results="available" className="min-w-0">
            <div className="flex min-w-0 flex-col gap-2.5 border-b border-brand-border-faint pb-3 sm:flex-row sm:items-start sm:justify-between">
              <p className="shrink-0 font-mono text-[8.5px] tracking-[0.05em] text-text-dark-faint">
                {data.targetHost} · {data.market.code}
              </p>
            </div>

            <dl className="mt-3 grid min-w-0 grid-cols-3 overflow-hidden rounded-md border border-brand-border-faint bg-brand-bg">
              {(
                [
                  ["provider", copy.providerCountLabel, reviewSuggestions.length],
                  ["confirmed", copy.confirmedCountLabel, confirmedCount],
                  ["excluded", copy.excludedCountLabel, excludedCount],
                ] as const
              ).map(([kind, label, count]) => (
                <div
                  key={kind}
                  data-profile-competitor-count={kind}
                  className="min-w-0 border-l border-brand-border-faint px-2.5 py-2.5 first:border-l-0 sm:px-3"
                >
                  <dt className="truncate font-mono text-[8px] tracking-[0.07em] text-text-dark-faint uppercase">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[15px] font-semibold text-text-dark-primary">
                    {count}
                  </dd>
                </div>
              ))}
            </dl>

            <ol className="mt-1 min-w-0 divide-y divide-brand-border-faint">
              {reviewSuggestions.map((suggestion) => {
                const resolution = resolveAgentCompetitorClassification(
                  suggestion,
                  classifications,
                );
                const { classification } = resolution;
                const statusLabel =
                  resolution.source === "system"
                    ? classification === "direct"
                      ? copy.suggestedDirectLabel
                      : copy.suggestedIndirectLabel
                    : classification === "direct"
                      ? copy.currentDirectLabel
                      : classification === "indirect"
                        ? copy.currentIndirectLabel
                        : copy.currentExcludedLabel;
                const bucketLabel =
                  suggestion.reviewBucket === "higher_overlap"
                    ? copy.higherOverlapLabel
                    : suggestion.evidenceKind ===
                        "profile_seed_serp_competitor"
                      ? copy.seedSerpObservedLabel
                    : suggestion.reviewBucket === "adjacent_overlap"
                      ? copy.adjacentOverlapLabel
                      : copy.unclassifiedLabel;
                const providerEvidenceLabel =
                  suggestion.evidenceKind ===
                  "profile_seed_serp_competitor"
                    ? copy.seedSerpEvidenceLabel
                    : copy.providerEvidenceLabel;
                return (
                  <li
                    key={suggestion.domain}
                    data-profile-competitor-candidate={suggestion.domain}
                    className="grid min-w-0 gap-3 py-3.5"
                  >
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center">
                      <div className="min-w-0">
                        <p className="font-mono text-[8px] tracking-[0.08em] text-text-dark-faint uppercase">
                          {copy.domainLabel}
                        </p>
                        <p
                          data-profile-search-domain
                          className="mt-1 min-w-0 break-all font-mono text-[11.5px] text-text-dark-strong"
                        >
                          {suggestion.domain}
                        </p>
                        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                          <span className="rounded border border-brand-info/25 bg-brand-info/[0.06] px-1.5 py-0.5 font-mono text-[8px] leading-[1.35] tracking-[0.04em] text-brand-info uppercase">
                            {providerEvidenceLabel}
                          </span>
                          <span className="rounded border border-brand-warning/25 bg-brand-warning/[0.06] px-1.5 py-0.5 font-mono text-[8px] leading-[1.35] tracking-[0.04em] text-brand-warning uppercase">
                            {bucketLabel}
                          </span>
                        </div>
                      </div>

                      {suggestion.evidenceKind ===
                      "organic_search_overlap" ? (
                        <dl className="grid min-w-0 grid-cols-1 gap-2 min-[440px]:grid-cols-2 sm:grid-cols-3">
                          <Metric
                            label={copy.intersectionsLabel}
                            value={formatMetric(
                              suggestion.metrics.intersections,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.averagePositionLabel}
                            value={formatMetric(
                              suggestion.metrics.averagePosition,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.trafficLabel}
                            value={formatMetric(
                              suggestion.metrics.organicEstimatedTrafficVolume,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                        </dl>
                      ) : suggestion.evidenceKind ===
                          "profile_seed_serp_competitor" ? (
                        <dl className="grid min-w-0 grid-cols-1 gap-2 min-[440px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                          <Metric
                            label={copy.averagePositionLabel}
                            value={formatMetric(
                              suggestion.metrics.averagePosition,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.medianPositionLabel}
                            value={formatMetric(
                              suggestion.metrics.medianPosition,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.ratingLabel}
                            value={formatMetric(
                              suggestion.metrics.rating,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.trafficLabel}
                            value={formatMetric(
                              suggestion.metrics.organicEstimatedTrafficVolume,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.keywordsCountLabel}
                            value={formatMetric(
                              suggestion.metrics.keywordsCount,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.visibilityLabel}
                            value={formatMetric(
                              suggestion.metrics.visibility,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                          <Metric
                            label={copy.relevantSerpItemsLabel}
                            value={formatMetric(
                              suggestion.metrics.relevantSerpItems,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                        </dl>
                      ) : (
                        <dl className="min-w-0">
                          <Metric
                            label={copy.rankLabel}
                            value={formatMetric(
                              suggestion.metrics.rank,
                              locale,
                              copy.unavailableMetricLabel,
                            )}
                          />
                        </dl>
                      )}
                    </div>

                    <div className="grid min-w-0 gap-2 rounded-md border border-brand-border-faint bg-brand-panel px-2.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <p
                        data-profile-competitor-classification={
                          classification
                        }
                        data-profile-competitor-classification-source={
                          resolution.source
                        }
                        className="min-w-0 text-[10px] leading-[1.45] text-text-dark-secondary"
                      >
                        {statusLabel}
                      </p>
                      <div className="grid min-w-0 grid-cols-3 gap-1.5">
                        {(
                          [
                            ["direct", copy.directAction],
                            ["indirect", copy.indirectAction],
                            ["excluded", copy.excludeAction],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            data-profile-competitor-action={value}
                            aria-label={`${label}: ${suggestion.domain}`}
                            aria-pressed={classification === value}
                            disabled={reviewDisabled || !onClassify}
                            onClick={() =>
                              onClassify?.(suggestion.domain, value)
                            }
                            className="min-w-0 rounded border border-brand-border-strong bg-brand-bg px-2 py-1.5 text-[9.5px] font-medium text-text-dark-secondary transition-colors hover:border-brand-accent/45 hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-accent aria-pressed:border-brand-accent/45 aria-pressed:bg-brand-accent/[0.09] aria-pressed:text-brand-accent-text disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="block truncate">{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {formattedFetchedAt ? (
              <p className="border-t border-brand-border-faint pt-2.5 font-mono text-[9px] tracking-[0.04em] text-text-dark-faint">
                {copy.observedAtLabel}: {formattedFetchedAt}
              </p>
            ) : null}
          </div>
        ) : data?.availability === "no_data" ? (
          <div className="min-w-0">
            <p className="mb-2.5 text-[10.5px] leading-[1.5] text-brand-warning">
              {boundary}
            </p>
            <AvailabilityNotice
              availability="no_data"
              message={copy.noData}
            />
            {formattedFetchedAt ? (
              <p className="mt-2.5 font-mono text-[9px] tracking-[0.04em] text-text-dark-faint">
                {copy.observedAtLabel}: {formattedFetchedAt}
              </p>
            ) : null}
          </div>
        ) : data?.availability === "market_unsupported" ? (
          <AvailabilityNotice
            availability="market_unsupported"
            message={copy.marketUnsupported}
          />
        ) : data?.availability === "source_unavailable" ? (
          <AvailabilityNotice
            availability="source_unavailable"
            message={copy.sourceUnavailable}
          />
        ) : null}
      </div>
    </section>
  );
}
