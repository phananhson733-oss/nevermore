/** @vitest-environment jsdom */

import { act, useRef, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { Dialog } from "./Dialog.tsx";
import { WB_APP_ROOT_ID, WB_MAIN_ID } from "./ids.ts";

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

/** The return target sits inside a subtree another modal has fenced off. */
function FencedReturnHarness({
  open,
  fence,
}: {
  readonly open: boolean;
  readonly fence: "inert" | "aria-hidden";
}) {
  const returnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={WB_APP_ROOT_ID}>
        <button type="button" id="opener">
          open
        </button>
      </div>
      <div
        id="fenced"
        inert={fence === "inert" ? true : undefined}
        aria-hidden={fence === "aria-hidden" ? "true" : undefined}
      >
        <button type="button" id="fenced-return" ref={returnRef}>
          return
        </button>
      </div>
      <Dialog
        open={open}
        onClose={() => {}}
        labelledBy="fenced-title"
        returnFocusTo={returnRef}
      >
        <h2 id="fenced-title">Fenced</h2>
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

/**
 * Opened by a state update while nothing has focus, so the opener Dialog
 * records is `<body>`; no `returnFocusTo`.
 */
function BodyOpenerHarness({
  open,
  withFallback = false,
}: {
  readonly open: boolean;
  readonly withFallback?: boolean;
}) {
  const fallbackRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={WB_APP_ROOT_ID}>
        <button type="button" id="fallback" ref={fallbackRef}>
          fallback
        </button>
        <main id={WB_MAIN_ID} tabIndex={-1}>
          page
        </main>
      </div>
      <Dialog
        open={open}
        onClose={() => {}}
        labelledBy="body-title"
        fallbackFocus={withFallback ? fallbackRef : undefined}
      >
        <h2 id="body-title">Body</h2>
        <button type="button" id="inside">
          inside
        </button>
      </Dialog>
    </>
  );
}

/**
 * Three stops, A, B and C, where B is `hidden` unless told otherwise; the
 * initial focus can be pointed at B.
 */
function StopsHarness({
  initialOnB = false,
  bHidden = true,
}: {
  readonly initialOnB?: boolean;
  readonly bHidden?: boolean;
}) {
  const bRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={WB_APP_ROOT_ID} />
      <Dialog
        open
        onClose={() => {}}
        labelledBy="stops-title"
        initialFocus={initialOnB ? bRef : undefined}
      >
        <h2 id="stops-title">Stops</h2>
        <button type="button" id="a">
          a
        </button>
        <button type="button" id="b" ref={bRef} hidden={bHidden}>
          b
        </button>
        <button type="button" id="c">
          c
        </button>
      </Dialog>
    </>
  );
}

function byId(view: ReturnType<typeof mount>, id: string): HTMLElement {
  const el = view.container.querySelector<HTMLElement>(`#${id}`);
  if (el === null) throw new Error(`no #${id} rendered`);
  return el;
}

/**
 * The confirm removes the button that opened the dialog in the same commit, as
 * "clear sample" and "clear GSC rows" do, and no `returnFocusTo` is given.
 */
function RemovedOpenerHarness({ withFallback = false }: { readonly withFallback?: boolean }) {
  const [open, setOpen] = useState(false);
  const [openerPresent, setOpenerPresent] = useState(true);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div id={WB_APP_ROOT_ID}>
        {openerPresent ? (
          <button type="button" id="opener" onClick={() => setOpen(true)}>
            open
          </button>
        ) : null}
        <button type="button" id="fallback" ref={fallbackRef}>
          fallback
        </button>
        <main id={WB_MAIN_ID} tabIndex={-1}>
          page
        </main>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="removed-title"
        fallbackFocus={withFallback ? fallbackRef : undefined}
      >
        <h2 id="removed-title">Removed</h2>
        <button
          type="button"
          id="confirm"
          onClick={() => {
            setOpenerPresent(false);
            setOpen(false);
          }}
        >
          confirm
        </button>
      </Dialog>
    </>
  );
}

