import { DiagnosisClient } from "./_diagnosis.tsx";

interface DiagnosisPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Diagnosis screen (spec §4.2, §8, §9.1). Server component: unwrap the async
 * `params` (Next 16) and hand the project id to the client view that owns the
 * findings / run queries. Rendered inside the project shell layout — content
 * only, no chrome.
 */
export default async function DiagnosisPage({ params }: DiagnosisPageProps) {
  const { projectId } = await params;
  return <DiagnosisClient projectId={projectId} />;
}
