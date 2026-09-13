import { PlaceholderView } from "@/components/workbench/views/placeholder/PlaceholderView";

export default async function WeekPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <PlaceholderView projectId={projectId} page="week" />;
}
