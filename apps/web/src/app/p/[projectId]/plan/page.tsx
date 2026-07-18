import { PlanClient } from "./_plan.tsx";

interface PlanPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Plan screen (spec §4.2, §9.3). Server component: unwrap the async `params`
 * (Next 16) and hand the project id to the client view that owns the actions
 * query. Rendered inside the project shell layout — content only, no chrome.
 */
export default async function PlanPage({ params }: PlanPageProps) {
  const { projectId } = await params;
  return <PlanClient projectId={projectId} />;
}
