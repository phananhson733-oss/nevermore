"use client";

/**
 * The one overlay this screen uses, in two shapes.
 *
 * `modal` carries a decision (it has a form and a commit button); `drawer`
 * carries read-only detail. That split is the rule the rest of the product
 * already follows, and it matters here: a reviewer must never be asked to
 * decide something inside a panel that reads like a reference sheet.
 *
 * Focus behaviour is not decoration. The control that opened the overlay gets
 * focus back on close, Tab wraps inside it, and Escape closes it — otherwise a
 * keyboard user who opens the review dialog is stranded behind a page they can
 * still tab into but cannot see.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "@/components/ui";
import styles from "./execution.module.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden"),
  );
}

export interface OverlayProps {
  readonly open: boolean;
  readonly shape: "modal" | "drawer";
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly testId?: string;
}

export function Overlay({
  open,
  shape,
  title,
  subtitle,
  children,
  footer,
  onClose,
  returnFocusRef,
  testId,
}: OverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  const requestClose = useCallback((): void => {
    onClose();
    // Focus goes back where it came from; anything else drops a keyboard user
    // at the top of the document with no memory of what they were doing.
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      const frame = frameRef.current;
      const target =
        frame?.querySelector<HTMLElement>("[data-autofocus]") ??
        closeRef.current;
      target?.focus();
    });

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || frameRef.current === null) return;
      const focusable = focusableElements(frameRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
    };
  }, [open, requestClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={styles.overlayScrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      data-overlay-scrim=""
    >
      <div
        ref={frameRef}
        className={cx(
          styles.overlayFrame,
          shape === "drawer" ? styles.overlayDrawer : styles.overlayModal,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(testId === undefined ? {} : { [`data-${testId}`]: "" })}
      >
        <header className={styles.overlayHead}>
          <div>
            <h3 id={titleId} className={styles.overlayTitle}>
              {title}
            </h3>
            {subtitle === undefined ? null : (
              <p className={styles.overlaySubtitle}>{subtitle}</p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.overlayClose}
            onClick={requestClose}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={styles.overlayBody}>{children}</div>
        {footer === undefined ? null : (
          <footer className={styles.overlayFooter}>{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
