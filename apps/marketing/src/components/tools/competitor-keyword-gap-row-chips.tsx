// @input  -- one v3 competitor gap row, the viewer locale, and the tool translator
// @output -- competitor rank chips linked to known pages, and opportunity signal chips with the pre-screen basis in the band chip title
// @pos    -- stateless row cells for the Marketing competitor gap results table

import type { CompetitorKeywordGapRow } from "@sf/public-tools/competitor-keyword-gap";

import {
  bestCompetitorTrafficEstimate,
  competitorLink,
  snapshotDate,
} from "./competitor-keyword-gap-competitor-pages";
import {
  CHIP_TEXT,
  META_TEXT,
  number,
  translated,
  type Translate,
} from "./competitor-keyword-gap-results-shared";

export function CompetitorChips({
  row,
}: {
  readonly row: CompetitorKeywordGapRow;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(row.competitorRanks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([domain, rank]) => {
          const href = competitorLink(row, domain);
          const className = `${CHIP_TEXT} max-w-[240px] break-all`;
          return href === null ? (
            <span
              key={domain}
              data-competitor-rank={domain}
              className={className}
            >
              {domain} #{rank}
            </span>
          ) : (
            <a
              key={domain}
              data-competitor-rank={domain}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={row.competitorPages[domain]?.title ?? undefined}
              className={`${className} transition hover:border-brand-accent-text`}
            >
              {domain} #{rank}
            </a>
          );
        })}
    </div>
  );
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
    <div className={`flex flex-wrap gap-2 ${META_TEXT}`}>
      <span className={CHIP_TEXT}>
        {t("signals.bestRank", { rank: row.bestCompetitorRank })}
      </span>
      <span className={CHIP_TEXT}>
        {t("signals.difficulty", {
          value:
            row.keywordDifficulty.value === null
              ? "—"
              : number(row.keywordDifficulty.value, locale),
        })}
      </span>
      <span
        data-pre-screen={row.preScreen.band}
        title={`${basis} ${reason}`}
        className={CHIP_TEXT}
      >
        {translated(t, `preScreen.band.${row.preScreen.band}`)}
      </span>
      {aiOverview ? (
        <span data-serp-snapshot="ai_overview" className={CHIP_TEXT}>
          {snapshotAt === null
            ? t("signals.aiOverviewSnapshotUndated")
            : t("signals.aiOverviewSnapshot", { date: snapshotAt })}
        </span>
      ) : null}
      {traffic !== null ? (
        <span data-competitor-traffic className={CHIP_TEXT}>
          {t("signals.competitorTraffic", { value: number(traffic, locale) })}
        </span>
      ) : null}
    </div>
  );
}
