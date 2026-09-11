/** @vitest-environment jsdom */

/**
 * The hook's contract is temporal: it is `false` on the first frame no matter
 * what the viewport says (the server rendered it that way, and the rail's
 * `inert` depends on it never flipping during hydration), then tracks the
 * `MediaQueryList` for as long as the component lives. jsdom ships no
 * `matchMedia`, so the list is a hand-rolled stub whose `matches` the test
 * flips before dispatching `change`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery.ts";

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const QUERY = "(width < 48rem)";

type ChangeListener = (event: MediaQueryListEvent) => void;

interface ListStub {
  matches: boolean;
  readonly media: string;
  readonly listeners: ChangeListener[];
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
}

function makeList(media: string, matches: boolean): ListStub {
  const listeners: ChangeListener[] = [];
  const list: ListStub = {
    matches,
    media,
    listeners,
    addEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.push(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type !== "change") return;
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    }),
  };
  return list;
}

/** Every value the hook returned, in render order. */
const seen: boolean[] = [];

function Host({ query }: { readonly query: string }) {
  const matches = useMediaQuery(query);
  seen.push(matches);
  return <div data-matches={String(matches)} />;
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let list: ListStub;
const matchMedia = vi.fn<(query: string) => ListStub>();

function render(query = QUERY): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Host query={query} />));
  return container;
}

function unmount(): void {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
}

function rendered(scope: HTMLElement): string | null {
  return scope.querySelector("[data-matches]")?.getAttribute("data-matches") ?? null;
}

beforeEach(() => {
  seen.length = 0;
  list = makeList(QUERY, true);
  matchMedia.mockReset();
  matchMedia.mockReturnValue(list);
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (root) unmount();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("useMediaQuery", () => {
  it("is false on the first frame and adopts the real value after mount", () => {
    const scope = render();

    // The SSR/hydration frame must not depend on the viewport.
    expect(seen[0]).toBe(false);
    // ...but the committed DOM already reflects the media query.
    expect(rendered(scope)).toBe("true");
    expect(matchMedia).toHaveBeenCalledExactlyOnceWith(QUERY);
  });

  it("stays false after mount when the query does not match", () => {
    list.matches = false;
    const scope = render();

    expect(rendered(scope)).toBe("false");
  });

  it("follows the list's current value on every change event", () => {
    const scope = render();
    expect(list.listeners).toHaveLength(1);

    // The hook re-reads `list.matches` rather than trusting the event, so the
    // stub flips first and the event carries nothing.
    list.matches = false;
    act(() => {
      for (const listener of list.listeners) listener({} as MediaQueryListEvent);
    });
    expect(rendered(scope)).toBe("false");

    list.matches = true;
    act(() => {
      for (const listener of list.listeners) listener({} as MediaQueryListEvent);
    });
    expect(rendered(scope)).toBe("true");
  });

  it("removes exactly the listener it added when the component unmounts", () => {
    render();
    const [type, added] = list.addEventListener.mock.calls[0] ?? [];
    expect(type).toBe("change");

    unmount();

    expect(list.removeEventListener).toHaveBeenCalledExactlyOnceWith("change", added);
    expect(list.listeners).toHaveLength(0);
  });
});
