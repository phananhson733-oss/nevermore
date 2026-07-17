import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./ui.module.css";

export type CardTone = "neutral" | "cobalt" | "mint" | "amber" | "coral" | "violet";
export type CardPadding = "none" | "sm" | "md" | "lg";

const TONE_CLASS: Record<CardTone, string | undefined> = {
  neutral: undefined,
  cobalt: styles.toneCobalt,
  mint: styles.toneMint,
  amber: styles.toneAmber,
  coral: styles.toneCoral,
  violet: styles.toneViolet,
};

const PADDING_CLASS: Record<CardPadding, string | undefined> = {
  none: styles.padNone,
  sm: styles.padSm,
  md: styles.padMd,
  lg: styles.padLg,
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: CardTone;
  readonly padding?: CardPadding;
}

/** Surface container. `tone` adds a subtle tinted ring in that accent. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = "neutral", padding = "md", className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx(styles.card, TONE_CLASS[tone], PADDING_CLASS[padding], className)}
      {...rest}
    />
  );
});

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  readonly tone?: CardTone;
  readonly padding?: CardPadding;
}

/** Same surface as {@link Card} but renders a `<section>` landmark. */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { tone = "neutral", padding = "md", className, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      className={cx(styles.card, TONE_CLASS[tone], PADDING_CLASS[padding], className)}
      {...rest}
    />
  );
});

export interface DarkPanelProps extends HTMLAttributes<HTMLElement> {
  readonly padding?: CardPadding;
}

/**
 * Inverted "ink" panel: fixed dark background + light text in both themes, for
 * the demo's near-black feature panels.
 */
export const DarkPanel = forwardRef<HTMLElement, DarkPanelProps>(function DarkPanel(
  { padding = "md", className, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      className={cx(styles.card, styles.darkPanel, PADDING_CLASS[padding], className)}
      {...rest}
    />
  );
});
