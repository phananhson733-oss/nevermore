"use client";

import { useTranslations } from "next-intl";

export function DemoChip({ demo = false }: { readonly demo?: boolean }) {
  const t = useTranslations("workbench.shell");
  return (
    <span
      title={t("sampleTitle")}
      className="inline-flex h-[26px] items-center rounded border border-amber-200/60 bg-amber-50 px-2 text-xs font-medium text-amber-700"
    >
      {demo ? t("sampleSite") : t("sampleData")}
    </span>
  );
}
