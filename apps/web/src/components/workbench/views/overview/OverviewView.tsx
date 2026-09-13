"use client";

import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";
import { domainOf } from "@/lib/workbench/mock/text";
import { LEGACY_LINKS, workbenchHref } from "@/lib/workbench/routes";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { formatShare } from "@/lib/workbench/store/selectors";
import type { KeywordRow, WorkbenchProjectState } from "@/lib/workbench/types";
import { cn } from "../../ui/cn.ts";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LegacyLinks } from "../../ui/LegacyLinks.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import { BUTTON_SECONDARY, CARD_PAD, CARD_SHELL, PANEL_TITLE, ROW_RULE, STAT_CARD_SHELL } from "../../ui/panel.ts";
import { StatCard } from "../../ui/StatCard.tsx";
import { statValue } from "../../ui/stat-format.ts";
import { LoadDemoButton } from "./LoadDemoButton.tsx";
import { isOverviewEmpty, overviewNextSteps, type NextStep } from "./next-steps.ts";

/**
 * Overview (design §12 row 1): four metric cards, "what to do next", and the
 * "load sample site" entry on an empty project.
 *
 * Every number has one producer and one way to say "unknown":
 * - health: `audit.score`; no audit → dash.
 * - AI mention rate: `formatShare` over the last COMPLETED run (`lastVis`, see
 *   next-steps.ts for why not `visResults`); no completed run → dash.
 * - keyword candidates: the provider's `keywordRowCount` — the sidebar badge's
 *   producer (R15), `null` until the matrix is built — never a count rebuilt
 *   here. Its footnote counts the gated rows that came from GSC.
 * - artifacts: `artifacts.length`, printed even at 0. `selectCounts` is not used
 *   for it: badges hide a zero, and "no artifact yet" is a measured fact (Q9).
 *
 * Whether those GSC rows are the sample's or the operator's is read from
 * `gscRowsSource`, never from `state.demo` (Q6): loading the sample and then
 * importing real rows keeps `demo` up while the rows are no longer sample data.
 *
 * Before the store has read storage the cards are a skeleton, not dashes (Q10).
 * The root is `<main>`'s direct child with its own padding and `.wb-reset`
 * (Q26); the containers of frame copy carry `data-wb-frame` (Q30) — the metric
 * values are numbers and the subtitle carries the project's own domain and
 * brand, everything else in them is catalogue copy.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function OverviewView({ projectId }: { readonly projectId: string }) {
  const { state, ready } = useWorkbench();
  const tNav = useTranslations("workbench.nav.items");
  const t = useTranslations("workbench.overview");
  const { profile } = state;
  const subtitle = t("subtitle", { domain: domainOf(profile.url), brand: profile.brand, market: profile.market });
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <div data-wb-frame="">
        <PageHead
          title={tNav("overview")}
          subtitle={subtitle}
          aside={
            <>
              <LegacyLinks projectId={projectId} segments={LEGACY_LINKS.overview} />
              <DemoChip />
            </>
          }
        />
      </div>
      {ready ? <OverviewBody projectId={projectId} /> : <OverviewSkeleton />}
    </div>
  );
}

const SKELETON_CARDS = ["health", "mention", "keywords", "artifacts"] as const;
const NO_ROWS: readonly KeywordRow[] = [];

function OverviewSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {SKELETON_CARDS.map((key) => (
          <div key={key} aria-hidden="true" className={cn(STAT_CARD_SHELL, "animate-pulse motion-reduce:animate-none")}>
            <div className="h-9 w-16 rounded bg-slate-100" />
            <div className="mt-3 h-4 w-28 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className={cn(CARD_SHELL, "h-40 animate-pulse motion-reduce:animate-none")} />
    </div>
  );
}

function OverviewBody({ projectId }: { readonly projectId: string }) {
  const { state, keywordRows, keywordRowCount } = useWorkbench();
  const rows = state.built ? keywordRows : NO_ROWS;
  return (
    <>
      <OverviewCards state={state} rows={rows} keywordRowCount={keywordRowCount} />
      {isOverviewEmpty(state) ? (
        <EmptyBlock />
      ) : (
        <NextStepsCard
          projectId={projectId}
          steps={overviewNextSteps({ audit: state.audit, lastVis: state.lastVis, rows })}
        />
      )}
      {state.gscRows.length === 0 ? <NoGscCallout projectId={projectId} /> : null}
    </>
  );
}

function OverviewCards({
  state,
  rows,
  keywordRowCount,
}: {
  readonly state: WorkbenchProjectState;
  readonly rows: readonly KeywordRow[];
  readonly keywordRowCount: number | null;
}) {
  const t = useTranslations("workbench.overview.cards");
  const { audit, lastVis } = state;
  const results = lastVis?.results ?? [];
  const hits = results.filter((result) => result.hit).length;
  const unknown = t("unknown");
  return (
    <div data-wb-frame="" className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        value={statValue(audit?.score)}
        label={t("health.label")}
        foot={audit === null ? unknown : t("health.foot", { count: audit.findings.length })}
      />
      <StatCard
        value={results.length === 0 ? null : formatShare(hits, results.length)}
        label={t("mention.label")}
        foot={results.length === 0 ? unknown : t("mention.foot", { hits, total: results.length })}
        accent="fuchsia"
      />
      <StatCard
        value={statValue(keywordRowCount)}
        label={t("keywords.label")}
        foot={keywordRowCount === null ? unknown : <KeywordFoot rows={rows} source={state.gscRowsSource} />}
        accent="emerald"
      />
      <StatCard value={statValue(state.artifacts.length)} label={t("artifacts.label")} foot={t("artifacts.foot")} />
    </div>
  );
}

function KeywordFoot({
  rows,
  source,
}: {
  readonly rows: readonly KeywordRow[];
  readonly source: WorkbenchProjectState["gscRowsSource"];
}) {
  const t = useTranslations("workbench.overview");
  const fromGsc = rows.filter((row) => row.source === "gsc").length;
  return (
    <>
      <span className="block">{t("cards.keywords.foot", { count: fromGsc })}</span>
      {/* `null` is unknown provenance: neither label is true, so neither is shown. */}
      {source === null ? null : <span className="mt-1 block">{t(`gscFoot.${source}`)}</span>}
    </>
  );
}

