"use client";

/**
 * The Execution destination. Studio owns the single deliverable queue and
 * working canvas; Content Shadow is opened inside that canvas for the selected
 * English draft instead of rendering a second, competing workspace.
 */

import { StudioClient } from "../studio/_studio.tsx";
import type { ExecutionDeepLink } from "./_execution-deep-link.ts";

export function ExecutionClient({
  projectId,
  initialDeepLink,
}: {
  readonly projectId: string;
  readonly initialDeepLink: ExecutionDeepLink;
}) {
  return (
    <StudioClient
      projectId={projectId}
      initialDeepLink={initialDeepLink}
    />
  );
}
