import { createElement } from "react";
import { ResultsClient } from "./_results.tsx";

interface ResultsPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Canonical Results destination (Slice 1, Task 8). Renders the read-only
 * prior-vs-new recheck comparison for one confirmed Action's technical
 * condition. No impact, lift, or business-outcome claims appear here.
 */
export default async function ResultsPage({ params }: ResultsPageProps) {
  const { projectId } = await params;
  return createElement(ResultsClient, { projectId });
}
