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
  WORKBENCH_SWEPT_EVENT,
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

/**
 * `volatile` and `quota` are storage FAILURES, and the topbar reports them.
 * `swept` is not one: the state was discarded on purpose (sign-out sweep or
 * project deletion), so the write effect must stay armed-off exactly like
 * `volatile` while the UI says nothing. Reporting it would put a persistent
 * "results will not be saved in this browser" banner in every other open tab,
 * blaming the browser for a sign-out.
 */
export type StorageMode = "ok" | "volatile" | "quota" | "swept";

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
  // The state object most recently taken FROM storage (first hydration or a
  // cross-tab `storage` event), held by identity. The reducer's `loadPersisted`
  // returns it unchanged, so `state === remoteStateRef.current` is exactly
  // "nothing local has happened since we last read disk".
  const remoteStateRef = useRef<WorkbenchProjectState | null>(null);
  // Synchronous write gate. `setStorageMode("swept")` alone cannot stop a
  // passive write effect that is already scheduled in the same commit: the
  // state setter does not change an already-captured effect closure; the ref
  // does. `storageMode` stays for the UI.
  const writesBlockedRef = useRef(false);

  function loadFromStorage(next: WorkbenchProjectState): void {
    remoteStateRef.current = next;
    dispatch({ type: "loadPersisted", state: next });
  }

  function hydrate(): void {
    const storage = storageRef.current;
    if (!storage) {
      setStorageMode("volatile");
      return;
    }
    const read = readProjectState(storage, projectId);
    if (read.status === "unavailable") setStorageMode("volatile");
    if (read.state) loadFromStorage(withProjectSeed(normalizeInterrupted(read.state), seed));
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
    if (writesBlockedRef.current || !ready) return;
    // States that came from storage are never echoed back. This is what makes
    // cross-tab sync converge even when two tabs disagree about the seed (a
    // project renamed while one tab is stale): `withProjectSeed` re-stamps
    // `profile.url/brand/market` on each side, and echoing that would make the
    // two tabs overwrite each other forever. It also keeps a freshly opened
    // tab's hydration rollback (`normalizeInterrupted`) from being broadcast as
    // authoritative over another tab's in-flight run. The persisted envelope
    // stays deterministic, but nothing relies on that any more.
    // Residual (PR-2): after a LOCAL change this tab persists its normalised
    // copy, so a rolled-back run in another tab is still clobbered by the first
    // local edit here; true protection needs run ownership / a lease once the
    // visibility view lands.
    if (state === remoteStateRef.current) return;
    const storage = storageRef.current;
    // Stop writing entirely once storage is volatile, full, or swept (design §6.5).
    if (!storage || storageMode !== "ok") return;
    const status: WriteStatus = writeProjectState(storage, projectId, state);
    if (status === "quota") setStorageMode("quota");
    if (status === "unavailable") setStorageMode("volatile");
  }, [state, ready, projectId, storageMode]);

  useEffect(() => {
    // Drop our copy of the project and stop persisting. Latching the storage
    // mode as well is deliberate: `reset` produces a fresh object, so the write
    // effect would otherwise re-create `gg.workbench.v1.<id>` holding the seed
    // mirror moments after sign-out, which design §6.5 says must leave nothing
    // behind. The user is signed out anyway; a reload re-hydrates normally and
    // clears the latch. `swept` rather than `volatile` because nothing is wrong
    // with this browser's storage and the topbar must stay silent about it.
    // The ref gate is flipped first: a write effect already scheduled in this
    // commit still sees the old `storageMode`, and only the ref reaches it.
    function forgetAndFreeze(): void {
      writesBlockedRef.current = true;
      setStorageMode("swept");
      dispatch({ type: "reset", seed });
    }

    function onStorage(event: StorageEvent): void {
      const storage = storageRef.current;
      if (!storage) return;
      // `sessionStorage` fires the same event type; only our store matters.
      if (event.storageArea && event.storageArea !== storage) return;
      if (event.key !== null && event.key !== storageKey(projectId)) return;
      if (event.key === null || event.newValue === null) {
        // A removal (`key === null` is a whole-store clear) is a sweep by the
        // event's own evidence, NOT by re-reading the key: if this tab's write
        // effect re-created the key inside the delivery window, a re-read finds
        // our own write and the sign-out is missed for good. `clearProjectState`
        // is idempotent and removes whatever this tab resurrected.
        forgetAndFreeze();
        clearProjectState(storage, projectId);
        return;
      }
      const read = readProjectState(storage, projectId);
      if (read.state) {
        // Deliberately NOT `normalizeInterrupted`: the writing tab may be
        // mid-run, and normalising here would roll its streamed partial results
        // back to `lastVis`. Interrupted runs are settled once, on first
        // hydration, when nothing can be in flight.
        loadFromStorage(withProjectSeed(read.state, seed));
      } else if (read.status === "unavailable") {
        // Storage became unreachable between the event and the re-read; same
        // treatment as in `hydrate`. (`invalid` is ignored, as before: a shape
        // we cannot parse is no reason to throw our own state away. `empty`
        // means the key vanished after this event was queued; the removal
        // event that follows is what sweeps.)
        setStorageMode("volatile");
      }
    }

    // The sweeping document never receives its own `storage` event, so
    // `SignOutButton` announces the sweep with this synthetic one.
    function onSwept(): void {
      forgetAndFreeze();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener(WORKBENCH_SWEPT_EVENT, onSwept);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WORKBENCH_SWEPT_EVENT, onSwept);
    };
    // Primitive deps: `WorkbenchShell` builds `seed` as a fresh object literal on
    // every RSC render, and re-subscribing on identity alone buys nothing.
  }, [projectId, seed.url, seed.brand, seed.market]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      projectId,
      state,
      dispatch,
      ready,
      storageMode,
      keywordRowCount: deriveKeywordRowCount ? deriveKeywordRowCount(state) : null,
      forgetProject: () => {
        // Gate before the removal, same reasoning as `forgetAndFreeze`: a write
        // effect already scheduled in this commit, or any dispatch between this
        // call and unmount (a cross-tab `storage` event, say), would otherwise
        // re-create `gg.workbench.v1.<id>` holding the deleted project's data.
        // No `reset` dispatch here — the caller navigates away immediately, so
        // there is nothing to re-render.
        writesBlockedRef.current = true;
        setStorageMode("swept");
        if (storageRef.current) clearProjectState(storageRef.current, projectId);
      },
    }),
    [projectId, state, ready, storageMode, deriveKeywordRowCount],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}
