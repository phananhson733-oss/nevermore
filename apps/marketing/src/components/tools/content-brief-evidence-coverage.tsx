// @input  -- one ContentBrief's run.reads and evidence ledger, and the tool translator
// @output -- four compact source summaries, with exact read counts and the full ledger in closed details
// @pos    -- evidence disclosure below the keyword; whitelisted for --sc-source-* colours
//            (app/source-tokens.test.ts) because each cell is coloured by its source layer

import type {
  ContentBrief,
  Unavailable,
} from "@sf/public-tools/content-brief/contract";

import {
  BODY_TEXT,
  CARD,
  MONO_FIGURE,
  PILL,
  SECTION_TITLE,
  attemptedCopy,
  chipTone,
  number,
  reasonCopy,
  statusTone,
  translated,
  type ReadStatus,
  type Translate,
} from "./content-brief-results-shared";
import type { SourceTone } from "./content-brief-source-chip";
import styles from "./content-brief-presentation.module.css";

/**
 * Each cell is framed in the colour of the layer its evidence belongs to:
 * third-party for the SERP and the pages fetched from it, first-party for
 * Search Console and the product profile, model for the one model call. The
 * status pill inside stays in the status palette so "green frame" never reads
 * as "complete".
 */
const CELL_FRAME: Readonly<Record<SourceTone, string>> = {
  first: "border-source-first/40",
  third: "border-source-third/40",
  model: "border-source-model/40",
};
const CELL_LABEL: Readonly<Record<SourceTone, string>> = {
  first: "text-source-first",
  third: "text-source-third",
  model: "text-source-model",
};
const BAR_FILL: Readonly<Record<SourceTone, string>> = {
  first: "bg-source-first",
  third: "bg-source-third",
  model: "bg-source-model",
};

