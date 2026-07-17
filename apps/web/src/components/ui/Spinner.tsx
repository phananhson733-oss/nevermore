import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export type SpinnerSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<SpinnerSize, string | undefined> = {
  sm: styles.spinnerSm,
  md: styles.spinnerMd,
  lg: styles.spinnerLg,
};

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, "aria-label"> {
  /** Accessible busy label announced by screen readers. */
  readonly label?: string;
  readonly size?: SpinnerSize;
}

/**
 * Accessible busy indicator. `role="status"` (a polite live region) plus an
 * `aria-label` announces the busy state; the spinning graphic is decorative.
 * The animation stops under the global `prefers-reduced-motion` block.
 */
export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { label = "Loading", size = "md", className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role="status"
      aria-label={label}
      className={cx(styles.spinnerRoot, className)}
      {...rest}
    >
      <span className={cx(styles.spinner, SIZE_CLASS[size])} aria-hidden="true" />
    </span>
  );
});
