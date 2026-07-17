import { OverviewClient } from "./_overview.tsx";

interface OverviewPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Overview screen (spec §4.2). Server component: unwrap the async `params`
 * (Next 16) and hand the project id to the client view that owns the workspace
 * query. Rendered inside the project shell layout — content only, no chrome.
 */
export default async function OverviewPage({ params }: OverviewPageProps) {
  const { projectId } = await params;
  return <OverviewClient projectId={projectId} />;
}
