import { notFound } from "next/navigation";
import { getOperatorContext } from "@/lib/auth/session";
import { getOnboardingGoogleSourceState } from "@/lib/services/source-connect";
import { SetupSources } from "./_setup-sources";
import { parseSetupSourceReturnParams } from "./_setup-source-flow";

interface SetupSourcesPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<
    Readonly<Record<string, string | readonly string[] | undefined>>
  >;
}

export default async function SetupSourcesPage({
  params,
  searchParams,
}: SetupSourcesPageProps) {
  const [{ projectId }, query, operator] = await Promise.all([
    params,
    searchParams,
    getOperatorContext(),
  ]);
  if (!operator) notFound();

  const state = await getOnboardingGoogleSourceState(
    { workspaceId: operator.workspaceId },
    projectId,
  );
  if (!state) notFound();

  return (
    <SetupSources
      projectId={projectId}
      initialConnectedProviders={state.connectedProviders}
      oauthReturn={parseSetupSourceReturnParams(query)}
    />
  );
}
