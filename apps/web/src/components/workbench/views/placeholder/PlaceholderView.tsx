"use client";

import { useTranslations } from "next-intl";
import { LEGACY_LINKS, type WorkbenchPageId } from "@/lib/workbench/routes";
import { DemoChip } from "../../ui/DemoChip.tsx";
import { LegacyLinks } from "../../ui/LegacyLinks.tsx";
import { PageHead } from "../../ui/PageHead.tsx";

export function PlaceholderView({
  projectId,
  page,
}: {
  readonly projectId: string;
  readonly page: WorkbenchPageId;
}) {
  const tNav = useTranslations("workbench.nav.items");
  const tShell = useTranslations("workbench.shell");
  return (
    <div className="wb-reset mx-auto min-h-full max-w-5xl p-6 font-sans text-slate-900 md:p-10">
      <PageHead
        title={tNav(page)}
        aside={
          <>
            <LegacyLinks projectId={projectId} segments={LEGACY_LINKS[page]} />
            <DemoChip />
          </>
        }
      />
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
        <h2 className="mb-2 text-lg font-semibold text-slate-600">{tShell("inProgress")}</h2>
        <p className="max-w-md text-sm text-slate-400">{tShell("inProgressDetail")}</p>
      </div>
    </div>
  );
}
