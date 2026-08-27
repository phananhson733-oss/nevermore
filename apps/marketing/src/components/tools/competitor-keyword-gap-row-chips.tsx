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
 * Whether Search Console returned this query at all.
 *
 * One predicate, in one place. It was written out twice in this file with
 * identical branch lists, so a fifth `queryStatus` value would have had to be
 * remembered in two spots -- the same reason `pageMetrics` below exists.
 */
function queryObserved(gsc: CompetitorKeywordGapRow["gsc"]): boolean {
  return (
    gsc.queryStatus === "observed_strong" || gsc.queryStatus === "observed_weak"
  );
}

/**
 * The position this row has to show, or null.
 *
 * One predicate for both the chip and the title that qualifies it. Deciding
 * them separately would let a chip showing no number carry a title explaining
 * how that number was averaged. It is read off an OBSERVED state only: the
 * other two carry no position by contract.
 *
 * Named for the query, not for a pill: the position has not rendered inside
 * the state pill since the two were split, and on `observed_weak` -- the state
 * most rows in this table are in -- there is no pill at all.
 */
function queryPosition(gsc: CompetitorKeywordGapRow["gsc"]): number | null {
  return queryObserved(gsc) ? gsc.queryPosition : null;
}

/**
 * The state, and nothing else.
 *
 * The average position used to be folded in here -- "has impressions - avg
 * position 83.1" -- with the impressions on a bare line underneath, so one
 * reading arrived attached to a state, the other loose, and neither looked
 * like the other. Both numbers are Search Console measurements of the same
 * kind; they belong in the same shape, beside the state rather than inside it.
 *
 * `not_observed_in_gsc_query_sample` reads "not in sample", never "not
 * covered". Anonymized queries are absent from this bounded sample entirely, so
 * absence from it is not absence from Search -- which is exactly what this
 * report's own evidence boundaries say two cards further down.
 */
function statusLabel(
  gsc: CompetitorKeywordGapRow["gsc"],
  t: Translate,
): string {
  return translated(t, `gsc.${gsc.queryStatus}`);
}

/**
 * The page reading, or null when the contract did not fill both halves of it.
 *
 * One predicate, because two readers need the same answer: the line that shows
 * the pair, and the cell above it that has to know whether this row measured
 * anything at all before it decides to drop its state pill.
 */
function pageMetrics(
  gsc: CompetitorKeywordGapRow["gsc"],
): { readonly impressions: number; readonly position: number } | null {
  return gsc.evidenceBasis === "query_page" &&
    gsc.pageImpressions !== null &&
    gsc.pagePosition !== null
    ? { impressions: gsc.pageImpressions, position: gsc.pagePosition }
    : null;
}

