// @input  -- one v3 competitor gap row, the viewer locale, and the tool translator
// @output -- competitor rank chips linked to known pages, the own-site GSC status cell, and tone-graded opportunity signal chips carrying the pre-screen basis as a visible badge
// @pos    -- stateless row cells for the Marketing competitor gap results table

import type {
  CompetitorKeywordGapPreScreenBand,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import {
  bestCompetitorTrafficEstimate,
  competitorLink,
  snapshotDate,
} from "./competitor-keyword-gap-competitor-pages";
import {
  chipTone,
  COLUMN_BADGE,
  COLUMN_BADGE_TONE,
  DATA_CHIP,
  META_TEXT,
  number,
  pagePath,
  TABLE_TEXT,
  translated,
  type ChipTone,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

export function CompetitorChips({
  row,
}: {
  readonly row: CompetitorKeywordGapRow;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {Object.entries(row.competitorRanks)
        .sort(([, a], [, b]) => a - b)
        .map(([domain, rank]) => {
          const href = competitorLink(row, domain);
          const className = `${DATA_CHIP} ${chipTone("neutral")} max-w-[260px] truncate`;
          // Belt and braces on the separator. Flex `gap` opens the visual space
          // but a whitespace-only node between flex items is not rendered, and
          // the literal space survives in textContent -- where a screen reader
          // and a copy-paste read "alpha.example #4" rather than one token.
          // The width is still bounded, but by truncation rather than the
          // `break-all` that used to sit here: that split ordinary domains
          // mid-label at normal widths, while truncation only touches the
          // pathological ones and keeps the whole value in the title.
          const body = (
            <>
              <span className="text-text-dark-secondary">{domain}</span>{" "}
              <b className="font-semibold text-text-dark-primary">#{rank}</b>
            </>
          );
          return href === null ? (
            <span
              key={domain}
              data-competitor-rank={domain}
              title={`${domain} #${rank}`}
              className={className}
            >
              {body}
            </span>
          ) : (
            <a
              key={domain}
              data-competitor-rank={domain}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={row.competitorPages[domain]?.title ?? `${domain} #${rank}`}
              className={`${className} transition hover:border-brand-accent-text`}
            >
              {body}
            </a>
          );
        })}
    </div>
  );
}

function statusTone(
  status: CompetitorKeywordGapRow["gsc"]["queryStatus"],
): string {
  switch (status) {
    case "observed_strong":
      return "border-brand-success/35 bg-brand-success/10 text-brand-success";
    case "observed_weak":
      return "border-brand-warning/35 bg-brand-warning/10 text-brand-warning";
    case "not_observed_in_gsc_query_sample":
      return "border-brand-error/25 bg-brand-error/[0.06] text-brand-error";
    case "gsc_query_sample_not_read":
      return "border-brand-border-strong bg-brand-panel-sunken text-text-dark-secondary";
  }
}

/**
 * The position the pill will compose into its label, or null.
 *
 * One predicate for both the label and the title that qualifies it. Deciding
 * them separately would let a pill showing no number carry a title explaining
 * how that number was averaged.
 */
function pillPosition(gsc: CompetitorKeywordGapRow["gsc"]): number | null {
  const observed =
    gsc.queryStatus === "observed_strong" ||
    gsc.queryStatus === "observed_weak";
  return observed ? gsc.queryPosition : null;
}

/**
 * The pill carries the average position, and nothing else repeats it.
 *
 * The state and the position answer one question -- "where am I on this query?"
 * -- and this column is read in one pass down the table, so keeping them on two
 * lines made a reader assemble every row twice. The position is composed onto
 * an OBSERVED state only: the other two states carry no position by contract,
 * and a separator with nothing after it reads as a number that failed to
 * render.
 *
 * `not_observed_in_gsc_query_sample` reads "not in sample", never "not
 * covered". Anonymized queries are absent from this bounded sample entirely, so
 * absence from it is not absence from Search -- which is exactly what this
 * report's own evidence boundaries say two cards further down.
 */
function statusLabel(
  gsc: CompetitorKeywordGapRow["gsc"],
  locale: string,
  t: Translate,
): string {
  const state = translated(t, `gsc.${gsc.queryStatus}`);
  const position = pillPosition(gsc);
  return position === null
    ? state
    : t("gsc.statusWithPosition", {
        status: state,
        position: number(position, locale, 1),
      });
}

/**
 * What Search Console attributed to a PAGE for this query, under the pill that
 * states the query itself.
 *
 * Kept apart from the pill because the two answer different questions and can
 * disagree: a query observed on one page still carries a partial attribution,
 * and the page's own average position is not the query's. The page number is
 * rendered only on `query_page` evidence, which is the only basis under which
 * the contract fills it in.
 */
function PageEvidence({
  gsc,
  locale,
  t,
}: {
  readonly gsc: CompetitorKeywordGapRow["gsc"];
  readonly locale: string;
  readonly t: Translate;
}) {
  const queryObserved =
    gsc.queryStatus === "observed_strong" ||
    gsc.queryStatus === "observed_weak";
  const pageObserved =
    gsc.pageStatus === "observed_sufficient" ||
    gsc.pageStatus === "observed_partial";
  const observedPath = pageObserved ? pagePath(gsc.pageUrl) : null;

  return (
    <>
      {gsc.evidenceBasis === "query_page" ? (
        <div className={`mt-2 ${META_TEXT} text-text-dark-secondary`}>
          {translated(t, "gsc.evidenceBasis.query_page")}
        </div>
      ) : null}
      {pageObserved || queryObserved ? (
        <div className={`mt-2 ${META_TEXT} text-text-dark-secondary`}>
          {translated(t, `gsc.pageStatus.${gsc.pageStatus}`)}
          {observedPath === null ? "" : ` · ${observedPath}`}
        </div>
      ) : null}
      {gsc.evidenceBasis === "query_page" &&
      gsc.pageImpressions !== null &&
      gsc.pagePosition !== null ? (
        <div
          data-gsc-metrics="query-page"
          className={`mt-1 ${META_TEXT} text-text-dark-secondary`}
        >
          {t("gsc.pageMetricLine", {
            impressions: number(gsc.pageImpressions, locale),
            position: number(gsc.pagePosition, locale, 1),
          })}
        </div>
      ) : null}
    </>
  );
}

export function StatusCell({
  row,
  locale,
  t,
}: {
  readonly row: CompetitorKeywordGapRow;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { gsc } = row;
  const label = statusLabel(gsc, locale, t);
  const basis =
    gsc.evidenceBasis === null
      ? null
      : translated(t, `gsc.evidenceBasis.${gsc.evidenceBasis}`);
  // "Already ranking · avg position 4.0" reads as a fact about Search right
  // now. It is one number averaged over a 28-day window that ends three days
  // before today, weighted by impressions. The qualification goes in the
  // accessible name as well as the hover: the pill is a plain div with no
  // tabIndex, so a keyboard user can never surface a title, and an explicit
  // aria-label suppresses the title as a description -- leaving exactly the
  // unqualified present-tense claim for the readers least able to check it.
  const positionTitle =
    pillPosition(gsc) === null ? null : translated(t, "gsc.positionTitle");
  /**
   * "Not in sample" says where we looked, and readers hear "not covered".
   *
   * The label stays as it is -- this column can only see a bounded 28-day
   * Search Console sample, and anonymized queries never enter that sample at
   * all, so "not covered" would state a fact this tool cannot have. What the
   * label could not carry on its own is what the absence DOES mean, which is
   * the sentence below.
   */
  const sampleTitle =
    gsc.queryStatus === "not_observed_in_gsc_query_sample"
      ? translated(t, "gsc.notObservedTitle")
      : null;
  const qualifications = [positionTitle, sampleTitle].filter(
    (part) => part !== null,
  );
  const title = qualifications.length === 0 ? null : qualifications.join(" · ");

  return (
    <>
      <div
        data-gsc-status
        aria-label={[label, basis, ...qualifications]
          .filter((part) => part !== null)
          .join(" · ")}
        {...(title === null ? {} : { title })}
        className={`inline-flex rounded-full border px-2.5 py-1 ${META_TEXT} ${statusTone(gsc.queryStatus)}`}
      >
        {label}
      </div>
      {gsc.queryImpressions === null ? null : (
        <div
          data-gsc-metrics="query"
          className={`mt-2 ${TABLE_TEXT} text-text-dark-primary`}
        >
          {t("gsc.impressionsLine", {
            impressions: number(gsc.queryImpressions, locale),
          })}
        </div>
      )}
      <PageEvidence gsc={gsc} locale={locale} t={t} />
    </>
  );
}

/**
 * The band decides how loud its own chip is, because the band is already an
 * ordering statement in words ("check the SERP first", "defer"). The tone only
 * makes that ordering scannable; the title still carries the basis, and none of
 * it claims the keyword can be won.
 */
function bandTone(band: CompetitorKeywordGapPreScreenBand): ChipTone {
  switch (band) {
    case "prioritize_serp_check":
      return "positive";
    case "defer_head_term":
    case "defer_brand_navigational":
      return "muted";
    case "stretch":
    case "unbanded":
      return "neutral";
  }
}

export function SignalChips({
  row,
  locale,
  t,
}: {
  readonly row: CompetitorKeywordGapRow;
  readonly locale: string;
  readonly t: Translate;
}) {
  const aiOverview =
    row.serpSnapshot?.itemTypes.includes("ai_overview") ?? false;
  const snapshotAt = snapshotDate(row.serpSnapshot?.updatedAt ?? null, locale);
  const traffic = bestCompetitorTrafficEstimate(row);
  const basis = translated(t, `preScreen.basis.${row.preScreen.basis}`);
  const reason = translated(t, `preScreen.reason.${row.preScreen.reason}`);
  return (
    <div className={`flex flex-wrap gap-1.5 ${META_TEXT}`}>
      <span
        data-pre-screen={row.preScreen.band}
        title={`${basis} ${reason}`}
        className={`${DATA_CHIP} ${chipTone(bandTone(row.preScreen.band))}`}
      >
        {translated(t, `preScreen.band.${row.preScreen.band}`)}
        {/* The basis rides on the chip, not on the column header. Three of the
            reasons that produce a band are this tool's own text and URL
            heuristics rather than provider estimates, so one badge over the
            whole column would state the wrong source for those rows. */}
        <span
          data-pre-screen-basis={row.preScreen.basis}
          className={`${COLUMN_BADGE} ${COLUMN_BADGE_TONE[row.preScreen.basis === "dfs_estimate" ? "dfs" : "tool"]}`}
        >
          {translated(t, `preScreen.basisShort.${row.preScreen.basis}`)}
        </span>
      </span>
      <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
        {t("signals.bestRank", { rank: row.bestCompetitorRank })}
      </span>
      <span className={`${DATA_CHIP} ${chipTone("neutral")}`}>
        {t("signals.difficulty", {
          value:
            row.keywordDifficulty.value === null
              ? "—"
              : number(row.keywordDifficulty.value, locale),
        })}
      </span>
      {aiOverview ? (
        // Amber, because an AI Overview above the results is a cost to plan
        // around. The chip still only states that the stored snapshot carried
        // one, on the date it names.
        <span
          data-serp-snapshot="ai_overview"
          className={`${DATA_CHIP} ${chipTone("caution")}`}
        >
          {snapshotAt === null
            ? t("signals.aiOverviewSnapshotUndated")
            : t("signals.aiOverviewSnapshot", { date: snapshotAt })}
        </span>
      ) : null}
      {traffic !== null ? (
        <span
          data-competitor-traffic
          className={`${DATA_CHIP} ${chipTone("neutral")}`}
        >
          {t("signals.competitorTraffic", { value: number(traffic, locale) })}
        </span>
      ) : null}
    </div>
  );
}
