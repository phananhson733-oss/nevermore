import { cn } from "./cn.ts";
import { statValue } from "./stat-format.ts";

/**
 * The change next to a metric: `+7`, `-2`, `+6pt`.
 *
 * `null` renders nothing at all rather than a dash — a metric with no
 * comparison point has no delta, and "—" next to a number reads as a measured
 * flat result. Zero is a measured result and does render, without a sign and in
 * neutral ink.
 *
 * Direction is carried by the sign, not only by colour. The two colours are
 * emerald-700 / rose-700 rather than the prototype's emerald-600 / rose-500:
 * this is 14px text, so it needs 4.5:1 on white, and the prototype's pair
 * measures 3.77:1 and 3.70:1 (emerald-700 is 5.48:1, rose-700 6.28:1). PR-1 made
 * the same lift in seven places.
 *
 * "Up is good" is not universal (a rank delta is better when negative), so the
 * caller that wants the other polarity negates the value it passes; there is no
 * `invert` prop to forget.
 */
export function Delta({
  value,
  unit,
}: {
  readonly value: number | null;
  readonly unit?: string | undefined;
}) {
  if (value === null) return null;
  const text = statValue(value);
  if (text === null) return null;
  const tone = value > 0 ? "text-emerald-700" : value < 0 ? "text-rose-700" : "text-slate-500";
  return (
    <span className={cn("text-sm font-medium", tone)}>
      {value > 0 ? "+" : ""}
      {text}
      {unit ?? ""}
    </span>
  );
}
