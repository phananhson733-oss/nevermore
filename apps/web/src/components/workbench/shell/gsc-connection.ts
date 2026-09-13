/**
 * The rail site card's GSC row, derived from the `useProjectSources` read.
 *
 * It answers exactly one question — is this project connected to Search
 * Console right now? — and gives a negative answer only when the slot says so
 * explicitly. The verdict table below is enumerated, not exclusive: a state is
 * a connection because it is listed as one, never because it is "not
 * `disconnected`". An exclusion fails open — `connecting`, or any state added
 * upstream later, would start reading "connected" on its own.
 *
 * - `true`: a state listed as a connection (the Sources page's own notion,
 *   `_sources.tsx:929`) AND a connection `id`. `permission_denied` and
 *   `unavailable` are on that list: they are connections whose data has gone
 *   bad, and whether the data is usable is the data-sources page's question
 *   (`sourceHasUsableSnapshot`), not this row's.
 * - `false`: `disconnected`, and nothing else — with or without a leftover id.
 * - `null` for everything that cannot be settled:
 *   - the first read has not finished (`isLoading`);
 *   - the read failed (`isError`), including a failed refetch that still holds
 *     an older list, and including a 422 `CONTEXT_INCOMPLETE` — no problem
 *     code turns into a claim here;
 *   - there is no data (`sources === undefined`, e.g. a disabled query);
 *   - the response has no gsc slot;
 *   - the slot's state is not a finished connection (`connecting`), or is one
 *     the client's union does not know yet;
 *   - a connection state arrives with `id: null` — the two fields contradict
 *     each other, and a contradiction is not evidence of absence.
 *
 * Deliberately NOT `null`: a background refetch in flight over a successful
 * earlier read. The app's QueryClient uses stale-while-revalidate with
 * `staleTime: 30_000` (`app/providers.tsx`) as its chosen freshness; that
 * earlier reading is knowledge, and blanking the row to "—" every time sources
 * are invalidated or refetched would replace it with a false "unknown".
 */

import type { SourceConnection, SourceState } from "@/lib/api/hooks-sources";

/** The three fields of `useProjectSources`'s result this derivation needs. */
export interface GscConnectionRead {
  readonly sources: readonly SourceConnection[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

type SlotVerdict = "connection" | "disconnected" | "undetermined";

/**
 * Every `SourceState`, classified. `Record<SourceState, …>` is the exhaustive
 * guard: adding a member to the union does not compile until it is placed in
 * one of the three classes here — nothing is connected by default.
 */
const STATE_VERDICT: Readonly<Record<SourceState, SlotVerdict>> = {
  // No producer in the app today (only the DB CHECK and the type union know
  // it). Classified as undetermined so the day it gets one, an OAuth flow in
  // progress is not announced as a finished connection.
  connecting: "undetermined",
  connected: "connection",
  syncing: "connection",
  available: "connection",
  partial: "connection",
  stale: "connection",
  permission_denied: "connection",
  unavailable: "connection",
  disconnected: "disconnected",
};

function verdictFor(state: SourceState): SlotVerdict {
  // Own-property check: the server can ship a state before this union does,
  // and a name like "toString" must not find an inherited value.
  return Object.hasOwn(STATE_VERDICT, state) ? STATE_VERDICT[state] : "undetermined";
}

function slotConnection(slot: SourceConnection): boolean | null {
  const verdict = verdictFor(slot.state);
  if (verdict === "disconnected") return false;
  if (verdict === "connection" && slot.id !== null) return true;
  return null;
}

export function gscConnectionState({
  sources,
  isLoading,
  isError,
}: GscConnectionRead): boolean | null {
  // `isError` unconditionally, before the data: TanStack keeps the previous
  // list alongside a failed refetch, and that list is no longer current.
  if (isLoading || isError || sources === undefined) return null;
  const gsc = sources.find((source) => source.provider === "gsc");
  return gsc === undefined ? null : slotConnection(gsc);
}
