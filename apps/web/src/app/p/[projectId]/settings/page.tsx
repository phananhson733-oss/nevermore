import { SettingsView } from "@/components/workbench/views/settings/SettingsView";

export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ readonly projectId: string }>;
}) {
  const { projectId } = await params;
  return <SettingsView projectId={projectId} />;
}
