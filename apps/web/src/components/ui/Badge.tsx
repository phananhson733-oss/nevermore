import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export type BadgeTone = "neutral" | "accent" | "mint" | "amber" | "coral" | "violet";

const TONE_CLASS: Record<BadgeTone, string | undefined> = {
  neutral: undefined,
  accent: styles.badgeAccent,
  mint: styles.badgeMint,
  amber: styles.badgeAmber,
  coral: styles.badgeCoral,
  violet: styles.badgeViolet,
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: BadgeTone;
}

/** Small labeling chip (radius-chip) for tags and categories. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = "neutral", className, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cx(styles.badge, TONE_CLASS[tone], className)} {...rest} />
  );
});
