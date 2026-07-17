import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "text";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.btnPrimary,
  secondary: styles.btnSecondary,
  // ghost + text are the same inline-cobalt treatment.
  ghost: styles.btnGhost,
  text: styles.btnGhost,
};

const SIZE_CLASS: Record<ButtonSize, string | undefined> = {
  sm: styles.btnSm,
  md: styles.btnMd,
};

/**
 * Action button. Defaults to `type="button"` so it never accidentally submits a
 * form. Disabled state is native (`opacity .48` + `not-allowed`); the global
 * focus-visible ring is intentionally left untouched.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", type = "button", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.btn, SIZE_CLASS[size], VARIANT_CLASS[variant], className)}
      {...rest}
    />
  );
});