function EmptyBlock() {
  const t = useTranslations("workbench.overview.empty");
  return (
    <section data-wb-frame="" className={CARD_SHELL}>
      <EmptyState title={t("title")} detail={t("detail")} action={<LoadDemoButton />} />
    </section>
  );
}

function NextStepsCard({ projectId, steps }: { readonly projectId: string; readonly steps: readonly NextStep[] }) {
  const t = useTranslations("workbench.overview.next");
  return (
    <section data-wb-frame="" className={cn(CARD_SHELL, CARD_PAD)}>
      <h2 className={PANEL_TITLE}>{t("title")}</h2>
      <ol className="mt-4 flex flex-col">
        {steps.map((step, index) => (
          <NextStepRow key={step.id} projectId={projectId} step={step} index={index} />
        ))}
      </ol>
    </section>
  );
}

function NextStepRow({
  projectId,
  step,
  index,
}: {
  readonly projectId: string;
  readonly step: NextStep;
  readonly index: number;
}) {
  const t = useTranslations("workbench.overview.next");
  const textId = useId();
  const text = "count" in step ? t(`step.${step.id}`, { count: step.count }) : t(`step.${step.id}`);
  return (
    <li data-wb-next-step={step.id} className={cn(ROW_RULE, "flex flex-wrap items-center gap-4 py-5")}>
      <span aria-hidden="true" className="font-mono text-xs text-slate-500">
        {String(index + 1).padStart(2, "0")}
      </span>
      <p id={textId} className="min-w-0 flex-1 text-[15px] font-medium text-slate-900">
        {text}
      </p>
      {/* A real <Link>, not router.push: the Studio unsaved-changes guard listens for anchors (Q21). */}
      <Link href={workbenchHref(projectId, step.target)} aria-describedby={textId} className={BUTTON_SECONDARY}>
        {t("cta")}
      </Link>
    </li>
  );
}

function NoGscCallout({ projectId }: { readonly projectId: string }) {
  const t = useTranslations("workbench.overview.noGsc");
  return (
    <section
      data-wb-frame=""
      className={cn(CARD_SHELL, "mt-4 flex flex-wrap items-center justify-between gap-3 p-5")}
    >
      <div className="min-w-0">
        <h2 className={PANEL_TITLE}>{t("title")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("detail")}</p>
      </div>
      <Link href={workbenchHref(projectId, "dataSources")} className={BUTTON_SECONDARY}>
        {t("cta")}
      </Link>
    </section>
  );
}
