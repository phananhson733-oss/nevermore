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
 * Per-project mock state (design §6.5). Mount with `key={projectId}` so a
 * project switch remounts and re-hydrates; writes are suppressed until the
 * first read completes so an SSR-shaped initial state never overwrites disk.
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
