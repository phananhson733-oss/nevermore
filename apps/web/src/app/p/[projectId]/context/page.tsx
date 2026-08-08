import { loadInitialConnectedGoogleProviders } from "./_initial-google-sources";
import { ProductProfilePage } from "./_product-profile";

interface ContextPageProps {
  readonly params: Promise<{ projectId: string }>;
}

export default async function ContextPage({ params }: ContextPageProps) {
  const { projectId } = await params;
  // The client page owns auth/404 handling through its API calls; this read is
  // presentational only. ProductProfileWorkspace deliberately carries no
  // connection state and the full Sources projection 422s before confirmation,
  // so without this minimal onboarding projection the page cannot tell the
  // user their setup-time GSC/GA4 connections are already in place.
  const connectedGoogleProviders =
    await loadInitialConnectedGoogleProviders(projectId, process.env);
  return (
    <ProductProfilePage
      key={projectId}
      projectId={projectId}
      connectedGoogleProviders={connectedGoogleProviders}
    />
  );
}
