import { OverviewView } from "@/components/workbench/views/overview/OverviewView";

export default async function OverviewPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <OverviewView projectId={projectId} />;
}
