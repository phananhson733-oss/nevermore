/**
 * The rail's GSC row answers one question — is this project connected to
 * Search Console right now? — and must never answer a different one. Three
 * rules carry the whole file:
 *
 * 1. Enumerated, not excluded. A slot is connected only when its state is one
 *    of the seven listed as a connection AND it has an `id`. The old criterion
 *    `state !== "disconnected"` failed open: `connecting`, or any state added
 *    later, silently became "connected".
 * 2. Q3: `permission_denied` and `unavailable` are still connections; whether
 *    their data is usable is the data-sources page's question.
 * 3. Q4: only an explicit `disconnected` earns "not connected". Everything we
 *    cannot settle is `null` — a state that is not a finished connection
 *    (`connecting`, or one the client has never heard of), a connected-looking
 *    state with no `id` (the two fields contradict each other), a failed or
 *    first read, no data, no gsc slot.
 *
 * Every `SourceState` is spelled out below one by one, with its answer both
 * with and without an `id`, rather than looped over the type: a loop over the
 * union would absorb a newly added state silently. `_NoUnlistedSourceState` is
 * the compile-time half — a tenth state fails `pnpm typecheck` until it is
 * given an expectation here (the production table has its own guard).
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
 * Each `SourceState` with the answer the rail owes for it: once for a slot
 * that has a connection `id`, once for a slot whose `id` is `null`. Nine
 * entries, one per member of the union, written out by hand.
 */
const STATE_EXPECTATIONS = [
  // Not a finished connection. It has no producer in the app today, which is
  // exactly why it must not inherit "connected" by default the day it gets one.
  { state: "connecting", withId: null, withoutId: null },
  { state: "connected", withId: true, withoutId: null },
  { state: "syncing", withId: true, withoutId: null },
  { state: "available", withId: true, withoutId: null },
  { state: "partial", withId: true, withoutId: null },
  { state: "stale", withId: true, withoutId: null },
  // Q3: a denied or unavailable connection is still a connection. "Needs
  // reconnecting" is the data-sources page's sentence, not this row's.
  { state: "permission_denied", withId: true, withoutId: null },
  { state: "unavailable", withId: true, withoutId: null },
  // The only negative verdict, with or without a leftover id: a past
  // connection is not a current one.
  { state: "disconnected", withId: false, withoutId: false },
] as const satisfies readonly {
  state: SourceState;
  withId: boolean | null;
  withoutId: boolean | null;
}[];

type ListedSourceState = (typeof STATE_EXPECTATIONS)[number]["state"];
/** Compile-time: a `SourceState` with no expectation above is an error here. */
type AssertNever<T extends never> = T;
export type _NoUnlistedSourceState = AssertNever<
  Exclude<SourceState, ListedSourceState>
>;

describe("gscConnectionState: every SourceState", () => {
  for (const { state, withId, withoutId } of STATE_EXPECTATIONS) {
    it(`reports ${state} with an id as ${withId}`, () => {
      expect(gscConnectionState(settled([source("gsc", state, "src-1")]))).toBe(withId);
    });

    it(`reports ${state} without an id as ${withoutId}`, () => {
      // A connected-looking state with `id: null` is a contradiction between
      // two fields, not evidence that nothing is connected (ruling 2).
      expect(gscConnectionState(settled([source("gsc", state, null)]))).toBe(withoutId);
    });
  }
});

describe("gscConnectionState: states the client does not know", () => {
  it("is null for a state the server sends before the client's union has it", () => {
    // The fail-open shape at runtime: `state !== "disconnected"` would call
    // this connected. An unknown state settles nothing.
    const unknown = "reconnecting" as unknown as SourceState;
    expect(gscConnectionState(settled([source("gsc", unknown)]))).toBeNull();
  });

  it("is null for a state that happens to be an Object.prototype key", () => {
    // Guards the table lookup itself: a plain `TABLE[state]` would find an
    // inherited function here and treat it as a verdict.
    const inherited = "toString" as unknown as SourceState;
    expect(gscConnectionState(settled([source("gsc", inherited)]))).toBeNull();
  });
});

describe("gscConnectionState: which slot", () => {
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
  it("is null on the first read, before any data exists", () => {
    expect(
      gscConnectionState({ sources: undefined, isLoading: true, isError: false }),
    ).toBeNull();
  });

  it("is null when the read failed", () => {
    // Q4: every failure lands here — a 422 CONTEXT_INCOMPLETE included. The
    // seam that proves a real problem+json response arrives here as `isError`
    // is `ShellChrome.test.tsx`.
    expect(
      gscConnectionState({ sources: undefined, isLoading: false, isError: true }),
    ).toBeNull();
  });

  it("is null when a stale list is still held alongside an error", () => {
    // TanStack keeps the last good data on a failed background refetch. The
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
