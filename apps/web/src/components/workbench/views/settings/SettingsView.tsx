"use client";

import { useTranslations } from "next-intl";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { PageHead } from "../../ui/PageHead.tsx";
import { DeleteProjectSection } from "./DeleteProjectSection.tsx";

/** PR-1 form (design §4.2): placeholder note + the real delete block. PR-3 adds notify + data sources. */
export function SettingsView({ projectId }: { readonly projectId: string }) {
  const tNav = useTranslations("workbench.nav.items");
  const tShell = useTranslations("workbench.shell");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <PageHead title={tNav("settings")} aside={<DemoChip />} />
      <p className="mb-6 text-[13px] text-slate-500">{tShell("inProgressDetail")}</p>
      <DeleteProjectSection projectId={projectId} />
    </div>
  );
}
