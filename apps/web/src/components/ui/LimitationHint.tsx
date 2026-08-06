"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import { cx } from "./cx.ts";
import styles from "./limitation-hint.module.css";

const VIEWPORT_GUTTER = 12;
const TRIGGER_GAP = 8;

interface RectLike {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface LimitationPopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly side: "top" | "bottom";
}

/**
 * Deterministically keeps the evidence-boundary popover inside the viewport.
 * Exported for unit coverage without requiring layout-capable browser mocks.
 */
export function limitationPopoverPosition(input: {
  readonly trigger: RectLike;
  readonly popoverWidth: number;
  readonly popoverHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly align: "start" | "end";
}): LimitationPopoverPosition {
  const desiredLeft =
    input.align === "end"
      ? input.trigger.right - input.popoverWidth
      : input.trigger.left;
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, desiredLeft),
    Math.max(VIEWPORT_GUTTER, input.viewportWidth - input.popoverWidth - VIEWPORT_GUTTER),
  );
  const belowTop = input.trigger.bottom + TRIGGER_GAP;
  const aboveTop = input.trigger.top - input.popoverHeight - TRIGGER_GAP;
  const canFitBelow =
    belowTop + input.popoverHeight <= input.viewportHeight - VIEWPORT_GUTTER;
  const canFitAbove = aboveTop >= VIEWPORT_GUTTER;
  const side = canFitBelow || !canFitAbove ? "bottom" : "top";
  const unclampedTop = side === "bottom" ? belowTop : aboveTop;
  const top = Math.min(
    Math.max(VIEWPORT_GUTTER, unclampedTop),
    Math.max(VIEWPORT_GUTTER, input.viewportHeight - input.popoverHeight - VIEWPORT_GUTTER),
  );
  return { top, left, side };
}

export interface LimitationHintProps {
  /** Customer-visible localized heading, e.g. “限制说明”. */
  readonly label: string;
  /** Verbatim canonical evidence boundaries; empty strings are ignored. */
  readonly limitations: readonly string[];
  /** Language of verbatim provider text when it differs from the page locale. */
  readonly contentLanguage?: string | undefined;
  readonly align?: "start" | "end";
  readonly className?: string;
}

/**
 * Compact, truthful presentation for long evidence boundaries.
 *
 * The reading line contains only one warning glyph. Hover and keyboard focus
 * reveal the content, while click/tap pins it for touch users. The content is
 * portalled to `document.body`, so source cards and table rails cannot clip it.
 */
export function LimitationHint({
  label,
  limitations,
  contentLanguage,
  align = "start",
  className,
}: LimitationHintProps) {
  const items = [...new Set(limitations.map((item) => item.trim()).filter(Boolean))];
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(false);
  const suppressNextFocusOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<LimitationPopoverPosition | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    clearCloseTimer();
    pinnedRef.current = false;
    setOpen(false);
    setPosition(null);
  }, [clearCloseTimer]);

  const show = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleFocus = useCallback(() => {
    if (suppressNextFocusOpenRef.current) {
      suppressNextFocusOpenRef.current = false;
      return;
    }
    show();
  }, [show]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    if (pinnedRef.current) return;
    closeTimerRef.current = setTimeout(() => {
      if (!pinnedRef.current) {
        setOpen(false);
        setPosition(null);
      }
    }, 140);
  }, [clearCloseTimer]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (trigger === null || tooltip === null) return;
    const triggerRect = trigger.getBoundingClientRect();
    setPosition(
      limitationPopoverPosition({
        trigger: triggerRect,
        // Layout dimensions are intentionally used instead of the transformed
        // client rect. The entry animation starts at scale(.985); measuring
        // that temporary rect would let the full-size popover cross a viewport
        // gutter after the animation settles.
        popoverWidth: tooltip.offsetWidth,
        popoverHeight: tooltip.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        align,
      }),
    );
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      const trigger = triggerRef.current;
      if (trigger !== null && document.activeElement !== trigger) {
        suppressNextFocusOpenRef.current = true;
        trigger.focus();
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open, updatePosition]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  if (items.length === 0) return null;

  const triggerLabel = `${label} (${items.length})`;
  const tooltipStyle: CSSProperties | undefined =
    position === null ? undefined : { top: position.top, left: position.left };

  return (
    <span
      className={cx(styles.anchor, className)}
      data-limitation-hint=""
      data-limitation-count={items.length}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={handleFocus}
        onBlur={scheduleClose}
        onClick={() => {
          if (pinnedRef.current) {
            close();
            return;
          }
          pinnedRef.current = true;
          show();
        }}
      >
        <CircleAlert aria-hidden="true" size={18} strokeWidth={2} />
      </button>

      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={cx(styles.popover, position !== null && styles.positioned)}
              data-side={position?.side ?? "bottom"}
              style={tooltipStyle}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              <header className={styles.popoverHeader}>
                <CircleAlert aria-hidden="true" size={17} strokeWidth={2} />
                <strong>{label}</strong>
                <span>{items.length}</span>
              </header>
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item} lang={contentLanguage}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
