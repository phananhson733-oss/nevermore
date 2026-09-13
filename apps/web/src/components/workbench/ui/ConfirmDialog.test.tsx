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
import { WB_APP_ROOT_ID, WB_ROOT_ID } from "./ids.ts";

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
const layoutRoots: HTMLElement[] = [];

/**
 * The project layout's root element, put in the document *before* anything
 * mounts — which is how it exists in production: it is server-rendered by
 * app/p/[projectId]/layout.tsx, above every view. It carries the next/font
 * variable class that defines `--font-wb`.
 */
function mountLayoutRoot(): HTMLElement {
  const root = document.createElement("div");
  root.id = WB_ROOT_ID;
  document.body.append(root);
  layoutRoots.push(root);
  return root;
}

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

function render(element: ReactElement, into: HTMLElement = document.body): HTMLElement {
  const container = document.createElement("div");
  into.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return container;
}

function open(handlers: Partial<Handlers> = {}, into?: HTMLElement): Handlers {
  const full: Handlers = {
    onClose: handlers.onClose ?? vi.fn(),
    onConfirm: handlers.onConfirm ?? vi.fn(),
  };
  render(<Harness open handlers={full} />, into);
  return full;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (found === null) throw new Error("no dialog rendered");
  return found;
}

/**
 * The node the portal inserts: Dialog's outermost element (scrim and panel are
 * its children). Where the portal put the box is *this* element's parent.
 * `contains` checks cannot answer that here — the harness mounts inside
 * `document.body` (and inside `#wb-root` below, as views are in production), so
 * "is somewhere under X" holds with or without a portal.
 */
function portalRoot(): HTMLElement {
  const root = dialog().parentElement;
  if (root === null) throw new Error("dialog panel has no parent");
  return root;
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
  layoutRoots.splice(0).forEach((node) => node.remove());
});

describe("ConfirmDialog", () => {
  it("renders outside #wb-app, which is inert while it is open", () => {
    open();
    const root = document.getElementById(WB_APP_ROOT_ID);

    // The danger is real, not hypothetical: the app root really is inert here.
    expect(root?.hasAttribute("inert")).toBe(true);
    expect(root?.contains(dialog())).toBe(false);
    // Nor may it hide under the inert root's own subtree through a wrapper.
    expect(dialog().closest("[inert]")).toBeNull();
  });

  it("portals into #wb-root, the element that carries the workbench face", () => {
    // `--font-wb` is defined by the next/font class on `#wb-root`, so a box
    // portalled into `document.body` — its parent, outside that class — renders
    // in the fallback stack and reports nothing. Still outside `#wb-app`, so the
    // inert fence asserted above is untouched.
    const root = mountLayoutRoot();
    open({}, root);

    // Direct parent, not "somewhere under": the view itself is under #wb-root.
    expect(portalRoot().parentElement).toBe(root);
    expect(document.getElementById(WB_APP_ROOT_ID)?.contains(portalRoot())).toBe(false);
    expect(dialog().closest("[inert]")).toBeNull();
  });

  it("falls back to document.body when there is no layout root around it", () => {
    // Reachable beats correct-looking: without `#wb-root` the box still opens,
    // it just does not get the face.
    open();

    expect(document.getElementById(WB_ROOT_ID)).toBeNull();
    expect(portalRoot().parentElement).toBe(document.body);
    expect(document.getElementById(WB_APP_ROOT_ID)?.contains(portalRoot())).toBe(false);
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const handlers = open();

    act(() => buttonWith(COPY.confirmLabel).click());

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
    // It does not close itself: the caller owns `open`, so a slow action can
    // keep the box up until it is done.
    expect(handlers.onClose).not.toHaveBeenCalled();
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
