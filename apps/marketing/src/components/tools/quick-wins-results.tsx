// @input  -- one QuickWinsResult plus the shared compact limitation disclosure
// @output -- actions, evidence, and secondary context without expanded caveat walls
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
import { LimitationHint } from "../ui/limitation-hint";

/** The order the summary tiles read in: most actionable first. */
const TILE_ORDER: readonly QuickWinTrack[] = [
  "compare_with_own_page",
  "read_the_serp",
  "band_is_the_story",
  "gap_within_noise",
  "at_or_above_curve",
];

const CARD =
  "rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]";
const MONO_LABEL =
  "font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";

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
    <div className="mt-8 space-y-4">
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
        <section className={CARD}>
          <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
            {t("emptyTitle")}
          </h3>
          <p className="mt-1.5 max-w-xl text-[13px] leading-[1.6] text-text-dark-secondary">
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
    <section className={CARD}>
      <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("window", {
          startDate: result.window.startDate,
          endDate: result.window.endDate,
        })}
      </p>

      {/* 1px gap over the divider colour: counts read as a table, not as chips. */}
      <div className="mt-4 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
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
      className={`px-5 py-4 ${
        emphasis ? "bg-brand-panel-raised" : "bg-brand-panel-sunken"
      }`}
    >
      <p
        className={`font-mono text-[22px] leading-none tabular-nums ${
          emphasis ? "text-brand-accent-text" : "text-text-dark-primary"
        }`}
      >
        {value}
      </p>
      <p className="mt-2.5 text-[12.5px] leading-tight text-text-dark-secondary">
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
    <section className={CARD}>
      <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("curveTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("curveIntro")}
      </p>

      <table className="mt-5 w-full table-fixed text-left text-[13px]">
        <caption className="sr-only">{t("curveCaption")}</caption>
        {/*
          Visible, not sr-only. The bar carries the shape; the two count
          columns are what tell a reader whether a band's rate is worth
          believing, and a bare number under no heading is not.
        */}
        <thead className="font-mono text-[10px] font-normal tracking-[0.1em] text-text-dark-secondary uppercase">
          <tr>
            <th scope="col" className="w-16 pr-3 pb-2 text-right font-normal">
              {t("curveColumns.band")}
            </th>
            <th scope="col" className="pr-4 pb-2 font-normal">
              {t("curveColumns.ctr")}
            </th>
            <th
              scope="col"
              className="hidden w-20 pr-4 pb-2 text-right font-normal sm:table-cell"
            >
              {t("curveColumns.queries")}
            </th>
            <th
              scope="col"
              className="hidden w-28 pr-4 pb-2 text-right font-normal md:table-cell"
            >
              {t("curveColumns.impressions")}
            </th>
            <th scope="col" className="w-36 pb-2 text-right font-normal">
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
                  className="w-16 py-1.5 pr-3 text-right font-mono text-[12px] font-normal tabular-nums text-text-dark-secondary"
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
                        className={`block h-3 min-w-[2px] rounded-[2px] ${
                          dimmed ? "bg-brand-border-strong" : "bg-brand-accent"
                        }`}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums text-text-dark-primary">
                      {formatPercent(bucket.ctr, locale)}
                    </span>
                  </div>
                </td>
                <td className="hidden py-1.5 pr-4 text-right font-mono text-[12px] tabular-nums text-text-dark-secondary sm:table-cell">
                  {formatCount(bucket.queryCount, locale)}
                </td>
                <td className="hidden py-1.5 pr-4 text-right font-mono text-[12px] tabular-nums text-text-dark-secondary md:table-cell">
                  {formatCount(bucket.impressions, locale)}
                </td>
                {/*
                  Answered on every row, including the usable ones. The quality
                  gate is why a band with a plausible-looking rate is not used
                  as a baseline, and an empty cell under a column headed "usable
                  as baseline" reads as a yes when it may be the opposite.
                */}
                <td
                  className={`py-1.5 text-right font-mono text-[10px] tracking-[0.06em] uppercase ${
                    dimmed ? "text-brand-warning" : "text-text-dark-secondary"
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
        <p className="mt-4 text-[12.5px] text-text-dark-secondary">
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
    <section className={CARD}>
      <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("draftsTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
        {t("draftsIntro")}
      </p>

      {result.drafts.length === 0 ? (
        <p className="mt-4 max-w-[52em] rounded-[10px] border border-brand-border bg-brand-panel-sunken p-4 text-[13px] leading-[1.6] text-text-dark-secondary">
          {t("draftsNone")}
        </p>
      ) : (
        <ul
          className={`mt-4 grid gap-3.5 ${
            // A single candidate in a two-column grid is a card with an empty
            // half beside it, which reads as something that failed to load.
            result.drafts.length > 1 ? "lg:grid-cols-2" : ""
          }`}
        >
          {result.drafts.map((draft) => (
            <li
              key={draft.query}
              className="rounded-[10px] border border-brand-border bg-brand-panel-sunken p-[18px]"
            >
              <p className="font-mono text-[12.5px] text-text-dark-primary">
                {draft.query}
              </p>
              <dl className="mt-3.5 space-y-3 text-[13px]">
                <div>
                  <dt className={MONO_LABEL}>{t("draftTitleLabel")}</dt>
                  <dd className="mt-1 leading-[1.6] text-text-dark-primary">
                    {draft.title}
                  </dd>
                </div>
                <div>
                  <dt className={MONO_LABEL}>{t("draftMetaLabel")}</dt>
                  <dd className="mt-1 leading-[1.6] text-text-dark-primary">
                    {draft.metaDescription}
                  </dd>
                </div>
              </dl>
              <p className="mt-3.5 border-t border-brand-border-faint pt-3 text-[12.5px] text-text-dark-secondary">
                {t("draftsSource")}{" "}
                <a
                  href={draft.comparablePage}
                  rel="noreferrer nofollow"
                  target="_blank"
                  className="break-all text-brand-accent-2 transition-colors hover:text-brand-info"
                >
                  {draft.comparablePage}
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}

      {skipped.length === 0 ? null : skipped.length <= MAX_INLINE_SKIPPED ? (
        <SkippedReasons entries={skipped} className="mt-4" />
      ) : (
        // A property with a few hundred queries produces a few dozen of these,
        // and rendering them all put a wall of "beyond the per-run limit"
        // directly under the candidates. Every line is still here and still
        // says why — it just no longer reads as a page of errors on open.
        <details className="mt-4 max-w-[52em]">
          <summary className="cursor-pointer text-[12.5px] leading-[1.6] text-text-dark-secondary transition-colors hover:text-text-dark-primary">
            {t("draftsSkippedToggle", { count: skipped.length })}
          </summary>
          <SkippedReasons entries={skipped} className="mt-2.5" />
        </details>
      )}
    </section>
  );
}

/**
 * How many skipped rows are worth showing without being asked.
 *
 * Small on purpose: this list explains an absence, and an explanation longer
 * than the thing it explains stops being one.
 */
const MAX_INLINE_SKIPPED = 6;

function SkippedReasons({
  entries,
  className,
}: {
  readonly entries: readonly (readonly [string, string])[];
  readonly className: string;
}) {
  const t = useTranslations("tools.quickWins");

  return (
    <ul className={`${className} space-y-1.5`}>
      {entries.map(([query, reason]) => (
        <li
          key={query}
          className="max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary"
        >
          <span className="font-mono text-[11.5px] text-text-dark-primary">
            {query}
          </span>
          {" — "}
          {t(`draftSkipped.${reason}`)}
        </li>
      ))}
    </ul>
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
    <details className="rounded-card border border-brand-border-card bg-brand-panel px-[22px] md:px-[26px]">
      <summary className="cursor-pointer py-4 text-[13px] font-medium text-text-dark-primary transition-colors hover:text-brand-accent-text">
        {t("contextTitle")}
      </summary>

      <div className="space-y-6 pb-5">
        <p className="max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("contextIntro")}
        </p>

        <section>
          <h4 className="text-[13.5px] font-semibold text-text-dark-primary">
            {t("anonymizationTitle")}
          </h4>
          <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
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
            <h4 className="text-[13.5px] font-semibold text-text-dark-primary">
              {t("excludedTitle")}
            </h4>
            <ul className="mt-1.5 space-y-1.5">
              {exclusions.map(([reason, value]) => (
                <li
                  key={reason}
                  className="max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary"
                >
                  {t(`exclusions.${reason}`, { count: value })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <LimitationHint
          label={t("limitationsTitle")}
          limitations={result.limitations.map((code) =>
            t(`limitations.${code}`),
          )}
        />

        <p className="max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
          {t("storageNote")}
        </p>
      </div>
    </details>
  );
}