/** Opens the harness from its opener, then confirms; returns the removed opener. */
function confirmRemovingOpener(view: ReturnType<typeof mount>): HTMLElement {
  const opener = view.container.querySelector<HTMLElement>("#opener");
  if (opener === null) throw new Error("no opener rendered");
  act(() => opener.focus());
  act(() => opener.click());
  expect(document.activeElement?.id).toBe("confirm");
  const focus = vi.spyOn(opener, "focus");

  act(() => view.container.querySelector<HTMLElement>("#confirm")?.click());

  expect(opener.isConnected).toBe(false);
  // A node that has left the document is not tried at all.
  expect(focus).not.toHaveBeenCalled();
  return opener;
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

  it("leaves an inert it did not set on the app root after closing", () => {
    // The legacy modals mark every `document.body` child inert and restore
    // only what they themselves added. A Dialog opened and closed meanwhile
    // must hand the root back exactly as it found it, or their background
    // wakes up under their scrim.
    const view = mount(<Harness open={false} onClose={() => {}} />);
    act(() => appRoot()?.setAttribute("inert", ""));

    view.rerender(<Harness open onClose={() => {}} />);
    expect(appRoot()?.hasAttribute("inert")).toBe(true);
    view.rerender(<Harness open={false} onClose={() => {}} />);

    expect(appRoot()?.hasAttribute("inert")).toBe(true);
  });

  it("snapshots the pre-existing inert once for a whole stack of dialogs", () => {
    // Taken at 0→1 only: a second dialog opening on top must not mistake the
    // first dialog's own inert for someone else's and strand it on the root.
    const view = mount(<TwoDialogs a={false} b={false} />);
    expect(appRoot()?.hasAttribute("inert")).toBe(false);

    view.rerender(<TwoDialogs a b={false} />);
    view.rerender(<TwoDialogs a b />);
    view.rerender(<TwoDialogs a={false} b />);
    view.rerender(<TwoDialogs a={false} b={false} />);

    expect(appRoot()?.hasAttribute("inert")).toBe(false);
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

  it.each(["inert", "aria-hidden"] as const)(
    "does not return focus into a subtree fenced off by %s; the opener gets it instead",
    (fence) => {
      // jsdom does not implement `inert`, so without the guard `focus()` on
      // the fenced target would succeed here and the test would pass for the
      // wrong reason: the assertion is that the guard never tries.
      const view = mount(<FencedReturnHarness open={false} fence={fence} />);
      const opener = view.container.querySelector<HTMLElement>("#opener");
      act(() => opener?.focus());
      view.rerender(<FencedReturnHarness open fence={fence} />);
      const fenced = view.container.querySelector<HTMLElement>("#fenced-return");
      expect(fenced).not.toBeNull();
      const focus = vi.spyOn(fenced as HTMLElement, "focus");

      view.rerender(<FencedReturnHarness open={false} fence={fence} />);

      expect(focus).not.toHaveBeenCalled();
      expect(document.activeElement?.id).toBe("opener");
    },
  );

  it("does not fall back onto an opener that was fenced off while the dialog was open", () => {
    const view = mount(<FencedReturnHarness open={false} fence="aria-hidden" />);
    const opener = view.container.querySelector<HTMLElement>("#opener");
    act(() => opener?.focus());
    view.rerender(<FencedReturnHarness open fence="aria-hidden" />);
    // Another modal fences the opener's subtree (aria-hidden does not stop
    // `focus()` in a browser, so the guard has to refuse on its own).
    act(() => appRoot()?.setAttribute("aria-hidden", "true"));
    const focus = vi.spyOn(opener as HTMLElement, "focus");

    view.rerender(<FencedReturnHarness open={false} fence="aria-hidden" />);

    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    act(() => appRoot()?.removeAttribute("aria-hidden"));
  });

  it("keeps focus on the panel when Tab finds nothing focusable inside", () => {
    const view = mount(<EmptyDialog open />);
    const panel = view.container.querySelector<HTMLElement>('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);

    expect(keydown(panel as HTMLElement, "Tab")).toBe(true);

    expect(document.activeElement).toBe(panel);
  });

  it("sends focus to <main> when the confirm removed the opener, not to <body>", () => {
    const view = mount(<RemovedOpenerHarness />);

    confirmRemovingOpener(view);

    expect(document.activeElement).toBe(view.container.querySelector(`#${WB_MAIN_ID}`));
  });

  it("prefers the caller's fallbackFocus to <main> when the opener is gone", () => {
    const view = mount(<RemovedOpenerHarness withFallback />);

    confirmRemovingOpener(view);

    expect(document.activeElement?.id).toBe("fallback");
  });

  it.each([
    ["<main>", false, WB_MAIN_ID],
    ["fallbackFocus", true, "fallback"],
  ] as const)(
    "does not return focus to <body> when the dialog opened with nothing focused; %s gets it",
    (_name, withFallback, expected) => {
      const view = mount(<BodyOpenerHarness open={false} withFallback={withFallback} />);
      expect(document.activeElement).toBe(document.body);

      view.rerender(<BodyOpenerHarness open withFallback={withFallback} />);
      expect(document.activeElement?.id).toBe("inside");
      view.rerender(<BodyOpenerHarness open={false} withFallback={withFallback} />);

      expect(document.activeElement?.id).toBe(expected);
    },
  );

  it("passes over a hidden control on Tab and Shift+Tab", () => {
    const view = mount(<StopsHarness />);
    expect(document.activeElement?.id).toBe("a");

    keydown(byId(view, "a"), "Tab");
    expect(document.activeElement?.id).toBe("c");

    keydown(byId(view, "c"), "Tab", true);
    expect(document.activeElement?.id).toBe("a");
  });

  it("puts initial focus on the first stop that can take it when initialFocus is hidden", () => {
    mount(<StopsHarness initialOnB />);

    expect(document.activeElement?.id).toBe("a");
  });

  it("passes over a control with no box once the panel is laid out", () => {
    // A laid-out document where A is `display: none` by a class: the panel has
    // a box and so do B and C; A does not.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.id === "a" ? [] : [{}]) as unknown as DOMRectList;
    });

    const view = mount(<StopsHarness bHidden={false} />);
    expect(document.activeElement?.id).toBe("b");

    // From C, Tab wraps past A to B.
    act(() => byId(view, "c").focus());
    keydown(byId(view, "c"), "Tab");
    expect(document.activeElement?.id).toBe("b");
  });

  it("passes over a stop whose focus() does not take", () => {
    const view = mount(<StopsHarness bHidden={false} />);
    vi.spyOn(byId(view, "b"), "focus").mockImplementation(() => {});

    keydown(byId(view, "a"), "Tab");

    expect(document.activeElement?.id).toBe("c");
  });

  it("puts focus on the panel when no stop takes it", () => {
    // Focus is on B, which is hidden after it took focus (a control can be
    // hidden while the dialog is open), and A and C refuse focus. Staying on B
    // would leave focus on a control no one can see.
    const view = mount(<StopsHarness bHidden={false} />);
    const panel = view.container.querySelector<HTMLElement>('[role="dialog"]');
    const b = byId(view, "b");
    act(() => b.focus());
    act(() => b.setAttribute("hidden", ""));
    vi.spyOn(byId(view, "a"), "focus").mockImplementation(() => {});
    vi.spyOn(byId(view, "c"), "focus").mockImplementation(() => {});

    expect(keydown(b, "Tab")).toBe(true);

    expect(document.activeElement).toBe(panel);
  });
});
