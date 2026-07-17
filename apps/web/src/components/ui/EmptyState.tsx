import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Optional decorative glyph (inline SVG). Rendered `aria-hidden`. */
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Optional action slot (e.g. a retry `Button`) rendered below the copy. */
  readonly children?: ReactNode;
}

/**
 * Centered, muted placeholder for loading / empty / error panels. The icon is
 * decorative; title + description carry the message.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    { icon, title, description, className, children, ...rest },
    ref,
  ) {
    return (
      <div ref={ref} className={cx(styles.empty, className)} {...rest}>
        {icon != null ? (
          <span className={styles.emptyIcon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <p className={styles.emptyTitle}>{title}</p>
        {description != null ? (
          <p className={styles.emptyDesc}>{description}</p>
        ) : null}
        {children != null ? (
          <div className={styles.emptyActions}>{children}</div>
        ) : null}
      </div>
    );
  },
);
