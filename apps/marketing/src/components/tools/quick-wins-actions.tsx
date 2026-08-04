// @input  -- the action list the engine derived from this run's evidence
// @output -- the "what to do next" card, ordered do → go look → don't
// @pos    -- the first thing under the results header; the reason the table is worth reading
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { useTranslations } from "next-intl";
import type { QuickWinAction, QuickWinActionKind } from "@sf/public-tools";
// Relative, not `@/`: the unit runner maps `@/` to the OTHER app, so a
// component reached through it is unimportable from a test. See vitest.config.
import { actionValues } from "../../lib/tools/quick-wins-action-values";

/**
 * One badge style per kind, and they are deliberately not all loud.
 *
 * `do` is the only filled badge. An `avoid` rendered in warning red competes
 * with the thing it is warning about, and this report has more things not to
 * do than things to do — a page of red badges is a page nobody finishes.
 */
const KIND_BADGE: Record<QuickWinActionKind, string> = {
  do: "bg-brand-accent text-white",
  external_data: "text-brand-series-2 bg-[rgba(79,134,200,0.14)]",
  avoid: "text-text-dark-secondary border border-brand-border",
};

const KIND_RAIL: Record<QuickWinActionKind, string> = {
  do: "bg-brand-accent",
  external_data: "bg-brand-series-2",
  avoid: "bg-text-dark-secondary/40",
};

export function QuickWinsActions({
  actions,
  locale,
}: {
  readonly actions: readonly QuickWinAction[];
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  if (actions.length === 0) return null;

  return (
    <section className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/35 p-5 md:p-6">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-text-dark-primary">
        {t("actionsTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-relaxed text-text-dark-secondary">
        {t("actionsIntro")}
      </p>

      <div className="mt-4">
        {actions.map((action) => (
          <ActionRow key={action.id} action={action} locale={locale} />
        ))}
      </div>
    </section>
  );
}

function ActionRow({
  action,
  locale,
}: {
  readonly action: QuickWinAction;
  readonly locale: string;
}) {
  const t = useTranslations("tools.quickWins");
  const values = actionValues(action, locale);
  // The engine caps how many queries an action names; the count in `measures`
  // is the real total, so the overflow line is computed from the two.
  const named = action.queries.length;
  const total = action.measures.find(
    (measure) => measure.key === "serpRowCount" || measure.key === "candidateCount",
  )?.value;
  const hidden =
    typeof total === "number" && Number.isFinite(total) ? total - named : 0;

  return (
    <article className="flex gap-3.5 border-t border-brand-border/40 py-4 first:border-t-0">
      <span
        aria-hidden="true"
        className={`my-1 w-1.5 shrink-0 rounded ${KIND_RAIL[action.kind]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold ${KIND_BADGE[action.kind]}`}
          >
            {t(`actionKinds.${action.kind}`)}
          </span>
          <h4 className="text-[14px] font-semibold text-text-dark-primary">
            {t(`actions.${action.id}.title`, values)}
          </h4>
        </div>

        <p className="mt-1.5 max-w-[52em] text-[13px] leading-relaxed text-text-dark-secondary">
          {t(`actions.${action.id}.body`, values)}
        </p>

        {action.queries.length > 0 ? (
          <>
            <p className="mt-2.5 text-[12px] text-text-dark-secondary/80">
              {t("actionQueriesLabel")}
            </p>
            <ul className="mt-1.5 flex list-none flex-wrap gap-2 p-0">
              {action.queries.map((query) => (
                <li
                  key={query}
                  className="rounded-full border border-brand-border bg-brand-bg px-3 py-1 text-[12px] text-text-dark-primary"
                >
                  {query}
                </li>
              ))}
              {hidden > 0 ? (
                <li className="rounded-full px-1 py-1 text-[12px] text-text-dark-secondary">
                  {t("actionQueriesMore", { count: hidden })}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </div>
    </article>
  );
}
