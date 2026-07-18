import { StudioClient } from "./_studio.tsx";

interface StudioPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Studio (execution artifacts) screen (spec §4.2, §10.1, §10.3). Server
 * component: unwrap the async `params` (Next 16) and hand the project id to the
 * client view that owns the artifact/action queries. Rendered inside the project
 * shell layout — content only, no chrome.
 */
export default async function StudioPage({ params }: StudioPageProps) {
  const { projectId } = await params;
  return <StudioClient projectId={projectId} />;
}
