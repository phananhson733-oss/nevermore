/**
 * The rail site card's GSC row, derived from the `useProjectSources` read.
 *
 * It answers exactly one question — has this project ever connected Search
 * Console? — with the criterion the Sources page already uses
 * (`_sources.tsx:929`, `_sources-readiness.ts:136-138`): a slot is connected
 * when it has an `id` and is not `disconnected`. `permission_denied` and
 * `unavailable` are connections whose data has gone bad, not absent
 * connections; saying "not connected" for them would send the reader to
 * reconnect a source that is already linked. Whether the data is usable is the
 * data-sources page's question and `sourceHasUsableSnapshot` is its predicate.
 *
 * Everything we cannot read is `null`, never `false`: in flight, failed (a 422
 * `CONTEXT_INCOMPLETE` included — no problem code turns into a claim here), no
 * data yet, or a response with no gsc slot at all. `false` is an assertion
 * about the customer's account; "I could not read it" is not that assertion,
 * and the card renders the two differently.
 */

import type { SourceConnection } from "@/lib/api/hooks-sources";

/** The three fields of `useProjectSources`'s result this derivation needs. */
export interface GscConnectionRead {
  readonly sources: readonly SourceConnection[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export function gscConnectionState({
  sources,
  isLoading,
  isError,
}: GscConnectionRead): boolean | null {
  // `isError` first and unconditionally: TanStack keeps the previous list
  // alongside a failed background refetch, and that list is no longer a
  // reading of the account's current state.
  if (isLoading || isError || sources === undefined) return null;
  const gsc = sources.find((source) => source.provider === "gsc");
  if (gsc === undefined) return null;
  return gsc.id !== null && gsc.state !== "disconnected";
}
