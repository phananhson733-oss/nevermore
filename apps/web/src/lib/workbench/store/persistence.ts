import type { WorkbenchProjectState } from "../types.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";

/**
 * localStorage boundary (design §6.5). Storage is injected so the node unit
 * suite can drive it; the provider passes `window.localStorage`.
 */
/** Sign-out must not leave an older version's user data behind (design §6.5), so the sweep is version-agnostic. */
const ALL_VERSIONS_PREFIX = "gg.workbench.";
const PREFIX = `${ALL_VERSIONS_PREFIX}v${PERSISTED_VERSION}.`;

export function storageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export type ReadResult =
  | { readonly status: "ok"; readonly state: WorkbenchProjectState }
  | { readonly status: "empty" | "invalid" | "unavailable"; readonly state: null };

export type ReadStatus = ReadResult["status"];
export type WriteStatus = "ok" | "quota" | "unavailable";

export function readProjectState(storage: Storage, projectId: string): ReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(projectId));
  } catch {
    return { status: "unavailable", state: null };
  }
  if (raw === null) return { status: "empty", state: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", state: null };
  }
  const state = parsePersistedState(parsed);
  return state ? { status: "ok", state } : { status: "invalid", state: null };
}

/** Chrome/Safari/spec name, Firefox name, then the legacy numeric codes (WebKit 22, Firefox 1014). */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as { readonly name?: unknown; readonly code?: unknown };
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

export function writeProjectState(
  storage: Storage,
  projectId: string,
  state: WorkbenchProjectState,
): WriteStatus {
  try {
    storage.setItem(storageKey(projectId), JSON.stringify({ v: PERSISTED_VERSION, state }));
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