function Cell({
  name,
  label,
  tone,
  status,
  reason,
  figure,
  bar,
  children,
  t,
}: {
  readonly name: string;
  readonly label: string;
  readonly tone: SourceTone;
  readonly status: ReadStatus;
  readonly reason?: Unavailable["reason"];
  readonly figure: string;
  /** observed / attempted, drawn as a bar on wider screens only; the text carries it on mobile. */
  readonly bar?: { readonly value: number; readonly of: number };
  readonly children?: React.ReactNode;
  readonly t: Translate;
}) {
  const notUsed = status === "unavailable" && reason === "not_requested";
  const ratio =
    bar === undefined || bar.of <= 0
      ? null
      : Math.max(0, Math.min(1, bar.value / bar.of));
  return (
    <div
      data-coverage-cell={name}
      data-coverage-status={notUsed ? "not_used" : status}
      className={`min-w-0 rounded-[10px] border bg-brand-bg p-3 ${CELL_FRAME[tone]}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span
          className={`font-mono text-[10px] tracking-[0.12em] uppercase ${CELL_LABEL[tone]}`}
        >
          {label}
        </span>
        <span className={`${PILL} ${notUsed ? chipTone("neutral") : statusTone(status)}`}>
          {notUsed ? t("coverage.notUsed") : translated(t, `modes.${status}`)}
        </span>
      </div>
      <div data-coverage-figure className={`mt-2 ${MONO_FIGURE}`}>
        {figure}
      </div>
      {ratio !== null ? (
        <div
          aria-hidden="true"
          className="mt-2 hidden h-1 overflow-hidden rounded-full bg-brand-panel-sunken md:block"
        >
          <div
            className={`h-full ${BAR_FILL[tone]}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
      {children !== undefined ? (
        <div className="mt-2 space-y-1 text-[11.5px] leading-[1.5] text-text-dark-secondary">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function UnavailableLines({
  read,
  group,
  t,
}: {
  readonly read: Unavailable;
  readonly group: string;
  readonly t: Translate;
}) {
  return (
    <>
      <p data-unavailable-reason={read.reason}>
        {reasonCopy(t, group, read.reason)}
      </p>
      {read.reason !== "not_requested" ? <p className="font-mono">{attemptedCopy(t, read)}</p> : null}
    </>
  );
}

function countBy<T extends string>(
  items: readonly { readonly reason: T }[],
): readonly (readonly [T, number])[] {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  return [...counts.entries()];
}

function CrawlCell({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const crawl = brief.run.reads.crawl;
  if (crawl.status === "unavailable") {
    return (
      <Cell name="crawl" label={t("coverage.crawl")} tone="third" status="unavailable" reason={crawl.reason} figure="—" t={t}>
        <UnavailableLines read={crawl} group="unavailable" t={t} />
      </Cell>
    );
  }
  const failed = countBy(brief.evidence.crawl.failed);
  const skipped = countBy(brief.evidence.crawl.skipped);
  return (
    <Cell
      name="crawl"
      label={t("coverage.crawl")}
      tone="third"
      status={crawl.status}
      figure={t("coverage.crawlObserved", {
        observed: crawl.observed,
        attempted: crawl.attempted,
      })}
      bar={{ value: crawl.observed, of: crawl.attempted }}
      t={t}
    >
      <p data-crawl-detail>
        {t("coverage.crawlDetail", {
          truncated: crawl.truncated,
          failed: crawl.failed,
          skipped: crawl.skipped,
        })}
      </p>
      {failed.map(([reason, count]) => (
        <p key={`failed:${reason}`} data-crawl-failed-reason={reason}>
          {t("coverage.crawlFailedReason", {
            count: number(count, locale),
            reason: translated(t, `crawlFailed.${reason}`),
          })}
        </p>
      ))}
      {skipped.map(([reason, count]) => (
        <p key={`skipped:${reason}`} data-crawl-skipped-reason={reason}>
          {t("coverage.crawlSkippedReason", {
            count: number(count, locale),
            reason: translated(t, `crawlSkipped.${reason}`),
          })}
        </p>
      ))}
    </Cell>
  );
}

function GscCell({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const gsc = brief.run.reads.gsc;
  if (gsc.status === "unavailable") {
    return (
      <Cell name="gsc" label={t("coverage.gsc")} tone="first" status="unavailable" reason={gsc.reason} figure="—" t={t}>
        <UnavailableLines read={gsc} group="unavailable" t={t} />
      </Cell>
    );
  }
  const coverage = gsc.primary_coverage;
  return (
    <Cell
      name="gsc"
      label={t("coverage.gsc")}
      tone="first"
      status={gsc.status}
      figure={
        coverage.ratio === null
          ? "—"
          : `${Math.round(coverage.ratio * 100)}%`
      }
      t={t}
    >
      <p className="break-all">
        {t("coverage.gscWindow", {
          property: gsc.property,
          days: gsc.window.lookback_days,
          end: gsc.window.end,
        })}
      </p>
      <p>{t("coverage.gscMatched", { count: number(gsc.matched_queries, locale) })}</p>
      {/* The three usable-row denominators, with the unreadable total beside
          them: a row the reader cannot see is still a row that was counted. */}
      <p data-gsc-rows className="font-mono">
        {t("coverage.gscRows", {
          query: number(gsc.rows.query, locale),
          queryPage: number(gsc.rows.query_page, locale),
          page: number(gsc.rows.page, locale),
          unreadable: number(
            gsc.unreadable_rows.query +
            gsc.unreadable_rows.query_page +
            gsc.unreadable_rows.page,
            locale,
          ),
        })}
      </p>
      {coverage.ratio === null ? (
        <p data-primary-coverage-reason={coverage.reason}>
          {translated(t, `primaryCoverage.${coverage.reason}`)}
        </p>
      ) : null}
      {gsc.truncated.length > 0 ? (
        <p data-gsc-truncated>
          {t("coverage.gscTruncated", {
            dimensions: gsc.truncated
              .map((dimension) => translated(t, `coverage.gscDimensions.${dimension}`))
              .join(" · "),
          })}
        </p>
      ) : null}
      {gsc.unreadable_rows.query > 0 ||
        gsc.unreadable_rows.query_page > 0 ||
        gsc.unreadable_rows.page > 0 ? (
        <p data-gsc-unreadable>
          {t("coverage.gscUnreadable", {
            query: gsc.unreadable_rows.query,
            queryPage: gsc.unreadable_rows.query_page,
            page: gsc.unreadable_rows.page,
          })}
        </p>
      ) : null}
    </Cell>
  );
}

function LlmCell({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const llm = brief.run.reads.llm;
  const calls =
    llm.model_id === null
      ? t("coverage.llmCallsNoModel", { calls: llm.calls })
      : t("coverage.llmCalls", { calls: llm.calls, model: llm.model_id });
  const tokens =
    llm.input_tokens === null || llm.output_tokens === null
      ? null
      : t("coverage.llmTokens", {
        input: number(llm.input_tokens, locale),
        output: number(llm.output_tokens, locale),
      });
  if (llm.status === "unavailable") {
    return (
      <Cell name="llm" label={t("coverage.llm")} tone="model" status="unavailable" reason={llm.reason} figure={calls} t={t}>
        <UnavailableLines read={llm} group="unavailable" t={t} />
        {tokens !== null ? <p className="font-mono">{tokens}</p> : null}
      </Cell>
    );
  }
  return (
    <Cell name="llm" label={t("coverage.llm")} tone="model" status="complete" figure={calls} t={t}>
      {tokens !== null ? <p className="font-mono">{tokens}</p> : null}
    </Cell>
  );
}

export function EvidenceCoverage({
  brief,
  locale,
  t,
}: {
  readonly brief: ContentBrief;
  readonly locale: string;
  readonly t: Translate;
}) {
  const { serp, crawl, gsc, product_profile: profile } = brief.run.reads;
  const summaries = [
    { name: "serp", tone: "third", read: serp, figure: serp.status === "unavailable" ? null : t("coverage.serpRows", serp), detail: null },
    { name: "crawl", tone: "third", read: crawl, figure: crawl.status === "unavailable" ? null : t("coverage.crawlObserved", crawl), detail: null },
    { name: "gsc", tone: "first", read: gsc, figure: null, detail: gsc.status === "unavailable" ? null : gsc.property },
    { name: "profile", tone: "first", read: profile, figure: null, detail: profile.status === "unavailable" ? null : t("coverage.profileSnapshot", { revision: profile.snapshot_revision }) },
  ] as const;
  return (
    <div className={styles.coverage}>
      <section data-source-summary>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-brand-border-card bg-brand-border-card sm:grid-cols-4">
          {summaries.map(({ name, tone, read, figure, detail }) => {
            const notUsed = read.status === "unavailable" && read.reason === "not_requested";
            const label = notUsed ? t("coverage.notUsed") : translated(t, `modes.${read.status}`);
            return (
              <div key={name} data-source-summary-item={name} className="min-w-0 bg-brand-panel px-3 py-2.5">
                <div className={`font-mono text-[10px] uppercase tracking-[0.1em] ${CELL_LABEL[tone]}`}>{t(`coverage.${name}`)}</div>
                <div className="mt-1 text-[15px] font-semibold text-text-dark-primary">{figure ?? label}</div>
                <p className="mt-1 text-text-dark-secondary">
                  {detail ?? (read.status === "unavailable" && !notUsed ? reasonCopy(t, "unavailable", read.reason) : label)}
                </p>
              </div>
            );
          })}
        </div>
      </section>
      <details data-evidence-details className="mt-2">
        <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">{t("coverage.details")}</summary>
        <section data-evidence-coverage className={`${CARD} mt-3`}>
          <h3 className={SECTION_TITLE}>{t("coverage.title")}</h3>
          <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            {serp.status === "unavailable" ? (
              <Cell name="serp" label={t("coverage.serp")} tone="third" status="unavailable" reason={serp.reason} figure="—" t={t}>
                <UnavailableLines read={serp} group="unavailable" t={t} />
              </Cell>
            ) : (
              <Cell
                name="serp"
                label={t("coverage.serp")}
                tone="third"
                status={serp.status}
                figure={t("coverage.serpRows", {
                  returned: serp.returned,
                  requested: serp.requested,
                })}
                bar={{ value: serp.returned, of: serp.requested }}
                t={t}
              >
                <p data-serp-unresolved>
                  {t("coverage.serpUnresolved", { count: serp.unresolved })}
                </p>
              </Cell>
            )}
            <CrawlCell brief={brief} locale={locale} t={t} />
            <GscCell brief={brief} locale={locale} t={t} />
            {profile.status === "unavailable" ? (
              <Cell name="profile" label={t("coverage.profile")} tone="first" status="unavailable" reason={profile.reason} figure="—" t={t}>
                <UnavailableLines read={profile} group="unavailable" t={t} />
              </Cell>
            ) : (
              <Cell
                name="profile"
                label={t("coverage.profile")}
                tone="first"
                status="complete"
                figure={t("coverage.profileSnapshot", {
                  revision: profile.snapshot_revision,
                })}
                t={t}
              >
                <p className="break-all font-mono">{profile.profile_hash}</p>
              </Cell>
            )}
            <LlmCell brief={brief} locale={locale} t={t} />
          </div>
          {brief.run.mode === "unavailable" ? (
            <p className={`mt-4 ${BODY_TEXT}`}>{t("modeBody.unavailable")}</p>
          ) : null}
          <details className="mt-4 border-t border-brand-border-card pt-3">
            <summary className="cursor-pointer text-[11.5px] text-text-dark-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">{t("coverage.ledger")}</summary>
            <pre data-evidence-ledger className="mt-3 max-h-[32rem] overflow-y-auto whitespace-pre-wrap break-all rounded-[4px] bg-brand-bg p-3 font-mono text-[11px] leading-[1.5] text-text-dark-secondary">{JSON.stringify(brief.evidence, null, 2)}</pre>
          </details>
        </section>
      </details>
    </div>
  );
}
