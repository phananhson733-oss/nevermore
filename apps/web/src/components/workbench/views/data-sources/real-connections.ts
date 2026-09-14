/**
 * The data-sources page's read-only model of the project's real connections
 * (T10 Step 1): `useProjectSources`' result in, what the page may say out. No
 * connect / disconnect lives anywhere near it — OAuth stays on the legacy
 * `sources` page, whose callback redirects there (Q1).
 *
 * Request states, in the order they are decided:
 *
 * - `isError` first, whatever list is still cached: TanStack keeps the previous
 *   list beside a failed refetch, and that list is no longer current (the rail
 *   site card makes the same call, `shell/gsc-connection.ts`).
 * - The failure is judged by the problem's `code`, never by its status (Q4).
 *   `CONTEXT_INCOMPLETE` is the one cause the page can name and fix (confirm the
 *   product profile; `listProjectSources` throws it before reading anything).
 *   Every other failure — another 422, a 500, a timeout, a thrown non-API error
 *   — is `failed`, which the page renders without naming a cause.
 * - `isLoading`: the first read has not settled; the page renders a skeleton.
 *
 * Per provider (GSC and GA4 only; crawl / csv / dataforseo are not this page's):
 *
 * - `slot: null` unless the list is an array of objects holding exactly ONE slot
 *   for that provider. Nothing below a missing or ambiguous slot is known, so
 *   there is no state and no snapshot to show.
 * - `status` is the rail site card's verdict (Q3), applied to that one slot:
 *   `gscConnectionState` is handed the slot alone, relabelled `gsc` because that
 *   is the provider it looks for; it reads only `state` and `id`. Reusing it
 *   rather than copying its table is the point — two tables would drift, and a
 *   page and a rail card that disagree about one connection are both wrong to
 *   someone. `true` → connected, `false` → notConnected, `null` → unknown.
 * - `state`: the slot's `SourceState` when the client knows it, else `null`.
 *   This is where "connected but permission denied" becomes visible; the rail
 *   card deliberately does not say it.
 * - `snapshot: null` only when the slot says `latestSnapshot: null` (no
 *   snapshot). Anything else that is not a readable object becomes facts that
 *   are all `null` — unreadable is unknown, not absent. Each fact is `null`
 *   unless it reads cleanly: a listed availability, an ISO timestamp with an
 *   offset whose date is on the calendar and whose clock fields are in range
 *   (`Date.parse` rolls 2026-02-30 over into March, so it cannot be the judge),
 *   a non-negative safe integer (0 stays 0), a non-blank limitation.
 *
 * 一旦本文件被更新，务必更新开头注释
 */
import { ApiError } from "@/lib/api/client";
import type { Availability, SourceConnection, SourceState } from "@/lib/api/hooks-sources";
import { gscConnectionState } from "../../shell/gsc-connection.ts";

export const REAL_PROVIDERS = ["gsc", "ga4"] as const;

export type RealProvider = (typeof REAL_PROVIDERS)[number];

export type ConnectionStatus = "connected" | "notConnected" | "unknown";

export interface RealConnectionsRead {
  readonly sources: readonly SourceConnection[] | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

export interface SnapshotFacts {
  readonly availability: Availability | null;
  readonly capturedAt: string | null;
  readonly rowCount: number | null;
  readonly limitation: string | null;
}

export interface ProviderSlot {
  readonly state: SourceState | null;
  /** `null`: the slot says there is no snapshot. */
  readonly snapshot: SnapshotFacts | null;
}

export interface ProviderView {
  readonly status: ConnectionStatus;
  /** `null`: no single readable slot for this provider. */
  readonly slot: ProviderSlot | null;
}

export type RealConnectionsView =
  | { readonly kind: "loading" }
  | { readonly kind: "needProfile" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly gsc: ProviderView; readonly ga4: ProviderView };

const CONTEXT_INCOMPLETE = "CONTEXT_INCOMPLETE";

/** Exhaustive over the union: a new member does not compile until it is listed. */
const SOURCE_STATES: Readonly<Record<SourceState, true>> = {
  connecting: true,
  connected: true,
  syncing: true,
  available: true,
  partial: true,
  stale: true,
  permission_denied: true,
  unavailable: true,
  disconnected: true,
};

const AVAILABILITIES: Readonly<Record<Availability, true>> = { available: true, partial: true, unavailable: true };

/** An offset or `Z` is required: a bare date string would be read in whatever zone the browser is in. */
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

type UnvalidatedSlot = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnvalidatedSlot {
  return typeof value === "object" && value !== null;
}

/** A string that is an own key of `table`; `Object.hasOwn` so "toString" finds nothing. */
function listed<K extends string>(table: Readonly<Record<K, true>>, value: unknown): K | null {
  return typeof value === "string" && Object.hasOwn(table, value) ? (value as K) : null;
}

function soleSlot(sources: unknown, provider: RealProvider): UnvalidatedSlot | null {
  if (!Array.isArray(sources) || !sources.every(isObject)) return null;
  const slots = sources.filter((source) => source.provider === provider);
  return slots.length === 1 ? (slots[0] ?? null) : null;
}

function statusOf(slot: UnvalidatedSlot): ConnectionStatus {
  const relabelled = [{ ...slot, provider: "gsc" }] as unknown as readonly SourceConnection[];
  const verdict = gscConnectionState({ sources: relabelled, isLoading: false, isError: false });
  if (verdict === null) return "unknown";
  return verdict ? "connected" : "notConnected";
}

/** Day 0 of the next month is the last day of this one; `setUTCFullYear` keeps years below 100 as written. */
function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_TIMESTAMP.exec(value);
  if (match === null) return null;
  // Absent seconds and a `Z` offset read as 0.
  const field = (index: number): number => Number(match[index] ?? "0");
  const month = field(2);
  const day = field(3);
  const onCalendar = month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(field(1), month);
  const onClock = field(4) <= 23 && field(5) <= 59 && field(6) <= 59 && field(7) <= 23 && field(8) <= 59;
  return onCalendar && onClock ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function snapshotFacts(value: unknown): SnapshotFacts | null {
  if (value === null) return null;
  const snapshot: UnvalidatedSlot = isObject(value) ? value : {};
  const { limitation } = snapshot;
  return {
    availability: listed(AVAILABILITIES, snapshot.availability),
    capturedAt: timestamp(snapshot.capturedAt),
    rowCount: count(snapshot.rowCount),
    limitation: typeof limitation === "string" && limitation.trim() !== "" ? limitation : null,
  };
}

function providerView(sources: unknown, provider: RealProvider): ProviderView {
  const slot = soleSlot(sources, provider);
  if (slot === null) return { status: "unknown", slot: null };
  return {
    status: statusOf(slot),
    slot: { state: listed(SOURCE_STATES, slot.state), snapshot: snapshotFacts(slot.latestSnapshot) },
  };
}

export function realConnectionsView({ sources, isLoading, isError, error }: RealConnectionsRead): RealConnectionsView {
  if (isError) {
    return error instanceof ApiError && error.code === CONTEXT_INCOMPLETE ? { kind: "needProfile" } : { kind: "failed" };
  }
  if (isLoading) return { kind: "loading" };
  return { kind: "read", gsc: providerView(sources, "gsc"), ga4: providerView(sources, "ga4") };
}
