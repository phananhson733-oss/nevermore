/**
 * Context (ICP profile) route — spec §4.2. Renders inside the project shell
 * (`p/[projectId]/layout.tsx`, owned elsewhere); this page contributes only the
 * context content. The client editor owns all data fetching via TanStack Query.
 */

import { ContextForm } from "./_context-form";

interface ContextPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ContextPage({ params }: ContextPageProps) {
  const { projectId } = await params;
  return <ContextForm projectId={projectId} />;
}
