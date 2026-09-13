/** @vitest-environment jsdom */

/**
 * Each profile tab's declaration speaks for its own body (Q36). The document and
 * the AI context carry GSC-derived content, so they declare the SNAPSHOT's
 * source (read the way Q6 reads it): `doc.gscSource`, frozen when the profile
 * was generated, never the project's current `gscRowsSource`. Every fixture
 * below gives the two different values, so reading the wrong one changes the
 * answer. A snapshot without GSC signals shows no GSC data and carries the
 * sample sentence. The JSON tab holds no GSC field at all, so it carries the
 * sample sentence whatever the snapshot's source.
 *
 * Declarations are the shipped sentences written out in both locales, read from
 * the final text each tab hands its actions: an md or prompt artifact's first
 * line, a json artifact's leading `_provenance` value.
 */

import { act } from "react";
import { getMessages } from "@sf/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { populatedProjectState } from "@/lib/workbench/store/test-fixtures";
import type { GscRowsSource, WorkbenchProjectState } from "@/lib/workbench/types";
import { PROFILE_TABS, type ProfileTab } from "./profile-artifact.ts";
import {
  PROFILE_SEED,
  type ProfileLocale,
  type RenderedProfile,
  must,
  renderProfile,
} from "./profile-view-test-harness.tsx";

const recorded = vi.hoisted(() => ({ prepared: [] as unknown[] }));

vi.mock("../../ui/ArtifactActions.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ui/ArtifactActions.tsx")>();
  return {
    ...actual,
    ArtifactActions: (props: Parameters<typeof actual.ArtifactActions>[0]) => {
      recorded.prepared = [...recorded.prepared, props.prepared];
      return <actual.ArtifactActions {...props} />;
    },
  };
});

const NOW = new Date(2026, 8, 13, 10, 30, 0);
const STAMP = "2026-09-13 10:30";

/** `workbench.provenance.*` as shipped, with the stamp filled in. */
const DECLARATION: Readonly<Record<ProfileLocale, Readonly<Record<"sample" | "user" | "unknown", string>>>> = {
  en: {
    sample: `Sample data: generated locally for demonstration, not measured. Generated ${STAMP}`,
    user: `Includes GSC data you imported; the rest was generated locally for demonstration, not measured. Generated ${STAMP}`,
    unknown: `Includes GSC data of unknown source; the rest was generated locally for demonstration, not measured. Generated ${STAMP}`,
  },
  "zh-CN": {
    sample: `示例数据：本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
    user: `含你导入的 GSC 数据；其余为本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
    unknown: `含来源未知的 GSC 数据；其余为本地生成的演示结果，不是真实测量；生成于 ${STAMP}`,
  },
};

const POPULATED = populatedProjectState(PROFILE_SEED);
const DOC = must(POPULATED.profileDoc);

/** A snapshot with or without GSC signals, written from `snapshot` rows, in a project whose rows are now `current`. */
function project(signals: boolean, snapshot: GscRowsSource | null, current: GscRowsSource | null): WorkbenchProjectState {
  return {
    ...POPULATED,
    profileDoc: { ...DOC, gsc: signals ? DOC.gsc : null, gscSource: snapshot },
    gscRowsSource: current,
  };
}

let rendered: RenderedProfile | null = null;

function lastContent(): string {
  return (must(recorded.prepared.at(-1)) as { readonly content: string }).content;
}

function declarationOf(tab: ProfileTab, content: string): string {
  if (tab !== "json") return must(content.split("\n")[0]);
  const parsed = JSON.parse(content) as Record<string, unknown>;
  expect(Object.keys(parsed)[0]).toBe("_provenance");
  return String(parsed["_provenance"]);
}

/** What each tab hands its actions, in tab order, clicking through them. */
function declarationsShown(state: WorkbenchProjectState, locale: ProfileLocale): readonly string[] {
  rendered?.unmount();
  const current = renderProfile(state, { locale });
  rendered = current;
  const labels = getMessages(locale).workbench.profile.tabs;
  return PROFILE_TABS.map((tab) => {
    const button = must(
      [...current.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (candidate) => candidate.textContent === labels[tab],
      ),
    );
    act(() => button.click());
    return declarationOf(tab, lastContent());
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  recorded.prepared = [];
});

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.useRealTimers();
});

describe.each(["en", "zh-CN"] as const)("the profile tabs' declaration (%s)", (locale) => {
  const line = DECLARATION[locale];
  /** `text` on the document and context tabs; the sample sentence on the JSON tab, which carries no GSC field. */
  const byTab = (text: string): readonly string[] =>
    PROFILE_TABS.map((tab) => (tab === "json" ? line.sample : text));
  const JSON_TAB = PROFILE_TABS.indexOf("json");

  it("is the sample sentence on every tab when the snapshot has no GSC signals, whatever the rows are now", () => {
    expect(declarationsShown(project(false, null, "user"), locale)).toEqual(byTab(line.sample));
  });

  it("is the sample sentence on the document and context tabs for a snapshot of the sample's rows, though real rows were imported since", () => {
    expect(declarationsShown(project(true, "sample", "user"), locale)).toEqual(byTab(line.sample));
  });

  it("names the operator's own rows on the document and context tabs for a snapshot of imported rows, though the sample's are loaded now", () => {
    expect(declarationsShown(project(true, "user", "sample"), locale)).toEqual(byTab(line.user));
  });

  it("says the source is unknown on the document and context tabs for a snapshot that recorded none, though the rows now have one", () => {
    expect(declarationsShown(project(true, null, "user"), locale)).toEqual(byTab(line.unknown));
  });

  it("is the sample sentence on the JSON tab for imported and for unrecorded rows, because its body has no GSC field", () => {
    expect(declarationsShown(project(true, "user", "user"), locale)[JSON_TAB]).toBe(line.sample);
    expect(declarationsShown(project(true, null, null), locale)[JSON_TAB]).toBe(line.sample);
  });
});

describe("the profile's declaration after generation", () => {
  it("does not change when real rows are imported over the sample's the snapshot was written from", () => {
    const state = project(true, "sample", "sample");
    rendered = renderProfile(state);
    expect(declarationOf("doc", lastContent())).toBe(DECLARATION.en.sample);
    rendered.rerender({ state: { ...state, gscRows: [...state.gscRows], gscRowsSource: "user" } });
    expect(declarationOf("doc", lastContent())).toBe(DECLARATION.en.sample);
  });
});
