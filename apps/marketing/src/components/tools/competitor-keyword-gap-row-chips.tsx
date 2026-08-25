// @input  -- one v3 competitor gap row, the viewer locale, and the tool translator
// @output -- competitor rank chips linked to known pages, and tone-graded opportunity signal chips with the pre-screen basis in the band chip title
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
  DATA_CHIP,
  META_TEXT,
  number,
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
