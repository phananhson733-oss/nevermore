// @input  -- one QuickWinsResult from /api/tools/quick-wins
// @output -- what to do next, the evidence behind it, and everything it rests on
// @pos    -- presentation only; every judgement it could make was left to the reader
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type { QuickWinTrack, QuickWinsResult } from "@sf/public-tools";
// By its own path, not the package barrel: the barrel re-exports the run
// pipeline, which reaches `@sf/sources` and `node:net`, and pulling a value
// through it drags all of that into the browser bundle.
import { trackCounts } from "@sf/public-tools/quick-wins/track";
// Relative, not `@/`: the unit runner maps `@/` to the OTHER app, so a
// component reached through it is unimportable from a test. See vitest.config.
import { formatCount, formatPercent } from "../../lib/tools/quick-wins-format";
import { QuickWinsActions } from "./quick-wins-actions";
import { QuickWinsEvidenceTable } from "./quick-wins-evidence-table";

/** The order the summary tiles read in: most actionable first. */
const TILE_ORDER: readonly QuickWinTrack[] = [
  "compare_with_own_page",
  "read_the_serp",
  "band_is_the_story",
  "gap_within_noise",
  "at_or_above_curve",
];

export function QuickWinsResults({
  result,
  locale,
}: {
  readonly result: QuickWinsResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const hasRows = result.rows.length > 0;

  return (
    <div className="mt-8 space-y-5">
      <ResultsHeader result={result} locale={locale} />

      {/*
        Before the table, deliberately. The table is the evidence; this is the
        reason to read it. A reader who scrolls a 47-row table looking for the
        point has been handed a spreadsheet, not a report — which is the note
        this surface shipped on and is here to answer.
      */}
      <QuickWinsActions actions={result.actions} locale={locale} />

      {hasRows ? (
        <QuickWinsEvidenceTable result={result} locale={locale} />
      ) : (
        <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
          <h3 className="text-[15px] font-semibold text-text-dark-primary">
            {t("emptyTitle")}
          </h3>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
            {t("emptyBody")}
          </p>
        </section>
      )}

      <DraftSection result={result} />

      <CurveSection result={result} locale={locale} />

      <ContextSection result={result} locale={locale} />
    </div>
  );
}

/**
 * The window, then how the rows divide by what to do with them.
 *
 * Counts only. There is deliberately no headline gap figure here: a single big
 * number at the top of a report is read as a score no matter what the caption
 * says, and the one number this table could offer — the summed shortfall — is
 * the one the reader is most likely to mistake for a forecast. It appears
 * exactly once, inside the action that exists to say it is not one.
 */
function ResultsHeader({
  result,
  locale,
}: {
  readonly result: QuickWinsResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const counts = trackCounts(result.rows);

  return (
    <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
      <p className="text-[12.5px] text-text-dark-secondary">
        {t("window", {
          startDate: result.window.startDate,
          endDate: result.window.endDate,
        })}
      </p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        <Tile
          label={t("summaryRowsLabel")}
          value={formatCount(result.rows.length, locale)}
          emphasis
        />
        {TILE_ORDER.filter((track) => counts[track] > 0).map((track) => (
          <Tile
            key={track}
            label={t(`tracks.${track}.label`)}
            value={formatCount(counts[track], locale)}
          />
        ))}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  emphasis = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}) {
  return (
    <div
      className={`min-w-[7.5rem] rounded-xl border px-3.5 py-2.5 ${
        emphasis
          ? "border-brand-accent/40 bg-brand-accent-soft"
          : "border-brand-border/70 bg-brand-bg"
      }`}
    >
      <p className="text-[19px] font-semibold tabular-nums leading-none text-text-dark-primary">
        {value}
      </p>
      <p className="mt-1.5 text-[12px] leading-tight text-text-dark-secondary">
        {label}
      </p>
    </div>
  );
}

/**
 * The site's own curve, as bars.
 *
 * A five-row table of percentages hid the single most interesting thing these
 * runs produce: on the evaluated site the 11-16 band earned four times what
 * 8-11 did. Bars make an inversion visible in the shape before anyone reads a
 * number, which is the point of drawing it at all. The numbers stay next to
 * the bars — the bar is the summary, not the source.
 */
function CurveSection({
  result,
  locale,
}: {
  readonly result: QuickWinsResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const usable = result.curve.buckets.filter(
    (bucket) => bucket.ctr !== null && Number.isFinite(bucket.ctr),
  );
  // Scaled to the largest measured band rather than to 100%: these curves top
  // out around 2% on a real site, and a fixed axis renders every bar as a
  // hairline.
  const peak = usable.reduce(
    (max, bucket) => Math.max(max, bucket.ctr ?? 0),
    0,
  );

  return (
    <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
        {t("curveTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
        {t("curveIntro")}
      </p>

      <table className="mt-4 w-full table-fixed text-left text-[13px]">
        <caption className="sr-only">{t("curveCaption")}</caption>
        {/*
          Visible, not sr-only. The bar carries the shape; the two count
          columns are what tell a reader whether a band's rate is worth
          believing, and a bare number under no heading is not.
        */}
        <thead className="text-[11.5px] uppercase tracking-wide text-text-dark-secondary/70">
          <tr>
            <th scope="col" className="w-16 pb-2 pr-3 text-right font-medium">
              {t("curveColumns.band")}
            </th>
            <th scope="col" className="pb-2 pr-4 font-medium">
              {t("curveColumns.ctr")}
            </th>
            <th
              scope="col"
              className="hidden w-20 pb-2 pr-4 text-right font-medium sm:table-cell"
            >
              {t("curveColumns.queries")}
            </th>
            <th
              scope="col"
              className="hidden w-28 pb-2 pr-4 text-right font-medium md:table-cell"
            >
              {t("curveColumns.impressions")}
            </th>
            <th scope="col" className="w-36 pb-2 text-right font-medium">
              {t("curveColumns.quality")}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.curve.buckets.map((bucket) => {
            const width =
              bucket.ctr !== null && Number.isFinite(bucket.ctr) && peak > 0
                ? Math.max(1.5, (bucket.ctr / peak) * 100)
                : 0;
            const dimmed = bucket.quality !== "usable";
            return (
              <tr key={bucket.bucketId} className="align-middle">
                <th
                  scope="row"
                  className="w-16 py-1.5 pr-3 text-right text-[12.5px] font-medium tabular-nums text-text-dark-secondary"
                >
                  {bucket.bucketId}
                </th>
                <td className="py-1.5 pr-4">
                  {/*
                    The rate sits at a fixed offset rather than after the bar.
                    Trailing the bar puts the eight numbers at eight different
                    x positions, which is the one job a column of rates has.
                  */}
                  <div className="flex items-center gap-3">
                    <span className="flex-1">
                      <span
                        aria-hidden="true"
                        style={{ width: `${width}%` }}
                        className={`block h-3.5 min-w-[2px] rounded-sm ${
                          dimmed
                            ? "bg-text-dark-secondary/30"
                            : "bg-brand-accent"
                        }`}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right text-[12.5px] tabular-nums text-text-dark-primary">
                      {formatPercent(bucket.ctr, locale)}
                    </span>
                  </div>
                </td>
                <td className="hidden py-1.5 pr-4 text-right text-[12px] tabular-nums text-text-dark-secondary sm:table-cell">
                  {formatCount(bucket.queryCount, locale)}
                </td>
                <td className="hidden py-1.5 pr-4 text-right text-[12px] tabular-nums text-text-dark-secondary md:table-cell">
                  {formatCount(bucket.impressions, locale)}
                </td>
                {/*
                  Answered on every row, including the usable ones. The quality
                  gate is why a band with a plausible-looking rate is not used
                  as a baseline, and an empty cell under a column headed "usable
                  as baseline" reads as a yes when it may be the opposite.
                */}
                <td
                  className={`py-1.5 text-right text-[12px] ${
                    dimmed
                      ? "text-brand-warning/80"
                      : "text-text-dark-secondary"
                  }`}
                >
                  {t(`bucketQuality.${bucket.quality}`)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {result.curve.brandRowsExcluded > 0 ? (
        <p className="mt-3 text-[12px] text-text-dark-secondary">
          {t("brandExcluded", { count: result.curve.brandRowsExcluded })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Wording candidates, each shown with the page it was modelled on.
 *
 * The source link is not decoration. A draft nobody can trace to a named page
 * on their own site is generic advice, and generic advice is what got drafts
 * cut from v1; being able to open the comparable page and judge the pattern
 * is the only reason they were allowed back.
 */
function DraftSection({ result }: { readonly result: QuickWinsResult }) {
  const t = useTranslations("tools.quickWins");
  const skipped = Object.entries(result.draftsSkipped);
  if (result.drafts.length === 0 && skipped.length === 0) return null;

  return (
    <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
        {t("draftsTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
        {t("draftsIntro")}
      </p>

      {result.drafts.length === 0 ? (
        <p className="mt-4 max-w-[52em] rounded-xl border border-brand-border/60 bg-brand-bg/60 p-4 text-[13px] leading-relaxed text-text-dark-secondary">
          {t("draftsNone")}
        </p>
      ) : (
        <ul
          className={`mt-4 grid gap-3 ${
            // A single candidate in a two-column grid is a card with an empty
            // half beside it, which reads as something that failed to load.
            result.drafts.length > 1 ? "lg:grid-cols-2" : ""
          }`}
        >
          {result.drafts.map((draft) => (
            <li
              key={draft.query}
              className="rounded-xl border border-brand-border/60 bg-brand-bg p-4"
            >
              <p className="text-[13px] font-semibold text-text-dark-primary">
                {draft.query}
              </p>
              <dl className="mt-3 space-y-2.5 text-[13px]">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-text-dark-secondary">
                    {t("draftTitleLabel")}
                  </dt>
                  <dd className="mt-0.5 leading-relaxed text-text-dark-primary">
                    {draft.title}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-text-dark-secondary">
                    {t("draftMetaLabel")}
                  </dt>
                  <dd className="mt-0.5 leading-relaxed text-text-dark-primary">
                    {draft.metaDescription}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 border-t border-brand-border/50 pt-2.5 text-[12px] text-text-dark-secondary">
                {t("draftsSource")}{" "}
                <a
                  href={draft.comparablePage}
                  rel="noreferrer nofollow"
                  target="_blank"
                  className="break-all underline hover:no-underline"
                >
                  {draft.comparablePage}
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {skipped.map(([query, reason]) => (
            <li
              key={query}
              className="max-w-[52em] text-[12px] leading-relaxed text-text-dark-secondary"
            >
              <span className="text-text-dark-primary">{query}</span>
              {" — "}
              {t(`draftSkipped.${reason}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The withheld share, the exclusions and the limitations, folded but present.
 *
 * Collapsed rather than removed. Three stacked prose sections at the bottom of
 * the page were what pushed the actions off the screen, but deleting them
 * would leave a report that shows only its findings — which claims a
 * completeness it does not have. `open` is not set: the reader who wants them
 * is the reader who came looking.
 */
function ContextSection({
  result,
  locale,
}: {
  readonly result: QuickWinsResult;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const exclusions = Object.entries(result.excluded).filter(
    ([, value]) => value > 0,
  );

  return (
    <details className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/25 px-5 md:px-6">
      <summary className="cursor-pointer py-4 text-[13px] font-medium text-text-dark-primary">
        {t("contextTitle")}
      </summary>

      <div className="space-y-6 pb-5">
        <p className="max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
          {t("contextIntro")}
        </p>

        <section>
          <h4 className="text-[13px] font-semibold text-text-dark-primary">
            {t("anonymizationTitle")}
          </h4>
          <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
            {result.anonymization === null ||
            result.anonymization.missingImpressionShare === null
              ? t("anonymizationUnknown")
              : t("anonymizationBody", {
                  impressionShare: formatPercent(
                    result.anonymization.missingImpressionShare,
                    locale,
                    0,
                  ),
                  clickShare: formatPercent(
                    result.anonymization.missingClickShare,
                    locale,
                    0,
                  ),
                })}
          </p>
        </section>

        {exclusions.length > 0 ? (
          <section>
            <h4 className="text-[13px] font-semibold text-text-dark-primary">
              {t("excludedTitle")}
            </h4>
            <ul className="mt-1.5 space-y-1.5">
              {exclusions.map(([reason, value]) => (
                <li
                  key={reason}
                  className="max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary"
                >
                  {t(`exclusions.${reason}`, { count: value })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h4 className="text-[13px] font-semibold text-text-dark-primary">
            {t("limitationsTitle")}
          </h4>
          <ul className="mt-1.5 space-y-2.5">
            {result.limitations.map((code) => (
              <li
                key={code}
                className="max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary"
              >
                {t(`limitations.${code}`)}
              </li>
            ))}
          </ul>
        </section>

        <p className="max-w-[52em] text-[12px] leading-relaxed text-text-dark-secondary">
          {t("storageNote")}
        </p>
      </div>
    </details>
  );
}
