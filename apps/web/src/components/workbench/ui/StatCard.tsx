import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { Delta } from "./Delta.tsx";
import { FOOT_NOTE, STAT_CARD_SHELL } from "./panel.ts";
import { UNKNOWN_TEXT } from "./stat-format.ts";

/**
 * One metric card: big value, label, footnote, optional delta, optionally a link
 * to the page that explains it.
 *
 * `value` is `string | null` and `null` prints an em dash. It is never 0: a zero
 * printed for "we have not measured this" is the dishonesty 裁决 Q10 forbids,
 * and the conversion that keeps a real zero while mapping unknown to `null` is
 * `statValue` in stat-format.ts. Before the store has read storage the caller
 * renders a skeleton instead of this card — an em dash is "unknown", not
 * "loading" (design §4.3). The accent is dropped when the value is unknown:
 * colouring a dash implies there is a value behind it.
 *
 * `href` makes the whole card a `<Link>`, not a button with `router.push`: a
 * real anchor is what the Studio unsaved-changes guard listens for, and a
 * programmatic push walks straight past it (PR-1 red-team A1).
 *
 * Accents are only for the 36px semibold numeral, where WCAG's 3:1 large-text
 * threshold applies; on white that is fuchsia-500 3.54:1, emerald-600 3.74:1,
 * amber-600 3.21:1, and amber has only 0.05 of margin on the wb-paper ground, so
 * none of them may be reused for body copy. Those ratios are computed, not
 * claimed: color-pairs.test.ts is the authority and these numbers only quote it.
 * `fuchsia` is the AI-mention tone, matching the rail's GEO dot; the prototype's
 * violet-500 is a deliberate deviation (裁决 Q19) and is not offered here, so no
 * view can pick it and split one concept across two colours.
 */

export type StatAccent = "default" | "fuchsia" | "emerald" | "amber";

const ACCENT: Readonly<Record<StatAccent, string>> = {
  default: "text-slate-900",
  fuchsia: "text-fuchsia-500",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
};

const LINK_SHELL = "group transition-colors hover:border-slate-300";

export function StatCard({
  value,
  label,
  foot,
  delta,
  deltaUnit,
  accent = "default",
  href,
}: {
  readonly value: string | null;
  readonly label: string;
  readonly foot: ReactNode;
  readonly delta?: number | null | undefined;
  /** Unit for the delta, e.g. "pt" for a percentage-point move (week view). */
  readonly deltaUnit?: string | undefined;
  readonly accent?: StatAccent | undefined;
  readonly href?: string | undefined;
}) {
  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "text-4xl font-semibold",
            value === null ? "text-slate-500" : ACCENT[accent],
          )}
        >
          {value ?? UNKNOWN_TEXT}
        </span>
        {/* The unit is spread rather than passed as `undefined`: under
            exactOptionalPropertyTypes an absent optional is an omitted key. */}
        {delta === undefined ? null : (
          <Delta value={delta} {...(deltaUnit === undefined ? {} : { unit: deltaUnit })} />
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-slate-600 group-hover:text-slate-900">{label}</p>
      <div className={FOOT_NOTE}>{foot}</div>
    </>
  );

  if (href === undefined) return <div className={STAT_CARD_SHELL}>{body}</div>;
  return (
    <Link href={href} className={cn(STAT_CARD_SHELL, LINK_SHELL)}>
      {body}
    </Link>
  );
}
