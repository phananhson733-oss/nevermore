"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LEGACY_LINKS } from "@/lib/workbench/routes";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { LegacyLinks } from "../../ui/LegacyLinks.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import type { ProfileSources } from "./build-profile-doc.ts";
import { ProfileInputPane } from "./ProfileInputPane.tsx";
import { ProfileOutputPane } from "./ProfileOutputPane.tsx";
import type { ProfileTab } from "./profile-artifact.ts";
import { useProfileRun } from "./useProfileRun.ts";

/**
 * The site profile page (plan Task 9; design §12 row `profile`; outward form
 * `ref:opengengrowth/views/SiteProfileView.tsx`, behaviour jsx `ProfileView`).
 *
 * A thin view: the inputs are the store's profile, the output is the stored
 * snapshot, the run is `useProfileRun` and the document is `buildProfileDoc`.
 * The subtitle says the signals are generated locally (Q16); the header's
 * sample chip is hung the way the other views hang it.
 *
 * Before the store has read storage both panes are a skeleton, not an empty
 * profile (Q10). The root is `<main>`'s direct child with its own padding and
 * `.wb-reset`, two-pane width (Q26); framework copy is marked `data-wb-frame`
 * in each pane (Q30).
 */

const ROOT = "wb-reset mx-auto min-h-full max-w-[1600px] p-6 font-sans text-slate-900 md:p-10";
const GRID = "grid grid-cols-1 items-start gap-6 lg:grid-cols-[5fr_7fr]";
const SKELETON_PANE = "h-[480px] animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none";
const ALL_SOURCES: ProfileSources = { crawl: true, gsc: true, third: true };

function ProfileSkeleton() {
  return (
    <div data-wb-skeleton="" aria-busy="true" className={GRID}>
      <div aria-hidden="true" className={SKELETON_PANE} />
      <div aria-hidden="true" className={SKELETON_PANE} />
    </div>
  );
}

function ProfileWorkspace() {
  const { state, dispatch, projectId } = useWorkbench();
  const [srcs, setSrcs] = useState<ProfileSources>(ALL_SOURCES);
  const [tab, setTab] = useState<ProfileTab>("doc");
  const { progress, start, refused } = useProfileRun();
  return (
    <div className={GRID}>
      <ProfileInputPane
        projectId={projectId}
        profile={state.profile}
        srcs={srcs}
        running={progress !== null}
        stale={refused}
        hasDoc={state.profileDoc !== null}
        onRun={() => start(srcs)}
        onPatch={(patch) => dispatch({ type: "patchProfile", patch })}
        onSrcsChange={setSrcs}
      />
      <ProfileOutputPane
        profile={state.profile}
        doc={state.profileDoc}
        tab={tab}
        onTab={setTab}
        progress={progress}
      />
    </div>
  );
}

export function ProfileView() {
  const { state, ready, projectId } = useWorkbench();
  const tNav = useTranslations("workbench.nav.items");
  const t = useTranslations("workbench.profile");
  return (
    <div className={ROOT}>
      <div data-wb-frame="">
        <PageHead
          title={tNav("profile")}
          subtitle={t("subtitle")}
          aside={
            <>
              <LegacyLinks projectId={projectId} segments={LEGACY_LINKS.profile} />
              <DemoChip demo={ready && state.demo} />
            </>
          }
        />
      </div>
      {ready ? <ProfileWorkspace /> : <ProfileSkeleton />}
    </div>
  );
}
