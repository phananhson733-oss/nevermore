import { DataSourcesView } from "@/components/workbench/views/data-sources/DataSourcesView";

export default async function DataSourcesPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <DataSourcesView projectId={projectId} />;
}
