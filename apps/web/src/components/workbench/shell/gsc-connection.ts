/**
 * The rail site card's GSC row, derived from the `useProjectSources` read.
 *
 * It answers exactly one question — is this project connected to Search
 * Console right now? — and gives a negative answer only when the slot says so
 * explicitly. The verdict table below is enumerated, not exclusive: a state is
 * a connection because it is listed as one, never because it is "not
 * `disconnected`". An exclusion fails open — `connecting`, or any state added
 * upstream later, would start reading "connected" on its own. The id follows
 * the same rule: "has an id" means a non-empty string, not "is not `null`".
 *
 * The list is a server DTO the client never validates at runtime. The server
 * sends exactly one slot per provider, with a uuid id and a CHECK-constrained
 * state (`services/sources.ts`), so the malformed shapes rejected below are
 * unreachable today. They are rejected anyway: this row's contract is "cannot
 * read it => unknown", and a lookup that coerces `["connected"]` into
 * `"connected"`, or throws on a `null` entry, breaks that contract.
 *
 * - `true`: exactly one gsc slot, its state listed as a connection (the
 *   Sources page's own notion, `_sources.tsx:929`) AND its `id` a non-empty
 *   string. `permission_denied` and `unavailable` are on that list: they are
 *   connections whose data has gone bad, and whether the data is usable is the
 *   data-sources page's question (`sourceHasUsableSnapshot`), not this row's.
 * - `false`: exactly one gsc slot whose state is `disconnected`, and nothing
 *   else — with or without a leftover id.
 * - `null` for everything that cannot be settled:
 *   - the first read has not finished (`isLoading`);
 *   - the read failed (`isError`), including a failed refetch that still holds
 *     an older list, and including a 422 `CONTEXT_INCOMPLETE` — no problem
 *     code turns into a claim here;
 *   - there is no list (`sources === undefined`, e.g. a disabled query), or
 *     what arrived is not an array of objects;
 *   - the list has no gsc slot, or more than one — two slots that disagree
 *     would otherwise let their order pick the answer;
 *   - the slot's state is not a string, is not a finished connection
 *     (`connecting`), or is one the client's union does not know yet;
 *   - a connection state arrives without a usable id (`null`, missing, blank,
 *     not a string) — the two fields contradict each other, and a
 *     contradiction is not evidence of absence.
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

/** A slot as the wire delivered it: every field is read as `unknown`. */
type UnvalidatedSlot = Readonly<Record<string, unknown>>;

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

function verdictFor(state: unknown): SlotVerdict {
  // A string first: `Object.hasOwn` and the index both coerce their key, so an
  // array `["connected"]` would find "connected". Then an own-property check:
  // the server can ship a state before this union does, and a name like
  // "toString" must not find an inherited value.
  if (typeof state !== "string" || !Object.hasOwn(STATE_VERDICT, state)) {
    return "undetermined";
  }
  return STATE_VERDICT[state as SourceState];
}

function hasConnectionId(id: unknown): boolean {
  return typeof id === "string" && id.trim().length > 0;
}

function slotConnection(slot: UnvalidatedSlot): boolean | null {
  const verdict = verdictFor(slot.state);
  if (verdict === "disconnected") return false;
  if (verdict === "connection" && hasConnectionId(slot.id)) return true;
  return null;
}

function isSlotShaped(value: unknown): value is UnvalidatedSlot {
  return typeof value === "object" && value !== null;
}

/** The gsc slot, when the list is readable and holds exactly one. */
function soleGscSlot(sources: unknown): UnvalidatedSlot | null {
  if (!Array.isArray(sources) || !sources.every(isSlotShaped)) return null;
  const slots = sources.filter((source) => source.provider === "gsc");
  return slots.length === 1 ? (slots[0] ?? null) : null;
}

export function gscConnectionState({
  sources,
  isLoading,
  isError,
}: GscConnectionRead): boolean | null {
  // `isError` unconditionally, before the data: TanStack keeps the previous
  // list alongside a failed refetch, and that list is no longer current.
  if (isLoading || isError) return null;
  const gsc = soleGscSlot(sources);
  return gsc === null ? null : slotConnection(gsc);
}
