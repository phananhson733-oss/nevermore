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
 * A footnote appears only when there is something true to put in it. The
 * comparison lines name the previous run's stamp — 「较上次（{at}）」, never
 * "last week" (Q20) — and exist only when there is a previous run; a card with
 * no comparison has no delta and no comparison sentence, rather than a "+0" or
 * a "0 no longer reported" that was never measured. Each sentence is its own
 * element so the view test can pin the ICU argument order whole (Q4b).
 */

const FOOT_LINE = "block";

function HealthFoot({ health }: { readonly health: WeekSummary["health"] }) {
  const t = useTranslations("workbench.week");
  const previous = health?.previous ?? null;
  if (previous === null) return null;
  return (
    <>
      <span data-wb-foot="diff" className={FOOT_LINE}>
        {t("cards.health.foot", { fixed: previous.noLonger.length, added: previous.newly.length })}
      </span>
      <span data-wb-foot="since" className={FOOT_LINE}>
        {t("sinceLast", { at: previous.at })}
      </span>
    </>
  );
}

function MentionFoot({ mention }: { readonly mention: WeekSummary["mention"] }) {
  const t = useTranslations("workbench.week");
  if (mention === null) return null;
  return (
    <>
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
          foot={<HealthFoot health={health} />}
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
          foot={<MentionFoot mention={mention} />}
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
