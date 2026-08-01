import { ProjectSettings } from "./_settings.tsx";

interface SettingsPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { projectId } = await params;
  return <ProjectSettings projectId={projectId} />;
}
