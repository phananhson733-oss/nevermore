/** @vitest-environment jsdom */

import { act, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { Dialog } from "./Dialog.tsx";
import { WB_APP_ROOT_ID } from "./ids.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// jsdom reflects the `inert` attribute without implementing its behaviour, so
// these tests pin the attribute contract, not real background unreachability.
function appRoot(): HTMLElement | null {
  return document.getElementById(WB_APP_ROOT_ID);
}

let active: { readonly cleanup: () => void } | null = null;

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  const view = {
    container,
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
      active = null;
    },
  };
  active = view;
  return view;
}

afterEach(() => {
  // An unmount left behind would leak the shared open-dialog count into the
  // next test, which is exactly the bug these tests exist to catch.
  active?.cleanup();
  // A spy left installed by a failing test would silence the next one's console.
  vi.restoreAllMocks();
});

/** Returns whether the handler called `preventDefault()`. */
function keydown(el: HTMLElement, key: string, shiftKey = false, isComposing = false): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    isComposing,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** One dialog plus the `#wb-app` root and the button that opened it. */
function Harness({
  open,
  onClose,
  withRoot = true,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly withRoot?: boolean;
}) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      {withRoot ? (
        <div id={WB_APP_ROOT_ID}>
          <button type="button" id="opener" ref={openerRef}>
            open
          </button>
        </div>
      ) : null}
      <Dialog open={open} onClose={onClose} labelledBy="dialog-title" returnFocusTo={openerRef}>
        <h2 id="dialog-title">Title</h2>
        <button type="button" id="first">
          first
        </button>
        <button type="button" id="last">
          last
        </button>
      </Dialog>
    </>
  );
}

function TwoDialogs({ a, b }: { readonly a: boolean; readonly b: boolean }) {
  const noop = () => {};
  return (
    <>
      <div id={WB_APP_ROOT_ID} />
      <Dialog open={a} onClose={noop} labelledBy="a-title">
        <h2 id="a-title">A</h2>
      </Dialog>
      <Dialog open={b} onClose={noop} labelledBy="b-title">
        <h2 id="b-title">B</h2>
      </Dialog>
    </>
  );
}

/** The return target is present but cannot take focus (hidden below `md`). */
function HiddenReturnHarness({ open }: { readonly open: boolean }) {
  const returnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={WB_APP_ROOT_ID}>
        <button type="button" id="opener">
          open
        </button>
        <button type="button" id="hidden-return" ref={returnRef}>
          return
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => {}}
        labelledBy="hidden-title"
        returnFocusTo={returnRef}
      >
        <h2 id="hidden-title">Hidden</h2>
        <button type="button" id="first">
          first
        </button>
      </Dialog>
    </>
  );
}

/** A panel with no focusable descendant at all. */
function EmptyDialog({ open }: { readonly open: boolean }) {
  return (
    <>
      <div id={WB_APP_ROOT_ID} />
      <Dialog open={open} onClose={() => {}} labelledBy="empty-title">
        <h2 id="empty-title">Empty</h2>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("makes the app root inert and moves focus to the first focusable child", () => {
    mount(<Harness open onClose={() => {}} />);

    expect(appRoot()?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.id).toBe("first");
  });

  it("traps Tab and Shift+Tab inside the panel", () => {
    const view = mount(<Harness open onClose={() => {}} />);
    const first = view.container.querySelector<HTMLElement>("#first");
    const last = view.container.querySelector<HTMLElement>("#last");
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();

    act(() => last?.focus());
    keydown(last as HTMLElement, "Tab");
    expect(document.activeElement?.id).toBe("first");

    keydown(first as HTMLElement, "Tab", true);
    expect(document.activeElement?.id).toBe("last");
  });

  it("calls onClose exactly once on Escape", () => {
    const onClose = vi.fn();
    const view = mount(<Harness open onClose={onClose} />);
    const first = view.container.querySelector<HTMLElement>("#first");

    keydown(first as HTMLElement, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a composing Escape to the IME instead of closing", () => {
    const onClose = vi.fn();
    const view = mount(<Harness open onClose={onClose} />);
    const first = view.container.querySelector<HTMLElement>("#first");

    // Escape mid-composition cancels the candidate list; the dialog must
    // neither close nor preventDefault (that would cancel the IME's own
    // handling too).
    expect(keydown(first as HTMLElement, "Escape", false, true)).toBe(false);

    expect(onClose).not.toHaveBeenCalled();
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("lifts inert and returns focus to returnFocusTo on close", () => {
    const view = mount(<Harness open onClose={() => {}} />);

    view.rerender(<Harness open={false} onClose={() => {}} />);

    expect(appRoot()?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement?.id).toBe("opener");
  });

  it("keeps the app root inert until the last of two dialogs closes", () => {
    const view = mount(<TwoDialogs a b />);
    expect(appRoot()?.hasAttribute("inert")).toBe(true);

    view.rerender(<TwoDialogs a={false} b />);
    expect(appRoot()?.hasAttribute("inert")).toBe(true);

    view.rerender(<TwoDialogs a={false} b={false} />);
    expect(appRoot()?.hasAttribute("inert")).toBe(false);
  });

  it("renders and warns once when the app root is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const view = mount(<Harness open onClose={() => {}} withRoot={false} />);

    expect(appRoot()).toBeNull();
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(`#${WB_APP_ROOT_ID}`);
  });

  it("returns focus to the opener when returnFocusTo cannot take focus", () => {
    const view = mount(<HiddenReturnHarness open={false} />);
    const opener = view.container.querySelector<HTMLElement>("#opener");
    act(() => opener?.focus());
    view.rerender(<HiddenReturnHarness open />);
    const hidden = view.container.querySelector<HTMLElement>("#hidden-return");
    expect(hidden).not.toBeNull();
    // jsdom has no layout, so "hidden" is modelled the way the browser behaves:
    // focus() on a display:none element does nothing.
    vi.spyOn(hidden as HTMLElement, "focus").mockImplementation(() => {});

    view.rerender(<HiddenReturnHarness open={false} />);

    expect(document.activeElement?.id).toBe("opener");
  });

  it("keeps focus on the panel when Tab finds nothing focusable inside", () => {
    const view = mount(<EmptyDialog open />);
    const panel = view.container.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);

    expect(keydown(panel as HTMLElement, "Tab")).toBe(true);

    expect(document.activeElement).toBe(panel);
  });
});
