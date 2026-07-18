import { ReportClient } from "./_report.tsx";

interface ReportPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

/**
 * Report screen (spec §4.2, §10.4). Server component: unwrap the async `params`
 * (Next 16) and hand the project id to the client view that owns the report +
 * export queries. Rendered inside the project shell layout — content only, no
 * chrome (the shell's sidebar + topbar are hidden by the print stylesheet).
 */
export default async function ReportPage({ params }: ReportPageProps) {
  const { projectId } = await params;
  return <ReportClient projectId={projectId} />;
}
