import { SourcesClient } from "./_sources.tsx";

interface SourcesPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Sources screen (spec §4.2, §7). Server component: unwrap the async `params`
 * (Next 16) and hand the project id to the client view that owns the source,
 * snapshot, and run queries. Rendered inside the project shell layout — content
 * only, no chrome.
 */
export default async function SourcesPage({ params }: SourcesPageProps) {
  const { projectId } = await params;
  return <SourcesClient projectId={projectId} />;
}
