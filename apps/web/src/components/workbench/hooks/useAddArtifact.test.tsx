/** @vitest-environment jsdom */

/**
 * Stamping happens here and nowhere else (Q23), so these tests pin the finished
 * text against the literal English provenance sentence rather than against
 * `stampArtifact` — calling the same function to build the expectation would pass
 * even if the hook stamped with the wrong key, or with the key path next-intl
 * renders when a message is missing. The store is the real provider, so `save()`
 * is checked by what ends up in the basket.
 *
 * The `ready` gate needs the other kind of store. Whether the hook hands out a
 * maker at all is a question about render passes, not about settled DOM, so the
 * two cases that turn on it render against a context value whose `ready` is
 * fixed, and the real provider is used to pin that its first pass is one of the
 * blocked ones.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentTaskWrapper } from "@/lib/workbench/mock/builders/agent-task";
import { splitFences } from "@/lib/workbench/mock/builders/prompt-test-helpers";
import { SAMPLE_CSV_MARKER } from "@/lib/workbench/mock/provenance";
import {
  initialProjectState,
  type ProjectSeed,
} from "@/lib/workbench/store/reducer";
import { useWorkbench } from "@/lib/workbench/store/hooks";
import {
  WorkbenchContext,
  WorkbenchProvider,
  type WorkbenchContextValue,
} from "@/lib/workbench/store/WorkbenchProvider";
import { ARTIFACT_CONTENT_MAX, ARTIFACT_LIMIT } from "@/lib/workbench/types";
import {
  useAddArtifact,
  type ArtifactDraft,
  type PreparedArtifact,
  type SaveResult,
} from "./useAddArtifact.ts";

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
const AT = new Date(2026, 8, 13, 10, 30, 45);
const STAMP = "2026-09-13 10:30";
/** `workbench.provenance.artifact` in en, with the stamp filled in. */
const LINE = `Sample data: generated locally for demonstration, not measured. Generated ${STAMP}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const MD_DRAFT: ArtifactDraft = {
  module: "audit",
  type: "md",
  engine: "seo",
  title: "修复任务",
  body: "# 修复任务\n- 给 /pricing 补 canonical",
};

type Prepare = (draft: ArtifactDraft) => PreparedArtifact;

interface Harness {
  readonly prepare: Prepare;
  readonly store: WorkbenchContextValue;
}

const captured: { prepare: Prepare | null; store: WorkbenchContextValue | null } = {
  prepare: null,
  store: null,
};
/** What the hook returned on each render pass, oldest first. */
let frames: (Prepare | null)[] = [];
let cleanup: (() => void) | null = null;

function Probe() {
  const prepare = useAddArtifact();
  frames.push(prepare);
  captured.prepare = prepare;
  captured.store = useWorkbench();
  return null;
}

/** A store stuck at one `ready`, so the gate can be read without racing hydration. */
function context(ready: boolean): WorkbenchContextValue {
  return {
    projectId: PROJECT_ID,
    state: initialProjectState(SEED),
    dispatch: () => {},
    ready,
    storageMode: "ok",
    keywordRows: [],
    keywordRowCount: null,
    forgetProject: () => {},
  };
}

/** Renders twice against that store and returns what the hook gave each time. */
function mountStub(ready: boolean): readonly (Prepare | null)[] {
  // A fresh element each pass: re-rendering the identical one is a bail-out, and
  // a single recorded frame would make "every frame" vacuous.
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <WorkbenchContext.Provider value={context(ready)}>
        <Probe />
      </WorkbenchContext.Provider>
    </NextIntlClientProvider>
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(tree()));
  act(() => root.render(tree()));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return frames;
}

function mount(): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <WorkbenchProvider projectId={PROJECT_ID} seed={SEED}>
          <Probe />
        </WorkbenchProvider>
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  const { prepare, store } = captured;
  if (!prepare || !store) throw new Error("the probe must have rendered");
  return { prepare, store };
}

/** The basket after a dispatch; the provider commits it inside `act`. */
function artifacts(): WorkbenchContextValue["state"]["artifacts"] {
  const { store } = captured;
  if (!store) throw new Error("the probe must have rendered");
  return store.state.artifacts;
}

/** An md body that stamps to exactly `units` UTF-16 units: the stamp is `${LINE}\n\n` + body. */
function mdBodyFor(units: number): string {
  return "a".repeat(units - `${LINE}\n\n`.length);
}

/** Puts `count` plain artifacts in the basket through the real store, `f0` first (so oldest). */
function fillBasket(count: number): void {
  const { store } = captured;
  if (!store) throw new Error("the probe must have rendered");
  act(() => {
    for (let i = 0; i < count; i += 1) {
      store.dispatch({
        type: "addArtifact",
        artifact: { id: `f${i}`, at: STAMP, module: "audit", type: "md", engine: "seo", title: `f${i}`, content: `f${i}` },
      });
    }
  });
}

function basketIds(): readonly string[] {
  return artifacts().map((artifact) => artifact.id);
}

/** Calls `save()` inside `act`, so a dispatch it makes is committed before the basket is read. */
function saveInAct(prepared: PreparedArtifact): SaveResult {
  let result: SaveResult | undefined;
  act(() => {
    result = prepared.save();
  });
  if (result === undefined) throw new Error("save must have returned");
  return result;
}

beforeEach(() => {
  window.localStorage.clear();
  frames = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AT);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  captured.prepare = null;
  captured.store = null;
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("useAddArtifact", () => {
  it("hands out nothing while the project is not hydrated, however many times it renders", () => {
    const seen = mountStub(false);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((value) => value === null)).toBe(true);
  });

  it("hands out the maker once the store says the project is ready", () => {
    const seen = mountStub(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((value) => value !== null)).toBe(true);
  });

  it("blocks the provider's own pre-hydration passes, where a save would be discarded twice", () => {
    // Both halves of that discard are in the store: the persistence effect
    // returns early while `ready` is false, and the `loadPersisted` that follows
    // replaces the state wholesale (reducer.ts). A row that called `save()` on
    // this pass would flash "saved" over an empty basket.
    mount();
    expect(frames.length).toBeGreaterThan(1);
    expect(frames[0]).toBeNull();
    expect(frames.at(-1)).not.toBeNull();
  });

  it("stamps a document with the localised provenance line above the body", () => {
    const prepared = mount().prepare(MD_DRAFT);
    expect(prepared.content).toBe(`${LINE}\n\n${MD_DRAFT.body}`);
    expect(prepared.artifact.at).toBe(STAMP);
    expect(prepared.artifact.content).toBe(prepared.content);
    // Not the key path next-intl renders for a missing message.
    expect(prepared.content).not.toContain("workbench.provenance");
  });

  it("stamps a csv with the sample marker and a comment line, and a json with the declaration first", () => {
    const { prepare } = mount();
    const csv = prepare({ ...MD_DRAFT, type: "csv", body: "q\nai seo\n" });
    // Canonical shape: the builder's trailing newline does not survive stamping.
    expect(csv.content).toBe(`${SAMPLE_CSV_MARKER}\n# ${LINE}\nq\nai seo`);

    const json = prepare({ ...MD_DRAFT, type: "json", body: '{"a":1}' });
    const parsed = JSON.parse(json.content) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["_sampleData", "a"]);
    expect(parsed._sampleData).toBe(LINE);
  });

  it("gives each artifact a fresh uuid", () => {
    const { prepare } = mount();
    const first = prepare(MD_DRAFT);
    const second = prepare(MD_DRAFT);
    expect(first.artifact.id).toMatch(UUID);
    expect(second.artifact.id).toMatch(UUID);
    expect(first.artifact.id).not.toBe(second.artifact.id);
  });

  it("saves exactly the canonical text, and only once however often save is called", () => {
    const { prepare } = mount();
    const prepared = prepare(MD_DRAFT);
    expect(artifacts()).toHaveLength(0);
    act(() => prepared.save());
    expect(artifacts()).toHaveLength(1);
    expect(artifacts()[0]).toEqual(prepared.artifact);
    expect(artifacts()[0]?.content).toBe(prepared.content);
    act(() => prepared.save());
    expect(artifacts()).toHaveLength(1);
  });

  it("carries the draft's module, type, engine and title, and the file name only when given", () => {
    const { prepare } = mount();
    const named = prepare({ ...MD_DRAFT, type: "csv", body: "q\n", filename: "keyword-matrix.csv" });
    expect(named.artifact).toMatchObject({
      module: "audit",
      type: "csv",
      engine: "seo",
      title: "修复任务",
      filename: "keyword-matrix.csv",
    });
    expect(Object.hasOwn(prepare(MD_DRAFT).artifact, "filename")).toBe(false);
  });

  it("reads the clock when the operator acts, not when the view rendered", () => {
    const { prepare } = mount();
    vi.setSystemTime(new Date(2026, 8, 14, 8, 5, 0));
    const later = prepare(MD_DRAFT);
    expect(later.artifact.at).toBe("2026-09-14 08:05");
    expect(later.content).toContain("Generated 2026-09-14 08:05");
  });

  it("refuses a json body that is not a JSON object rather than shipping it undeclared", () => {
    const { prepare } = mount();
    expect(() => prepare({ ...MD_DRAFT, type: "json", body: "[1,2]" })).toThrow(
      /json artifacts must be a JSON object/,
    );
  });

  it("hands out text whose AI payload is byte for byte the text itself, whatever the body's line endings", () => {
    // Q23 at the hook: `prepared.content` is what copy, export and save hand
    // over, and the AI wrapper must carry exactly that. Every body below is one
    // `fenceBlock` would otherwise rewrite (CR) or fold into its closing fence
    // (a trailing LF); U+2028 is here to show content is NOT normalised.
    const { prepare } = mount();
    const bodies: readonly (readonly [string, string])[] = [
      ["CRLF", "# 任务\r\n- 补 canonical"],
      ["a lone CR", "# 任务\r- 补 canonical"],
      ["one trailing LF", "# 任务\n- 补 canonical\n"],
      ["several trailing LFs", "# 任务\n- 补 canonical\n\n\n"],
      ["U+2028", "# 任务\u2028- 补 canonical"],
    ];
    for (const type of ["md", "prompt", "csv"] as const) {
      for (const [name, body] of bodies) {
        const prepared = prepare({ ...MD_DRAFT, type, body });
        const { blocks } = splitFences(agentTaskWrapper(prepared.content));
        expect(blocks, `${type} / ${name}`).toHaveLength(1);
        expect(blocks[0]?.body, `${type} / ${name}`).toBe(prepared.content);
      }
    }
  });

  it("freezes what it hands out, so save cannot put text in the basket that copy and export never saw", () => {
    const { prepare } = mount();
    const prepared = prepare(MD_DRAFT);

    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.artifact)).toBe(true);
    // `Object.assign` writes with throw-on-failure in sloppy and strict code
    // alike, so against a frozen object the rewrite is refused, not ignored.
    expect(() =>
      Object.assign(prepared.artifact, { content: "another, unstamped body" }),
    ).toThrow(TypeError);
    expect(() =>
      Object.assign(prepared, { content: "another, unstamped body" }),
    ).toThrow(TypeError);

    act(() => prepared.save());
    expect(artifacts()[0]?.content).toBe(prepared.content);
  });

  it("stores a text exactly at the size limit, whole", () => {
    const { prepare } = mount();
    const prepared = prepare({ ...MD_DRAFT, body: mdBodyFor(ARTIFACT_CONTENT_MAX) });
    expect(prepared.content.length).toBe(ARTIFACT_CONTENT_MAX);

    expect(saveInAct(prepared)).toBe("saved");
    expect(artifacts()).toHaveLength(1);
    expect(artifacts()[0]?.content).toBe(prepared.content);
  });

  it("refuses a text one UTF-16 unit over the limit rather than let the store cut it short", () => {
    const { prepare } = mount();
    // Ends in an astral character: one code point, two UTF-16 units. Counted in
    // code points this text is exactly at the limit; the store counts units, so
    // a check that counted code points would let it through to be truncated.
    const prepared = prepare({
      ...MD_DRAFT,
      body: `${mdBodyFor(ARTIFACT_CONTENT_MAX - 1)}\u{1F600}`,
    });
    expect(prepared.content.length).toBe(ARTIFACT_CONTENT_MAX + 1);
    expect([...prepared.content]).toHaveLength(ARTIFACT_CONTENT_MAX);

    expect(saveInAct(prepared)).toBe("tooLarge");
    expect(saveInAct(prepared)).toBe("tooLarge");
    expect(artifacts()).toHaveLength(0);
  });

  it("refuses to save into a full basket: nothing stored, nothing evicted, and it says so", () => {
    const { prepare } = mount();
    fillBasket(ARTIFACT_LIMIT);
    const before = basketIds();
    expect(before).toHaveLength(ARTIFACT_LIMIT);

    const prepared = prepare(MD_DRAFT);

    expect(saveInAct(prepared)).toBe("full");
    expect(basketIds()).toEqual(before);
  });

  it("judges fullness when it writes, so two saves back to back cannot both land past the limit", () => {
    const { prepare } = mount();
    fillBasket(ARTIFACT_LIMIT - 1);
    // Both prepared, and both saved, before anything re-renders: each one's
    // render saw a single free slot.
    const first = prepare(MD_DRAFT);
    const second = prepare({ ...MD_DRAFT, title: "second" });
    let results: readonly SaveResult[] = [];
    act(() => {
      results = [first.save(), second.save()];
    });

    expect(results).toEqual(["saved", "full"]);
    expect(artifacts()).toHaveLength(ARTIFACT_LIMIT);
    expect(artifacts()[0]?.id).toBe(first.artifact.id);
    expect(basketIds()).not.toContain(second.artifact.id);
    expect(basketIds()).toContain("f0");
  });

  it("does not remember a refusal: once there is room, the same artifact saves", () => {
    const { prepare, store } = mount();
    fillBasket(ARTIFACT_LIMIT);
    const prepared = prepare(MD_DRAFT);
    expect(saveInAct(prepared)).toBe("full");

    act(() => store.dispatch({ type: "removeArtifact", id: "f0" }));

    expect(saveInAct(prepared)).toBe("saved");
    expect(artifacts()).toHaveLength(ARTIFACT_LIMIT);
    expect(artifacts()[0]?.id).toBe(prepared.artifact.id);
  });
});

/**
 * Compile-time contract (S2 #2), checked by `tsc --noEmit` and never called.
 * Each `@ts-expect-error` line must FAIL to type-check: if the brand is removed
 * the directive becomes unused (TS2578) and tsc goes red. The last two lines
 * must PASS: a builder's plain string is exactly what `body` is for, and weak-type
 * detection rejecting it would break every producer at once.
 */
function _stampedTextCannotBeStampedAgain(
  prepare: Prepare,
  prepared: PreparedArtifact,
): void {
  // @ts-expect-error — already-stamped text fed straight back in
  prepare({ ...MD_DRAFT, body: prepared.content });
  // @ts-expect-error — the artifact's own content carries the same brand
  prepare({ ...MD_DRAFT, body: prepared.artifact.content });
  // @ts-expect-error — nor can it be smuggled through an annotated draft first
  const _smuggled: ArtifactDraft = { ...MD_DRAFT, body: prepared.content };
  prepare({ ...MD_DRAFT, body: agentTaskWrapper("a builder's plain string") });
  prepare({ ...MD_DRAFT, body: `${MD_DRAFT.title} as a template literal` });
}
