// @input  — localized label plus one or more truthful evidence limitations
// @output — one compact warning control whose popover opens on hover, focus, or tap
// @pos    — shared disclosure primitive for public-tool result surfaces
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

"use client";

import { CircleAlert } from "lucide-react";
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

const VIEWPORT_GUTTER = 12;
const TRIGGER_GAP = 8;

interface RectLike {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface MarketingLimitationPopoverPosition {
  readonly top: number;
  readonly left: number;
  readonly side: "top" | "bottom";
}

export function marketingLimitationPopoverPosition(input: {
  readonly trigger: RectLike;
  readonly popoverWidth: number;
  readonly popoverHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly align: "start" | "end";
}): MarketingLimitationPopoverPosition {
  const desiredLeft =
    input.align === "end"
      ? input.trigger.right - input.popoverWidth
      : input.trigger.left;
  const left = Math.min(
    Math.max(VIEWPORT_GUTTER, desiredLeft),
    Math.max(
      VIEWPORT_GUTTER,
      input.viewportWidth - input.popoverWidth - VIEWPORT_GUTTER,
    ),
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
    Math.max(
      VIEWPORT_GUTTER,
      input.viewportHeight - input.popoverHeight - VIEWPORT_GUTTER,
    ),
  );
  return { top, left, side };
}

export interface LimitationHintProps {
  readonly label: string;
  readonly limitations: readonly string[];
  readonly contentLanguage?: string | undefined;
  readonly align?: "start" | "end";
  readonly className?: string | undefined;
}

/**
 * Keeps evidence boundaries available without letting them dominate a result.
 * Hover and keyboard focus reveal the popover; click/tap pins it until the
 * visitor clicks the control again, presses Escape, or points elsewhere.
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
  const [position, setPosition] =
    useState<MarketingLimitationPopoverPosition | null>(null);

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
      marketingLimitationPopoverPosition({
        trigger: triggerRect,
        // `offset*` excludes the temporary scale(.985) entry transform, so
        // the settled popover cannot grow beyond the calculated viewport edge.
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
      className={`inline-flex w-max flex-none items-center leading-none ${className ?? ""}`}
      data-limitation-hint=""
      data-limitation-count={items.length}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className="inline-grid h-7 w-7 cursor-help place-items-center rounded-full border border-brand-warning/55 bg-brand-warning/10 p-0 text-brand-warning shadow-[0_4px_12px_rgba(212,168,67,0.12)] transition duration-150 hover:-translate-y-px hover:border-brand-warning hover:bg-brand-warning/15 hover:text-text-dark-primary hover:shadow-[0_7px_18px_rgba(212,168,67,0.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent aria-expanded:-translate-y-px aria-expanded:border-brand-warning aria-expanded:bg-brand-warning/15 aria-expanded:text-text-dark-primary"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-describedby={open ? tooltipId : undefined}
        aria-keyshortcuts="ArrowDown"
        onFocus={handleFocus}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" || !open) return;
          event.preventDefault();
          clearCloseTimer();
          tooltipRef.current?.focus();
        }}
        onClick={() => {
          if (pinnedRef.current) {
            close();
            return;
          }
          pinnedRef.current = true;
          show();
        }}
      >
        <CircleAlert aria-hidden="true" className="h-[18px] w-[18px]" />
      </button>

      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              tabIndex={0}
              data-side={position?.side ?? "bottom"}
              data-positioned={position !== null ? "true" : "false"}
              style={tooltipStyle}
              className="fixed z-[1400] max-h-[min(360px,calc(100vh-24px))] w-[min(380px,calc(100vw-28px))] overflow-auto overscroll-contain rounded-xl border border-brand-warning/55 bg-[#171718] p-3.5 text-text-dark-primary opacity-0 shadow-2xl transition duration-150 data-[positioned=true]:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent motion-reduce:transition-none"
              onFocus={clearCloseTimer}
              onBlur={scheduleClose}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            >
              <header className="flex items-center gap-2 border-b border-brand-border/70 pb-2.5">
                <CircleAlert
                  aria-hidden="true"
                  className="h-[17px] w-[17px] flex-none text-brand-warning"
                />
                <strong className="min-w-0 flex-1 text-[13px] font-semibold leading-5 text-text-dark-primary">
                  {label}
                </strong>
                <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand-warning/10 px-1.5 text-[11px] font-bold tabular-nums text-brand-warning">
                  {items.length}
                </span>
              </header>
              <ul className="mt-2.5 grid list-disc gap-2 pl-[18px] text-[12.5px] leading-relaxed text-text-dark-secondary marker:text-brand-warning">
                {items.map((item) => (
                  <li key={item} lang={contentLanguage} className="break-words pl-0.5">
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
