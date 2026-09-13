/** @vitest-environment jsdom */

/**
 * Four buttons, one text (裁决 Q23). The whole point of this row is that copy,
 * "copy for an AI", export and "save to the basket" cannot disagree about what
 * the artifact says, and that the stamped provenance declaration travels with
 * every one of them exactly once — a second declaration reads as two claims
 * about where the numbers came from, and a missing one ships sample data with
 * nothing saying so.
 *
 * So the row is driven against the REAL `useAddArtifact` and the real store
 * rather than a hand-written `prepared` object: the canonical text is the hook's
 * output, the saved text is read back out of the basket, and the AI payload is
 * taken out of the fenced block by the same splitter the prompt builders' tests
 * use. A hand-written expectation could only re-state the implementation.
 */

import { act, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitFences } from "@/lib/workbench/mock/builders/prompt-test-helpers";
import type { ProjectSeed } from "@/lib/workbench/store/reducer";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import {
  WorkbenchProvider,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import {
  useAddArtifact,
  type ArtifactDraft,
  type PreparedArtifact,
} from "../hooks/useAddArtifact.ts";

const mocks = vi.hoisted(() => ({
  downloadText: vi.fn<(name: string, content: string, mime: string) => void>(),
}));

// The real sink creates an object URL and clicks an anchor, neither of which
// jsdom implements; what is under test is the name, the text and the mime.
vi.mock("@/lib/workbench/download", () => ({
  downloadText: mocks.downloadText,
}));

// Type-only, so it is erased and cannot defeat the hoisted mock above.
import type { ArtifactActionLabels } from "./ArtifactActions.tsx";

const { ArtifactActions } = await import("./ArtifactActions.tsx");

const en = getMessages("en");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";
const SEED: ProjectSeed = {
  url: "https://example.test",
  brand: "Example",
  market: "US",
};
const AT = new Date(2026, 8, 13, 10, 30, 45);
/** `workbench.provenance.artifact` in en, with the stamp `useAddArtifact` writes. */
const LINE =
  "Sample data: generated locally for demonstration, not measured. Generated 2026-09-13 10:30";
const BODY = "# 修复任务\n- 给 /pricing 补 canonical";
const MD_DRAFT: ArtifactDraft = {
  module: "audit",
  type: "md",
  engine: "seo",
  title: "修复任务",
  body: BODY,
};
const LABELS: ArtifactActionLabels = {
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Could not copy. Select the text and copy it by hand.",
  copyForAi: "Copy for an AI",
  exportFile: "Export",
  save: "Save to the basket",
  saved: "Saved",
};
/** How long a flash stays up. */
const FLASH_MS = 1300;

interface Mounted {
  readonly prepared: PreparedArtifact;
}

const captured: {
  prepared: PreparedArtifact | null;
  store: WorkbenchContextValue | null;
} = {
  prepared: null,
  store: null,
};
const writeText = vi.fn<(value: string) => Promise<void>>();
let cleanup: (() => void) | null = null;

/**
 * Prepares the artifact once and hands the row the result, which is how a view
 * uses it: the clock is read when the run finishes, not on every render. The
 * hook hands out nothing until the project is hydrated, so the preparation waits
 * for it and the row is not rendered before then — a view does the same with a
 * skeleton.
 */
function Probe({
  draft,
  disabled,
}: {
  readonly draft: ArtifactDraft;
  readonly disabled: boolean;
}) {
  const prepare = useAddArtifact();
  const [prepared, setPrepared] = useState<PreparedArtifact | null>(null);
  captured.store = useWorkbench();
  useEffect(() => {
    if (prepare === null) return;
    // Latched: `prepare` is a new function each render on purpose, and one
    // artifact must not turn into a new id and stamp on every pass.
    setPrepared((current) => current ?? prepare(draft));
  }, [prepare, draft]);
  captured.prepared = prepared;
  if (prepared === null) return null;
  return (
    <ArtifactActions prepared={prepared} labels={LABELS} disabled={disabled} />
  );
}

function render(element: ReactElement): void {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
}

function mount(draft: ArtifactDraft = MD_DRAFT, disabled = false): Mounted {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
        <Probe draft={draft} disabled={disabled} />
      </WorkbenchProvider>
    </NextIntlClientProvider>,
  );
  const { prepared } = captured;
  if (!prepared) throw new Error("the probe must have rendered");
  return { prepared };
}

