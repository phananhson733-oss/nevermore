"use client";

import { useContext } from "react";
import type { Artifact } from "../types.ts";
import { selectCounts, type WorkbenchCounts } from "./selectors.ts";
import { WorkbenchContext, type WorkbenchContextValue } from "./WorkbenchProvider.tsx";

export function useWorkbench(): WorkbenchContextValue {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return value;
}

/** `null` before hydration so the sidebar can render skeleton badge slots. */
export function useWorkbenchCounts(): WorkbenchCounts | null {
  const { state, ready, keywordRowCount } = useWorkbench();
  return ready ? selectCounts(state, keywordRowCount) : null;
}

export function useWorkbenchArtifacts(): readonly Artifact[] {
  return useWorkbench().state.artifacts;
}
