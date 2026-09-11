"use client";

import {
  createContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import type { WorkbenchProjectState } from "../types.ts";
import {
  clearProjectState,
  readProjectState,
  storageKey,
  writeProjectState,
  type WriteStatus,
} from "./persistence.ts";
import {
  initialProjectState,
  normalizeInterrupted,
  reduce,
  withProjectSeed,
  type ProjectSeed,
  type WorkbenchAction,
} from "./reducer.ts";

export type StorageMode = "ok" | "volatile" | "quota";

export interface WorkbenchContextValue {
  readonly projectId: string;
  readonly state: WorkbenchProjectState;
  readonly dispatch: Dispatch<WorkbenchAction>;
  /** False until localStorage has been read; views render skeletons meanwhile. */
  readonly ready: boolean;
  readonly storageMode: StorageMode;
  readonly keywordRowCount: number | null;
  readonly forgetProject: () => void;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Per-project mock state (design §6.5). Mount with `key={projectId}`.
 *
 * The remount is load-bearing for correctness, not merely a way to re-hydrate:
 * without it a `projectId` change would re-run the write effect with the
 * PREVIOUS render's `state` closure under the NEW key, copying one project's
 * data over another's, and `ready` / `storageMode` (including the quota and
 * volatile latches) would carry over from the project that set them. The guard
 * in the component body turns that misuse into a loud error instead of silent
 * cross-project data loss.
 *
 * Writes are suppressed until the first read completes so an SSR-shaped initial
 * state never overwrites disk.
 */
export function WorkbenchProvider({
  projectId,
  seed,
  deriveKeywordRowCount,
  children,
}: {
  readonly projectId: string;
  readonly seed: ProjectSeed;
  readonly deriveKeywordRowCount?: (state: WorkbenchProjectState) => number | null;
  readonly children: ReactNode;
}) {
  const mountedFor = useRef(projectId);
  if (mountedFor.current !== projectId) {
    throw new Error("WorkbenchProvider must be remounted with key={projectId}; it cannot switch projects in place");
  }

  const [state, dispatch] = useReducer(reduce, seed, initialProjectState);
  const [ready, setReady] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("ok");
  const storageRef = useRef<Storage | null>(null);

  function hydrate(): void {
    const storage = storageRef.current;
    if (!storage) {
      setStorageMode("volatile");
      return;
    }
    const read = readProjectState(storage, projectId);
    if (read.status === "unavailable") setStorageMode("volatile");
    if (read.state) {
      dispatch({ type: "loadPersisted", state: withProjectSeed(normalizeInterrupted(read.state), seed) });
    }
  }

  useEffect(() => {
    storageRef.current = localStorageOrNull();
    hydrate();
    setReady(true);
    // The seed is a server-rendered mirror; it cannot change without remount.
    // (No react-hooks eslint plugin in this repo, so no disable comment: one
    // would fail lint with "Definition for rule ... was not found".)
  }, [projectId]);

  // Echo write. A cross-tab `storage` event dispatches `loadPersisted` with a
  // fresh object, so this effect immediately writes the very same bytes back.
  // That terminates only because `setItem` with an identical value fires no
  // `storage` event in the other tabs. The persisted envelope must therefore
  // stay deterministic (no `savedAt`, no nonce, no re-ordered keys) or two open
  // tabs would write to each other forever.
  useEffect(() => {
    if (!ready) return;
    const storage = storageRef.current;
    // Stop writing entirely once storage is volatile or full (design §6.5).
    if (!storage || storageMode !== "ok") return;
    const status: WriteStatus = writeProjectState(storage, projectId, state);
    if (status === "quota") setStorageMode("quota");
    if (status === "unavailable") setStorageMode("volatile");
  }, [state, ready, projectId, storageMode]);

  useEffect(() => {
    function onStorage(event: StorageEvent): void {
      if (event.key !== storageKey(projectId) || !storageRef.current) return;
      const read = readProjectState(storageRef.current, projectId);
      if (read.state) {
        dispatch({ type: "loadPersisted", state: withProjectSeed(normalizeInterrupted(read.state), seed) });
      } else if (read.status === "empty") {
        // Another tab removed the key (sign-out sweep / project deletion).
        // Drop our copy too, otherwise the next state change would write the
        // user's data straight back. Going volatile as well is deliberate:
        // `reset` produces a fresh object, so the write effect would otherwise
        // re-create `gg.workbench.v1.<id>` holding the seed mirror moments
        // after sign-out, which design §6.5 says must leave nothing behind.
        // The user is signed out anyway; a reload re-hydrates normally and
        // clears the latch.
        setStorageMode("volatile");
        dispatch({ type: "reset", seed });
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId, seed]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      projectId,
      state,
      dispatch,
      ready,
      storageMode,
      keywordRowCount: deriveKeywordRowCount ? deriveKeywordRowCount(state) : null,
      forgetProject: () => {
        if (storageRef.current) clearProjectState(storageRef.current, projectId);
      },
    }),
    [projectId, state, ready, storageMode, deriveKeywordRowCount],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}
