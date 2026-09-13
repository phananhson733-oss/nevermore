import { PlaceholderView } from "@/components/workbench/views/placeholder/PlaceholderView";

export default async function KeywordLibraryPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <PlaceholderView projectId={projectId} page="keywordLibrary" />;
}
