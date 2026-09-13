/** @vitest-environment jsdom */

/**
 * The reason this component exists is the first case below (裁决 Q32): `Dialog`
 * makes `#wb-app` inert while it is open, and every view and the topbar live
 * inside `#wb-app`. A confirm box rendered where it was declared therefore sits
 * inside the subtree it just fenced off — initial focus is a no-op, the buttons
 * do not respond and assistive technology cannot see it, while an e2e check for
 * "exactly one dialog root" stays green. jsdom reflects `inert` without
 * implementing it, so no behavioural assertion here can catch that; the tree
 * position is the only thing that can, which is why it is asserted directly.
 */

import { act, useRef, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { WB_APP_ROOT_ID } from "./ids.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const COPY = {
  title: "Clear the sample data?",
  body: "This clears the GSC rows, the keyword library and the artifacts saved in this browser.",
  confirmLabel: "Clear sample",
  cancelLabel: "Cancel",
} as const;

let cleanup: (() => void) | null = null;

interface Handlers {
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/** The confirm box declared where a view would declare it: inside `#wb-app`. */
function Harness({ open, handlers }: { readonly open: boolean; readonly handlers: Handlers }) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <div id={WB_APP_ROOT_ID}>
      <button type="button" id="opener" ref={openerRef}>
        open
      </button>
      <ConfirmDialog
        open={open}
        onClose={handlers.onClose}
        onConfirm={handlers.onConfirm}
        returnFocusTo={openerRef}
        {...COPY}
      />
    </div>
  );
}

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function open(handlers: Partial<Handlers> = {}): Handlers {
  const full: Handlers = {
    onClose: handlers.onClose ?? vi.fn(),
    onConfirm: handlers.onConfirm ?? vi.fn(),
  };
  render(<Harness open handlers={full} />);
  return full;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (found === null) throw new Error("no dialog rendered");
  return found;
}

function buttonWith(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (found === undefined) throw new Error(`no button labelled ${label}`);
  return found;
}

afterEach(() => {
  // An unmount left behind leaks `Dialog`'s shared open count into the next test.
  cleanup?.();
  cleanup = null;
});

describe("ConfirmDialog", () => {
  it("renders outside #wb-app, which is inert while it is open", () => {
    open();
    const root = document.getElementById(WB_APP_ROOT_ID);

    // The danger is real, not hypothetical: the app root really is inert here.
    expect(root?.hasAttribute("inert")).toBe(true);
    expect(root?.contains(dialog())).toBe(false);
    expect(document.body.contains(dialog())).toBe(true);
    // Nor may it hide under the inert root's own subtree through a wrapper.
    expect(dialog().closest("[inert]")).toBeNull();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const handlers = open();

    act(() => buttonWith(COPY.confirmLabel).click());

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes on cancel without confirming", () => {
    const handlers = open();

    act(() => buttonWith(COPY.cancelLabel).click());

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Escape without confirming", () => {
    const handlers = open();

    act(() => {
      dialog().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it("is named by its own title and describes what will happen", () => {
    open();
    const labelledBy = dialog().getAttribute("aria-labelledby") ?? "";

    expect(document.getElementById(labelledBy)?.textContent).toBe(COPY.title);
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(dialog().textContent).toContain(COPY.body);
  });

  it("puts the initial focus on cancel, not on the destructive action", () => {
    open();

    expect(document.activeElement).toBe(buttonWith(COPY.cancelLabel));
  });

  it("renders nothing while it is closed, and leaves the app root alone", () => {
    const handlers: Handlers = { onClose: vi.fn(), onConfirm: vi.fn() };
    render(<Harness open={false} handlers={handlers} />);

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain(COPY.title);
    expect(document.getElementById(WB_APP_ROOT_ID)?.hasAttribute("inert")).toBe(false);
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    open();

    expect(document.body.querySelectorAll("[style]")).toHaveLength(0);
  });
});
