/** @vitest-environment jsdom */

/**
 * The settings page's data-sources block (T11 Step 3): the shared read-only
 * `DataSourcesPanel` under this page's own title, note and two links, driven
 * through the real `useProjectSources` with only `fetch` stubbed.
 *
 * It must offer no action: no button, no form, no input, no OAuth link. The
 * only anchors are the two links this block names, plus — when the profile is
 * not confirmed — the panel's own way out to `/context`. Hrefs are written out
 * here, not rebuilt from `routes.ts`, so a wrong segment there fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DS_MESSAGES,
  DS_PROJECT_ID,
  mountPlain,
  settle,
  snapshot,
  sourceSlot,
  sourcesOk,
  sourcesProblem,
} from "../data-sources/data-sources-test-harness.tsx";
import { SourcesSummaryBlock } from "./SourcesSummaryBlock.tsx";

const SOURCES = DS_MESSAGES.en.workbench.settings.sources;

const DATA_SOURCES_HREF = `/p/${DS_PROJECT_ID}/data-sources`;
const LEGACY_SOURCES_HREF = `/p/${DS_PROJECT_ID}/sources`;
const CONTEXT_HREF = `/p/${DS_PROJECT_ID}/context`;

let answer: () => Promise<Response> = () => new Promise<Response>(() => {});
let cleanup: (() => void) | null = null;

beforeEach(() => {
  answer = () =>
    Promise.resolve(
      sourcesOk([
        sourceSlot("gsc", "available", { latestSnapshot: snapshot() }),
        sourceSlot("ga4", "connected"),
      ]),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => answer()),
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.unstubAllGlobals();
});

async function renderBlock(): Promise<HTMLElement> {
  const mounted = mountPlain(<SourcesSummaryBlock projectId={DS_PROJECT_ID} />);
  cleanup = mounted.unmount;
  await settle();
  const found = mounted.container.querySelector<HTMLElement>("[data-wb-sources-summary]");
  if (found === null) throw new Error("no sources summary block");
  return found;
}

function hrefs(scope: ParentNode): readonly (string | null)[] {
  return [...scope.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
}

describe("SourcesSummaryBlock", () => {
  it("names the block, says it shows status only, and mounts the shared panel", async () => {
    const scope = await renderBlock();
    const headings = scope.querySelectorAll("h2");
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Data sources");
    expect(scope.getAttribute("aria-labelledby")).toBe(headings[0]?.id);
    const notes = scope.querySelectorAll("[data-wb-sources-summary-note]");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe(SOURCES.note);
    expect(scope.querySelectorAll('[data-wb-sources-panel="read"]')).toHaveLength(1);
    expect(scope.querySelectorAll('[data-wb-source="gsc"][data-wb-status="connected"]')).toHaveLength(1);
    expect(scope.querySelectorAll('[data-wb-source="ga4"][data-wb-status="connected"]')).toHaveLength(1);
  });

  it("links to the data-sources page and to the legacy sources page", async () => {
    const scope = await renderBlock();
    const toDataSources = scope.querySelectorAll(`a[href="${DATA_SOURCES_HREF}"]`);
    expect(toDataSources).toHaveLength(1);
    expect(toDataSources[0]?.textContent).toBe("Open Data sources");
    const toLegacy = scope.querySelectorAll(`a[href="${LEGACY_SOURCES_HREF}"]`);
    expect(toLegacy).toHaveLength(1);
    expect(toLegacy[0]?.textContent).toBe("Connect sources on the legacy page");
  });

  it("offers no action: the two links are its only controls", async () => {
    const scope = await renderBlock();
    expect(hrefs(scope)).toEqual([DATA_SOURCES_HREF, LEGACY_SOURCES_HREF]);
    expect(scope.querySelectorAll("button")).toHaveLength(0);
    expect(scope.querySelectorAll("form")).toHaveLength(0);
    expect(scope.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(scope.querySelectorAll("[data-wb-real-action]")).toHaveLength(0);
    expect(scope.closest("[data-wb-real-action]")).toBeNull();
  });

  it("keeps the panel's /context way out when the profile is not confirmed, and nothing else changes", async () => {
    answer = () => Promise.resolve(sourcesProblem(422, "CONTEXT_INCOMPLETE"));
    const scope = await renderBlock();
    expect(scope.querySelectorAll('[data-wb-sources-panel="needProfile"]')).toHaveLength(1);
    expect(hrefs(scope)).toEqual([DATA_SOURCES_HREF, LEGACY_SOURCES_HREF, CONTEXT_HREF]);
    expect(scope.querySelectorAll("button")).toHaveLength(0);
    expect(scope.querySelectorAll("[data-wb-real-action]")).toHaveLength(0);
  });
});