/**
 * What Search Console attributed to a PAGE for this query, under the reading
 * of the query itself.
 *
 * Kept apart from the QUERY reading above it, because the two answer different
 * questions and can disagree: a query observed on one page still carries a
 * partial attribution, and the page's own average position is not the query's.
 * The page number is rendered only on `query_page` evidence, which is the only
 * basis under which the contract fills it in.
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
  const pageObserved =
    gsc.pageStatus === "observed_sufficient" ||
    gsc.pageStatus === "observed_partial";
  const observedPath = pageObserved ? pagePath(gsc.pageUrl) : null;
  const metrics = pageMetrics(gsc);

  const attribution = pageObserved || queryObserved(gsc);

  return (
    <>
      {gsc.evidenceBasis === "query_page" ? (
        <div className={`${META_TEXT} text-text-dark-secondary`}>
          {translated(t, "gsc.evidenceBasis.query_page")}
        </div>
      ) : null}
      {/*
        The attribution and its numbers are one group, set tighter than the
        gap between groups: the second line is the first line's measurement,
        not a third thing to read. Rendered only when it has a member, because
        an empty flex child still takes a gap from the column above it.
      */}
      {!attribution && metrics === null ? null : (
        <div className="flex flex-col items-start gap-1">
          {attribution ? (
            <div className={`${META_TEXT} text-text-dark-secondary`}>
              {translated(t, `gsc.pageStatus.${gsc.pageStatus}`)}
              {observedPath === null ? "" : ` · ${observedPath}`}
            </div>
          ) : null}
          {metrics === null ? null : (
            <div
              data-gsc-metrics="query-page"
              className={`${META_TEXT} text-text-dark-secondary`}
            >
              {t("gsc.pageMetricLine", {
                impressions: number(metrics.impressions, locale),
                position: number(metrics.position, locale, 1),
              })}
            </div>
          )}
        </div>
      )}
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
  const label = statusLabel(gsc, t);
  const basis =
    gsc.evidenceBasis === null
      ? null
      : translated(t, `gsc.evidenceBasis.${gsc.evidenceBasis}`);
  const position = queryPosition(gsc);
  /**
   * "avg position 4.0" reads as a fact about Search right now.
   *
   * It is one number averaged over a 28-day window that ends three days before
   * today, weighted by impressions. The qualification rides the chip that shows
   * the number -- it followed the number here out of the state pill -- and goes
   * in the accessible name as well as the hover: these are plain divs with no
   * tabIndex, so a keyboard user can never surface a title, and an explicit
   * aria-label suppresses the title as a description, leaving exactly the
   * unqualified present-tense claim for the readers least able to check it.
   */
  const positionTitle =
    position === null ? null : translated(t, "gsc.positionTitle");
  /**
   * "Not in sample" says where we looked, and readers hear "not covered".
   *
   * The label stays as it is -- this column can only see a bounded 28-day
   * Search Console sample, and anonymized queries never enter that sample at
   * all, so "not covered" would state a fact this tool cannot have. What the
   * label could not carry on its own is what the absence DOES mean, which is
   * the sentence below. It qualifies the STATE, so it stays on the pill.
   */
  const sampleTitle =
    gsc.queryStatus === "not_observed_in_gsc_query_sample"
      ? translated(t, "gsc.notObservedTitle")
      : null;
  /**
   * "Has impressions" is the vaguest possible reading of the numbers printed
   * directly under it.
   *
   * The other three states say something no chip below can: already ranking is
   * a band this tool drew across two thresholds, and the two unobserved states
   * exist precisely because there is no measurement to show. `observed_weak`
   * is the leftover -- Search Console saw the query and it did not clear the
   * band -- which is what "64 impressions, avg position 83.1" says exactly,
   * one line down, in the shape reserved for measurements. On the state most
   * rows in this table are in, the pill was a line of scanning that returned
   * nothing.
   *
   * Dropped only when a reading is actually on screen. The contract fills both
   * numbers on every path that produces this state, so the fallback is for a
   * malformed payload rather than a real run -- but a cell that renders
   * nothing at all would be a worse answer than a vague pill.
   */
  const measured =
    gsc.queryImpressions !== null ||
    position !== null ||
    pageMetrics(gsc) !== null;
  const showStatePill = gsc.queryStatus !== "observed_weak" || !measured;

  return (
    // The column owns the rhythm, so nothing in it declares a top margin.
    //
    // This was `[&>*:first-child]:mt-0` over children that each carried their
    // own `mt-*` -- the only arbitrary child-selector variant in the app, and
    // an unwritten contract with three separate things: every direct child had
    // to own a margin, `PageEvidence` had to keep returning a fragment rather
    // than a wrapping element, and no future block could be inserted at the
    // top without one. None of that was checkable. A gap is.
    <div className="flex flex-col items-start gap-2">
      {showStatePill ? (
        <div
          data-gsc-status
          aria-label={[label, basis, sampleTitle]
            .filter((part) => part !== null)
            .join(" · ")}
          {...(sampleTitle === null ? {} : { title: sampleTitle })}
          className={`inline-flex rounded-full border px-2.5 py-1 ${META_TEXT} ${statusTone(gsc.queryStatus)}`}
        >
          {label}
        </div>
      ) : null}
      {/*
        One chip per reading, in the DATUM shape rather than the pill shape.
        The rule this table is built on is that a pill is a STATE and a
        rectangle is a number somebody measured or estimated; impressions and
        average position are both the latter, and giving them the pill would
        make two Search Console readings look like two more states.
      */}
      {gsc.queryImpressions === null && position === null ? null : (
        <div className="flex flex-wrap gap-1.5">
          {gsc.queryImpressions === null ? null : (
            <span
              data-gsc-metrics="query"
              // Both readings carry the same qualification, because both invite
              // the same comparison: a visitor checks this against Search
              // Console, reaches for the "contains" filter that is one click
              // away there, and reads a number two orders of magnitude larger
              // for every query with this term in it. Naming the basis is what
              // makes the two reconcilable instead of contradictory.
              aria-label={`${t("gsc.impressionsLine", {
                impressions: number(gsc.queryImpressions, locale),
              })} · ${translated(t, "gsc.impressionsTitle")}`}
              title={translated(t, "gsc.impressionsTitle")}
              className={`${DATA_CHIP} ${chipTone("neutral")}`}
            >
              {t("gsc.impressionsLine", {
                impressions: number(gsc.queryImpressions, locale),
              })}
            </span>
          )}
          {position === null ? null : (
            <span
              data-gsc-metrics="position"
              aria-label={[
                t("gsc.positionChip", {
                  position: number(position, locale, 1),
                }),
                positionTitle,
              ]
                .filter((part) => part !== null)
                .join(" · ")}
              {...(positionTitle === null ? {} : { title: positionTitle })}
              className={`${DATA_CHIP} ${chipTone("neutral")}`}
            >
              {t("gsc.positionChip", {
                position: number(position, locale, 1),
              })}
            </span>
          )}
        </div>
      )}
      <PageEvidence gsc={gsc} locale={locale} t={t} />
    </div>
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
