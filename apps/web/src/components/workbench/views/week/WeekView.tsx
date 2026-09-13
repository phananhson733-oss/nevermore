"use client";

import { useTranslations } from "next-intl";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { useNowStamp } from "../../hooks/useNowStamp.ts";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import { CARD_SHELL } from "../../ui/panel.ts";
import { WeekCards } from "./WeekCards.tsx";
import { WeekPanels } from "./WeekPanels.tsx";
import { WeekReport } from "./WeekReport.tsx";
import { weekRange, weekSummary } from "./week-summary.ts";

/**
 * The week page (plan Task 8; design §12 row `week`; outward form
 * `ref:opengengrowth/views/WeeklyView.tsx`, behaviour jsx `WeekView`).
 *
 * A thin view: every number comes from `weekSummary`, the clock from
 * `useNowStamp` (read in an effect once the store is hydrated, Q22), and the
 * report text from the mock-layer builder, stamped by `useAddArtifact` (Q23).
 * Until both the store and the clock are ready it renders a skeleton, never a
 * dash: a dash is "unknown", not "loading" (Q10).
 *
 * An empty project shows one empty state instead of a row of zero cards, and
 * its report cannot be saved (jsx W18). Anything at all — even one old artifact
 * or an import with no borderline row — is a week worth showing, because every
 * number on it is then either measured or honestly unknown.
 *
 * The root carries its own padding and `.wb-reset` and sits directly under
 * `<main>` (Q26). Framework copy is marked `data-wb-frame` (Q30); rows that
 * carry data (artifact titles, queries, the brand) are deliberately outside it.
 */

const ROOT =
  "wb-reset mx-auto min-h-full max-w-[1200px] p-6 font-sans text-slate-900 md:p-10";
const SKELETON_CARD =
  "h-[140px] animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none";

function WeekSkeleton({ title }: { readonly title: string }) {
  return (
    <div className={ROOT}>
      <PageHead title={title} />
      <div data-wb-skeleton="" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={SKELETON_CARD} />
        <div className={SKELETON_CARD} />
        <div className={SKELETON_CARD} />
      </div>
    </div>
  );
}

export function WeekView() {
  const { state, ready, projectId } = useWorkbench();
  const clock = useNowStamp();
  const tNav = useTranslations("workbench.nav.items");
  const t = useTranslations("workbench.week");
  if (!ready || clock === null) return <WeekSkeleton title={tNav("week")} />;

  const summary = weekSummary(state, clock.now);
  return (
    <div className={ROOT}>
      <div data-wb-frame="">
        <PageHead
          title={tNav("week")}
          subtitle={t("subtitle", weekRange(clock.now))}
          aside={<DemoChip demo={state.demo} />}
        />
      </div>
      {summary.empty ? (
        <div data-wb-frame="" data-wb-week-empty="" className={CARD_SHELL}>
          <EmptyState title={t("empty.title")} detail={t("empty.detail")} />
        </div>
      ) : (
        <>
          <WeekCards summary={summary} projectId={projectId} />
          <WeekPanels summary={summary} projectId={projectId} />
        </>
      )}
      <WeekReport summary={summary} brand={state.profile.brand} now={clock.now} />
    </div>
  );
}
