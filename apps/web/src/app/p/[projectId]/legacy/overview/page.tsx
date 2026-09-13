import { OverviewClient } from "./_overview.tsx";
import { loadInitialOverviewView } from "./_overview-server";

interface OverviewPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Overview screen (spec §4.2). Server component: unwrap the async `params`
 * (Next 16) and seed the client query from the canonical workspace service.
 * The request-scoped operator cache is shared with the surrounding layout, so
 * this adds no second auth lookup and never reuses identity across requests.
 */
export default async function OverviewPage({ params }: OverviewPageProps) {
  const { projectId } = await params;
  const initialView = await loadInitialOverviewView(projectId, process.env);
  if (initialView === undefined) return <OverviewClient projectId={projectId} />;
  return <OverviewClient projectId={projectId} initialView={initialView} />;
}
