/** @vitest-environment jsdom */

/**
 * The drawer is a view over the workbench store plus one piece of transient
 * state — the "Copied" flash — whose whole contract is *when it goes away*.
 * That is unreachable from markup, so the real component runs against the real
 * provider through `createRoot`, with only the clipboard stubbed.
 */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/workbench/types";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import {
  WorkbenchProvider,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { WB_APP_ROOT_ID } from "../ui/ids.ts";
import { ArtifactDrawer } from "./ArtifactDrawer.tsx";

const en = getMessages("en");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};
const ARTIFACT: Artifact = {
  id: "a1",
  at: "2026-09-11 14:00",
  module: "keywordLibrary",
  type: "csv",
  engine: "both",
  title: "Keyword library",
  content: "q\ngeo audit\n",
  filename: "keywords.csv",
};
const COPY = {
  empty: "Nothing saved yet",
  copy: "Copy",
  copied: "Copied",
  remove: "Remove",
} as const;
/** `ArtifactDrawer` clears the flash after this many ms. */
const FLASH_MS = 1300;

const store: { current: WorkbenchContextValue | null } = { current: null };

function Probe() {
  store.current = useWorkbench();
  return null;
}

function Harness({ open }: { readonly open: boolean }) {
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <div id={WB_APP_ROOT_ID}>
          <button type="button" id="opener" ref={openerRef}>
            open
          </button>
        </div>
        <Probe />
        <ArtifactDrawer open={open} onClose={() => {}} returnFocusTo={openerRef} />
      </WorkbenchProvider>
    </NextIntlClientProvider>
  );
}

let cleanup: (() => void) | null = null;
const writeText = vi.fn<(value: string) => Promise<void>>();

function render(open = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = {
    container,
    open(next: boolean) {
      act(() => root.render(<Harness open={next} />));
    },
  };
  view.open(open);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return view;
}

function addArtifact(artifact: Artifact = ARTIFACT): void {
  const dispatch = store.current?.dispatch;
  if (!dispatch) throw new Error("the provider never rendered");
  act(() => dispatch({ type: "addArtifact", artifact }));
}

function buttonWith(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

beforeEach(() => {
  window.localStorage.clear();
  store.current = null;
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  // jsdom ships no clipboard; the drawer's fallback is `window.prompt`, which
  // would hide a broken happy path behind a passing assertion.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ArtifactDrawer", () => {
  it("shows the empty state until something is saved", () => {
    const view = render();

    expect(view.container.textContent).toContain(COPY.empty);
    expect(view.container.querySelectorAll("[data-wb-artifact]")).toHaveLength(0);

    addArtifact();

    expect(view.container.textContent).not.toContain(COPY.empty);
    expect(view.container.querySelector("[data-wb-artifact]")?.textContent).toContain(
      ARTIFACT.title,
    );
  });

  it("flashes Copied and goes back to Copy on its own", async () => {
    vi.useFakeTimers();
    const view = render();
    addArtifact();

    await act(async () => {
      buttonWith(view.container, COPY.copy).click();
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(ARTIFACT.content);
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });

    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
  });

  it("clears a pending Copied when the drawer is reopened", async () => {
    vi.useFakeTimers();
    const view = render();
    addArtifact();
    await act(async () => {
      buttonWith(view.container, COPY.copy).click();
    });
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    view.open(false);
    view.open(true);

    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
    // The timer from the first copy must not fire into the reopened drawer.
    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
  });

  it("returns to the empty state when the last artifact is removed", () => {
    const view = render();
    addArtifact();

    act(() => buttonWith(view.container, COPY.remove).click());

    expect(view.container.querySelectorAll("[data-wb-artifact]")).toHaveLength(0);
    expect(view.container.textContent).toContain(COPY.empty);
  });
});
