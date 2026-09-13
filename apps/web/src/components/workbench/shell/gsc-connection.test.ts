/**
 * The rail's GSC row answers one question — "has this project ever connected
 * Search Console?" — and must never answer a different one. Two rules carry
 * the whole file:
 *
 * 1. Q3: connected is `id !== null && state !== "disconnected"`, the criterion
 *    the Sources page itself uses (`_sources.tsx:929`,
 *    `_sources-readiness.ts:136-138`). `permission_denied` and `unavailable`
 *    are still connections; whether their data is usable is the data-sources
 *    page's question, not the site card's.
 * 2. Q4: anything we cannot read is `null`, never `false`. Rendering a failed
 *    or in-flight read as "not connected" states a fact about the customer's
 *    account that we do not have.
 *
 * Every `SourceState` is spelled out here one by one rather than looped over
 * the type: a loop over the union would absorb a newly added state silently
 * and keep reporting green. `_NoUnlistedSourceState` below is the compile-time
 * half of that — adding a tenth state fails `pnpm typecheck` until it is given
 * an expectation here.
 */

import { describe, expect, it } from "vitest";
import type {
  Provider,
  SourceConnection,
  SourceState,
} from "@/lib/api/hooks-sources";
import { gscConnectionState } from "./gsc-connection.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000042";

function source(
  provider: Provider,
  state: SourceState,
  id: string | null = "src-1",
): SourceConnection {
  return {
    id,
    projectId: PROJECT_ID,
    provider,
    connectionType: provider === "gsc" || provider === "ga4" ? "oauth" : "public",
    state,
    externalRef: null,
    scopes: [],
    connectedAt: null,
    latestSnapshot: null,
    latestMetricSummary: null,
    activeRun: null,
    limitation: "",
    featureEnabled: true,
    updatedAt: "2026-09-13T00:00:00.000Z",
  };
}

/** `{ sources, isLoading, isError }` with the settled-and-empty defaults. */
function settled(
  sources: readonly SourceConnection[],
): Parameters<typeof gscConnectionState>[0] {
  return { sources, isLoading: false, isError: false };
}

/**
 * Each `SourceState` with the answer the rail owes for it. Nine entries, one
 * per member of the union, written out by hand.
 */
const STATE_EXPECTATIONS = [
  { state: "connecting", connected: true },
  { state: "connected", connected: true },
  { state: "syncing", connected: true },
  { state: "available", connected: true },
  { state: "partial", connected: true },
  { state: "stale", connected: true },
  // Q3: a denied or unavailable connection is still a connection. The site
  // card would be lying if it said "not connected" here, and "needs
  // reconnecting" is the data-sources page's sentence to say, not this row's.
  { state: "permission_denied", connected: true },
  { state: "unavailable", connected: true },
  { state: "disconnected", connected: false },
] as const satisfies readonly { state: SourceState; connected: boolean }[];

type ListedSourceState = (typeof STATE_EXPECTATIONS)[number]["state"];
/** Compile-time: a `SourceState` with no expectation above is an error here. */
type AssertNever<T extends never> = T;
export type _NoUnlistedSourceState = AssertNever<
  Exclude<SourceState, ListedSourceState>
>;

describe("gscConnectionState: every SourceState", () => {
  for (const { state, connected } of STATE_EXPECTATIONS) {
    it(`reports ${state} as ${connected}`, () => {
      expect(gscConnectionState(settled([source("gsc", state)]))).toBe(connected);
    });
  }
});

describe("gscConnectionState: not connected", () => {
  it("is false when the slot has no connection id, whatever the state says", () => {
    // Q3's other half: the canonical slot is always returned, so a project
    // that never connected still has a `gsc` entry — with `id: null`.
    expect(gscConnectionState(settled([source("gsc", "connected", null)]))).toBe(
      false,
    );
  });

  it("reads the gsc slot, not whichever slot comes first", () => {
    expect(
      gscConnectionState(
        settled([
          source("crawl", "available"),
          source("ga4", "connected"),
          source("gsc", "disconnected"),
        ]),
      ),
    ).toBe(false);
  });

  it("is true for a connected gsc slot sitting behind other providers", () => {
    expect(
      gscConnectionState(
        settled([
          source("crawl", "available"),
          source("ga4", "disconnected"),
          source("gsc", "stale"),
        ]),
      ),
    ).toBe(true);
  });
});

describe("gscConnectionState: unknown is not 'not connected'", () => {
  it("is null while the read is in flight", () => {
    expect(
      gscConnectionState({ sources: undefined, isLoading: true, isError: false }),
    ).toBeNull();
  });

  it("is null when the read failed", () => {
    // Q4: every failure lands here — a 422 CONTEXT_INCOMPLETE included. The
    // rail never turns a failed read into a claim about the account. The
    // seam that proves a real problem+json response arrives here as `isError`
    // is `ShellChrome.test.tsx`.
    expect(
      gscConnectionState({ sources: undefined, isLoading: false, isError: true }),
    ).toBeNull();
  });

  it("is null when a stale list is still held alongside an error", () => {
    // TanStack keeps the last good data on a background refetch failure. The
    // row must not present that as current truth.
    expect(
      gscConnectionState({
        sources: [source("gsc", "connected")],
        isLoading: false,
        isError: true,
      }),
    ).toBeNull();
  });

  it("is null when the response carries no gsc slot", () => {
    expect(
      gscConnectionState(settled([source("crawl", "available"), source("ga4", "connected")])),
    ).toBeNull();
  });

  it("is null for an empty list", () => {
    expect(gscConnectionState(settled([]))).toBeNull();
  });

  it("is null when the query is disabled and never produced data", () => {
    // `useProjectSources` is `enabled: projectId.length > 0`; a disabled query
    // is neither loading nor errored and has no data.
    expect(
      gscConnectionState({ sources: undefined, isLoading: false, isError: false }),
    ).toBeNull();
  });
});
