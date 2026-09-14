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
import { ARTIFACT_CONTENT_MAX, ARTIFACT_LIMIT } from "@/lib/workbench/types";
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
  gscData: "sample",
};
const LABELS: ArtifactActionLabels = {
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Could not copy. Select the text and copy it by hand.",
  copyForAi: "Copy for an AI",
  exportFile: "Export",
  save: "Save to the basket",
  saved: "Saved",
  tooLarge: "Too large to save. Export it or copy it instead.",
  basketFull: "Could not save: the basket is full. Remove a few there, then save again.",
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

const reprepared: { setDraft: ((next: ArtifactDraft) => void) | null } = {
  setDraft: null,
};

/**
 * A parent that prepares on EVERY render, as a view that does not latch does:
 * each pass hands the row a new `PreparedArtifact`, new id and all, for the same
 * text while the draft's content is unchanged.
 */
function Reprepared({ initial }: { readonly initial: ArtifactDraft }) {
  const prepare = useAddArtifact();
  const [draft, setDraft] = useState(initial);
  captured.store = useWorkbench();
  reprepared.setDraft = setDraft;
  if (prepare === null) return null;
  const prepared = prepare(draft);
  captured.prepared = prepared;
  return <ArtifactActions prepared={prepared} labels={LABELS} />;
}

/** Hands the re-preparing parent a new draft object, which re-renders it. */
function redraft(next: ArtifactDraft): void {
  const { setDraft } = reprepared;
  if (setDraft === null) throw new Error("the re-preparing parent must have rendered");
  act(() => setDraft(next));
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

/** An md body that `useAddArtifact` stamps to exactly `units` UTF-16 units. */
function mdBodyFor(units: number): string {
  return "a".repeat(units - `${LINE}\n\n`.length);
}

/** Puts `count` plain artifacts in the basket through the real store, and returns their ids. */
function fillBasket(count: number): readonly string[] {
  const { store } = captured;
  if (!store) throw new Error("the probe must have rendered");
  act(() => {
    for (let i = 0; i < count; i += 1) {
      store.dispatch({
        type: "addArtifact",
        artifact: {
          id: `f${i}`,
          at: "2026-09-13 10:30",
          module: "audit",
          type: "md",
          engine: "seo",
          title: `f${i}`,
          content: `f${i}`,
        },
      });
    }
  });
  return basket().map((artifact) => artifact.id);
}

function alertText(): string | null {
  return document.querySelector('[role="alert"]')?.textContent ?? null;
}

const switcher: {
  pick: ((which: "a" | "b") => void) | null;
  a: PreparedArtifact | null;
  b: PreparedArtifact | null;
} = { pick: null, a: null, b: null };

/**
 * A parent that holds two prepared artifacts at once and hands the row one of
 * them: the same body as md and as prompt, which stamp to the very same text
 * under two different ids.
 */
function Switcher() {
  const prepare = useAddArtifact();
  const [pair, setPair] = useState<{
    readonly a: PreparedArtifact;
    readonly b: PreparedArtifact;
  } | null>(null);
  const [which, setWhich] = useState<"a" | "b">("a");
  captured.store = useWorkbench();
  switcher.pick = setWhich;
  useEffect(() => {
    if (prepare === null) return;
    setPair(
      (current) =>
        current ?? {
          a: prepare(MD_DRAFT),
          b: prepare({ ...MD_DRAFT, type: "prompt" }),
        },
    );
  }, [prepare]);
  if (pair === null) return null;
  switcher.a = pair.a;
  switcher.b = pair.b;
  return (
    <ArtifactActions prepared={which === "a" ? pair.a : pair.b} labels={LABELS} />
  );
}

function pick(which: "a" | "b"): void {
  const { pick: set } = switcher;
  if (set === null) throw new Error("the switcher must have rendered");
  act(() => set(which));
}

function statusText(): string | null {
  return document.querySelector('[role="status"]')?.textContent ?? null;
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
  reprepared.setDraft = null;
  switcher.pick = null;
  switcher.a = null;
  switcher.b = null;
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

  it("stores a text exactly at the size limit and says it saved, with no refusal", () => {
    const { prepared } = mount({
      ...MD_DRAFT,
      body: mdBodyFor(ARTIFACT_CONTENT_MAX),
    });
    expect(prepared.content.length).toBe(ARTIFACT_CONTENT_MAX);

    click(LABELS.save);

    expect(basket()).toHaveLength(1);
    expect(basket()[0]?.content).toBe(prepared.content);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      LABELS.saved,
    );
    expect(alertText()).toBeNull();
  });

  it("refuses a text one unit over the limit, says so, and still copies and exports all of it", async () => {
    const { prepared } = mount({
      ...MD_DRAFT,
      body: `${mdBodyFor(ARTIFACT_CONTENT_MAX)}a`,
    });
    expect(prepared.content.length).toBe(ARTIFACT_CONTENT_MAX + 1);

    click(LABELS.save);

    expect(basket()).toHaveLength(0);
    expect(alertText()).toBe(LABELS.tooLarge);
    expect(document.querySelector('[role="status"]')?.textContent).not.toBe(
      LABELS.saved,
    );

    click(LABELS.copy);
    await settle();
    click(LABELS.copyForAi);
    await settle();
    click(LABELS.exportFile);

    expect(writeText.mock.calls[0]?.[0]).toBe(prepared.content);
    expect(payloadOf(writeText.mock.calls[1]?.[0] ?? "")).toBe(prepared.content);
    expect(mocks.downloadText.mock.calls[0]?.[1]).toBe(prepared.content);
    // A standing fact about this text, not a flash: copying does not clear it.
    expect(alertText()).toBe(LABELS.tooLarge);
    expect(basket()).toHaveLength(0);
  });

  it("keeps a refusal up when the parent re-renders with a new object for the same text, and drops it for another text", () => {
    const over: ArtifactDraft = {
      ...MD_DRAFT,
      body: `${mdBodyFor(ARTIFACT_CONTENT_MAX)}a`,
    };
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
          <Reprepared initial={over} />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    );
    const first = captured.prepared;

    click(LABELS.save);
    expect(alertText()).toBe(LABELS.tooLarge);

    redraft({ ...over });
    // Really a new object for the same text: otherwise this proves nothing.
    expect(captured.prepared).not.toBe(first);
    expect(captured.prepared?.artifact.id).not.toBe(first?.artifact.id);
    expect(captured.prepared?.content).toBe(first?.content);
    expect(alertText()).toBe(LABELS.tooLarge);

    redraft({ ...over, body: `${mdBodyFor(ARTIFACT_CONTENT_MAX)}b` });
    expect(alertText()).toBeNull();
  });

  it("refuses to save into a full basket, says why and what to do, and keeps every artifact already there", async () => {
    const { prepared } = mount();
    const before = fillBasket(ARTIFACT_LIMIT);

    click(LABELS.save);

    expect(basket().map((artifact) => artifact.id)).toEqual(before);
    expect(alertText()).toBe(LABELS.basketFull);
    expect(document.querySelector('[role="status"]')?.textContent).not.toBe(
      LABELS.saved,
    );

    click(LABELS.copy);
    await settle();
    click(LABELS.exportFile);
    expect(writeText.mock.calls[0]?.[0]).toBe(prepared.content);
    expect(mocks.downloadText.mock.calls[0]?.[1]).toBe(prepared.content);
  });

  it("drops the full-basket notice once there is room, and the same artifact then saves", () => {
    const { prepared } = mount();
    fillBasket(ARTIFACT_LIMIT);
    click(LABELS.save);
    expect(alertText()).toBe(LABELS.basketFull);

    act(() => captured.store?.dispatch({ type: "removeArtifact", id: "f0" }));
    expect(alertText()).toBeNull();

    click(LABELS.save);
    expect(basket()[0]?.id).toBe(prepared.artifact.id);
    expect(basket()).toHaveLength(ARTIFACT_LIMIT);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      LABELS.saved,
    );
    expect(alertText()).toBeNull();
  });

  it("keeps the full-basket notice when the parent re-renders with a new object for the same text", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
          <Reprepared initial={MD_DRAFT} />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    );
    fillBasket(ARTIFACT_LIMIT);
    click(LABELS.save);
    expect(alertText()).toBe(LABELS.basketFull);

    redraft({ ...MD_DRAFT });

    expect(alertText()).toBe(LABELS.basketFull);
  });

  it("drops the full-basket notice for an artifact that is itself already in the basket", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
          <Switcher />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    );
    const { a, b } = switcher;
    if (a === null || b === null) throw new Error("the switcher must have prepared both");
    // Really one text under two ids: otherwise this proves nothing.
    expect(b.content).toBe(a.content);
    expect(b.artifact.id).not.toBe(a.artifact.id);

    click(LABELS.save);
    fillBasket(ARTIFACT_LIMIT - 1);
    expect(basket()).toHaveLength(ARTIFACT_LIMIT);
    pick("b");
    click(LABELS.save);
    expect(alertText()).toBe(LABELS.basketFull);

    pick("a");
    expect(alertText()).toBeNull();
    click(LABELS.save);
    expect(statusText()).toBe(LABELS.saved);
    expect(basket()).toHaveLength(ARTIFACT_LIMIT);
  });

  it("replaces a saved flash with the refusal when the next save is refused", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
          <Reprepared initial={MD_DRAFT} />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    );
    fillBasket(ARTIFACT_LIMIT - 1);
    click(LABELS.save);
    expect(statusText()).toBe(LABELS.saved);
    expect(basket()).toHaveLength(ARTIFACT_LIMIT);

    redraft({ ...MD_DRAFT, body: `${BODY}\n- 另一件` });
    click(LABELS.save);

    expect(alertText()).toBe(LABELS.basketFull);
    expect(statusText()).toBe("");
  });
});
