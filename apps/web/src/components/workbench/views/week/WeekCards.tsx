"use client";

import { useTranslations } from "next-intl";
import { workbenchHref } from "@/lib/workbench/routes";
import { StatCard } from "../../ui/StatCard.tsx";
import { statValue } from "../../ui/stat-format.ts";
import type { WeekSummary } from "./week-summary.ts";

/**
 * The three cards (Q18: the outward form's three, not the prototype's six):
 * technical health, AI mention rate, borderline queries. Each links to the page
 * that explains it (Q21: borderline goes to `keywords`).
 *
 * A footnote appears only when there is something true to put in it:
 * - A card with a measurement names when that check ran (「检查于 {at}」) and,
 *   when it ran before the page's date range, adds 「这段日期内没有新的检查」:
 *   the card shows the latest check however old, and under this week's dates an
 *   undated score reads as this week's (codex S7a #6).
 * - The comparison lines name the previous run's stamp — 「较上次（{at}）」,
 *   never "last week" (Q20) — and exist only when `week-summary.ts` found a
 *   previous run comparable with the latest (S7a #1 / #2). A card with no
 *   comparison has no delta and no comparison sentence, rather than a "+0" or a
 *   "0 no longer reported" that was never measured; a mention share printed as
 *   a band keeps the comparison sentence and draws no delta (S7a #7).
 *
 * Each sentence is its own element so the view test can pin the ICU argument
 * order whole (Q4b).
 */

const FOOT_LINE = "block";

function CheckedFoot({ at, inWindow }: { readonly at: string; readonly inWindow: boolean }) {
  const t = useTranslations("workbench.week");
  return (
    <>
      <span data-wb-foot="at" className={FOOT_LINE}>
        {t("checkedAt", { at })}
      </span>
      {inWindow ? null : (
        <span data-wb-foot="stale" className={FOOT_LINE}>
          {t("noNewCheck")}
        </span>
      )}
    </>
  );
}

function HealthFoot({
  health,
  inWindow,
}: {
  readonly health: WeekSummary["health"];
  readonly inWindow: boolean;
}) {
  const t = useTranslations("workbench.week");
  if (health === null) return null;
  const { previous } = health;
  return (
    <>
      <CheckedFoot at={health.at} inWindow={inWindow} />
      {previous === null ? null : (
        <>
          <span data-wb-foot="diff" className={FOOT_LINE}>
            {t("cards.health.foot", { fixed: previous.noLonger.length, added: previous.newly.length })}
          </span>
          <span data-wb-foot="since" className={FOOT_LINE}>
            {t("sinceLast", { at: previous.at })}
          </span>
        </>
      )}
    </>
  );
}

function MentionFoot({
  mention,
  inWindow,
}: {
  readonly mention: WeekSummary["mention"];
  readonly inWindow: boolean;
}) {
  const t = useTranslations("workbench.week");
  if (mention === null) return null;
  return (
    <>
      <CheckedFoot at={mention.at} inWindow={inWindow} />
      <span data-wb-foot="share" className={FOOT_LINE}>
        {t("cards.mention.foot", { hits: mention.hits, total: mention.total })}
      </span>
      {mention.previous === null ? null : (
        <span data-wb-foot="since" className={FOOT_LINE}>
          {t("sinceLast", { at: mention.previous.at })}
        </span>
      )}
    </>
  );
}

export function WeekCards({
  summary,
  projectId,
}: {
  readonly summary: WeekSummary;
  readonly projectId: string;
}) {
  const t = useTranslations("workbench.week");
  const { health, mention, borderline } = summary;
  return (
    <div data-wb-frame="" className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div data-wb-week-card="health" className="grid">
        <StatCard
          value={statValue(health?.score)}
          delta={health?.previous?.scoreDelta ?? null}
          label={t("cards.health.label")}
          foot={<HealthFoot health={health} inWindow={summary.healthInWindow} />}
          href={workbenchHref(projectId, "audit")}
        />
      </div>
      <div data-wb-week-card="mention" className="grid">
        <StatCard
          value={mention === null ? null : mention.share}
          delta={mention?.previous?.deltaPt ?? null}
          deltaUnit="pt"
          accent="fuchsia"
          label={t("cards.mention.label")}
          foot={<MentionFoot mention={mention} inWindow={summary.mentionInWindow} />}
          href={workbenchHref(projectId, "visibility")}
        />
      </div>
      <div data-wb-week-card="borderline" className="grid">
        <StatCard
          value={statValue(borderline === null ? null : borderline.length)}
          accent="amber"
          label={t("cards.borderline.label")}
          foot={
            borderline === null ? null : (
              <span data-wb-foot="basis" className={FOOT_LINE}>
                {t("cards.borderline.foot")}
              </span>
            )
          }
          href={workbenchHref(projectId, "keywords")}
        />
      </div>
    </div>
  );
}
