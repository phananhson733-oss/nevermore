"use client";

// @input  -- the locally stored list of finished checks
// @output -- that list, newest first, with each score against the same page's last
// @pos    -- the only part of this tool that remembers anything between runs
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { useTranslations } from "next-intl";

import type { OnPageHistoryEntry } from "../../lib/on-page-checker/storage.ts";

export function OnPageHistoryPanel({
  history,
  onClear,
}: {
  readonly history: readonly OnPageHistoryEntry[];
  readonly onClear: () => void;
}) {
  const t = useTranslations("tools.onPageChecker");

  return (
    <section
      aria-labelledby="onpage-history"
      className="rounded-xl border border-brand-border-card bg-brand-panel p-6 md:p-7"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2
          className="text-[19px] text-text-dark-primary"
          id="onpage-history"
        >
          {t("history.title")}
        </h2>
        {history.length > 0 && (
          <button
            className="ml-auto text-[13px] text-text-dark-secondary underline underline-offset-4 hover:text-text-dark-primary"
            onClick={onClear}
            type="button"
          >
            {t("history.clear")}
          </button>
        )}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-faint">
        {t("history.localOnly")}
      </p>
      {history.length === 0 ? (
        <p className="mt-4 text-[14px] text-text-dark-secondary">
          {t("history.empty")}
        </p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {[...history].reverse().map((entry) => (
            <li
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-brand-border-card pt-2 text-[13px]"
              key={entry.id}
            >
              <span className="font-mono text-text-dark-primary">
                {entry.url}
              </span>
              <span className="text-text-dark-faint">
                {entry.targetQueries.join(", ")}
              </span>
              <span className="ml-auto font-mono tabular-nums text-text-dark-secondary">
                {entry.focus === null
                  ? "—"
                  : t("focus.short", {
                      covered: entry.focus.covered,
                      applicable: entry.focus.applicable,
                    })}
              </span>
              {/*
                The trend, and the arithmetic that makes it one. `previous` is
                the same URL's last check before this one, so re-checking a
                different page never reads as an improvement on this one.
              */}
              <ScoreTrend
                score={entry.score ?? null}
                previous={previousScoreFor(history, entry)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The last score this same URL scored before the given check.
 *
 * Same URL, because a list mixing pages would otherwise report the difference
 * between two unrelated pages as a change in one of them.
 */
function previousScoreFor(
  history: readonly OnPageHistoryEntry[],
  entry: OnPageHistoryEntry,
): number | null {
  const earlier = history
    .filter(
      (candidate) =>
        candidate.url === entry.url && candidate.createdAt < entry.createdAt,
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .at(-1);
  return earlier?.score?.value ?? null;
}

function ScoreTrend({
  score,
  previous,
}: {
  readonly score: { readonly value: number; readonly grade: string } | null;
  readonly previous: number | null;
}) {
  if (score === null) {
    return <span className="font-mono text-text-dark-faint">—</span>;
  }
  const delta = previous === null ? null : score.value - previous;
  return (
    <span className="font-mono tabular-nums text-text-dark-primary">
      {score.value}
      <span className="text-text-dark-faint"> {score.grade}</span>
      {delta !== null && delta !== 0 && (
        <span
          className={
            delta > 0 ? "text-brand-success" : "text-brand-warning"
          }
        >
          {` ${delta > 0 ? "+" : ""}${delta}`}
        </span>
      )}
    </span>
  );
}

