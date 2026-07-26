"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./growth-map.module.css";

export interface EvidenceRefsDisclosureProps {
  readonly findingId: string;
  readonly label: string;
  readonly children: ReactNode;
}

/**
 * Growth Map evidence disclosure.
 *
 * The retired Diagnosis screen owned a keyboard contract for opening a
 * Finding's evidence: Enter opens a named `dialog`, the dialog takes focus,
 * Escape closes it, focus returns to the exact trigger, and the trigger's
 * `aria-expanded` tracks the open state. Growth Map replaced that screen with a
 * bare `<details>/<summary>`, which has no Escape and no focus return, so a
 * keyboard-only reviewer lost the ability to open and leave the disclosure.
 *
 * This restores the contract on top of the existing `<details>/<summary>`
 * rendering: the markup, the CSS Module classes and the layout are untouched,
 * only behavior and ARIA are added.
 */
export function EvidenceRefsDisclosure({
  findingId,
  label,
  children,
}: EvidenceRefsDisclosureProps) {
  const summaryRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const triggerId = `sf-finding-${findingId}-evidence-refs-trigger`;

  /** Native `<details>` toggles itself; mirror it and take focus on open. */
  const syncOpen = useCallback((next: boolean): void => {
    setOpen(next);
    if (!next) return;
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, []);

  /** Close and hand focus back to the exact trigger that opened the dialog. */
  const requestClose = useCallback((): void => {
    setOpen(false);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    requestClose();
  }

  return (
    <details
      className={styles.evidenceRefs}
      open={open}
      onToggle={(event) => syncOpen(event.currentTarget.open)}
      onKeyDown={onKeyDown}
    >
      <summary ref={summaryRef} id={triggerId} aria-expanded={open}>
        {label}
      </summary>
      {/* Rendered unconditionally: a closed <details> already hides its own
        * content, and callers index the evidence rows by attribute. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={triggerId}
        tabIndex={-1}
      >
        {children}
      </div>
    </details>
  );
}
