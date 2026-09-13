import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * Status pill. The point of the component is `CHIP_TONE`: the prototype spelled
 * the same three colour sets out by hand in three places (the GSC table's
 * ranking / borderline / gap cells), so a fourth state or a contrast fix had to
 * be found in all of them. A tone is named here once and nowhere else.
 *
 * Tones map to the workbench's palette (research §3.4): `seo` emerald,
 * `geo` fuchsia (the rail's GEO tone — never violet, 裁决 Q19), `warn` amber,
 * `bad` rose (rose, not red: the destructive colour in DeleteProjectSection is
 * rose and two near-identical reds read as two meanings). Every text/background
 * pair clears WCAG AA 4.5:1, which 12px text needs: amber-800 on amber-50 and
 * rose-700 on rose-50 rather than the prototype's lighter pairs.
 *
 * Borders are explicit: `.wb-reset` zeroes border widths, so a chip without a
 * `border` class has no outline at all.
 */

export const CHIP_TONES = ["neutral", "seo", "geo", "warn", "bad"] as const;

export type ChipTone = (typeof CHIP_TONES)[number];

const CHIP_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium";

const CHIP_TONE: Readonly<Record<ChipTone, string>> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  seo: "border-emerald-200 bg-emerald-50 text-emerald-700",
  geo: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-rose-200 bg-rose-50 text-rose-700",
};

export function Chip({
  tone,
  children,
  title,
}: {
  readonly tone: ChipTone;
  readonly children: ReactNode;
  readonly title?: string | undefined;
}) {
  return (
    <span className={cn(CHIP_BASE, CHIP_TONE[tone])} title={title}>
      {children}
    </span>
  );
}
