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

/** Status chips: mono, 4px radius, tinted at 15%. */
const CHIP =
  "rounded font-mono text-[9.5px] tracking-[0.08em] uppercase px-2 py-[3px]";

/**
 * One badge style per kind, and they are deliberately not all loud.
 *
 * `do` is the only filled badge. An `avoid` rendered in warning red competes
 * with the thing it is warning about, and this report has more things not to
 * do than things to do — a page of red badges is a page nobody finishes.
 */
const KIND_BADGE: Record<QuickWinActionKind, string> = {
  do: "bg-brand-accent text-brand-on-accent",
  external_data: "bg-brand-info/15 text-brand-info",
  avoid: "border border-brand-border-strong text-text-dark-secondary",
};

const KIND_RAIL: Record<QuickWinActionKind, string> = {
  do: "bg-brand-accent",
  external_data: "bg-brand-info",
  avoid: "bg-brand-border-strong",
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
    <section className="rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]">
      <h3 className="text-[16.5px] font-semibold text-text-dark-primary">
        {t("actionsTitle")}
      </h3>
      <p className="mt-1.5 max-w-[52em] text-[12.5px] leading-[1.6] text-text-dark-secondary">
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
    <article className="flex gap-3.5 border-t border-brand-border-faint py-5 first:border-t-0">
      <span
        aria-hidden="true"
        className={`my-1 w-[3px] shrink-0 rounded-full ${KIND_RAIL[action.kind]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`shrink-0 ${CHIP} ${KIND_BADGE[action.kind]}`}>
            {t(`actionKinds.${action.kind}`)}
          </span>
          <h4 className="text-[15.5px] font-semibold text-text-dark-primary">
            {t(`actions.${action.id}.title`, values)}
          </h4>
        </div>

        <p className="mt-2 max-w-[52em] text-[13px] leading-[1.6] text-text-dark-secondary">
          {t(`actions.${action.id}.body`, values)}
        </p>

        {action.queries.length > 0 ? (
          <>
            <p className="mt-3 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
              {t("actionQueriesLabel")}
            </p>
            <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
              {action.queries.map((query) => (
                <li
                  key={query}
                  className="rounded-full border border-brand-border-strong bg-brand-panel-sunken px-3 py-1 font-mono text-[11px] text-text-dark-primary"
                >
                  {query}
                </li>
              ))}
              {hidden > 0 ? (
                <li className="rounded-full px-1 py-1 font-mono text-[11px] text-text-dark-secondary">
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
