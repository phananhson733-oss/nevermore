"use client";

import { useTranslations } from "next-intl";
import { PageHead } from "../../ui/PageHead.tsx";
import { DeleteProjectSection } from "./DeleteProjectSection.tsx";
import { NotifyBlock } from "./NotifyBlock.tsx";
import { SourcesSummaryBlock } from "./SourcesSummaryBlock.tsx";

/**
 * Settings (design §6.2, T11): three blocks and no save button (Q24).
 *
 * 1. `NotifyBlock` — local notification preferences, stating they stay in this
 *    browser and nothing is sent. No sample marker (codex S11 #1).
 * 2. `SourcesSummaryBlock` — read-only connection status and links out.
 * 3. `DeleteProjectSection` — the page's one real action
 *    (`[data-wb-real-action]`, pinned to exactly one by the e2e spec); no sample
 *    marker may sit inside it.
 *
 * The PR-1 "lands in a later batch" sentence is gone: the page is complete.
 * There is no legacy settings link, because that page was deleted. The root is
 * `<main>`'s direct child with its own padding and `.wb-reset`, overview width
 * (Q26); frame copy carries `data-wb-frame` (Q30).
 *
 * 一旦本文件被更新，务必更新开头注释
 */
export function SettingsView({ projectId }: { readonly projectId: string }) {
  const tNav = useTranslations("workbench.nav.items");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <div data-wb-frame="">
        <PageHead title={tNav("settings")} />
      </div>
      <NotifyBlock />
      <SourcesSummaryBlock projectId={projectId} />
      <DeleteProjectSection projectId={projectId} />
    </div>
  );
}