function click(label: string): void {
  const found = [...document.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (found === undefined) throw new Error(`no button labelled ${label}`);
  act(() => found.click());
}

function buttons(): readonly HTMLButtonElement[] {
  return [...document.querySelectorAll("button")];
}

/** Waits out the promise the click handler started, then lets React commit. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * The basket as it is NOW. Read through `captured` on every call: `useWorkbench`
 * hands out a fresh value per render, so a reference kept from mount time still
 * carries the state the probe first rendered with — an empty basket, forever.
 */
function basket(): WorkbenchContextValue["state"]["artifacts"] {
  const { store } = captured;
  if (!store) throw new Error("the probe must have rendered");
  return store.state.artifacts;
}

function payloadOf(prompt: string): string {
  const { blocks } = splitFences(prompt);
  const [only, ...rest] = blocks;
  if (only === undefined || rest.length > 0) {
    throw new Error(`expected exactly one data block, got ${blocks.length}`);
  }
  return only.body;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(AT);
  mocks.downloadText.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  // jsdom ships no clipboard at all; without this the happy path would take the
  // failure branch and the "copied" assertions would be about the wrong thing.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  captured.prepared = null;
  captured.store = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ArtifactActions", () => {
  it("hands the same canonical text to all four actions, byte for byte", async () => {
    const { prepared } = mount();

    click(LABELS.copy);
    await settle();
    click(LABELS.exportFile);
    click(LABELS.save);
    click(LABELS.copyForAi);
    await settle();

    const copied = writeText.mock.calls[0]?.[0] ?? "";
    const wrapped = writeText.mock.calls[1]?.[0] ?? "";
    const exported = mocks.downloadText.mock.calls[0]?.[1] ?? "";
    const saved = basket()[0]?.content ?? "";

    expect(copied).toBe(prepared.content);
    expect(exported).toBe(prepared.content);
    expect(saved).toBe(prepared.content);
    expect(payloadOf(wrapped)).toBe(prepared.content);
    // And the canonical text really is the stamped one, not the builder's body.
    expect(prepared.content).toBe(`${LINE}\n\n${BODY}`);
  });

  it("declares its provenance exactly once in every one of them", async () => {
    mount();

    click(LABELS.copy);
    await settle();
    click(LABELS.exportFile);
    click(LABELS.save);
    click(LABELS.copyForAi);
    await settle();

    for (const text of [
      writeText.mock.calls[0]?.[0] ?? "",
      writeText.mock.calls[1]?.[0] ?? "",
      mocks.downloadText.mock.calls[0]?.[1] ?? "",
      basket()[0]?.content ?? "",
    ]) {
      expect(occurrences(text, LINE), text.slice(0, 120)).toBe(1);
    }
  });

  it("wraps the AI copy in the fixed prompt and changes nothing inside the payload", async () => {
    const { prepared } = mount();

    click(LABELS.copyForAi);
    await settle();

    const wrapped = writeText.mock.calls[0]?.[0] ?? "";
    expect(wrapped).not.toBe(prepared.content);
    expect(wrapped.startsWith("# 工作台产物")).toBe(true);
    expect(payloadOf(wrapped)).toBe(prepared.content);
  });

  it("flashes that it copied, and clears the flash again", async () => {
    mount();

    click(LABELS.copy);
    await settle();
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe(LABELS.copied);

    act(() => {
      vi.advanceTimersByTime(FLASH_MS);
    });
    expect(document.querySelector('[role="status"]')?.textContent ?? "").toBe(
      "",
    );
  });

  it("says so when the clipboard refuses, instead of claiming it copied", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    mount();

    click(LABELS.copy);
    await settle();

    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe(LABELS.copyFailed);
    expect(document.body.textContent).not.toContain(LABELS.copied);
  });

  it("survives a browser with no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    mount();

    click(LABELS.copy);
    await settle();

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      LABELS.copyFailed,
    );
  });

  it("flashes that it saved, and saves once however often it is clicked", () => {
    mount();

    click(LABELS.save);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      LABELS.saved,
    );
    click(LABELS.save);

    expect(basket()).toHaveLength(1);
  });

  it("names the download from the artifact and takes the extension from its type", () => {
    mount({
      ...MD_DRAFT,
      type: "csv",
      body: "query\ngeo audit\n",
      filename: "gsc rows.csv",
    });

    click(LABELS.exportFile);

    const [name, , mime] = mocks.downloadText.mock.calls[0] ?? [];
    expect(name).toBe("gsc rows.csv");
    expect(mime).toBe("text/csv;charset=utf-8");
  });

  it("forces the extension the type dictates even when the title says otherwise", () => {
    mount({ ...MD_DRAFT, filename: "../../report<1>.csv" });

    click(LABELS.exportFile);

    // The exact spelling of the sanitised stem is `downloadName`'s contract and
    // is pinned in its own test; what matters here is that the type decides the
    // extension and that no path separator reaches the save dialog.
    const name = mocks.downloadText.mock.calls[0]?.[0] ?? "";
    expect(name.endsWith(".md")).toBe(true);
    expect(name).not.toContain("/");
    expect(name).not.toContain("<");
    expect(mocks.downloadText.mock.calls[0]?.[2]).toBe(
      "text/markdown;charset=utf-8",
    );
  });

  it("disables every action when the caller says there is nothing to act on", async () => {
    mount(MD_DRAFT, true);

    expect(buttons()).toHaveLength(4);
    for (const button of buttons()) {
      expect(button.disabled, button.textContent ?? "").toBe(true);
    }
    click(LABELS.copy);
    await settle();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("carries no inline style (production CSP has no unsafe-inline)", () => {
    mount();

    expect(document.body.querySelectorAll("[style]")).toHaveLength(0);
  });
});
