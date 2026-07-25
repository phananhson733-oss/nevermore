"use client";

/**
 * The Execution destination.
 *
 * It used to open with a "delivery chain" summary that restated, as three
 * badges, what the workspace below already showed in full — and it did so under
 * an `<h2>` that came BEFORE the page's `<h1>`, which is a heading-order defect
 * a screen reader user pays for. That summary is gone.
 *
 * What replaces it is the thing this screen was missing: the deliverable
 * itself. The Content Shadow surface renders the English draft body, what the
 * quality gate found, what it could not judge, and what this stage does not do
 * — directly under the page heading, where a reviewer reads first.
 */

import { StudioClient } from "../studio/_studio.tsx";
import { ContentShadowSection } from "./_content-shadow.tsx";
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
      afterHero={<ContentShadowSection projectId={projectId} />}
    />
  );
}
