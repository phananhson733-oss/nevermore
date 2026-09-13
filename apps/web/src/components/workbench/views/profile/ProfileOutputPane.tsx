"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Profile, ProfileDoc } from "@/lib/workbench/types";
import type { ArtifactDraft } from "../../hooks/useAddArtifact.ts";
import {
  ARTIFACT_ACTION_LABEL_KEYS,
  ArtifactActions,
  type ArtifactActionLabels,
} from "../../ui/ArtifactActions.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { OutPane } from "../../ui/OutPane.tsx";
import type { TabItem } from "../../ui/Tabs.tsx";
import { ProfileDocTab } from "./ProfileDocTab.tsx";
import { ProfileTextTab } from "./ProfileTextTab.tsx";
import {
  PROFILE_TABS,
  isProfileTab,
  profileArtifactBody,
  profileArtifactDraft,
  type ProfileTab,
} from "./profile-artifact.ts";
import type { ProfileRunProgress } from "./useProfileRun.ts";
import { usePreparedArtifact } from "./usePreparedArtifact.ts";

/**
 * The profile page's output pane (plan Task 9 Step 4; outward form
 * `ref:opengengrowth/views/SiteProfileView.tsx:144-392`).
 *
 * `OutPane`'s three-way body: a run in flight shows its steps, then the stored
 * snapshot, then the empty state. The title reads the stored snapshot's stamp,
 * so while a run is in flight the page still names the profile the store holds
 * (Q14) — and the actions are withdrawn for that time, because the text they
 * would hand over is not what the body is showing.
 *
 * The four actions are `ArtifactActions` over one prepared text per tab (Q23):
 * copy, export and save take it as stamped, "copy for an AI" wraps the same
 * string. Its labels are the shared `artifactActions` messages, generated from
 * the component's own key table; the row brings its own status line and its
 * full / too-large notices, so this pane renders none of its own.
 */

export interface ProfileOutputPaneProps {
  readonly profile: Profile;
  readonly doc: ProfileDoc | null;
  readonly tab: ProfileTab;
  readonly onTab: (tab: ProfileTab) => void;
  readonly progress: ProfileRunProgress | null;
}

type LabelField = keyof typeof ARTIFACT_ACTION_LABEL_KEYS;

function useActionLabels(): ArtifactActionLabels {
  const t = useTranslations("workbench.artifactActions");
  const fields = Object.keys(ARTIFACT_ACTION_LABEL_KEYS) as LabelField[];
  return Object.fromEntries(fields.map((field) => [field, t(field)])) as Record<LabelField, string>;
}

function ProfileActions({ draft }: { readonly draft: ArtifactDraft }) {
  const prepared = usePreparedArtifact(draft);
  const labels = useActionLabels();
  if (prepared === null) {
    return (
      <div
        data-wb-skeleton=""
        className="h-[28px] w-64 max-w-full animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none"
      />
    );
  }
  return (
    <div data-wb-frame="" className="flex flex-col gap-2">
      <ArtifactActions prepared={prepared} labels={labels} />
    </div>
  );
}

function TabBody({
  tab,
  profile,
  doc,
}: {
  readonly tab: ProfileTab;
  readonly profile: Profile;
  readonly doc: ProfileDoc;
}) {
  return tab === "doc" ? <ProfileDocTab doc={doc} /> : <ProfileTextTab text={profileArtifactBody(tab, profile, doc)} />;
}

export function ProfileOutputPane({ profile, doc, tab, onTab, progress }: ProfileOutputPaneProps) {
  const t = useTranslations("workbench.profile");
  const tNav = useTranslations("workbench.nav.items");
  const tPanes = useTranslations("workbench.panes");
  const idPrefix = `profile-out-${useId()}`;
  const items: readonly TabItem[] = PROFILE_TABS.map((id) => [id, t(`tabs.${id}`)] as const);
  const run =
    progress === null
      ? null
      : { steps: progress.steps.map((id) => t(`run.steps.${id}`)), current: progress.current };
  const footer =
    doc === null || progress !== null ? undefined : (
      <ProfileActions
        draft={profileArtifactDraft(tab, profile, doc, t(`artifactTitle.${tab}`, { brand: profile.brand }))}
      />
    );
  return (
    <OutPane
      title={doc === null ? tNav("profile") : t("doc.stamp", { at: doc.at })}
      tag={tPanes("out")}
      tabs={{
        items,
        value: tab,
        onChange: (id) => {
          if (isProfileTab(id)) onTab(id);
        },
        label: t("tabs.label"),
        idPrefix,
      }}
      run={run}
      hasContent={doc !== null}
      empty={
        <div data-wb-frame="">
          <EmptyState title={t("empty.title")} detail={t("empty.detail")} />
        </div>
      }
      footer={footer}
    >
      {doc === null ? null : <TabBody tab={tab} profile={profile} doc={doc} />}
    </OutPane>
  );
}
