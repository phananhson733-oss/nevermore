/**
 * Context (ICP profile) route — spec §4.2. Renders inside the project shell
 * (`p/[projectId]/layout.tsx`, owned elsewhere); this page contributes only the
 * context content. The canonical profile is read on the server so the editor's
 * first paint is complete; TanStack Query takes over cache/update semantics in
 * the client component.
 */

import { ContextForm } from "./_context-form";
import { loadInitialContext } from "./_initial-context";

interface ContextPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ContextPage({ params }: ContextPageProps) {
  const { projectId } = await params;
  const initialProfile = await loadInitialContext(projectId);
  if (initialProfile === undefined) {
    return <ContextForm key={projectId} projectId={projectId} />;
  }
  return (
    <ContextForm
      key={projectId}
      projectId={projectId}
      initialProfile={initialProfile}
    />
  );
}
