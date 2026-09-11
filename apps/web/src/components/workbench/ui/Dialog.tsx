"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "./cn.ts";
import { FOCUSABLE, nextTrapIndex } from "./focus-order.ts";

/**
 * Accessible modal (design §4.3): role=dialog + aria-modal, focus moves in on
 * open, is trapped while open, and returns to the opener on close. The app root
 * (`#wb-app`) is made inert so the background is unreachable by keyboard and AT.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  initialFocus,
  returnFocusTo,
  className,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /** Preferred focus target on close; falls back to whatever was focused on open. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const root = document.getElementById("wb-app");
    root?.setAttribute("inert", "");
    const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      // Order matters: focus() on a node inside an inert subtree is a no-op,
      // so inert comes off first. Next's layout-router focuses the changed
      // segment after navigation, so activeElement-on-open is only a fallback.
      root?.removeAttribute("inert");
      const target = returnFocusTo?.current ?? openerRef.current;
      if (target instanceof HTMLElement) target.focus();
    };
  }, [open, initialFocus, returnFocusTo]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const active = items.indexOf(document.activeElement as HTMLElement);
    const next = nextTrapIndex(items.length, active, event.shiftKey);
    if (next === -1) return;
    event.preventDefault();
    items[next]?.focus();
  }

  if (!open) return null;
  return (
    <div className="wb-reset fixed inset-0 z-50 font-sans text-slate-900">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        className={cn("absolute bg-white shadow-xl outline-none", className)}
      >
        {children}
      </div>
    </div>
  );
}
