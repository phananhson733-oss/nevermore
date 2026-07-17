import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export type StatusTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "priority"
  | "neutral";

const TONE_CLASS: Record<StatusTone, string | undefined> = {
  success: styles.pillSuccess,
  warning: styles.pillWarning,
  danger: styles.pillDanger,
  info: styles.pillInfo,
  priority: styles.pillPriority,
  neutral: styles.pillNeutral,
};

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: StatusTone;
  readonly children: ReactNode;
}

/**
 * Status chip that pairs a colored dot with a mandatory text label — status is
 * never conveyed by color alone (spec §4.4). The dot is decorative
 * (`aria-hidden`); the label carries the meaning. No `role` is forced: a static
 * chip should not be a live region. Pass `role`/`aria-*` through `...rest` when
 * the surrounding context calls for it (e.g. a live-updating region).
 */
export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(function StatusPill(
  { tone = "neutral", className, children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={cx(styles.pill, TONE_CLASS[tone], className)} {...rest}>
      <span className={styles.pillDot} aria-hidden="true" />
      <span className={styles.pillLabel}>{children}</span>
    </span>
  );
});
