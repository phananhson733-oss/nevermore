import type { WorkbenchProjectState } from "../types.ts";
import { classifyPersistedState, PERSISTED_VERSION, type PersistedParse } from "./schema.ts";

// localStorage boundary (design §6.5). Storage is injected so the node unit
// suite can drive it; the provider passes `window.localStorage`. (Plain
// comment, not JSDoc: a second doc block would otherwise stack onto the
// declaration below and both would show up on hover.)

/** Sign-out must not leave an older version's user data behind (design §6.5), so the sweep is version-agnostic. */
const ALL_VERSIONS_PREFIX = "gg.workbench.";
const PREFIX = `${ALL_VERSIONS_PREFIX}v${PERSISTED_VERSION}.`;

export function storageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export type ReadResult =
  | { readonly status: "ok"; readonly state: WorkbenchProjectState }
  // `incompatible` (a newer build's data) is kept apart from `invalid`: the
  // caller must go read-only instead of writing over it (R14).
  | { readonly status: "empty" | "invalid" | "incompatible" | "unavailable"; readonly state: null };

/** `incompatible`: nothing was written, because the key holds a newer build's data (R14). */
export type WriteStatus = "ok" | "quota" | "unavailable" | "incompatible";

/**
 * Classifies stored bytes; unparseable JSON is `invalid`. Also used by the
 * provider on a `storage` event's `newValue`, which it classifies directly
 * instead of re-reading storage (R14).
 */
export function classifyStoredValue(raw: string): PersistedParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid" };
  }
  return classifyPersistedState(parsed);
}

export function readProjectState(storage: Storage, projectId: string): ReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(projectId));
  } catch {
    return { status: "unavailable", state: null };
  }
  if (raw === null) return { status: "empty", state: null };
  const parsed = classifyStoredValue(raw);
  return parsed.kind === "ok" ? { status: "ok", state: parsed.state } : { status: parsed.kind, state: null };
}

/** Chrome/Safari/spec name, Firefox name, then the legacy numeric codes (WebKit 22, Firefox 1014). */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as { readonly name?: unknown; readonly code?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

/**
 * Writes the envelope unless the key already holds a newer build's data (R14).
 *
 * The stored value is classified immediately before `setItem`, because another
 * tab's newer build can write between this tab's reads and its `storage` event
 * arriving here (and a tab never receives events for its own writes). On
 * `incompatible` nothing is written and the caller must go read-only. Empty,
 * readable and corrupt (`invalid`) values are written over as before: corrupt
 * bytes are not a newer build, and locking on them would strand the project.
 * A read that throws is `unavailable`, and nothing is written.
 *
 * Residual: the read and the `setItem` are two calls, not a cross-tab
 * transaction; a newer build's write landing between them is replaced once.
 *
 * Cost: one extra read and parse per write, measured at about the cost of the
 * `JSON.stringify` the write already pays (about 1.4 ms for a 4.4 MB envelope,
 * near the storage quota; well under 1 ms at typical sizes).
 */
export function writeProjectState(
  storage: Storage,
  projectId: string,
  state: WorkbenchProjectState,
): WriteStatus {
  const key = storageKey(projectId);
  try {
    const stored = storage.getItem(key);
    if (stored !== null && classifyStoredValue(stored).kind === "incompatible") return "incompatible";
    storage.setItem(key, JSON.stringify({ v: PERSISTED_VERSION, state }));
    return "ok";
  } catch (error) {
    return isQuotaError(error) ? "quota" : "unavailable";
  }
}

export function clearProjectState(storage: Storage, projectId: string): void {
  try {
    storage.removeItem(storageKey(projectId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/**
 * Dispatched on `window` by the tab that just ran `clearAllWorkbenchState`.
 * The DOM `storage` event only reaches OTHER documents, so the sweeping tab has
 * to announce itself or its own provider would keep (and re-persist) the state
 * that was just wiped.
 */
export const WORKBENCH_SWEPT_EVENT = "gg.workbench.swept";

export function clearAllWorkbenchState(storage: Storage): void {
  const keys: string[] = [];
  try {
    // Collect first, remove after: removing inside the loop shifts every later index.
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(ALL_VERSIONS_PREFIX)) keys.push(key);
    }
  } catch {
    // Storage unavailable: there is nothing persisted to clear.
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Best effort: one key refusing to go must not strand the others.
    }
  }
}
