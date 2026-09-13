"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  LEGACY_LABEL_KEY,
  legacyHref,
  type LegacySegment,
} from "@/lib/workbench/routes";

/** "旧版页面 →" affordance (design §4.3). One link per legacy destination. */
export function LegacyLinks({
  projectId,
  segments,
}: {
  readonly projectId: string;
  readonly segments: readonly LegacySegment[];
}) {
  const t = useTranslations("workbench.shell");
  const tNav = useTranslations("nav");
  if (segments.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {segments.map((segment) => (
        <Link
          key={segment}
          href={legacyHref(projectId, segment)}
          data-wb-legacy-link={segment}
          // `-my-1 py-1`: a `text-xs` link is a 16px line box, under the 24px
          // WCAG 2.5.8 minimum. The margin box keeps its old height, so the
          // header row this sits in does not move. Vertical only — every label
          // here is a page name, far wider than 24px.
          className="-my-1 py-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
        >
          {t("legacy")} · {tNav(LEGACY_LABEL_KEY[segment])} →
        </Link>
      ))}
    </span>
  );
}
