import type { WorkbenchProjectState } from "../types.ts";
import { PERSISTED_VERSION, parsePersistedState } from "./schema.ts";

/**
 * localStorage boundary (design §6.5). Storage is injected so the node unit
 * suite can drive it; the provider passes `window.localStorage`.
 */
const PREFIX = `gg.workbench.v${PERSISTED_VERSION}.`;

export function storageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export type ReadStatus = "ok" | "empty" | "invalid" | "unavailable";
export type WriteStatus = "ok" | "quota" | "unavailable";

export function readProjectState(
  storage: Storage,
  projectId: string,
): { readonly status: ReadStatus; readonly state: WorkbenchProjectState | null } {
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

export function writeProjectState(
  storage: Storage,
  projectId: string,
  state: WorkbenchProjectState,
): WriteStatus {
  try {
    storage.setItem(storageKey(projectId), JSON.stringify({ v: PERSISTED_VERSION, state }));
    return "ok";
  } catch (error) {
    return error instanceof Error && error.name === "QuotaExceededError" ? "quota" : "unavailable";
  }
}

export function clearProjectState(storage: Storage, projectId: string): void {
  try {
    storage.removeItem(storageKey(projectId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function clearAllWorkbenchState(storage: Storage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Storage unavailable: there is nothing persisted to clear.
  }
}
