// @input  -- controlled Agent profile-search state, callback, and localized copy
// @output -- bounded search-evidence rows with honest availability boundaries
// @pos    -- presentational Stage 01 enrichment block; never fetches or mutates profile state

"use client";

import {
  CircleAlert,
  DatabaseZap,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useId } from "react";

import type { AgentProfileSearchData } from "../../lib/agents/profile-search-contract";

export interface AgentProfileSearchCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly loadingAction: string;
  readonly organicBoundary: string;
  readonly serpBoundary: string;
  readonly noData: string;
  readonly marketUnsupported: string;
  readonly sourceUnavailable: string;
  readonly requestError: string;
  readonly domainLabel: string;
  readonly intersectionsLabel: string;
  readonly averagePositionLabel: string;
  readonly trafficLabel: string;
  readonly rankLabel: string;
  readonly observedAtLabel: string;
}

export interface AgentProfileSearchProps {
  readonly locale?: string;
  readonly loading: boolean;
  readonly data: AgentProfileSearchData | null;
  readonly errorCode: string | null;
  readonly onDiscover: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
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
      : copy.organicBoundary;

  return (
    <section
      data-profile-search
      aria-labelledby={titleId}
      className="min-w-0 overflow-hidden rounded-row border border-brand-border bg-brand-panel-sunken"
    >
      <div className="grid min-w-0 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[8.5px] tracking-[0.1em] text-brand-accent-text uppercase">
            <DatabaseZap aria-hidden="true" className="size-3" />
            {copy.eyebrow}
          </p>
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
              <p className="min-w-0 text-[10.5px] leading-[1.5] text-brand-warning">
                {boundary}
              </p>
              <p className="shrink-0 font-mono text-[8.5px] tracking-[0.05em] text-text-dark-faint">
                {data.targetHost} · {data.market.code}
              </p>
            </div>

            <ol className="mt-1 min-w-0 divide-y divide-brand-border-faint">
              {data.rows.map((row) => (
                <li
                  key={row.domain}
                  className="grid min-w-0 gap-3 py-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[8px] tracking-[0.08em] text-text-dark-faint uppercase">
                      {copy.domainLabel}
                    </p>
                    <p
                      data-profile-search-domain
                      className="mt-1 min-w-0 break-all font-mono text-[11.5px] text-text-dark-strong"
                    >
                      {row.domain}
                    </p>
                  </div>

                  {row.kind === "organic_search_overlap" ? (
                    <dl className="grid min-w-0 grid-cols-1 gap-2 min-[440px]:grid-cols-2 sm:grid-cols-3">
                      <Metric
                        label={copy.intersectionsLabel}
                        value={formatNumber(row.intersections, locale)}
                      />
                      <Metric
                        label={copy.averagePositionLabel}
                        value={formatNumber(row.averagePosition, locale)}
                      />
                      <Metric
                        label={copy.trafficLabel}
                        value={formatNumber(
                          row.organicEstimatedTrafficVolume,
                          locale,
                        )}
                      />
                    </dl>
                  ) : (
                    <dl className="min-w-0">
                      <Metric
                        label={copy.rankLabel}
                        value={formatNumber(row.rank, locale)}
                      />
                    </dl>
                  )}
                </li>
              ))}
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
