"use client";

import { useTranslations } from "next-intl";
import { PageHead } from "../../ui/PageHead.tsx";
import { DeleteProjectSection } from "./DeleteProjectSection.tsx";

/**
 * PR-1 form (design §4.2): in-progress note + the real delete block. PR-3 adds
 * notify + data sources. No `DemoChip`: the page carries no mock content, and
 * `inProgressNoLegacy` is used unconditionally because the legacy settings page
 * was deleted, so there is nothing that "keeps working meanwhile".
 */
export function SettingsView({ projectId }: { readonly projectId: string }) {
  const tNav = useTranslations("workbench.nav.items");
  const tShell = useTranslations("workbench.shell");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <PageHead title={tNav("settings")} />
      <p className="mb-6 text-[13px] text-slate-500">{tShell("inProgressNoLegacy")}</p>
      <DeleteProjectSection projectId={projectId} />
    </div>
  );
}
