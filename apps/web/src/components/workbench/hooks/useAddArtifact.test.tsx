/** @vitest-environment jsdom */

/**
 * Stamping happens here and nowhere else (Q23), so these tests pin the finished
 * text against the literal English provenance sentence rather than against
 * `stampArtifact` — calling the same function to build the expectation would pass
 * even if the hook stamped with the wrong key, or with the key path next-intl
 * renders when a message is missing. The store is the real provider, so `save()`
 * is checked by what ends up in the basket.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_CSV_MARKER } from "@/lib/workbench/mock/provenance";
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

interface Harness {
  readonly prepare: (draft: ArtifactDraft) => PreparedArtifact;
  readonly store: WorkbenchContextValue;
}

const captured: { prepare: Harness["prepare"] | null; store: WorkbenchContextValue | null } = {
  prepare: null,
  store: null,
};
let cleanup: (() => void) | null = null;

function Probe() {
  captured.prepare = useAddArtifact();
  captured.store = useWorkbench();
  return null;
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

beforeEach(() => {
  window.localStorage.clear();
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
    expect(csv.content).toBe(`${SAMPLE_CSV_MARKER}\n# ${LINE}\nq\nai seo\n`);

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
});
