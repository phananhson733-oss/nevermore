/** @vitest-environment jsdom */

import { act, startTransition, Suspense, use } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { useGlobalShortcut } from "./useGlobalShortcut.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// A module-level object for the key-semantics tests below. Its identity never
// changes, so these tests cannot see whether the hook re-subscribes: the
// "handler identity" describe at the bottom is the one that carries that contract.
const handlers = { onTogglePalette: vi.fn(), onEscape: vi.fn() };

function Host() {
  useGlobalShortcut(handlers);
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  handlers.onTogglePalette.mockReset();
  handlers.onEscape.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** Returns whether the handler called `preventDefault()`. */
function pressAtWindow(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

describe("useGlobalShortcut", () => {
  beforeEach(() => {
    act(() => root?.render(<Host />));
  });

  it("toggles the palette on Cmd/Ctrl+K and closes on Escape", () => {
    expect(pressAtWindow({ key: "k", metaKey: true })).toBe(true);
    expect(pressAtWindow({ key: "K", ctrlKey: true })).toBe(true);
    expect(handlers.onTogglePalette).toHaveBeenCalledTimes(2);

    pressAtWindow({ key: "Escape" });
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it("ignores keys pressed mid-IME-composition, Escape included", () => {
    // Dialog lets a composing Escape bubble on purpose (it is the IME's
    // cancel, not a close), so this layer must not turn it into one either.
    expect(pressAtWindow({ key: "Escape", isComposing: true })).toBe(false);
    expect(pressAtWindow({ key: "Escape", keyCode: 229 })).toBe(false);
    expect(pressAtWindow({ key: "k", metaKey: true, isComposing: true })).toBe(false);

    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
  });

  it("leaves every other key alone, a bare k included", () => {
    // Typing into any field on the page passes through this listener, so a
    // plain "k" must neither open the palette nor be swallowed.
    expect(pressAtWindow({ key: "k" })).toBe(false);
    expect(pressAtWindow({ key: "Enter" })).toBe(false);
    expect(pressAtWindow({ key: "j", metaKey: true })).toBe(false);

    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });

  it("stops listening once the host unmounts", () => {
    act(() => root?.unmount());
    root = null;

    pressAtWindow({ key: "k", metaKey: true });
    pressAtWindow({ key: "Escape" });

    expect(handlers.onTogglePalette).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });
});

type ShortcutHandlers = Parameters<typeof useGlobalShortcut>[0];

function spyHandlers() {
  return { onTogglePalette: vi.fn(), onEscape: vi.fn() };
}

/**
 * Renders a host that builds its handlers object inline, so every render hands
 * the hook a fresh identity with fresh functions: the shape a caller gets when
 * it forgets (or does not bother) to memoize. Renders three times (a tuple, so
 * each generation is statically present) and returns one spy pair per render,
 * the keydown subscriptions made on `window`, and how many renders happened.
 */
function renderInlineHandlersRepeatedly() {
  const addListener = vi.spyOn(window, "addEventListener");
  onTestFinished(() => addListener.mockRestore());

  let renders = 0;
  function InlineHost({ onTogglePalette, onEscape }: ShortcutHandlers) {
    renders += 1;
    useGlobalShortcut({ onTogglePalette, onEscape });
    return null;
  }

  const generations = [spyHandlers(), spyHandlers(), spyHandlers()] as const;
  for (const generation of generations) {
    act(() =>
      root?.render(
        <InlineHost
          onTogglePalette={generation.onTogglePalette}
          onEscape={generation.onEscape}
        />,
      ),
    );
  }

  const keydownSubscriptions = addListener.mock.calls.filter(
    ([type]) => type === "keydown",
  );
  return { generations, keydownSubscriptions, renders: () => renders };
}

describe("useGlobalShortcut handler identity", () => {
  it("subscribes to window keydown once across re-renders with new handler identities", () => {
    const { keydownSubscriptions, renders } = renderInlineHandlersRepeatedly();

    // Without this the next line could pass on a host that rendered only once.
    expect(renders()).toBe(3);
    expect(keydownSubscriptions).toHaveLength(1);
  });

  it("delivers keys to the handlers from the latest render, not earlier ones", () => {
    const { generations } = renderInlineHandlersRepeatedly();
    const [first, second, latest] = generations;

    pressAtWindow({ key: "k", metaKey: true });
    pressAtWindow({ key: "Escape" });

    expect(latest.onTogglePalette).toHaveBeenCalledTimes(1);
    expect(latest.onEscape).toHaveBeenCalledTimes(1);
    for (const stale of [first, second]) {
      expect(stale.onTogglePalette).not.toHaveBeenCalled();
      expect(stale.onEscape).not.toHaveBeenCalled();
    }
  });
});

/** Never settles, so a render that reads it with `use` stays suspended. */
const NEVER_SETTLES: Promise<never> = new Promise<never>(() => {});

/**
 * A host inside a Suspense boundary whose render can suspend right after the
 * hook has run. `suspendedRenders()` counts the suspending renders React began,
 * which is how a test knows such a render really handed the hook its handlers.
 */
function suspendableHost() {
  let suspendedRenders = 0;
  function SuspendableHost(props: {
    readonly label: string;
    readonly handlers: ShortcutHandlers;
    readonly suspend: boolean;
  }) {
    useGlobalShortcut(props.handlers);
    if (props.suspend) {
      suspendedRenders += 1;
      use(NEVER_SETTLES);
    }
    return props.label;
  }
  function tree(label: string, shortcutHandlers: ShortcutHandlers, suspend: boolean) {
    return (
      <Suspense fallback="fallback">
        <SuspendableHost label={label} handlers={shortcutHandlers} suspend={suspend} />
      </Suspense>
    );
  }
  return { tree, suspendedRenders: () => suspendedRenders };
}

function pressBothShortcuts(): void {
  pressAtWindow({ key: "k", metaKey: true });
  pressAtWindow({ key: "Escape" });
}

function expectCalls(spies: ReturnType<typeof spyHandlers>, times: number): void {
  expect(spies.onTogglePalette).toHaveBeenCalledTimes(times);
  expect(spies.onEscape).toHaveBeenCalledTimes(times);
}

describe("useGlobalShortcut committed handlers", () => {
  it("keeps delivering keys to the committed handlers while a newer render is suspended in a Transition", async () => {
    const { tree, suspendedRenders } = suspendableHost();
    const [committed, suspended, next] = [spyHandlers(), spyHandlers(), spyHandlers()] as const;

    act(() => root?.render(tree("committed", committed, false)));
    await act(async () => {
      startTransition(() => root?.render(tree("suspended", suspended, true)));
    });
    // The Transition render called the hook with `suspended` and then
    // suspended; React kept the committed tree on screen, neither committing
    // the new one nor falling back.
    expect(suspendedRenders()).toBeGreaterThan(0);
    expect(container?.textContent).toBe("committed");

    pressBothShortcuts();
    expectCalls(committed, 1);
    expectCalls(suspended, 0);

    act(() => root?.render(tree("next", next, false)));
    expect(container?.textContent).toBe("next");

    pressBothShortcuts();
    expectCalls(next, 1);
    expectCalls(committed, 1);
    expectCalls(suspended, 0);
  });
});
