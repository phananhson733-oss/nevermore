// @input  -- one ContentBrief's verdict, its GSC read meta, and the tool translator
// @output -- the create / update / undecidable card with the existing page named
// @pos    -- the top card of the brief body; framed in STATUS colour, never source colour

import type {
  ContentBrief,
  Verdict,
} from "@sf/public-tools/content-brief/contract";
import {
  GSC_LOOKBACK_DAYS,
  SELF_COMPETE_MAX_POSITION,
  SELF_COMPETE_MIN_IMPRESSIONS,
} from "@sf/public-tools/content-brief/constants";

import {
  BODY_TEXT,
  DATA_CHIP,
  MONO_FIGURE,
  PILL,
  chipTone,
  number,
  pagePath,
  safePageUrl,
  translated,
  type Translate,
} from "./content-brief-results-shared";
import { SourceChip } from "./content-brief-source-chip";

/**
 * The frame says which of three states the verdict is in, in the status
 * palette the rest of the site uses for states. `update` is the one that
 * changes what the visitor should do next, so it gets the accent; `create`
 * is the expected case; `undecidable` is a caution, not an error -- the
 * brief still exists, it just cannot answer this one question.
 */
const FRAME: Readonly<Record<Verdict["action"], string>> = {
  undecidable:
    "rounded-card border border-brand-warning/35 bg-brand-warning/[0.06] p-[22px] md:p-[26px]",
  create:
    "rounded-card border border-brand-success/35 bg-brand-success/[0.05] p-[22px] md:p-[26px]",
  update:
    "rounded-card border border-brand-info/40 bg-brand-info/[0.06] p-[22px] md:p-[26px]",
};

const TONE: Readonly<Record<Verdict["action"], string>> = {
  undecidable: chipTone("caution"),
  create: chipTone("positive"),
  update: "border-brand-info/35 bg-brand-info/[0.10] text-brand-info",
};

function lookbackDays(brief: ContentBrief): number {
  const gsc = brief.run.reads.gsc;
  return gsc.status === "unavailable" ? GSC_LOOKBACK_DAYS : gsc.window.lookback_days;
}

function PageLink({ page }: { readonly page: string }) {
  const href = safePageUrl(page);
  const label = pagePath(page) ?? page;
  return href === null ? (
    <span className="break-all font-mono text-[12.5px] text-text-dark-primary">
      {label}
    </span>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all font-mono text-[12.5px] text-text-dark-primary underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );
}

function ExistingPage({
  page,
  impressions,
  position,
  rows,
  rowsWithPosition,
  locale,
  t,
}: {
  readonly page: string;
  readonly impressions: number;
  readonly position: number | null;
  readonly rows: number;
  readonly rowsWithPosition: number;
  readonly locale: string;
  readonly t: Translate;
}) {
  return (
    <div
      data-verdict-existing
      className="mt-4 rounded-[10px] border border-brand-border-card bg-brand-bg p-4"
    >
      <div className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
        {t("verdict.existing")}
      </div>
      <div className="mt-1">
        <PageLink page={page} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
          {t("verdict.impressions", { count: number(impressions, locale) })}
        </span>
        <span
          data-verdict-position={position === null ? "unavailable" : "available"}
          className={`${DATA_CHIP} ${chipTone(position === null ? "muted" : "neutral")}`}
        >
          {position === null
            ? t("verdict.positionUnavailable")
            : t("verdict.position", { value: number(position, locale, 1) })}
        </span>
        {rowsWithPosition < rows ? (
          <span
            data-verdict-rows-with-position
            className={`${DATA_CHIP} ${chipTone("caution")}`}
          >
            {t("verdict.rowsWithPosition", {
              withPosition: rowsWithPosition,
              rows,
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function verdictBody(
  verdict: Verdict,
  brief: ContentBrief,
  locale: string,
  t: Translate,
): string {
  const key = `verdict.${verdict.action}.${verdict.reason}`;
  const days = lookbackDays(brief);
  switch (verdict.action) {
    case "undecidable":
      return translated(t, key);
    case "create":
      if (verdict.reason === "not_observed") {
        return translated(t, key, { days });
      }
      if (verdict.reason === "below_impression_floor") {
        return translated(t, key, {
          days,
          minImpressions: SELF_COMPETE_MIN_IMPRESSIONS,
        });
      }
      return translated(t, key, {
        page: pagePath(verdict.existing.page) ?? verdict.existing.page,
        position: number(verdict.existing.avg_position, locale, 1),
        maxPosition: SELF_COMPETE_MAX_POSITION,
      });
    case "update":
      return translated(t, key, {
        page: pagePath(verdict.target_url) ?? verdict.target_url,
        position: number(verdict.observed.avg_position, locale, 1),
        impressions: number(verdict.observed.impressions, locale),
        maxPosition: SELF_COMPETE_MAX_POSITION,
      });
  }
}

export function VerdictCard({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { verdict } = brief;
  const gsc = brief.run.reads.gsc;
  const existing =
    verdict.action === "update"
      ? {
          page: verdict.target_url,
          impressions: verdict.observed.impressions,
          position: verdict.observed.avg_position,
          rows: verdict.observed.rows,
          rowsWithPosition: verdict.observed.rows_with_position,
        }
      : verdict.action === "create" && verdict.existing !== null
        ? {
            page: verdict.existing.page,
            impressions: verdict.existing.impressions,
            position: verdict.existing.avg_position,
            rows: verdict.existing.rows,
            rowsWithPosition: verdict.existing.rows_with_position,
          }
        : null;
  return (
    <section
      data-verdict-card
      data-verdict-action={verdict.action}
      data-verdict-reason={verdict.reason}
      className={FRAME[verdict.action]}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
            {t("verdict.title")}
          </span>
          <span className={`${PILL} ${TONE[verdict.action]}`}>
            {translated(t, `verdict.${verdict.action}.title`)}
          </span>
        </div>
        {verdict.provenance !== null ? (
          <SourceChip provenance={verdict.provenance} t={t} locale={locale} />
        ) : null}
      </div>
      <h3
        data-verdict-title
        className="mt-3 text-[20px] font-semibold tracking-[-0.03em] text-text-dark-primary"
      >
        {translated(t, `verdict.${verdict.action}.title`)}
      </h3>
      <p data-verdict-body className={`mt-2 ${BODY_TEXT}`}>
        {verdictBody(verdict, brief, locale, t)}
      </p>
      {verdict.action === "update" ? (
        <p data-verdict-no-rewrite className={`mt-2 ${BODY_TEXT}`}>
          {t("verdict.update.v1NoRewrite")}
        </p>
      ) : null}
      {existing !== null ? (
        <ExistingPage {...existing} locale={locale} t={t} />
      ) : null}
      {gsc.status !== "unavailable" ? (
        <p data-verdict-matched-queries className={`mt-3 ${MONO_FIGURE} text-[11.5px] text-text-dark-secondary`}>
          {t("verdict.matchedQueries", { count: gsc.matched_queries })}
        </p>
      ) : null}
    </section>
  );
}
