/** @vitest-environment jsdom */

/**
 * The drawer is a view over the workbench store plus one piece of transient
 * state — the "Copied" flash — whose whole contract is *when it goes away*.
 * That is unreachable from markup, so the real component runs against the real
 * provider through `createRoot`, with only the clipboard and the download sink
 * stubbed.
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

const mocks = vi.hoisted(() => ({
  downloadText: vi.fn<(name: string, content: string, mime: string) => void>(),
}));

// The real sink creates an object URL and clicks an anchor, neither of which
// jsdom implements; the contract under test is only what name it is handed.
vi.mock("@/lib/workbench/download", () => ({ downloadText: mocks.downloadText }));

const { ArtifactDrawer } = await import("./ArtifactDrawer.tsx");

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
  download: "Download",
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
  mocks.downloadText.mockReset();
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

  it("does not let a timer from a closed drawer cut the next Copied short", async () => {
    vi.useFakeTimers();
    const view = render();
    addArtifact();
    await act(async () => {
      buttonWith(view.container, COPY.copy).click();
    });
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    // Close well before the first flash would have expired, then start a second
    // one: an uncleared timer is now due sooner than the new flash is.
    const EARLY = 300;
    act(() => {
      vi.advanceTimersByTime(EARLY);
    });
    view.open(false);
    view.open(true);
    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
    await act(async () => {
      buttonWith(view.container, COPY.copy).click();
    });
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    // A surviving first timer is due FLASH_MS - EARLY from here, so it would have
    // cut this flash short well before the second timer is due.
    act(() => {
      vi.advanceTimersByTime(FLASH_MS - 1);
    });
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
  });

  it("restarts the flash on a second copy instead of inheriting the first timer", async () => {
    // Without a close in between, `copy()`'s own clear is the only thing standing
    // between the second flash and the first copy's timer. (The close-path clear
    // alone cannot be observed from the UI: every path that starts a new flash
    // also clears, so it is defence in depth, not the mechanism.)
    vi.useFakeTimers();
    const view = render();
    addArtifact();
    await act(async () => {
      buttonWith(view.container, COPY.copy).click();
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(buttonWith(view.container, COPY.copied)).toBeDefined();

    await act(async () => {
      buttonWith(view.container, COPY.copied).click();
    });
    act(() => {
      vi.advanceTimersByTime(FLASH_MS - 1);
    });

    expect(buttonWith(view.container, COPY.copied)).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(buttonWith(view.container, COPY.copy)).toBeDefined();
  });

  it("downloads under the stored filename with the type's extension and MIME", () => {
    const view = render();
    addArtifact();

    act(() => buttonWith(view.container, COPY.download).click());

    expect(mocks.downloadText).toHaveBeenCalledExactlyOnceWith(
      "keywords.csv",
      ARTIFACT.content,
      "text/csv;charset=utf-8",
    );
  });

  it("falls back to the title when the reducer dropped a filename that was not a bare name", () => {
    // Two layers: the reducer refuses to store a filename with a path in it
    // (`ARTIFACT_FILENAME_PATTERN`), so through the store the download is
    // named after the title — with the type's extension, not the `.csv` the
    // rejected name claimed.
    const view = render();
    addArtifact({
      ...ARTIFACT,
      id: "a2",
      type: "md",
      title: "Weekly report",
      filename: "../../report<1>.csv",
    });

    act(() => buttonWith(view.container, COPY.download).click());

    expect(mocks.downloadText).toHaveBeenCalledExactlyOnceWith(
      "Weekly report.md",
      ARTIFACT.content,
      "text/markdown;charset=utf-8",
    );
  });

  // `downloadName`'s own contract — the sanitiser table and the extension
  // forcing — moved to `lib/workbench/artifact-file.test.ts` with the function
  // (裁决 Q35). What stays here is what only the rendered drawer can show: that
  // its download button hands the sink that name and that type's MIME.

  it("returns to the empty state when the last artifact is removed", () => {
    const view = render();
    addArtifact();

    act(() => buttonWith(view.container, COPY.remove).click());

    expect(view.container.querySelectorAll("[data-wb-artifact]")).toHaveLength(0);
    expect(view.container.textContent).toContain(COPY.empty);
  });

  it("clears the artifacts it rendered and keeps one queued behind that render (codex S6r3 #1)", () => {
    const view = render();
    addArtifact({ ...ARTIFACT, id: "a1" });
    addArtifact({ ...ARTIFACT, id: "a2" });
    const rendered = [...view.container.querySelectorAll<HTMLElement>("[data-wb-artifact]")].map(
      (node) => node.dataset["wbArtifact"],
    );
    expect(rendered).toEqual(["a2", "a1"]);
    const clear = buttonWith(view.container, en.workbench.shell.drawer.clear);
    const dispatch = store.current?.dispatch;
    if (!dispatch) throw new Error("the provider never rendered");

    act(() => {
      // Queued, not rendered: the click below still runs in the render that
      // showed a2 and a1, so those are the ids it can dispatch.
      dispatch({ type: "addArtifact", artifact: { ...ARTIFACT, id: "a3" } });
      clear.click();
    });

    expect(store.current?.state.artifacts.map((a) => a.id)).toEqual(["a3"]);
  });
});
